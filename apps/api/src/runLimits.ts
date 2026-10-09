import { DEFAULT_MAX_RUN_CELLS } from "./config.js";
import type { IDb } from "./db.js";
import { ApiBadRequestError, ApiConflictError } from "./errors.js";

const count = new Intl.NumberFormat("en-US");
const usd = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
});

export function assertRunCellLimit(input: {
    itemCount: number;
    perItemCount: number;
    perItemLabel: "models" | "workflow nodes";
    maxRunCells?: number;
}): void {
    const maxRunCells = input.maxRunCells ?? DEFAULT_MAX_RUN_CELLS;
    const cells = input.itemCount * input.perItemCount;
    if (cells <= maxRunCells) return;
    throw new ApiBadRequestError(
        `This run would create ${count.format(cells)} cells (${count.format(input.itemCount)} items x ${count.format(input.perItemCount)} ${input.perItemLabel}); the limit is ${count.format(maxRunCells)}. Use a smaller dataset or fewer ${input.perItemLabel}.`,
    );
}

// Spend is attributed to the run's start time: cost recorded by any run created
// in the last 24 hours counts, including runs still in progress. A run started
// just under the cap can finish above it; the cap blocks the next run.
export async function assertTeamSpendUnderCap(
    db: IDb,
    teamId: string,
    capUsd: number | undefined,
): Promise<void> {
    if (capUsd === undefined) return;
    const result = await db.query<{ spentUsd: number | string | null }>(
        `select
            coalesce((
                select sum(c.cost_usd)
                from run_cells c
                join runs r on r.id = c.run_id
                where r.team_id = $1
                  and r.created_at > now() - interval '24 hours'
            ), 0)
            + coalesce((
                select sum(c.cost_usd)
                from workflow_run_cells c
                join workflow_runs r on r.id = c.workflow_run_id
                where r.team_id = $1
                  and r.created_at > now() - interval '24 hours'
            ), 0)
            + coalesce((
                select sum(i.incurred_cost_usd)
                from workflow_run_items i
                join workflow_runs r on r.id = i.workflow_run_id
                where r.team_id = $1
                  and r.created_at > now() - interval '24 hours'
            ), 0) as "spentUsd"`,
        [teamId],
    );
    const spentUsd = Number(result.rows[0]?.spentUsd ?? 0);
    if (spentUsd < capUsd) return;
    throw new ApiConflictError(
        `This team has spent ${usd.format(spentUsd)} in the last 24 hours, reaching its ${usd.format(capUsd)} daily cap. New runs are blocked until spend falls below the cap.`,
    );
}
