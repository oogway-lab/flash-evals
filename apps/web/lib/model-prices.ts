import type {
    IModelProviderOffer,
    ProviderTransport,
} from "@flash-evals/api-contract";
import { transportLabel } from "@/lib/transport";

/** "$0.80", "$0.006": two decimals from 10 cents up, two significant digits below. */
export function fmtPerMillion(raw: number): string {
    // Per-token prices times a million carry float noise (0.0999999…).
    const rounded = Math.round(raw * 1e6) / 1e6;
    // Two significant digits can round up to 0.10, which reads as cents.
    const value = rounded >= 0.1 ? rounded : Number(rounded.toPrecision(2));
    return value >= 0.1 ? `$${value.toFixed(2)}` : `$${value}`;
}

/** "$0.80 / $2.55", or undefined when the provider lists no price. */
export function offerPrice(
    offer: Pick<IModelProviderOffer, "inputPerMillion" | "outputPerMillion">,
): string | undefined {
    if (
        offer.inputPerMillion === undefined ||
        offer.outputPerMillion === undefined
    )
        return undefined;
    return `${fmtPerMillion(offer.inputPerMillion)} / ${fmtPerMillion(offer.outputPerMillion)}`;
}

/** "Vercel AI Gateway · $0.80 / $2.55 per 1M tokens in / out · no key" */
export function offerSummary(offer: IModelProviderOffer): string {
    const price = offerPrice(offer);
    return [
        transportLabel(offer.transport),
        price ? `${price} per 1M tokens in / out` : "no price listed",
        ...(offer.keySaved ? [] : ["no key"]),
    ].join(" · ");
}

/**
 * The provider that is no more expensive on input and output and cheaper on
 * at least one. Undefined when they tie, or when one is cheaper for input and
 * the other for output, since then it depends on the call.
 */
export function cheaperOffer(
    offers: readonly IModelProviderOffer[],
): ProviderTransport | undefined {
    const priced = offers.filter(
        (offer) =>
            offer.inputPerMillion !== undefined &&
            offer.outputPerMillion !== undefined,
    );
    if (priced.length < 2) return undefined;
    return priced.find((candidate) =>
        priced.every(
            (other) =>
                other === candidate ||
                (candidate.inputPerMillion! <= other.inputPerMillion! &&
                    candidate.outputPerMillion! <= other.outputPerMillion! &&
                    (candidate.inputPerMillion! < other.inputPerMillion! ||
                        candidate.outputPerMillion! < other.outputPerMillion!)),
        ),
    )?.transport;
}

/** "Vercel AI Gateway and OpenRouter" */
export function providerList(transports: readonly ProviderTransport[]): string {
    const labels = transports.map(transportLabel);
    if (labels.length <= 1) return labels.join("");
    return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}
