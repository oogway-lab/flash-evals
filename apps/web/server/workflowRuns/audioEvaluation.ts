import { randomUUID } from "crypto";
import type { ApiKeys } from "@mosaic/llm-core";
import type { ISttRunConfig } from "@mosaic/api-contract";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db/client";
import { workflowRunItems } from "../db/schema";
import type {
    IPreparedWorkflowAudio,
    WorkflowDatasetItem,
} from "./audioPreparation";
import { workflowItemLeaseMs } from "./itemLease";
import {
    scoreWorkflowTranscriptItem,
    type IWorkflowScoringContext,
} from "./scoring";

interface IEvaluatePreparedWorkflowAudioInput {
    prepared: IPreparedWorkflowAudio;
    item: WorkflowDatasetItem;
    evaluator: ISttRunConfig["evaluator"];
    sttModelId: string;
    apiKeys: ApiKeys;
    scoringContext: IWorkflowScoringContext;
}

export async function evaluatePreparedWorkflowAudio(
    input: IEvaluatePreparedWorkflowAudioInput,
): Promise<void> {
    const leaseOwner = randomUUID();
    const claimedId = await claimEvaluation(
        input.prepared.workflowRunItemId,
        leaseOwner,
    );
    if (!claimedId) return;
    try {
        await scoreWorkflowTranscriptItem({
            ownership: {
                workflowRunItemId: input.prepared.workflowRunItemId,
                leaseOwner,
            },
            candidate: {
                itemId: input.item.id,
                transcript: input.prepared.selectedTranscript,
                variant: input.prepared.variant,
                artifact: input.prepared.artifact,
            },
            model: {
                sttModelId: input.sttModelId,
                providerId: input.prepared.identity.providerId,
                routeId: input.prepared.identity.routeId,
                configHash: input.prepared.identity.configHash,
            },
            provenance: {
                latencyMs: input.prepared.artifactLatencyMs,
                costUsd: input.prepared.artifactCostUsd,
                costSource: input.prepared.artifactCostSource,
            },
            evaluator: input.evaluator,
            apiKeys: input.apiKeys,
            context: input.scoringContext,
        });
    } catch (error) {
        await failEvaluation(claimedId, leaseOwner, error);
    }
}

async function claimEvaluation(workflowRunItemId: string, leaseOwner: string) {
    const leaseCutoff = new Date(Date.now() - workflowItemLeaseMs);
    const [claimed] = await db
        .update(workflowRunItems)
        .set({
            evaluationStatus: "running",
            claimedAt: new Date(),
            leaseOwner,
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(workflowRunItems.id, workflowRunItemId),
                sql`(${workflowRunItems.evaluationStatus} in ('pending', 'error') or (${workflowRunItems.evaluationStatus} = 'running' and ${workflowRunItems.claimedAt} < ${leaseCutoff}))`,
            ),
        )
        .returning({ id: workflowRunItems.id });
    return claimed?.id;
}

async function failEvaluation(id: string, leaseOwner: string, error: unknown) {
    await db
        .update(workflowRunItems)
        .set({
            evaluationStatus: "error",
            claimedAt: null,
            leaseOwner: null,
            error: error instanceof Error ? error.message : String(error),
            updatedAt: new Date(),
        })
        .where(
            and(
                eq(workflowRunItems.id, id),
                eq(workflowRunItems.leaseOwner, leaseOwner),
            ),
        );
}
