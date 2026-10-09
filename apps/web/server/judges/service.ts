import { and, desc, eq } from "drizzle-orm";
import { db } from "../db/client";
import { judgeConfigs, prompts, promptVersions } from "../db/schema";
import type {
    IJudgeSpec,
    IReasoningConfig,
    JudgeDeclaredInput,
} from "../db/jsonTypes";

export const DEFAULT_JUDGE_DECLARED_INPUTS: JudgeDeclaredInput[] = [
    "task_input",
    "candidate_output",
    "reference",
];

export async function createJudgeConfig(
    teamId: string,
    projectId: string,
    name: string,
    modelId: string,
    rubricPrompt: string,
    reasoningConfig?: IReasoningConfig,
) {
    const [row] = await db
        .insert(judgeConfigs)
        .values({
            teamId,
            projectId,
            name,
            modelId,
            rubricPrompt,
            reasoningConfig,
        })
        .returning();
    return row;
}

export async function listJudgeConfigs(teamId: string, projectId: string) {
    return db
        .select()
        .from(judgeConfigs)
        .where(
            and(
                eq(judgeConfigs.teamId, teamId),
                eq(judgeConfigs.projectId, projectId),
            ),
        );
}

export interface IJudgePromptOption {
    promptId: string;
    promptName: string;
    promptVersionId: string;
    version: number;
    modelId: string;
    transport?: IJudgeSpec["transport"];
    rubricPrompt: string;
    declaredInputs: JudgeDeclaredInput[];
    reasoningConfig?: IReasoningConfig;
}

export async function listJudgePrompts(
    teamId: string,
    projectId: string,
): Promise<IJudgePromptOption[]> {
    const rows = await db
        .select({
            promptId: prompts.id,
            promptName: prompts.name,
            promptVersionId: promptVersions.id,
            version: promptVersions.version,
            rubricPrompt: promptVersions.content,
            judgeSpec: promptVersions.judgeSpec,
            reasoningConfig: promptVersions.reasoningConfig,
        })
        .from(prompts)
        .innerJoin(promptVersions, eq(promptVersions.promptId, prompts.id))
        .where(
            and(
                eq(prompts.teamId, teamId),
                eq(prompts.projectId, projectId),
                eq(prompts.kind, "judge"),
                eq(promptVersions.status, "runnable"),
            ),
        )
        .orderBy(prompts.name, desc(promptVersions.version));

    const latestByPrompt = new Map<string, IJudgePromptOption>();
    for (const row of rows) {
        if (latestByPrompt.has(row.promptId) || !row.judgeSpec) continue;
        latestByPrompt.set(row.promptId, {
            promptId: row.promptId,
            promptName: row.promptName,
            promptVersionId: row.promptVersionId,
            version: row.version,
            modelId: row.judgeSpec.modelId,
            transport: row.judgeSpec.transport,
            rubricPrompt: row.rubricPrompt,
            declaredInputs: normalizeJudgeDeclaredInputs(
                row.judgeSpec.declaredInputs,
            ),
            reasoningConfig: row.reasoningConfig ?? undefined,
        });
    }
    return [...latestByPrompt.values()];
}

export async function getJudgePromptVersion(
    promptVersionId: string,
): Promise<IJudgePromptOption | undefined> {
    const [row] = await db
        .select({
            promptId: prompts.id,
            promptName: prompts.name,
            teamId: prompts.teamId,
            promptVersionId: promptVersions.id,
            version: promptVersions.version,
            rubricPrompt: promptVersions.content,
            judgeSpec: promptVersions.judgeSpec,
            reasoningConfig: promptVersions.reasoningConfig,
        })
        .from(promptVersions)
        .innerJoin(prompts, eq(prompts.id, promptVersions.promptId))
        .where(
            and(
                eq(promptVersions.id, promptVersionId),
                eq(prompts.kind, "judge"),
                eq(promptVersions.status, "runnable"),
            ),
        )
        .limit(1);

    if (!row?.judgeSpec) return undefined;
    return {
        promptId: row.promptId,
        promptName: row.promptName,
        promptVersionId: row.promptVersionId,
        version: row.version,
        modelId: row.judgeSpec.modelId,
        transport: row.judgeSpec.transport,
        rubricPrompt: row.rubricPrompt,
        declaredInputs: normalizeJudgeDeclaredInputs(
            row.judgeSpec.declaredInputs,
        ),
        reasoningConfig: row.reasoningConfig ?? undefined,
    };
}

export function legacyJudgeSpec(modelId: string): IJudgeSpec {
    return {
        modelId,
        declaredInputs: DEFAULT_JUDGE_DECLARED_INPUTS,
    };
}

export function normalizeJudgeDeclaredInputs(
    inputs: readonly JudgeDeclaredInput[] | undefined,
): JudgeDeclaredInput[] {
    const allowed = new Set<JudgeDeclaredInput>([
        "task_input",
        "candidate_output",
        "reference",
    ]);
    const unique = [...new Set(inputs ?? [])].filter(
        (input): input is JudgeDeclaredInput => allowed.has(input),
    );
    return unique.length > 0 ? unique : ["candidate_output"];
}
