import {
    getEvalProvider,
    type IEvalCompletionProvider,
} from "@flash-evals/llm-core";
import type { IApiConfig } from "../../config.js";
import type { IDb } from "../../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../../errors.js";
import {
    resolveApiKeys,
    teamBaseUrlProviderOptions,
} from "../../secrets/resolveApiKeys.js";

interface IPromptVersionRow {
    id: string;
    prompt_id: string;
    content: string;
    schema_version_id: string | null;
    status: "legacy" | "runnable";
}

interface IPromptRow {
    id: string;
    team_id: string;
    project_id: string;
}

interface ISchemaRow {
    json_schema: Record<string, unknown>;
}

export interface IRunnablePromptContext {
    content: string;
    outputSchema: Record<string, unknown>;
}

/** A runnable prompt version's text and output schema, scoped to the team and project. */
export async function loadRunnablePromptContext(
    db: IDb,
    input: { teamId: string; projectId: string; promptVersionId: string },
): Promise<IRunnablePromptContext> {
    const versionResult = await db.query<IPromptVersionRow>(
        `select id, prompt_id, content, schema_version_id, status
        from prompt_versions
        where id = $1
        limit 1`,
        [input.promptVersionId],
    );
    const version = versionResult.rows[0];
    if (!version?.schema_version_id || version.status !== "runnable") {
        throw new ApiBadRequestError("Select a runnable prompt version first.");
    }

    const promptResult = await db.query<IPromptRow>(
        `select id, team_id, project_id
        from prompts
        where id = $1
        limit 1`,
        [version.prompt_id],
    );
    const prompt = promptResult.rows[0];
    if (
        !prompt ||
        prompt.team_id !== input.teamId ||
        prompt.project_id !== input.projectId
    ) {
        throw new ApiNotFoundError("Prompt not found.");
    }

    const schemaResult = await db.query<ISchemaRow>(
        `select json_schema
        from prompt_schema_versions
        where id = $1
        limit 1`,
        [version.schema_version_id],
    );
    const schemaVersion = schemaResult.rows[0];
    if (!schemaVersion) {
        throw new ApiNotFoundError("Prompt schema not found.");
    }
    return {
        content: version.content,
        outputSchema: schemaVersion.json_schema,
    };
}

/** The team's model provider, using its own keys when it has them. */
export async function evalProvider(
    db: IDb,
    config: IApiConfig,
    teamId: string,
): Promise<IEvalCompletionProvider> {
    const resolved = await resolveApiKeys(db, config, teamId);
    return getEvalProvider(resolved.apiKeys, {
        provider: config.flashEvalsLlmProvider,
        ...teamBaseUrlProviderOptions(resolved),
    });
}
