import { isRecord } from "../../lib/objects";

export interface ITranscriptionSpend {
    costUsd?: number;
    costSource: "computed" | "unavailable";
}

/** A checkpoint belongs to a cell/item, never to the shared transcript cache. */
export function transcriptionSpend(
    value: unknown,
    previousCost?: number | null,
): ITranscriptionSpend {
    if (isRecord(value) && value.costSource === "unavailable")
        return { costSource: "unavailable" };
    const costUsd = isRecord(value) ? value.costUsd : previousCost;
    return {
        costUsd:
            typeof costUsd === "number" &&
            Number.isFinite(costUsd) &&
            costUsd >= 0
                ? costUsd
                : 0,
        costSource: "computed",
    };
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
        async record(costUsd: number | undefined) {
            const next: ITranscriptionSpend =
                current.costSource === "unavailable" ||
                costUsd === undefined ||
                !Number.isFinite(costUsd) ||
                costUsd < 0
                    ? { costSource: "unavailable" }
                    : {
                          costUsd: (current.costUsd ?? 0) + costUsd,
                          costSource: "computed",
                      };
            await persist(next);
            current = next;
            recorded = true;
        },
    };
}
