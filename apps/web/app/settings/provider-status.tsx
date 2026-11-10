import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import type {
    IProviderStatusResponse,
    ProviderTransport,
} from "@flash-evals/api-contract";
import { SectionTitle } from "@/components/layout/section-title";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { transportLabel } from "@/lib/transport";

const PROVIDERS: ProviderTransport[] = [
    "gateway",
    "openrouter",
    "openai",
    "anthropic",
    "google",
    "bifrost",
];

const SOURCE_LABEL = {
    env: "Key from .env",
    settings: "Key saved in Settings",
} as const;

/**
 * Read-only: which providers have a key and where it comes from, and which
 * provider runs start on. Both are set in the API's .env (or keys below);
 * nothing here changes them.
 */
export function ProviderStatus({
    status,
}: {
    status: IProviderStatusResponse | undefined;
}) {
    const keys = status?.keys ?? [];
    return (
        <section
            aria-labelledby="provider-status-heading"
            className="flex flex-col gap-4"
        >
            <SectionTitle
                id="provider-status-heading"
                description="Which providers can run models, and where their keys come from. Keys are read from apps/api/.env, or saved under Provider keys below; a key saved here wins."
            >
                Model providers
            </SectionTitle>
            {status === undefined ? (
                <p role="status" className="text-copy-14 text-muted-foreground">
                    Provider status is temporarily unavailable.
                </p>
            ) : keys.length === 0 ? (
                <Alert variant="warning" className="max-w-xl">
                    <TriangleAlert aria-hidden="true" />
                    <AlertDescription>
                        No provider has a key, so no model can run. Set
                        AI_GATEWAY_API_KEY (or another provider&apos;s key) in
                        apps/api/.env and restart, or save one below.
                    </AlertDescription>
                </Alert>
            ) : null}
            <ul className="flex flex-col gap-2">
                {PROVIDERS.map((provider) => {
                    const key = keys.find(
                        (entry) => entry.provider === provider,
                    );
                    return (
                        <li
                            key={provider}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-copy-14"
                        >
                            <span className="text-label-14 text-foreground">
                                {transportLabel(provider)}
                            </span>
                            {key ? (
                                <Badge variant="success">
                                    {SOURCE_LABEL[key.source]}
                                </Badge>
                            ) : (
                                <Badge variant="outline">No key</Badge>
                            )}
                            {status?.defaultProvider === provider && (
                                <Badge variant="outline">Runs start here</Badge>
                            )}
                            {provider === "bifrost" && status?.bifrost ? (
                                <BifrostDetails bifrost={status.bifrost} />
                            ) : null}
                        </li>
                    );
                })}
            </ul>
            <p className="text-copy-14 text-muted-foreground">
                {status?.defaultProvider
                    ? `New runs start each model on ${transportLabel(status.defaultProvider)} (FLASH_EVALS_LLM_PROVIDER in apps/api/.env) when it has a key and lists the model; you can switch any model in the run form.`
                    : 'FLASH_EVALS_LLM_PROVIDER in apps/api/.env is "auto", so new runs start each model on the first provider with a key. Set it to vercel-ai-gateway to start on Vercel.'}
            </p>
            <p className="text-copy-14 text-muted-foreground">
                To check:{" "}
                <Link
                    href="/models"
                    className="text-foreground underline underline-offset-4"
                >
                    Models and prices
                </Link>{" "}
                lists both price lists and which providers have a key; every run
                result says which provider ran each model. Bifrost is configured
                with BIFROST_API_KEY and BIFROST_BASE_URL in apps/api/.env (set
                FLASH_EVALS_LLM_PROVIDER=bifrost to start runs on it) or saved
                below; models are offered on it under the ids its own model list
                gives.
            </p>
        </section>
    );
}

/** Bifrost's address and whether its model list could be fetched. */
function BifrostDetails({
    bifrost,
}: {
    bifrost: NonNullable<IProviderStatusResponse["bifrost"]>;
}) {
    return (
        <>
            {bifrost.baseUrlHost ? (
                <span className="text-copy-14 text-muted-foreground">
                    {bifrost.baseUrlHost}
                </span>
            ) : null}
            {bifrost.modelListError ? (
                <span
                    role="note"
                    className="basis-full text-copy-14 text-warning"
                >
                    {bifrost.modelListError}
                </span>
            ) : bifrost.modelCount !== undefined ? (
                <span className="text-copy-14 text-muted-foreground">
                    {`${bifrost.modelCount.toLocaleString("en-US")} models listed`}
                </span>
            ) : null}
        </>
    );
}
