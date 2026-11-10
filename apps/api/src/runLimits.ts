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

// Spend counts by when it was paid: the spend ledger (spend_ledger,
// migration 0081) gets a row each time a cell's, final answer's or item's
// recorded spend grows, so a cell re-judged today counts only today's judge
// call, and a pipeline retried today counts today's steps. Runs still in
// progress count what they have recorded so far. A run started just under
// the cap can finish above it; the cap blocks the next run. Eval spend is
// what cells' own calls cost when made (model calls and the transcription
// their input needed; reused answers and transcripts are free) plus judge
// calls; pipeline spend is step calls, their judges, the judges comparing
// final answers with an eval run, and shared audio transcription. Spend of
// deleted runs still counts.
export async function assertTeamSpendUnderCap(
    db: IDb,
    teamId: string,
    capUsd: number | undefined,
): Promise<void> {
    if (capUsd === undefined) return;
    const result = await db.query<{ spentUsd: number | string | null }>(
        `select coalesce(sum(amount_usd), 0) as "spentUsd"
        from spend_ledger
        where team_id = $1
          and paid_at > now() - interval '24 hours'`,
        [teamId],
    );
    const spentUsd = Number(result.rows[0]?.spentUsd ?? 0);
    if (spentUsd < capUsd) return;
    throw new ApiConflictError(
        `This team has spent ${usd.format(spentUsd)} in the last 24 hours, reaching its ${usd.format(capUsd)} daily cap. New runs are blocked until spend falls below the cap.`,
    );
}
