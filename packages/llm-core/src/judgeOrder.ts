import { createHash } from "node:crypto";

/**
 * Whether the candidate's answer is shown to a head-to-head judge first
 * ("A"). Fixed per seed so a rerun asks the same question, and split about
 * evenly across seeds so position bias averages out. The seed is
 * `${cellId}:${taskKey}`; the scorer and the review panel must agree on it.
 */
export function candidateGoesFirst(seed: string): boolean {
    return createHash("sha256").update(seed).digest()[0]! % 2 === 0;
}

/** The seed the scorer uses for one answer's head-to-head task. */
export function judgeOrderSeed(cellId: string, taskKey: string): string {
    return `${cellId}:${taskKey}`;
}
