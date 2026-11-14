import type { ProviderTransport } from "@flash-evals/api-contract";
import { PROVIDER_TRANSPORT_LABELS } from "@/lib/labels";

export function transportLabel(transport: ProviderTransport): string {
    return PROVIDER_TRANSPORT_LABELS[transport];
}
