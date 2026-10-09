import { eq, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
    datasets,
    datasetItems,
    datasetSchemas,
    prompts,
} from "@/server/db/schema";
import { getRunCounts, listRecentRuns } from "@/server/runs/service";
import { enrichRunRows } from "@/server/runs/listReads";
import { activeDatasetWhere } from "@/server/datasets/reads";
import { timedSpan } from "@/server/lib/timing";

export async function getDashboardStats(teamId: string) {
    return timedSpan("dashboard.getStats", async () => {
        const [
            datasetCountRows,
            promptCountRows,
            runCounts,
            schemaRows,
            itemRows,
        ] = await Promise.all([
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(datasets)
                .where(activeDatasetWhere(teamId)),
            db
                .select({ count: sql<number>`count(*)::int` })
                .from(prompts)
                .where(eq(prompts.teamId, teamId)),
            getRunCounts(teamId),
            db
                .select({ datasetId: datasetSchemas.datasetId })
                .from(datasetSchemas)
                .innerJoin(datasets, eq(datasetSchemas.datasetId, datasets.id))
                .where(activeDatasetWhere(teamId)),
            db
                .select({
                    datasetId: datasetItems.datasetId,
                    count: sql<number>`count(*)::int`,
                })
                .from(datasetItems)
                .innerJoin(datasets, eq(datasetItems.datasetId, datasets.id))
                .where(activeDatasetWhere(teamId))
                .groupBy(datasetItems.datasetId),
        ]);

        const [datasetCount] = datasetCountRows;
        const [promptCount] = promptCountRows;

        return {
            datasetCount: datasetCount?.count ?? 0,
            promptCount: promptCount?.count ?? 0,
            runCount: runCounts.total,
            runningCount: runCounts.active,
            hasDatasetWithSchema: schemaRows.length > 0,
            hasDatasetWithItems: itemRows.some((r) => r.count > 0),
            hasPrompt: (promptCount?.count ?? 0) > 0,
        };
    });
}

export async function getRecentRuns(teamId: string, limit = 5) {
    return timedSpan("dashboard.getRecentRuns", async () => {
        const recent = await listRecentRuns(teamId, limit);
        return enrichRunRows(recent);
    });
}
