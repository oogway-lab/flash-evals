import type { ProviderTransport } from "@flash-evals/api-contract";
import { TRANSPORT_LABELS } from "@/lib/labels";

export function transportLabel(transport: ProviderTransport): string {
    return TRANSPORT_LABELS[transport];
}
