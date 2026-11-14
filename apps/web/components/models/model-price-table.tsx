"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type {
    IModelPriceRow,
    IModelProviderOffer,
    ProviderTransport,
} from "@flash-evals/api-contract";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Num } from "@/components/ui/num";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { cheaperOffer, offerPrice } from "@/lib/model-prices";
import { transportLabel } from "@/lib/transport";

type Filter = "all" | "both" | "gateway" | "openrouter";

const FILTERS: Array<{ value: Filter; label: string }> = [
    { value: "all", label: "All models" },
    { value: "both", label: "On both lists" },
    { value: "gateway", label: "Only on Vercel AI Gateway" },
    { value: "openrouter", label: "Only on OpenRouter" },
];

const PAGE_SIZE = 100;
const LISTS = ["gateway", "openrouter"] as const;

function offerFor(
    row: IModelPriceRow,
    provider: ProviderTransport,
): IModelProviderOffer | undefined {
    return row.providers.find((offer) => offer.transport === provider);
}

/** Whether a row passes the filter and the search text. */
export function rowMatches(
    row: IModelPriceRow,
    filter: Filter,
    query: string,
): boolean {
    const onGateway = Boolean(offerFor(row, "gateway"));
    const onOpenRouter = Boolean(offerFor(row, "openrouter"));
    if (filter === "both" && !(onGateway && onOpenRouter)) return false;
    if (filter === "gateway" && !(onGateway && !onOpenRouter)) return false;
    if (filter === "openrouter" && !(onOpenRouter && !onGateway)) return false;
    const text = query.trim().toLowerCase();
    if (!text) return true;
    return [
        row.label,
        row.vendor,
        row.id,
        ...row.providers.map((offer) => offer.modelId),
    ].some((value) => value.toLowerCase().includes(text));
}

/**
 * Both price lists side by side. Ticked models can start a new run, which
 * opens the run form with them selected; the provider for each is picked
 * there, starting from the preferred one.
 */
export function ModelPriceTable({
    models,
    savedKeyProviders,
}: {
    models: IModelPriceRow[];
    savedKeyProviders: ProviderTransport[];
}) {
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState<Filter>("all");
    const [limit, setLimit] = useState(PAGE_SIZE);
    const [picked, setPicked] = useState<string[]>([]);
    const matches = useMemo(
        () => models.filter((row) => rowMatches(row, filter, query)),
        [models, filter, query],
    );
    const shown = matches.slice(0, limit);
    const toggle = (id: string) =>
        setPicked((previous) =>
            previous.includes(id)
                ? previous.filter((value) => value !== id)
                : [...previous, id],
        );
    const runHref = `/runs/new?models=${encodeURIComponent(picked.join(","))}`;
    return (
        <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
                <div className="flex min-w-0 flex-1 basis-60 flex-col gap-2">
                    <Label htmlFor="model-search">Search</Label>
                    <Input
                        id="model-search"
                        type="search"
                        value={query}
                        onChange={(event) => {
                            setQuery(event.target.value);
                            setLimit(PAGE_SIZE);
                        }}
                        placeholder="glm, claude, deepseek…"
                    />
                </div>
                <div className="flex flex-col gap-2">
                    <Label htmlFor="model-filter">Show</Label>
                    <Select
                        value={filter}
                        onValueChange={(value) => {
                            setFilter(value as Filter);
                            setLimit(PAGE_SIZE);
                        }}
                    >
                        <SelectTrigger id="model-filter" className="w-60">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            {FILTERS.map((option) => (
                                <SelectItem
                                    key={option.value}
                                    value={option.value}
                                >
                                    {option.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
                <p role="status" className="text-copy-14 text-muted-foreground">
                    {matches.length} of {models.length} models
                    {picked.length > 0 ? ` · ${picked.length} ticked` : ""}
                </p>
                {picked.length > 0 && (
                    <>
                        <Link
                            href={runHref as `/runs/new?${string}`}
                            className={buttonVariants({ size: "sm" })}
                        >
                            Start a run with {picked.length} ticked
                        </Link>
                        <button
                            type="button"
                            onClick={() => setPicked([])}
                            className="text-copy-14 text-muted-foreground underline underline-offset-4 hover:text-foreground"
                        >
                            Clear
                        </button>
                    </>
                )}
            </div>
            <Table>
                <TableHeader>
                    <TableRow>
                        <TableHead className="w-10">
                            <span className="sr-only">Tick</span>
                        </TableHead>
                        <TableHead>Model</TableHead>
                        {LISTS.map((provider) => (
                            <TableHead key={provider} className="text-right">
                                {transportLabel(provider)}
                                <span className="block text-label-12 text-muted-foreground">
                                    in / out per 1M tokens
                                    {savedKeyProviders.includes(provider)
                                        ? ""
                                        : " · no key"}
                                </span>
                            </TableHead>
                        ))}
                    </TableRow>
                </TableHeader>
                <TableBody>
                    {shown.map((row) => (
                        <PriceRow
                            key={row.id}
                            row={row}
                            picked={picked.includes(row.id)}
                            onToggle={() => toggle(row.id)}
                        />
                    ))}
                </TableBody>
            </Table>
            {matches.length > shown.length && (
                <button
                    type="button"
                    onClick={() => setLimit((value) => value + PAGE_SIZE)}
                    className="self-start text-copy-14 text-foreground underline underline-offset-4"
                >
                    Show {Math.min(PAGE_SIZE, matches.length - shown.length)}{" "}
                    more
                </button>
            )}
        </div>
    );
}

function PriceRow({
    row,
    picked,
    onToggle,
}: {
    row: IModelPriceRow;
    picked: boolean;
    onToggle: () => void;
}) {
    const cheaper = cheaperOffer(row.providers);
    const checkboxId = `pick-${row.id}`;
    return (
        <TableRow data-state={picked ? "selected" : undefined}>
            <TableCell>
                <Checkbox
                    id={checkboxId}
                    checked={picked}
                    onChange={onToggle}
                    aria-label={`Tick ${row.label}`}
                />
            </TableCell>
            <TableCell>
                <label
                    htmlFor={checkboxId}
                    className="flex min-w-0 flex-col gap-0.5"
                >
                    <span className="text-foreground">{row.label}</span>
                    <span className="text-label-12 text-muted-foreground">
                        {row.vendor}
                    </span>
                </label>
            </TableCell>
            {LISTS.map((provider) => {
                const offer = offerFor(row, provider);
                const price = offer ? offerPrice(offer) : undefined;
                return (
                    <TableCell key={provider} className="text-right">
                        {offer ? (
                            <span className="inline-flex flex-col items-end gap-0.5">
                                <span className="inline-flex items-center gap-2">
                                    {cheaper === provider && (
                                        <Badge variant="success">Cheaper</Badge>
                                    )}
                                    <Num>{price ?? "No price"}</Num>
                                </span>
                                <span className="text-mono-13 text-muted-foreground">
                                    {offer.modelId}
                                </span>
                            </span>
                        ) : (
                            <span className="text-muted-foreground">
                                Not listed
                            </span>
                        )}
                    </TableCell>
                );
            })}
        </TableRow>
    );
}
