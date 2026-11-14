import Link from "next/link";
import { requireActiveProject as requirePagePrincipal } from "@/server/projects/activeProject";
import { serverApiClient } from "@/server/api/client";
import { refreshModelPricesAction } from "@/app/actions/settings";
import { Page } from "@/components/layout/page";
import { PageHeader } from "@/components/layout/page-header";
import { ModelPriceTable } from "@/components/models/model-price-table";
import { PriceListStatus } from "@/components/models/price-list-status";
import { transportLabel } from "@/lib/transport";

export const dynamic = "force-dynamic";

export default async function ModelsPage() {
    const p = await requirePagePrincipal();
    const prices = await serverApiClient().listModelPrices(p.teamId);
    return (
        <Page>
            <PageHeader
                title="Models and prices"
                description="Every model on the Vercel AI Gateway and OpenRouter price lists, side by side. Prices are each provider's published price in USD per 1M tokens, input / output."
            />
            <div className="flex flex-col gap-6">
                <PriceListStatus
                    lists={prices.lists}
                    savedKeyProviders={prices.savedKeyProviders}
                    refreshAction={refreshModelPricesAction}
                />
                <p className="text-copy-14 text-muted-foreground">
                    {prices.preferredProvider
                        ? `New runs start each model on ${transportLabel(prices.preferredProvider)} (FLASH_EVALS_LLM_PROVIDER in apps/api/.env) when it has a key and lists the model.`
                        : 'FLASH_EVALS_LLM_PROVIDER in apps/api/.env is "auto", so new runs start each model on the first provider with a key.'}{" "}
                    <Link
                        href="/settings"
                        className="text-foreground underline underline-offset-4"
                    >
                        See key status in Settings
                    </Link>
                </p>
                <ModelPriceTable
                    models={prices.models}
                    savedKeyProviders={prices.savedKeyProviders}
                />
            </div>
        </Page>
    );
}
