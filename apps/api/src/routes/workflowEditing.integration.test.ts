import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
    ICreateWorkflowRequest,
    IPromptWorkflow,
    IWorkflowNodeInput,
} from "@mosaic/api-contract";
import type { IDb, ITransactionalDb } from "../db.js";
import { ApiConflictError, ApiNotFoundError } from "../errors.js";
import {
    createWorkflowPayload,
    deleteWorkflowPayload,
    selectWorkflowLlmModelPayload,
    updateWorkflowPayload,
    workflowDetailPayload,
} from "./workflows.js";

// Opt in with a disposable, migrated PostgreSQL database. Fixtures have their
// own tenant. Immutable routing history remains until the database is discarded;
// only mutable workflows are removed afterward. No provider calls are made.
const databaseUrl = process.env.MOSAIC_TEST_DATABASE_URL;

describe.skipIf(!databaseUrl)("workflow edit locking (PostgreSQL)", () => {
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 5 });
    const teamId = randomUUID();
    const projectId = randomUUID();
    const userId = randomUUID();
    const capabilityId = randomUUID();
    const providerKeyId = randomUUID();
    const rotationVersion = randomUUID();
    const routeVersions = [randomUUID(), randomUUID()];
    const scope = { teamId, projectId };
    const db = database();

    function database(
        hooks: {
            before?: (sql: string, pid: number) => void;
            after?: (sql: string) => Promise<void>;
        } = {},
    ): ITransactionalDb {
        return {
            query: (sql, values) => pool.query(sql, values),
            async transaction(run) {
                const client = await pool.connect();
                try {
                    await client.query("begin");
                    const pid = (
                        await client.query<{ pid: number }>(
                            "select pg_backend_pid() as pid",
                        )
                    ).rows[0]!.pid;
                    const tx: IDb = {
                        async query(sql, values) {
                            hooks.before?.(sql, pid);
                            const result = await client.query(sql, values);
                            await hooks.after?.(sql);
                            return result;
                        },
                    };
                    const result = await run(tx);
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
    }

    beforeAll(async () => {
        await pool.query(
            "insert into teams(id,name) values($1,'Workflow edit regression')",
            [teamId],
        );
        await pool.query(
            "insert into users(id,team_id,email) values($1,$2,$3)",
            [userId, teamId, `${userId}@example.invalid`],
        );
        await pool.query(
            "insert into projects(id,team_id,name) values($1,$2,'Workflow edit regression')",
            [projectId, teamId],
        );
        await pool.query(
            `insert into llm_capability_versions(id,team_id,project_id,transport,capability_digest,capability_snapshot,captured_at,expires_at)
            values($1,$2,$3,'openai',$4,'{}',now(),now()+interval '1 day')`,
            [capabilityId, teamId, projectId, randomUUID()],
        );
        await pool.query(
            `insert into provider_keys(id,team_id,provider,ciphertext,iv,auth_tag,hint,rotation_version)
             values($1,$2,'openai','unused-synthetic-ciphertext','unused-iv','unused-tag','test-only',$3)`,
            [providerKeyId, teamId, rotationVersion],
        );
        for (const [index, versionId] of routeVersions.entries()) {
            const routeId = randomUUID();
            await pool.query(
                "insert into llm_routes(id,team_id,project_id,name) values($1,$2,$3,$4)",
                [routeId, teamId, projectId, `Route ${index}`],
            );
            await pool.query(
                `insert into llm_route_versions(id,team_id,project_id,route_id,version,config,provider_key_id,provider_key_rotation_version,capability_version_id)
                values($1,$2,$3,$4,1,$5,$6,$7,$8)`,
                [
                    versionId,
                    teamId,
                    projectId,
                    routeId,
                    {
                        transportConfig: { transport: "openai" },
                        modelId: index === 0 ? "gpt-4o-mini" : "gpt-4o",
                        generation: { maxOutputTokens: 128 },
                        structuredOutput: { mode: "text" },
                        retry: {
                            owner: "mosaic",
                            maxAttempts: 1,
                            timeoutMs: 1000,
                            retryableErrorClasses: ["timeout"],
                        },
                        cache: {
                            mosaicReuse: "allow",
                            providerCaching: "allow",
                        },
                    },
                    providerKeyId,
                    rotationVersion,
                    capabilityId,
                ],
            );
        }
    });

    afterAll(async () => {
        try {
            await pool.query("delete from prompt_workflows where team_id=$1", [
                teamId,
            ]);
        } finally {
            await pool.end();
        }
    });

    function graph(): ICreateWorkflowRequest {
        return {
            ...scope,
            createdBy: userId,
            name: "Concurrent edits",
            kind: "multi",
            nodes: [
                {
                    nodeKey: "input",
                    label: "Input",
                    nodeType: "input",
                    nodeConfig: { type: "input", modality: "text" },
                    evalConfig: { type: "none" },
                },
                {
                    nodeKey: "llm",
                    label: "Text",
                    nodeType: "llm_text",
                    nodeConfig: {
                        type: "llm_text",
                        promptText: "Reply briefly",
                    },
                    modelId: "gpt-4o-mini",
                    evalConfig: { type: "none" },
                },
                {
                    nodeKey: "judge",
                    label: "Judge",
                    nodeType: "judge",
                    nodeConfig: {
                        type: "judge",
                        rubricPrompt: "Score quality",
                    },
                    modelId: "gpt-4o-mini",
                    evalConfig: { type: "none" },
                },
            ],
            edges: [
                {
                    fromNodeKey: "input",
                    toNodeKey: "llm",
                    carryOriginalInput: false,
                },
                {
                    fromNodeKey: "llm",
                    toNodeKey: "judge",
                    carryOriginalInput: true,
                },
            ],
        };
    }

    function select(workflowId: string, nodeKey: string, index = 0) {
        return {
            ...scope,
            workflowId,
            nodeKey,
            routeVersionId: routeVersions[index]!,
        };
    }

    // Pause the first transaction after its actual PostgreSQL row lock, then
    // start a second writer and prove PostgreSQL has blocked it on that lock.
    // The hooks arrange timing only; the database implements all locking.
    async function overlap<A, B>(
        first: (db: ITransactionalDb) => Promise<A>,
        second: (db: ITransactionalDb) => Promise<B>,
    ): Promise<[PromiseSettledResult<A>, PromiseSettledResult<B>]> {
        const entered = deferred<void>();
        const release = deferred<void>();
        const contender = deferred<number>();
        const isLock = (sql: string) =>
            (sql.includes("from prompt_workflows") &&
                sql.endsWith("for update")) ||
            sql.includes("update prompt_workflows set archived_at = now()");
        const a = first(
            database({
                after: async (sql) => {
                    if (isLock(sql)) {
                        entered.resolve();
                        await release.promise;
                    }
                },
            }),
        );
        void a.catch(() => undefined);
        let b: Promise<B> | undefined;
        try {
            await deadline(entered.promise);
            b = second(
                database({
                    before: (sql, pid) => {
                        if (isLock(sql)) contender.resolve(pid);
                    },
                }),
            );
            // Attach rejection handlers before releasing either operation.
            const results = Promise.allSettled([a, b]);
            const pid = await deadline(contender.promise);
            await deadline(
                (async () => {
                    const expires = Date.now() + 4500;
                    while (Date.now() < expires) {
                        const row = (
                            await pool.query<{ blocked: boolean }>(
                                "select cardinality(pg_blocking_pids($1)) > 0 as blocked",
                                [pid],
                            )
                        ).rows[0]!;
                        if (row.blocked) return;
                        await new Promise<void>((resolve) =>
                            setImmediate(resolve),
                        );
                    }
                    throw new Error(
                        "PostgreSQL did not block the concurrent writer",
                    );
                })(),
            );
            release.resolve();
            return await results;
        } finally {
            release.resolve();
            await Promise.allSettled(b ? [a, b] : [a]);
        }
    }

    it("preserves both concurrent node selections and all node/edge identities", async () => {
        const before = await createWorkflowPayload(db, graph());
        const results = await overlap(
            (tx) => selectWorkflowLlmModelPayload(tx, select(before.id, "llm")),
            (tx) =>
                selectWorkflowLlmModelPayload(
                    tx,
                    select(before.id, "judge", 1),
                ),
        );
        expect(results.map((r) => r.status)).toEqual([
            "fulfilled",
            "fulfilled",
        ]);
        const after = await workflowDetailPayload(
            db,
            teamId,
            projectId,
            before.id,
        );
        expect(after.nodes.map((n) => n.id)).toEqual(
            before.nodes.map((n) => n.id),
        );
        expect(after.edges).toEqual(before.edges);
        expect(
            after.nodes.find((n) => n.nodeKey === "llm")?.llmExecutionSelection,
        ).toEqual({ mode: "pinned_route", routeVersionId: routeVersions[0] });
        expect(
            after.nodes.find((n) => n.nodeKey === "judge")
                ?.llmExecutionSelection,
        ).toEqual({ mode: "pinned_route", routeVersionId: routeVersions[1] });
    });

    it("reads a whole-graph replacement only after waiting for its lock", async () => {
        const input = graph();
        const before = await createWorkflowPayload(db, input);
        const results = await overlap(
            (tx) =>
                updateWorkflowPayload(tx, {
                    ...input,
                    workflowId: before.id,
                    name: "Renamed",
                    nodes: input.nodes.map((node) => ({
                        ...node,
                        label: `Updated ${node.label}`,
                    })),
                }),
            (tx) => selectWorkflowLlmModelPayload(tx, select(before.id, "llm")),
        );
        expect(results.map((r) => r.status)).toEqual([
            "fulfilled",
            "fulfilled",
        ]);
        const after = await workflowDetailPayload(
            db,
            teamId,
            projectId,
            before.id,
        );
        expect(after.name).toBe("Renamed");
        expect(
            after.nodes.every((node) => node.label.startsWith("Updated ")),
        ).toBe(true);
        expect(
            after.nodes.find((n) => n.nodeKey === "llm")?.llmExecutionSelection
                ?.mode,
        ).toBe("pinned_route");
    });

    it("reports a conflict if a concurrent graph replacement removes the target", async () => {
        const input = graph();
        const before = await createWorkflowPayload(db, input);
        const results = await overlap(
            (tx) =>
                updateWorkflowPayload(tx, {
                    ...input,
                    workflowId: before.id,
                    nodes: input.nodes.slice(0, 2),
                    edges: input.edges.slice(0, 1),
                }),
            (tx) =>
                selectWorkflowLlmModelPayload(tx, select(before.id, "judge")),
        );
        expect(results[0].status).toBe("fulfilled");
        expect(results[1]).toMatchObject({
            status: "rejected",
            reason: expect.any(ApiConflictError),
        });
        if (results[1].status === "rejected")
            expect(results[1].reason.message).toContain("Reload the workflow");
    });

    it("waits for a concurrent archive, then rejects the edit without restoring nodes", async () => {
        const before = await createWorkflowPayload(db, graph());
        const results = await overlap(
            (store) =>
                store.transaction((tx) =>
                    deleteWorkflowPayload(tx, {
                        ...scope,
                        workflowId: before.id,
                    }),
                ),
            (tx) => selectWorkflowLlmModelPayload(tx, select(before.id, "llm")),
        );
        expect(results[0].status).toBe("fulfilled");
        expect(results[1]).toMatchObject({
            status: "rejected",
            reason: expect.any(ApiNotFoundError),
        });
        const nodes = await pool.query(
            "select llm_route_version_id from workflow_nodes where workflow_id=$1",
            [before.id],
        );
        expect(
            nodes.rows.every((node) => node.llm_route_version_id === null),
        ).toBe(true);
    });

    it("rejects foreign, unavailable and disabled route versions without changing the graph", async () => {
        const before = await createWorkflowPayload(db, graph());
        const foreignProjectId = randomUUID();
        const foreignCapabilityId = randomUUID();
        const foreignRouteId = randomUUID();
        const foreignVersionId = randomUUID();
        await pool.query(
            "insert into projects(id,team_id,name) values($1,$2,'Other route project')",
            [foreignProjectId, teamId],
        );
        await pool.query(
            `insert into llm_capability_versions(id,team_id,project_id,transport,capability_digest,capability_snapshot,captured_at,expires_at)
            values($1,$2,$3,'openai',$4,'{}',now(),now()+interval '1 day')`,
            [foreignCapabilityId, teamId, foreignProjectId, randomUUID()],
        );
        await pool.query(
            "insert into llm_routes(id,team_id,project_id,name) values($1,$2,$3,'Foreign route')",
            [foreignRouteId, teamId, foreignProjectId],
        );
        await pool.query(
            `insert into llm_route_versions(id,team_id,project_id,route_id,version,config,provider_key_id,provider_key_rotation_version,capability_version_id)
            select $1,team_id,$2,$3,1,config,provider_key_id,provider_key_rotation_version,$4
            from llm_route_versions where id=$5`,
            [
                foreignVersionId,
                foreignProjectId,
                foreignRouteId,
                foreignCapabilityId,
                routeVersions[0],
            ],
        );
        for (const routeVersionId of [randomUUID(), foreignVersionId]) {
            await expect(
                selectWorkflowLlmModelPayload(db, {
                    ...select(before.id, "llm"),
                    routeVersionId,
                }),
            ).rejects.toThrow(
                "exact active route version was not found in this project",
            );
        }
        await pool.query(
            "update llm_routes set disabled_at=now() where id=(select route_id from llm_route_versions where id=$1)",
            [routeVersions[0]],
        );
        try {
            await expect(
                selectWorkflowLlmModelPayload(db, select(before.id, "llm")),
            ).rejects.toThrow(
                "exact active route version was not found in this project",
            );
        } finally {
            await pool.query(
                "update llm_routes set disabled_at=null where id=(select route_id from llm_route_versions where id=$1)",
                [routeVersions[0]],
            );
        }
        expect(
            await workflowDetailPayload(db, teamId, projectId, before.id),
        ).toEqual(before);
    });

    it("rejects archived workflows and foreign tenant/project scopes", async () => {
        const before = await createWorkflowPayload(db, graph());
        for (const foreignScope of [
            { teamId: randomUUID() },
            { projectId: randomUUID() },
        ]) {
            await expect(
                selectWorkflowLlmModelPayload(db, {
                    ...select(before.id, "llm"),
                    ...foreignScope,
                }),
            ).rejects.toBeInstanceOf(ApiNotFoundError);
        }
        await deleteWorkflowPayload(db, { ...scope, workflowId: before.id });
        await expect(
            selectWorkflowLlmModelPayload(db, select(before.id, "llm")),
        ).rejects.toBeInstanceOf(ApiNotFoundError);
        await expect(
            updateWorkflowPayload(db, { ...graph(), workflowId: before.id }),
        ).rejects.toBeInstanceOf(ApiNotFoundError);
    });

    it("updates transliteration model configuration without changing its other settings", async () => {
        const input = graph();
        input.nodes[2] = {
            nodeKey: "judge",
            label: "Transliterate",
            nodeType: "transliterate",
            nodeConfig: {
                type: "transliterate",
                transliteration: {
                    enabled: true,
                    modelId: "gpt-4o-mini",
                    targetScript: "latin",
                },
            },
            modelId: "gpt-4o-mini",
            evalConfig: { type: "none" },
        } as IWorkflowNodeInput;
        const before = await createWorkflowPayload(db, input);
        const after: IPromptWorkflow = await selectWorkflowLlmModelPayload(
            db,
            select(before.id, "judge", 1),
        );
        expect(
            after.nodes.find((node) => node.nodeKey === "judge"),
        ).toMatchObject({
            modelId: "gpt-4o",
            nodeConfig: {
                transliteration: {
                    enabled: true,
                    modelId: "gpt-4o",
                    targetScript: "latin",
                },
            },
        });
    });
});

async function deadline<T>(promise: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () =>
                        reject(
                            new Error(
                                "Expected PostgreSQL lock interleaving was not observed",
                            ),
                        ),
                    5000,
                );
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    const promise = new Promise<T>((done) => {
        resolve = done;
    });
    return { promise, resolve };
}
