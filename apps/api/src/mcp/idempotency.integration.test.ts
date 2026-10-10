import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { IDb, ITransactionalDb } from "../db.js";
import { duplicateDatasetPayload } from "../routes/datasets.js";
import { duplicatePromptVersionPayload } from "../routes/prompts.js";
import { withMcpIdempotency } from "./idempotency.js";

// Opt in with a disposable migrated PostgreSQL database. All fixtures use a
// fresh synthetic tenant, and no provider or storage calls are made.
const databaseUrl = process.env.MOSAIC_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("MCP copy idempotency (PostgreSQL)", () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const teamId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const datasetId = randomUUID();
    const datasetItemId = randomUUID();
    const promptId = randomUUID();
    const schemaVersionId = randomUUID();
    const validationAttemptId = randomUUID();
    const promptVersionId = randomUUID();

    const db: ITransactionalDb = {
        query: (text, values) => pool.query(text, values),
        async transaction<T>(run: (tx: IDb) => Promise<T>): Promise<T> {
            const client = await pool.connect();
            try {
                await client.query("begin");
                const result = await run({
                    query: (text, values) => client.query(text, values),
                });
                await client.query("commit");
                return result;
            } catch (error) {
                await client.query("rollback");
                throw error;
            } finally {
                client.release();
            }
        },
    };

    beforeAll(async () => {
        await pool.query("insert into teams(id,name) values($1,$2)", [
            teamId,
            `MCP idempotency ${teamId}`,
        ]);
        await pool.query(
            "insert into users(id,team_id,email) values($1,$2,$3)",
            [userId, teamId, `${userId}@example.invalid`],
        );
        await pool.query(
            "insert into projects(id,team_id,name) values($1,$2,$3)",
            [projectId, teamId, `MCP idempotency ${projectId}`],
        );
        await pool.query(
            `insert into datasets(id,team_id,project_id,name,purpose,modality,created_by)
             values($1,$2,$3,'Idempotency source','golden','text',$4)`,
            [datasetId, teamId, projectId, userId],
        );
        await pool.query(
            `insert into dataset_schemas(dataset_id,json_schema,field_rules)
             values($1,'{"type":"object"}'::jsonb,'[]'::jsonb)`,
            [datasetId],
        );
        await pool.query(
            `insert into dataset_items(id,dataset_id,type,input_text)
             values($1,$2,'text','synthetic input')`,
            [datasetItemId, datasetId],
        );
        await pool.query(
            `insert into labels(dataset_item_id,label_json)
             values($1,'{"answer":"synthetic"}'::jsonb)`,
            [datasetItemId],
        );

        await pool.query(
            `insert into prompts(id,team_id,project_id,name,kind,target_model_id)
             values($1,$2,$3,'Idempotency prompt','eval','synthetic-model')`,
            [promptId, teamId, projectId],
        );
        await pool.query(
            `insert into prompt_schema_versions(
                id,prompt_id,version,json_schema,field_configs,schema_hash,
                openai_compatible,compatibility_errors,created_by
             ) values($1,$2,1,'{"type":"object"}'::jsonb,'[]'::jsonb,
                'synthetic-schema-hash',false,'[]'::jsonb,$3)`,
            [schemaVersionId, promptId, userId],
        );
        await pool.query(
            `insert into prompt_validation_attempts(
                id,team_id,project_id,prompt_id,schema_version_id,target_model_id,
                status,schema_hash,evidence,raw_output,parsed_output,latency_ms,created_by
             ) values($1,$2,$3,$4,$5,'synthetic-model','passed',
                'synthetic-schema-hash','{}'::jsonb,'{"answer":"synthetic"}',
                '{"answer":"synthetic"}'::jsonb,1,$6)`,
            [
                validationAttemptId,
                teamId,
                projectId,
                promptId,
                schemaVersionId,
                userId,
            ],
        );
        await pool.query(
            `insert into prompt_versions(
                id,prompt_id,version,content,schema_version_id,status,
                validation_attempt_id,created_by
             ) values($1,$2,1,'Synthetic prompt',$3,'runnable',$4,$5)`,
            [
                promptVersionId,
                promptId,
                schemaVersionId,
                validationAttemptId,
                userId,
            ],
        );
    });

    afterAll(async () => {
        try {
            await pool.query(
                `delete from prompt_version_fit_tags where prompt_version_id in
                    (select id from prompt_versions where prompt_id in
                        (select id from prompts where team_id=$1))`,
                [teamId],
            );
            await pool.query(
                "delete from prompt_versions where prompt_id in (select id from prompts where team_id=$1)",
                [teamId],
            );
            await pool.query(
                "delete from prompt_validation_attempts where team_id=$1",
                [teamId],
            );
            await pool.query(
                "delete from prompt_schema_versions where prompt_id in (select id from prompts where team_id=$1)",
                [teamId],
            );
            await pool.query("delete from prompts where team_id=$1", [teamId]);
            await pool.query(
                "delete from labels where dataset_item_id in (select id from dataset_items where dataset_id in (select id from datasets where team_id=$1))",
                [teamId],
            );
            await pool.query(
                "delete from dataset_schemas where dataset_id in (select id from datasets where team_id=$1)",
                [teamId],
            );
            await pool.query(
                "delete from dataset_items where dataset_id in (select id from datasets where team_id=$1)",
                [teamId],
            );
            await pool.query("delete from datasets where team_id=$1", [teamId]);
            await pool.query("delete from projects where team_id=$1", [teamId]);
            await pool.query("delete from users where team_id=$1", [teamId]);
            await pool.query("delete from teams where id=$1", [teamId]);
        } finally {
            await pool.end();
        }
    });

    it("returns one created dataset across concurrent calls and a lost-response retry", async () => {
        const request = { teamId, projectId, datasetId, createdBy: userId };
        const call = () =>
            withMcpIdempotency(
                db,
                {
                    teamId,
                    operation: "duplicate_dataset",
                    idempotencyKey: "same-dataset-copy-intent",
                    request,
                },
                (tx) => duplicateDatasetPayload(tx, request),
            );

        const firstResponse = await call();
        const concurrentResponses = await Promise.all(
            Array.from({ length: 6 }, call),
        );
        // Discard the first response to model a lost HTTP/MCP reply, then retry.
        const retryResponse = await call();
        expect(firstResponse.createdDatasetId).not.toBe(datasetId);
        expect(retryResponse).toEqual(firstResponse);
        expect(concurrentResponses).toEqual(
            concurrentResponses.map(() => firstResponse),
        );
        const copies = await pool.query<{ count: number }>(
            "select count(*)::int as count from datasets where team_id=$1 and name='Copy of Idempotency source'",
            [teamId],
        );
        expect(copies.rows[0]?.count).toBe(1);
    });

    it("returns one created prompt and version across concurrent calls and retries", async () => {
        const request = {
            teamId,
            projectId,
            sourcePromptVersionId: promptVersionId,
            createdBy: userId,
        };
        const call = () =>
            withMcpIdempotency(
                db,
                {
                    teamId,
                    operation: "duplicate_prompt_version",
                    idempotencyKey: "same-prompt-copy-intent",
                    request,
                },
                (tx) => duplicatePromptVersionPayload(tx, request),
            );

        const firstResponse = await call();
        const concurrentResponses = await Promise.all(
            Array.from({ length: 6 }, call),
        );
        const retryResponse = await call();
        expect(firstResponse.promptId).not.toBe(promptId);
        expect(firstResponse.promptVersionId).not.toBe(promptVersionId);
        expect(retryResponse).toEqual(firstResponse);
        expect(concurrentResponses).toEqual(
            concurrentResponses.map(() => firstResponse),
        );
        const copies = await pool.query<{ count: number }>(
            "select count(*)::int as count from prompts where team_id=$1 and name='Idempotency prompt copy'",
            [teamId],
        );
        expect(copies.rows[0]?.count).toBe(1);
    });
});
