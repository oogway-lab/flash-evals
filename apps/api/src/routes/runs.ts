import type {
    IComparableRun,
    IGenerateJudgeForRunRequest,
    IGenerateJudgeForRunResponse,
    ILeaderboardRow,
    IMatrixCellScore,
    IModelComparison,
    IReasoningConfig,
    IRunContext,
    IRunDetailCell,
    IRunDetailItem,
    IRunDetailModel,
    IRunDetailResponse,
    IRunListRow,
    IRunNote,
    ISideMetrics,
    ReviewVerdict,
    RunStatus,
} from "@mosaic/api-contract";
import {
    buildLeaderboardRows,
    buildSttShipGate,
    pickBestModel,
} from "@mosaic/api-contract";
import {
    getEvalProvider,
    type IEvalCompletionProvider,
} from "@mosaic/llm-core";
import type { IApiConfig } from "../config.js";
import type { IDb } from "../db.js";
import { ApiBadRequestError, ApiNotFoundError } from "../errors.js";
import { registryEntryFor } from "../modelRegistry.js";
import {
    resolveApiKeys,
    teamBaseUrlProviderOptions,
} from "../secrets/resolveApiKeys.js";
import { RUN_NOTE_TITLE_SQL } from "./runNoteTitle.js";
import {
    createRunFromSelectionPayload,
    createRunPayload,
    resolveReasoningEffort,
    runSetupPayload,
} from "./runs/creation.js";
import {
    deleteRunPayload,
    retryRunPayload,
    runProgressPayload,
    saveCellAnnotationPayload,
    saveRunNotePayload,
} from "./runs/lifecycle.js";
import {
    audioTranscriptPayload,
    sttConfigsFromRunSnapshot,
} from "./runs/transcripts.js";

export {
    createRunFromSelectionPayload,
    createRunPayload,
    deleteRunPayload,
    retryRunPayload,
    runProgressPayload,
    runSetupPayload,
    saveCellAnnotationPayload,
    saveRunNotePayload,
};

interface IRunDetailDbRow {
    id: string;
    team_id: string;
    project_id: string;
    dataset_id: string;
    status: RunStatus;
    config_snapshot: Record<string, unknown>;
    created_at: Date | string;
}

interface IRunModelDbRow {
    id: string;
    model_id: string;
    prompt_version_id: string | null;
    is_reference: boolean;
    reasoning_config: IReasoningConfig | null;
}

interface IRunCellDbRow {
    id: string;
    dataset_item_id: string;
    run_model_id: string;
    status: "pending" | "running" | "succeeded" | "failed" | "cached";
    output_json: unknown;
    latency_ms: number | null;
    cost_usd: number | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    error: string | null;
}

interface IRunItemDbRow {
    id: string;
    type: "audio" | "image" | "text" | "mixed";
    input_text: string | null;
    storage_key: string | null;
    mime_type: string | null;
}

interface ICellScoreDbRow {
    run_cell_id: string;
    scorer_type:
        "field_diff" | "judge" | "transcript_metric" | "transcript_judge";
    score: number | null;
    rationale: string | null;
    details_json: unknown;
}

interface ICellAnnotationDbRow {
    run_cell_id: string;
    verdict: "unreviewed" | "approved" | "needs_review" | "issue";
    comment: string;
    updated_at: Date | string;
    updated_by: string | null;
}

interface IRunNoteDbRow {
    body: string;
    updated_at: Date | string;
    updated_by: string | null;
}

interface IRunListDbRow {
    id: string;
    status: RunStatus;
    created_at: Date | string;
    dataset_id: string;
    dataset_name: string;
    models: string[] | null;
    total: number | string;
    done: number | string;
    failed: number | string;
    pending: number | string;
    note_title: string | null;
    model_scores: IRunModelScoreDbRow[] | null;
}

interface IRunModelScoreDbRow {
    model_id: string;
    judge: number | string | null;
    transcript: number | string | null;
}

interface IRunContextDbRow {
    dataset_name: string;
    judge_config_model_id: string | null;
    judge_spec: { modelId?: string } | null;
    judge_prompt_id: string | null;
    judge_prompt_name: string | null;
    judge_prompt_version: number | null;
}

interface IRunPromptDbRow {
    prompt_id: string;
    name: string;
    version: number;
}

interface IComparableRunDbRow {
    id: string;
    dataset_id: string;
    status: RunStatus;
    config_snapshot: Record<string, unknown>;
    created_at: Date | string;
    models: string[] | null;
}

interface IGenerateJudgePromptVersionRow {
    id: string;
    prompt_id: string;
    content: string;
    schema_version_id: string | null;
    status: "legacy" | "runnable";
}

interface IGenerateJudgePromptRow {
    id: string;
    team_id: string;
    project_id: string;
}

interface IGenerateJudgeSchemaRow {
    json_schema: Record<string, unknown>;
}

interface IGenerateJudgeDatasetRow {
    team_id: string;
    project_id: string;
    modality: "audio" | "image" | "text";
    purpose: "golden" | "evaluation";
}

export async function generateJudgeForRunPayload(
    db: IDb,
    config: IApiConfig,
    input: IGenerateJudgeForRunRequest,
): Promise<IGenerateJudgeForRunResponse> {
    const versionResult = await db.query<IGenerateJudgePromptVersionRow>(
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

    const promptResult = await db.query<IGenerateJudgePromptRow>(
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

    const schemaResult = await db.query<IGenerateJudgeSchemaRow>(
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

    const datasetResult = await db.query<IGenerateJudgeDatasetRow>(
        `select team_id, project_id, modality, purpose
        from datasets
        where id = $1
        limit 1`,
        [input.datasetId],
    );
    const dataset = datasetResult.rows[0];
    if (
        !dataset ||
        dataset.team_id !== input.teamId ||
        dataset.project_id !== input.projectId
    ) {
        throw new ApiNotFoundError("Dataset not found.");
    }

    return generateJudgeFromContext(db, config, input.teamId, {
        taskPrompt: version.content,
        outputSchema: schemaVersion.json_schema,
        modality: dataset.modality,
        hasGolden: dataset.purpose === "golden",
        generatorModelId: input.generatorModelId,
    });
}

export async function listRunsPayload(
    db: IDb,
    teamId: string,
    projectId: string,
): Promise<IRunListRow[]> {
    const rows = await runListRows(db, teamId, projectId);
    return rows.map(runListPayloadRow);
}

export async function listRunSummariesPagePayload(
    db: IDb,
    teamId: string,
    projectId: string,
    input: { limit: number; cursor?: { createdAt: string; id: string } },
) {
    const rows = await runListRows(db, teamId, projectId, input);
    const complete = rows.length <= input.limit;
    const pageRows = rows.slice(0, input.limit);
    return {
        runs: pageRows.map(runListPayloadRow),
        complete,
        ...(complete || pageRows.length === 0
            ? {}
            : {
                  nextCursor: {
                      createdAt: pageRows.at(-1)!.cursor_created_at!,
                      id: pageRows.at(-1)!.id,
                  },
              }),
    };
}

async function runListRows(
    db: IDb,
    teamId: string,
    projectId: string,
    page?: { limit: number; cursor?: { createdAt: string; id: string } },
) {
    const result = await db.query<
        IRunListDbRow & { cursor_created_at?: string }
    >(
        `select
            r.id,
            r.status,
            r.created_at,
            ${page ? `to_char(r.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at,` : ""}
            r.dataset_id,
            d.name as dataset_name,
            coalesce(
                array_remove(array_agg(distinct rm.model_id order by rm.model_id), null),
                array[]::text[]
            ) as models,
            count(distinct rc.id)::int as total,
            count(distinct rc.id) filter (where rc.status in ('succeeded', 'cached'))::int as done,
            count(distinct rc.id) filter (where rc.status = 'failed')::int as failed,
            count(distinct rc.id) filter (where rc.status in ('pending', 'running'))::int as pending,
            ${RUN_NOTE_TITLE_SQL} as note_title,
            (
                select coalesce(json_agg(json_build_object(
                    'model_id', ms.model_id,
                    'judge', ms.judge,
                    'transcript', ms.transcript
                ) order by ms.model_id), '[]'::json)
                from (
                    select
                        rm2.model_id,
                        avg(cs.score) filter (where cs.scorer_type = 'judge')::float8 as judge,
                        avg(cs.score) filter (
                            where cs.scorer_type = 'transcript_metric'
                            and coalesce(cs.details_json->>'metricKind', '') <> 'llm_judge'
                        )::float8 as transcript
                    from run_models rm2
                    left join run_cells rc2
                        on rc2.run_model_id = rm2.id and rc2.run_id = r.id
                    left join cell_scores cs on cs.run_cell_id = rc2.id
                    where rm2.run_id = r.id
                    group by rm2.id, rm2.model_id
                ) ms
            ) as model_scores
        from runs r
        inner join datasets d on d.id = r.dataset_id
        left join run_models rm on rm.run_id = r.id
        left join run_cells rc on rc.run_id = r.id
        where r.team_id = $1 and r.project_id = $2
          ${page ? "and ($3::timestamptz is null or (r.created_at,r.id)<($3::timestamptz,$4::uuid))" : ""}
        group by r.id, r.status, r.created_at, r.dataset_id, d.name
        order by r.created_at desc,r.id desc
        ${page ? "limit $5" : ""}`,
        page
            ? [
                  teamId,
                  projectId,
                  page.cursor?.createdAt ?? null,
                  page.cursor?.id ?? null,
                  page.limit + 1,
              ]
            : [teamId, projectId],
    );
    return result.rows;
}

function runListPayloadRow(row: IRunListDbRow): IRunListRow {
    const best = pickBestModel(
        (row.model_scores ?? []).map((score) => ({
            modelId: score.model_id,
            avgJudgeScore: optionalNumber(score.judge),
            avgTranscriptScore: optionalNumber(score.transcript),
        })),
    );
    return {
        id: row.id,
        status: row.status,
        createdAt:
            row.created_at instanceof Date
                ? row.created_at.toISOString()
                : new Date(row.created_at).toISOString(),
        datasetId: row.dataset_id,
        datasetName: row.dataset_name,
        models: row.models ?? [],
        progress: {
            total: countValue(row.total),
            done: countValue(row.done),
            failed: countValue(row.failed),
            pending: countValue(row.pending),
        },
        ...(row.note_title ? { noteTitle: row.note_title } : {}),
        ...(best ? { best } : {}),
    };
}

function optionalNumber(value: number | string | null | undefined) {
    if (value === null || value === undefined) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

async function getTeamRun(
    db: IDb,
    teamId: string,
    projectId: string,
    runId: string,
): Promise<IRunDetailDbRow | undefined> {
    const result = await db.query<IRunDetailDbRow>(
        `select id, team_id, project_id, dataset_id, status, config_snapshot, created_at
        from runs
        where id = $1 and team_id = $2 and project_id = $3
        limit 1`,
        [runId, teamId, projectId],
    );
    return result.rows[0];
}

async function progressPayloadForRun(
    db: IDb,
    runId: string,
): Promise<{ total: number; done: number; failed: number; pending: number }> {
    const result = await db.query<{
        status: "pending" | "running" | "succeeded" | "failed" | "cached";
        count: number | string;
    }>(
        `select status, count(*)::int as count
        from run_cells
        where run_id = $1
        group by status`,
        [runId],
    );
    let total = 0;
    let done = 0;
    let failed = 0;
    for (const row of result.rows) {
        const count = countValue(row.count);
        total += count;
        if (row.status === "succeeded" || row.status === "cached")
            done += count;
        else if (row.status === "failed") failed += count;
    }
    return { total, done, failed, pending: total - done - failed };
}

export async function runDetailPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    runId: string,
    compareWith?: string,
): Promise<IRunDetailResponse> {
    const run = await getTeamRun(db, teamId, projectId, runId);
    if (!run) throw new ApiNotFoundError();

    const [progress, matrix, leaderboard, note, comparableRuns, runContext] =
        await Promise.all([
            progressPayloadForRun(db, runId),
            runMatrixPayload(db, runId),
            leaderboardPayload(db, runId),
            runNotePayload(db, runId),
            comparableRunsPayload(db, teamId, projectId, run),
            runContextRow(db, runId),
        ]);
    const context = await runContextPayload(db, runContext, matrix.models);

    const baselineRunId =
        compareWith &&
        comparableRuns.some((candidate) => candidate.id === compareWith)
            ? compareWith
            : undefined;
    const comparison = baselineRunId
        ? await compareRunsPayload(db, baselineRunId, runId)
        : undefined;
    const audioTranscripts = await audioTranscriptPayload(
        db,
        matrix.items,
        sttConfigsFromRunSnapshot(run.config_snapshot),
    );

    return {
        run: {
            id: run.id,
            teamId: run.team_id,
            datasetId: run.dataset_id,
            status: run.status,
            createdAt: isoDate(run.created_at),
            configSnapshot: run.config_snapshot,
        },
        progress,
        ...(context ? { context } : {}),
        leaderboard,
        models: matrix.models,
        items: matrix.items,
        cells: matrix.cells,
        scoresByCell: matrix.scoresByCell,
        audioTranscripts,
        note,
        comparableRuns,
        baselineRunId,
        comparison,
    };
}

export async function runSummaryPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    runId: string,
) {
    const run = await getTeamRun(db, teamId, projectId, runId);
    if (!run) throw new ApiNotFoundError();
    const [progress, models] = await Promise.all([
        runProgressPayload(db, teamId, projectId, runId),
        db.query<{ model_id: string }>(
            `select distinct model_id from run_models where run_id=$1 order by model_id`,
            [runId],
        ),
    ]);
    return {
        run: {
            id: run.id,
            datasetId: run.dataset_id,
            status: run.status,
            createdAt: isoDate(run.created_at),
        },
        progress,
        modelIds: models.rows.map((row) => row.model_id),
    };
}

interface IRunCellPageRow {
    id: string;
    dataset_item_id: string;
    model_id: string;
    status: "pending" | "running" | "succeeded" | "failed" | "cached";
    input_text: string | null;
    output_json: unknown;
    latency_ms: number | null;
    cost_usd: number | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    error: string | null;
    cursor_created_at: string;
    annotation_verdict: ReviewVerdict | null;
    annotation_comment: string | null;
    scores: Array<{ scorerType: string; score: number | null }> | null;
}

type IRunCellPageOptions = Pick<
    Parameters<typeof listRunCellsPagePayload>[1],
    "includeInputText" | "includeOutput" | "includeReview" | "includeScores"
>;

function runCellPageProjection(options: IRunCellPageOptions) {
    return {
        inputText: options.includeInputText ? "i.input_text" : "null::text",
        output: options.includeOutput ? "c.output_json" : "null::jsonb",
        reviewVerdict: options.includeReview
            ? "a.verdict"
            : "null::review_verdict",
        reviewComment: options.includeReview ? "a.comment" : "null::text",
        scores: options.includeScores
            ? "(select coalesce(json_agg(json_build_object('scorerType',s.scorer_type,'score',s.score) order by s.scorer_type),'[]'::json) from cell_scores s where s.run_cell_id=c.id)"
            : "null::json",
    };
}

function runCellPageOrder(order: "oldest_first" | "newest_first" | undefined) {
    const newestFirst = order === "newest_first";
    return {
        cursorOperator: newestFirst ? "<" : ">",
        direction: newestFirst ? "desc" : "asc",
    };
}

function runCellPageItem(row: IRunCellPageRow, options: IRunCellPageOptions) {
    return {
        id: row.id,
        itemId: row.dataset_item_id,
        modelId: row.model_id,
        status: row.status,
        latencyMs: row.latency_ms,
        costUsd: row.cost_usd,
        promptTokens: row.prompt_tokens,
        completionTokens: row.completion_tokens,
        error: row.error,
        ...(options.includeInputText ? { inputText: row.input_text } : {}),
        ...(options.includeOutput ? { output: row.output_json } : {}),
        ...(options.includeReview
            ? {
                  review: row.annotation_verdict
                      ? {
                            verdict: row.annotation_verdict,
                            comment: row.annotation_comment ?? "",
                        }
                      : null,
              }
            : {}),
        ...(options.includeScores ? { scores: row.scores ?? [] } : {}),
    };
}

export async function listRunCellsPagePayload(
    db: IDb,
    input: {
        teamId: string;
        projectId: string;
        runId: string;
        limit: number;
        cursor?: { createdAt: string; id: string };
        itemId?: string;
        modelId?: string;
        status?: "pending" | "running" | "succeeded" | "failed" | "cached";
        reviewVerdict?: ReviewVerdict;
        order?: "oldest_first" | "newest_first";
        includeInputText?: boolean;
        includeOutput?: boolean;
        includeReview?: boolean;
        includeScores?: boolean;
    },
) {
    const run = await getTeamRun(
        db,
        input.teamId,
        input.projectId,
        input.runId,
    );
    if (!run) throw new ApiNotFoundError();
    const projection = runCellPageProjection(input);
    const sort = runCellPageOrder(input.order);
    const result = await db.query<IRunCellPageRow>(
        `select c.id,c.dataset_item_id,m.model_id,c.status,
                ${projection.inputText} as input_text,${projection.output} as output_json,
                c.latency_ms,c.cost_usd,c.prompt_tokens,c.completion_tokens,
                c.error,
                ${projection.reviewVerdict} as annotation_verdict,
                ${projection.reviewComment} as annotation_comment,
                ${projection.scores} as scores,
                to_char(c.created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as cursor_created_at
         from run_cells c
         inner join run_models m on m.id=c.run_model_id
         inner join dataset_items i on i.id=c.dataset_item_id
         left join run_cell_annotations a on a.run_cell_id=c.id
         where c.run_id=$1
           and ($2::uuid is null or c.dataset_item_id=$2)
           and ($3::text is null or m.model_id=$3)
           and ($4::cell_status is null or c.status=$4::cell_status)
           and ($5::review_verdict is null or coalesce(a.verdict,'unreviewed'::review_verdict)=$5::review_verdict)
           and ($6::timestamptz is null or (c.created_at,c.id)${sort.cursorOperator}($6::timestamptz,$7::uuid))
         order by c.created_at ${sort.direction},c.id ${sort.direction}
         limit $8`,
        [
            input.runId,
            input.itemId ?? null,
            input.modelId ?? null,
            input.status ?? null,
            input.reviewVerdict ?? null,
            input.cursor?.createdAt ?? null,
            input.cursor?.id ?? null,
            input.limit + 1,
        ],
    );
    const complete = result.rows.length <= input.limit;
    const rows = result.rows.slice(0, input.limit);
    return {
        cells: rows.map((row) => runCellPageItem(row, input)),
        complete,
        ...(complete || rows.length === 0
            ? {}
            : {
                  nextCursor: {
                      createdAt: rows.at(-1)!.cursor_created_at,
                      id: rows.at(-1)!.id,
                  },
              }),
    };
}

/** The dataset and judge a run was created with (needs only the run id). */
async function runContextRow(
    db: IDb,
    runId: string,
): Promise<IRunContextDbRow | undefined> {
    const result = await db.query<IRunContextDbRow>(
        `select
            d.name as dataset_name,
            jc.model_id as judge_config_model_id,
            jpv.judge_spec,
            jp.id as judge_prompt_id,
            jp.name as judge_prompt_name,
            jpv.version as judge_prompt_version
        from runs r
        inner join datasets d on d.id = r.dataset_id
        left join judge_configs jc on jc.id = r.judge_config_id
        left join prompt_versions jpv on jpv.id = r.judge_prompt_version_id
        left join prompts jp on jp.id = jpv.prompt_id
        where r.id = $1
        limit 1`,
        [runId],
    );
    return result.rows[0];
}

/**
 * Names for the dataset, prompt versions and judge a run was created with.
 * Only the prompt-version lookup depends on the matrix models; the dataset and
 * judge row is fetched alongside the other detail queries.
 */
async function runContextPayload(
    db: IDb,
    row: IRunContextDbRow | undefined,
    models: IRunDetailModel[],
): Promise<IRunContext | undefined> {
    if (!row) return undefined;
    const promptVersionIds = [
        ...new Set(
            models.flatMap((m) =>
                m.promptVersionId ? [m.promptVersionId] : [],
            ),
        ),
    ];
    const promptsResult =
        promptVersionIds.length > 0
            ? await db.query<IRunPromptDbRow>(
                  `select p.id as prompt_id, p.name, pv.version
                from prompt_versions pv
                inner join prompts p on p.id = pv.prompt_id
                where pv.id = any($1::uuid[])
                order by p.name, pv.version`,
                  [promptVersionIds],
              )
            : { rows: [] as IRunPromptDbRow[] };
    const judgeModelId = row.judge_spec?.modelId ?? row.judge_config_model_id;
    const judge: NonNullable<IRunContext["judge"]> = {};
    if (judgeModelId) judge.modelId = judgeModelId;
    if (row.judge_prompt_id) {
        judge.promptId = row.judge_prompt_id;
        if (row.judge_prompt_name) judge.promptName = row.judge_prompt_name;
        if (row.judge_prompt_version !== null) {
            judge.promptVersion = row.judge_prompt_version;
        }
    }
    return {
        datasetName: row.dataset_name,
        prompts: promptsResult.rows.map((p) => ({
            promptId: p.prompt_id,
            name: p.name,
            version: p.version,
        })),
        ...(Object.keys(judge).length > 0 ? { judge } : {}),
    };
}

async function runMatrixPayload(db: IDb, runId: string) {
    const [modelsResult, cellsResult] = await Promise.all([
        db.query<IRunModelDbRow>(
            `select id, model_id, prompt_version_id, is_reference, reasoning_config
            from run_models
            where run_id = $1`,
            [runId],
        ),
        db.query<IRunCellDbRow>(
            `select
                id,
                dataset_item_id,
                run_model_id,
                status,
                output_json,
                latency_ms,
                cost_usd,
                prompt_tokens,
                completion_tokens,
                error
            from run_cells
            where run_id = $1`,
            [runId],
        ),
    ]);
    const cells = cellsResult.rows;
    const itemIds = [...new Set(cells.map((cell) => cell.dataset_item_id))];
    const cellIds = cells.map((cell) => cell.id);

    const [itemsResult, scoresResult, annotationsResult] = await Promise.all([
        itemIds.length > 0
            ? db.query<IRunItemDbRow>(
                  `select id, type, input_text, storage_key, mime_type
                from dataset_items
                where id = any($1::uuid[])`,
                  [itemIds],
              )
            : Promise.resolve({ rows: [] }),
        cellIds.length > 0
            ? db.query<ICellScoreDbRow>(
                  `select run_cell_id, scorer_type, score, rationale, details_json
                from cell_scores
                where run_cell_id = any($1::uuid[])`,
                  [cellIds],
              )
            : Promise.resolve({ rows: [] }),
        cellIds.length > 0
            ? db.query<ICellAnnotationDbRow>(
                  `select run_cell_id, verdict, comment, updated_at, updated_by
                from run_cell_annotations
                where run_cell_id = any($1::uuid[])`,
                  [cellIds],
              )
            : Promise.resolve({ rows: [] }),
    ]);

    const annotationsByCell = new Map(
        annotationsResult.rows.map((row) => [
            row.run_cell_id,
            {
                verdict: row.verdict,
                comment: row.comment,
                updatedAt: isoDate(row.updated_at),
                updatedBy: row.updated_by,
            },
        ]),
    );
    const scoresByCell = scoresByCellRecord(scoresResult.rows);

    return {
        models: modelsResult.rows.map((row): IRunDetailModel => ({
            id: row.id,
            modelId: row.model_id,
            promptVersionId: row.prompt_version_id,
            isReference: row.is_reference,
        })),
        items: itemsResult.rows.map((row): IRunDetailItem => ({
            id: row.id,
            type: row.type,
            inputText: row.input_text,
            storageKey: row.storage_key,
            mimeType: row.mime_type,
        })),
        cells: cells.map((row): IRunDetailCell => ({
            id: row.id,
            datasetItemId: row.dataset_item_id,
            runModelId: row.run_model_id,
            status: row.status,
            outputJson: row.output_json,
            latencyMs: row.latency_ms,
            costUsd: row.cost_usd,
            promptTokens: row.prompt_tokens,
            completionTokens: row.completion_tokens,
            annotation: annotationsByCell.get(row.id),
            error: row.error,
        })),
        scoresByCell,
    };
}

async function leaderboardPayload(
    db: IDb,
    runId: string,
): Promise<ILeaderboardRow[]> {
    const matrix = await runMatrixPayload(db, runId);
    const scoresByCell = new Map(Object.entries(matrix.scoresByCell));
    return buildLeaderboardRows(matrix.models, matrix.cells, scoresByCell);
}

async function runNotePayload(
    db: IDb,
    runId: string,
): Promise<IRunNote | undefined> {
    const result = await db.query<IRunNoteDbRow>(
        `select body, updated_at, updated_by
        from run_notes
        where run_id = $1
        limit 1`,
        [runId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    return {
        body: row.body,
        updatedAt: isoDate(row.updated_at),
        updatedBy: row.updated_by,
    };
}

async function comparableRunsPayload(
    db: IDb,
    teamId: string,
    projectId: string,
    currentRun: IRunDetailDbRow,
): Promise<IComparableRun[]> {
    const result = await db.query<IComparableRunDbRow>(
        `select
            r.id,
            r.dataset_id,
            r.status,
            r.config_snapshot,
            r.created_at,
            coalesce(
                array_remove(array_agg(distinct rm.model_id order by rm.model_id), null),
                array[]::text[]
            ) as models
        from runs r
        left join run_models rm on rm.run_id = r.id
        where r.team_id = $1 and r.project_id = $2
        group by r.id, r.dataset_id, r.status, r.config_snapshot, r.created_at`,
        [teamId, projectId],
    );
    const relatedIds = relatedRunIdsForComparison(currentRun, result.rows);
    if (relatedIds.size === 0) return [];

    return result.rows
        .filter(
            (run) =>
                relatedIds.has(run.id) &&
                run.dataset_id === currentRun.dataset_id &&
                run.id !== currentRun.id &&
                run.status === "completed",
        )
        .map((run) => ({
            id: run.id,
            createdAt: isoDate(run.created_at),
            models: run.models ?? [],
        }));
}

function relatedRunIdsForComparison(
    currentRun: { id: string; config_snapshot: Record<string, unknown> },
    runs: Array<{ id: string; config_snapshot: Record<string, unknown> }>,
): Set<string> {
    const sourceRunId =
        typeof currentRun.config_snapshot.sourceRunId === "string"
            ? currentRun.config_snapshot.sourceRunId
            : undefined;
    if (sourceRunId) return new Set([sourceRunId]);

    return new Set(
        runs
            .filter((run) => run.config_snapshot.sourceRunId === currentRun.id)
            .map((run) => run.id),
    );
}

async function compareRunsPayload(
    db: IDb,
    baselineRunId: string,
    currentRunId: string,
): Promise<IModelComparison[]> {
    const [baseline, current] = await Promise.all([
        comparisonRowsForRun(db, baselineRunId),
        comparisonRowsForRun(db, currentRunId),
    ]);
    return buildComparison(baseline, current);
}

interface IRunComparisonRow {
    row: ILeaderboardRow;
    effort: IReasoningConfig["effort"] | undefined;
}

async function comparisonRowsForRun(
    db: IDb,
    runId: string,
): Promise<IRunComparisonRow[]> {
    const [rows, efforts] = await Promise.all([
        leaderboardPayload(db, runId),
        effortByModel(db, runId),
    ]);
    return rows.map((row) => ({ row, effort: efforts.get(row.modelId) }));
}

async function effortByModel(
    db: IDb,
    runId: string,
): Promise<Map<string, IReasoningConfig["effort"] | undefined>> {
    const result = await db.query<
        Pick<IRunModelDbRow, "model_id" | "reasoning_config">
    >(
        `select model_id, reasoning_config
        from run_models
        where run_id = $1`,
        [runId],
    );
    return new Map(
        result.rows.map((row) => [row.model_id, row.reasoning_config?.effort]),
    );
}

function buildComparison(
    baseline: IRunComparisonRow[],
    current: IRunComparisonRow[],
): IModelComparison[] {
    const baseByModel = new Map(baseline.map((row) => [row.row.modelId, row]));
    const curByModel = new Map(current.map((row) => [row.row.modelId, row]));
    const modelIds = [
        ...new Set([...baseByModel.keys(), ...curByModel.keys()]),
    ];

    return modelIds.map((modelId) => {
        const baselineRow = baseByModel.get(modelId);
        const currentRow = curByModel.get(modelId);
        const baselineSide = baselineRow ? side(baselineRow) : undefined;
        const currentSide = currentRow ? side(currentRow) : undefined;

        let delta: IModelComparison["delta"];
        if (baselineSide && currentSide) {
            const qualityComparable =
                baselineSide.qualitySource !== undefined &&
                baselineSide.qualitySource === currentSide.qualitySource;
            delta = {
                quality: qualityComparable
                    ? diff(currentSide.quality, baselineSide.quality)
                    : undefined,
                cost: diff(currentSide.cost, baselineSide.cost),
                latency: diff(currentSide.latency, baselineSide.latency),
                qualityComparable,
            };
        }

        return {
            modelId,
            isReference: (currentRow ?? baselineRow)!.row.isReference,
            baseline: baselineSide,
            current: currentSide,
            delta,
            sttShipGate: buildSttShipGate({
                baseline: baselineSide,
                current: currentSide,
            }),
        };
    });
}

function side(input: IRunComparisonRow): ISideMetrics {
    const { row } = input;
    return {
        quality: row.avgJudgeScore,
        qualitySource: row.avgJudgeScore !== undefined ? "judge" : undefined,
        cost: row.totalCostUsd,
        latency: row.avgLatencyMs,
        p95Latency: row.p95LatencyMs,
        sttCost: row.totalSttCostUsd,
        sttP95Latency: row.p95SttLatencyMs,
        wer: row.avgWer,
        cpWer: row.avgCpWer,
        transcriptJudgeScore: row.avgTranscriptJudgeScore,
        hardFailureCount: row.transcriptFailureCount,
        effort: input.effort,
        n: row.n,
    };
}

function diff(
    a: number | undefined,
    b: number | undefined,
): number | undefined {
    return a === undefined || b === undefined ? undefined : a - b;
}

const JUDGE_GENERATOR_SYSTEM =
    "You write rubrics for an LLM-as-judge that scores another model's output. " +
    "Return only the rubric text the judge will follow — no JSON, no Markdown fences, no preamble.";

async function generateJudgeFromContext(
    db: IDb,
    config: IApiConfig,
    teamId: string,
    input: {
        taskPrompt: string;
        outputSchema: Record<string, unknown>;
        modality: "audio" | "image" | "text";
        hasGolden: boolean;
        generatorModelId?: string;
    },
): Promise<IGenerateJudgeForRunResponse> {
    const generatorModelId =
        input.generatorModelId ??
        process.env.PROMPT_OPTIMIZER_MODEL ??
        "gpt-5.4-mini";
    const provider = await evalProvider(db, config, teamId);
    const reasoning = registryEntryFor(generatorModelId)?.reasoning ?? false;
    const result = await provider.complete({
        model: generatorModelId,
        system: JUDGE_GENERATOR_SYSTEM,
        prompt: judgeGeneratorInstructions(input),
        maxTokens: reasoning ? 6000 : 2000,
        reasoningEffort: resolveReasoningEffort(generatorModelId, "low"),
    });

    const rubricPrompt = result.text.trim();
    if (rubricPrompt === "") {
        throw new ApiBadRequestError(
            "The judge generator did not return a rubric. Try again.",
        );
    }

    return { rubricPrompt };
}

function judgeGeneratorInstructions(input: {
    taskPrompt: string;
    outputSchema: Record<string, unknown>;
    modality: "audio" | "image" | "text";
    hasGolden: boolean;
}): string {
    const reference = input.hasGolden
        ? "A reference answer is available for each example; the judge may compare the candidate output against it."
        : "No reference answer is available; the judge must score against the criteria themselves, not a known answer.";

    return [
        "Write a concise grading rubric for a judge that scores how well a model's output satisfies the task below.",
        "The rubric must:",
        "- Stay concise: no more than 250 words, covering every required field.",
        "- Define a short list of NAMED evaluation criteria (e.g. correctness, completeness, format) derived from the task and the output structure.",
        "- Instruct the judge to score EACH named criterion independently from 0 (worst) to 1 (best), reasoning before scoring, then give a single overall 0-1 score.",
        "- Judge only against the rubric — do not reward longer or more verbose answers, and do not favor any particular model.",
        `- ${reference}`,
        "",
        `The task inputs are ${input.modality} examples.`,
        "",
        "Task prompt (what the model under test is asked to do):",
        input.taskPrompt,
        "",
        "Output structure the model returns (JSON Schema):",
        JSON.stringify(input.outputSchema, null, 2),
        "",
        "Return the rubric text only.",
    ].join("\n");
}

async function evalProvider(
    db: IDb,
    config: IApiConfig,
    teamId: string,
): Promise<IEvalCompletionProvider> {
    const resolved = await resolveApiKeys(db, config, teamId);
    return getEvalProvider(resolved.apiKeys, {
        provider: config.mosaicLlmProvider,
        ...teamBaseUrlProviderOptions(resolved),
    });
}

function scoresByCellRecord(
    scores: ICellScoreDbRow[],
): Record<string, IMatrixCellScore[]> {
    const result: Record<string, IMatrixCellScore[]> = {};
    for (const score of scores) {
        const cellScores = result[score.run_cell_id] ?? [];
        cellScores.push({
            scorerType: score.scorer_type,
            score: score.score,
            rationale: score.rationale,
            detailsJson: score.details_json,
        });
        result[score.run_cell_id] = cellScores;
    }
    return result;
}

function isoDate(value: Date | string): string {
    return value instanceof Date
        ? value.toISOString()
        : new Date(value).toISOString();
}

function countValue(value: number | string): number {
    return typeof value === "number" ? value : Number(value);
}
