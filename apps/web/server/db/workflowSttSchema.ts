import { sql } from "drizzle-orm";
import {
    boolean,
    check,
    doublePrecision,
    index,
    jsonb,
    pgTable,
    text,
    timestamp,
    unique,
    uuid,
    type AnyPgColumn,
} from "drizzle-orm/pg-core";
import type {
    ITranscriptSegment,
    ITranscriptSpeaker,
    IWorkflowSttProviderMetadata,
    IWorkflowSttScoreDetails,
} from "./jsonTypes";
import { costSource, scorerType } from "./schemaEnums";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
    timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export function createWorkflowSttTables(references: {
    workflowRunId: () => AnyPgColumn;
    datasetItemId: () => AnyPgColumn;
}) {
    const workflowRunItems = pgTable(
        "workflow_run_items",
        {
            id: id(),
            workflowRunId: uuid("workflow_run_id")
                .notNull()
                .references(references.workflowRunId, { onDelete: "cascade" }),
            datasetItemId: uuid("dataset_item_id")
                .notNull()
                .references(references.datasetItemId),
            selectedTranscript: text("selected_transcript"),
            transcriptVariant: text("transcript_variant"),
            detectedLanguage: text("detected_language"),
            providerId: text("provider_id"),
            routeId: text("route_id"),
            sttModelId: text("stt_model_id"),
            canonicalModelId: text("canonical_model_id"),
            language: text("language"),
            configHash: text("config_hash"),
            configJson: jsonb("config_json").$type<Record<string, unknown>>(),
            segmentsJson: jsonb("segments_json")
                .$type<ITranscriptSegment[]>()
                .notNull()
                .default([]),
            speakersJson: jsonb("speakers_json")
                .$type<ITranscriptSpeaker[]>()
                .notNull()
                .default([]),
            warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
            providerMetadata:
                jsonb(
                    "provider_metadata",
                ).$type<IWorkflowSttProviderMetadata>(),
            artifactLatencyMs: doublePrecision("artifact_latency_ms"),
            artifactCostUsd: doublePrecision("artifact_cost_usd"),
            artifactCostSource: costSource("artifact_cost_source"),
            lookupLatencyMs: doublePrecision("lookup_latency_ms"),
            transcriptionLatencyMs: doublePrecision("transcription_latency_ms"),
            transliterationLatencyMs: doublePrecision(
                "transliteration_latency_ms",
            ),
            incurredCostUsd: doublePrecision("incurred_cost_usd"),
            incurredCostSource: costSource("incurred_cost_source"),
            cacheHit: boolean("cache_hit"),
            preparationStatus: text("preparation_status")
                .notNull()
                .default("pending"),
            evaluationStatus: text("evaluation_status")
                .notNull()
                .default("pending"),
            claimedAt: timestamp("claimed_at", { withTimezone: true }),
            leaseOwner: text("lease_owner"),
            error: text("error"),
            createdAt: createdAt(),
            updatedAt: timestamp("updated_at", { withTimezone: true })
                .notNull()
                .defaultNow(),
        },
        (t) => [
            unique().on(t.workflowRunId, t.datasetItemId),
            check(
                "workflow_run_items_transcript_variant_check",
                sql`${t.transcriptVariant} is null or ${t.transcriptVariant} in ('raw', 'latin')`,
            ),
            check(
                "workflow_run_items_preparation_status_check",
                sql`${t.preparationStatus} in ('pending', 'running', 'completed', 'error')`,
            ),
            check(
                "workflow_run_items_evaluation_status_check",
                sql`${t.evaluationStatus} in ('pending', 'running', 'completed', 'partial', 'error', 'skipped')`,
            ),
            index("workflow_run_items_run_status_idx").on(
                t.workflowRunId,
                t.preparationStatus,
                t.evaluationStatus,
            ),
            index("workflow_run_items_dataset_item_id_idx").on(t.datasetItemId),
        ],
    );

    const workflowRunItemScores = pgTable(
        "workflow_run_item_scores",
        {
            id: id(),
            workflowRunItemId: uuid("workflow_run_item_id")
                .notNull()
                .references(() => workflowRunItems.id, { onDelete: "cascade" }),
            scorerType: scorerType("scorer_type").notNull(),
            status: text("status").notNull(),
            score: doublePrecision("score"),
            detailsJson:
                jsonb("details_json").$type<IWorkflowSttScoreDetails>(),
            rationale: text("rationale"),
            error: text("error"),
            createdAt: createdAt(),
            updatedAt: timestamp("updated_at", { withTimezone: true })
                .notNull()
                .defaultNow(),
        },
        (t) => [
            unique().on(t.workflowRunItemId, t.scorerType),
            // Compared as text on purpose. Drizzle runs every pending migration
            // inside one transaction, and Postgres rejects an enum value used in
            // the same transaction that added it ("unsafe use of new value").
            // 'transcript_metric' is added to scorer_type in 0028, so an enum
            // literal here breaks any from-scratch migration run. See
            // 0042_workflow_run_item_scores.sql.
            check(
                "workflow_run_item_scores_scorer_type_check",
                sql`${t.scorerType}::text in ('transcript_metric', 'transcript_judge')`,
            ),
            check(
                "workflow_run_item_scores_status_check",
                sql`${t.status} in ('completed', 'skipped', 'error')`,
            ),
            index("workflow_run_item_scores_item_id_idx").on(
                t.workflowRunItemId,
            ),
        ],
    );

    return { workflowRunItems, workflowRunItemScores };
}
