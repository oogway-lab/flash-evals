"use client";

import Link from "next/link";
import type {
    IModelProviderOffer,
    IRunSetupModelOption,
    ProviderTransport,
} from "@flash-evals/api-contract";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { offerPrice, providerList } from "@/lib/model-prices";
import { transportLabel } from "@/lib/transport";

/**
 * Every provider that lists the model with its price. Older API responses
 * carry only the providers that have a key; treat those as offers without a
 * price.
 */
export function modelOffers(
    model: IRunSetupModelOption | undefined,
): IModelProviderOffer[] {
    if (!model) return [];
    return (
        model.providers ??
        model.transports.map((transport) => ({
            transport,
            modelId: model.id,
            keySaved: true,
        }))
    );
}

/**
 * The provider a model runs on, as the run request carries it. On Bifrost
 * it names the id Bifrost lists the model under, which is sent as it is.
 */
export function transportAssignmentFor(
    model: IRunSetupModelOption | undefined,
    modelId: string,
    transport: ProviderTransport | undefined,
): Array<{
    modelId: string;
    transport: ProviderTransport;
    transportModelId?: string;
}> {
    if (!transport) return [];
    const bifrostId =
        transport === "bifrost"
            ? modelOffers(model).find((offer) => offer.transport === "bifrost")
                  ?.modelId
            : undefined;
    return [
        {
            modelId,
            transport,
            ...(bifrostId && bifrostId !== modelId
                ? { transportModelId: bifrostId }
                : {}),
        },
    ];
}

function optionText(offer: IModelProviderOffer): string {
    const price = offerPrice(offer);
    return [
        transportLabel(offer.transport),
        price ?? "no price listed",
        ...(offer.keySaved ? [] : ["no key"]),
    ].join(" · ");
}

/**
 * Which provider runs a model, showing each provider's list price (in / out
 * per 1M tokens). Providers without a key are listed but can't
 * be chosen, and a model no keyed provider carries says which key is missing.
 */
export function ProviderSelect({
    id,
    model,
    value,
    onChange,
    disabled,
    label,
}: {
    id: string;
    model: IRunSetupModelOption | undefined;
    value: ProviderTransport | undefined;
    onChange: (transport: ProviderTransport) => void;
    disabled?: boolean;
    /** Accessible name when no visible label points at this control. */
    label?: string;
}) {
    const offers = modelOffers(model);
    const usable = offers.filter((offer) => offer.keySaved);
    if (offers.length === 0)
        return (
            <p className="px-3 py-2 text-copy-14 text-muted-foreground">
                No provider lists this model
            </p>
        );
    const current = usable.some((offer) => offer.transport === value)
        ? value
        : usable[0]?.transport;
    return (
        <div className="flex min-w-0 flex-col gap-1">
            <Select
                value={current ?? ""}
                onValueChange={(next) => {
                    if (typeof next === "string" && next)
                        onChange(next as ProviderTransport);
                }}
                disabled={disabled || usable.length === 0}
            >
                <SelectTrigger id={id} aria-label={label}>
                    <SelectValue placeholder="No provider with a key" />
                </SelectTrigger>
                <SelectContent>
                    {offers.map((offer) => (
                        <SelectItem
                            key={offer.transport}
                            value={offer.transport}
                            disabled={!offer.keySaved}
                        >
                            {optionText(offer)}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
            {usable.length === 0 && (
                <ul className="flex flex-col text-label-12 text-muted-foreground">
                    {offers.map((offer) => (
                        <li key={offer.transport}>{optionText(offer)}</li>
                    ))}
                </ul>
            )}
            {usable.length === 0 && (
                <p role="alert" className="text-label-12 text-eval-warning">
                    No key for{" "}
                    {providerList(offers.map((offer) => offer.transport))}. Add
                    one in Settings or the repo&apos;s .env files.{" "}
                    <Link
                        href="/settings"
                        className="underline underline-offset-4"
                    >
                        Add a key
                    </Link>
                </p>
            )}
        </div>
    );
}
