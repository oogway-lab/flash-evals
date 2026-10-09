import { and, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../server/db/client";
import { getRunProgressForRuns } from "../server/runs/service";

type RunRow = typeof schema.runs.$inferSelect;

interface Candidate {
    run: RunRow;
    total: number;
}

function sourceRunId(run: RunRow): string | undefined {
    return run.configSnapshot.sourceRunId;
}

function withSourceRun(run: RunRow, sourceRunId: string) {
    return {
        ...run.configSnapshot,
        sourceRunId,
    };
}

function nearestPriorWithSameProgress(
    run: Candidate,
    candidates: Candidate[],
): Candidate | undefined {
    const prior = candidates.filter(
        (candidate) =>
            candidate.run.id !== run.run.id &&
            candidate.run.teamId === run.run.teamId &&
            candidate.run.datasetId === run.run.datasetId &&
            candidate.run.status === "completed" &&
            candidate.total === run.total &&
            candidate.run.createdAt < run.run.createdAt,
    );

    return prior.sort(
        (a, b) => b.run.createdAt.getTime() - a.run.createdAt.getTime(),
    )[0];
}

async function main() {
    const apply = process.argv.includes("--apply");
    const runs = await db
        .select()
        .from(schema.runs)
        .orderBy(schema.runs.createdAt);
    const progressByRun = await getRunProgressForRuns(
        runs.map((run) => run.id),
    );
    const candidates = runs.map((run) => ({
        run,
        total: progressByRun.get(run.id)?.total ?? 0,
    }));

    const updates = candidates
        .filter((candidate) => !sourceRunId(candidate.run))
        .map((candidate) => ({
            run: candidate.run,
            total: candidate.total,
            source: nearestPriorWithSameProgress(candidate, candidates),
        }))
        .filter(
            (
                update,
            ): update is {
                run: RunRow;
                total: number;
                source: Candidate;
            } => update.source !== undefined,
        );

    if (updates.length === 0) {
        console.info("No existing runs need inferred sourceRunId updates.");
        return;
    }

    for (const update of updates) {
        console.info(
            `${apply ? "Updating" : "Would update"} ${update.run.id} -> ${update.source.run.id} (dataset ${update.run.datasetId}, progress ${update.total})`,
        );
    }

    if (!apply) {
        console.info(
            `Dry run only. Re-run with --apply to update ${updates.length} runs.`,
        );
        return;
    }

    await db.transaction(async (tx) => {
        for (const update of updates) {
            await tx
                .update(schema.runs)
                .set({
                    configSnapshot: withSourceRun(
                        update.run,
                        update.source.run.id,
                    ),
                })
                .where(
                    and(
                        eq(schema.runs.id, update.run.id),
                        isNull(
                            sql`${schema.runs.configSnapshot}->>'sourceRunId'`,
                        ),
                    ),
                );
        }
    });

    console.info(`Updated ${updates.length} runs.`);
}

main()
    .catch((err) => {
        console.error(err);
        process.exitCode = 1;
    })
    .finally(async () => {
        await db.$client?.end?.();
    });
