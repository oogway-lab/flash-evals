import { isRecord } from "../../lib/objects";

/**
 * Spend so far. costUsd is the known part; "unavailable" means some part's
 * cost is not known, so the real total may be higher than costUsd.
 */
export interface ITranscriptionSpend {
    costUsd?: number;
    costSource: "computed" | "unavailable";
}

function knownCost(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : undefined;
}

/** A checkpoint belongs to a cell/item, never to the shared transcript cache. */
export function transcriptionSpend(
    value: unknown,
    previousCost?: number | null,
): ITranscriptionSpend {
    if (isRecord(value) && value.costSource === "unavailable") {
        const costUsd = knownCost(value.costUsd);
        return {
            ...(costUsd !== undefined ? { costUsd } : {}),
            costSource: "unavailable",
        };
    }
    const costUsd = isRecord(value) ? value.costUsd : previousCost;
    return { costUsd: knownCost(costUsd) ?? 0, costSource: "computed" };
}

/** Persist each paid part before another provider request can fail. */
export function trackTranscriptionSpend(
    initial: ITranscriptionSpend,
    persist: (spend: ITranscriptionSpend) => Promise<void>,
) {
    let current = initial;
    let recorded = false;
    return {
        get current() {
            return current;
        },
        get recorded() {
            return recorded;
        },
        /** An unknown part keeps the known spend and marks it incomplete. */
        async record(costUsd: number | undefined) {
            const part = knownCost(costUsd);
            const next: ITranscriptionSpend = {
                costUsd: (current.costUsd ?? 0) + (part ?? 0),
                costSource:
                    current.costSource === "unavailable" || part === undefined
                        ? "unavailable"
                        : "computed",
            };
            await persist(next);
            current = next;
            recorded = true;
        },
    };
}
