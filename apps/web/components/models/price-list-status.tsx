"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import type {
    IModelPriceListSource,
    ProviderTransport,
} from "@flash-evals/api-contract";
import type { IRefreshModelPricesState } from "@/app/actions/settings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { transportLabel } from "@/lib/transport";

const DATE_FORMAT = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
});

/**
 * One line per price list: how many models, when it was fetched, and whether
 * a key is saved, plus a button that asks the worker to fetch both again.
 */
export function PriceListStatus({
    lists,
    savedKeyProviders,
    refreshAction,
}: {
    lists: IModelPriceListSource[];
    savedKeyProviders: ProviderTransport[];
    refreshAction: () => Promise<IRefreshModelPricesState>;
}) {
    const [pending, startTransition] = useTransition();
    const [result, setResult] = useState<IRefreshModelPricesState>();
    return (
        <div className="flex flex-col gap-3">
            <ul className="flex flex-col gap-2">
                {lists.map((list) => {
                    const keySaved = savedKeyProviders.includes(list.provider);
                    return (
                        <li
                            key={list.provider}
                            className="flex flex-wrap items-center gap-x-3 gap-y-1 text-copy-14"
                        >
                            <span className="text-label-14 text-foreground">
                                {transportLabel(list.provider)}
                            </span>
                            <span className="text-muted-foreground">
                                {list.fetchedAt
                                    ? `${list.modelCount} models · prices fetched ${DATE_FORMAT.format(new Date(list.fetchedAt))} UTC`
                                    : "Prices not fetched yet"}
                            </span>
                            {keySaved ? (
                                <Badge variant="success">Key set</Badge>
                            ) : (
                                <Badge variant="warning">No key</Badge>
                            )}
                            {!keySaved && (
                                <Link
                                    href="/settings"
                                    className="text-foreground underline underline-offset-4"
                                >
                                    Add a key
                                </Link>
                            )}
                        </li>
                    );
                })}
            </ul>
            <div className="flex flex-wrap items-center gap-3">
                <Button
                    type="button"
                    variant="secondary"
                    loading={pending}
                    loadingText="Asking…"
                    onClick={() =>
                        startTransition(async () => {
                            setResult(await refreshAction());
                        })
                    }
                >
                    Fetch prices again
                </Button>
                <p role="status" className="text-copy-14 text-muted-foreground">
                    {result?.ok
                        ? "Fetching both price lists. Reload this page in a minute to see them."
                        : (result?.error ??
                          "Prices are fetched daily. Fetching uses no keys and costs nothing.")}
                </p>
            </div>
        </div>
    );
}
