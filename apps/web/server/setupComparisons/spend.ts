import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { runs, workflowRuns } from "../db/schema";
import { createRunStopGuard, readRunSpendUsd } from "../runs/runStop";
import { readWorkflowRunSpendUsd } from "../workflowRuns/runStop";

/** The reads the shared spend needs; replaced in tests. */
export interface ISetupComparisonSpendStore {
    memberRunIds(setupComparisonId: string): Promise<{
        evalRunIds: string[];
        workflowRunIds: string[];
    }>;
    evalRunSpend(runId: string): Promise<number>;
    workflowRunSpend(workflowRunId: string): Promise<number>;
}

const dbStore: ISetupComparisonSpendStore = {
    async memberRunIds(setupComparisonId) {
        const [evalRuns, pipelineRuns] = await Promise.all([
            db
                .select({ id: runs.id })
                .from(runs)
                .where(eq(runs.setupComparisonId, setupComparisonId)),
            db
                .select({ id: workflowRuns.id })
                .from(workflowRuns)
                .where(eq(workflowRuns.setupComparisonId, setupComparisonId)),
        ]);
        return {
            evalRunIds: evalRuns.map((row) => row.id),
            workflowRunIds: pipelineRuns.map((row) => row.id),
        };
    },
    evalRunSpend: readRunSpendUsd,
    workflowRunSpend: readWorkflowRunSpendUsd,
};

/**
 * What a setup comparison has spent so far: every member run's recorded
 * spend, counted the way each run counts its own (model and step calls,
 * judge calls, shared transcription; cache hits are free). The members'
 * spend limit is the comparison's, so each member stops once all of them
 * together reach it.
 */
export async function readSetupComparisonSpendUsd(
    setupComparisonId: string,
    store: ISetupComparisonSpendStore = dbStore,
): Promise<number> {
    const members = await store.memberRunIds(setupComparisonId);
    const spends = await Promise.all([
        ...members.evalRunIds.map((id) => store.evalRunSpend(id)),
        ...members.workflowRunIds.map((id) => store.workflowRunSpend(id)),
    ]);
    return spends.reduce((total, spent) => total + spent, 0);
}

/**
 * An eval run's stop check. A setup comparison's members share its spend
 * limit: the spend that counts is all of theirs together.
 */
export function evalRunStopGuard(run: {
    id: string;
    setupComparisonId: string | null;
    configSnapshot: { maxCostUsd?: number };
}) {
    const comparisonId = run.setupComparisonId;
    return createRunStopGuard(run.id, {
        maxCostUsd: run.configSnapshot.maxCostUsd,
        ...(comparisonId
            ? { readSpend: () => readSetupComparisonSpendUsd(comparisonId) }
            : {}),
    });
}
