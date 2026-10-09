"use client";

import * as React from "react";
import { Select as SelectPrimitive } from "@base-ui/react/select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/cn";

interface ISelectItemEntry {
    value: string;
    label: React.ReactNode;
}

/**
 * Base UI shows the selected item's label in `<SelectValue>` only when it
 * knows the items up front (`items`); Radix read the label from the mounted
 * item. To keep `<SelectItem value="x">Label</SelectItem>` call sites as they
 * are, `Select` walks its children for `SelectItem`s and builds `items` from
 * them. Items must be rendered inline (or in fragments / `.map`), not hidden
 * inside another component, or the trigger falls back to the raw value.
 */
function collectItems(
    node: React.ReactNode,
    out: ISelectItemEntry[] = [],
): ISelectItemEntry[] {
    React.Children.forEach(node, (child) => {
        if (!React.isValidElement(child)) return;
        const props = child.props as {
            value?: unknown;
            children?: React.ReactNode;
        };
        if (child.type === SelectItem) {
            if (typeof props.value === "string") {
                out.push({ value: props.value, label: props.children });
            }
            return;
        }
        if (props.children !== undefined) collectItems(props.children, out);
    });
    return out;
}

/**
 * The plain text of a label, for comparing labels that are not strings. It is
 * `undefined` when part of the label is an element with no children to read
 * text from (an icon, a `<Badge status="x" />`): its output can't be derived,
 * so such labels must not be judged equal by their text.
 */
function labelText(node: React.ReactNode): string | undefined {
    if (typeof node === "string" || typeof node === "number") {
        return String(node);
    }
    if (node === null || node === undefined || typeof node === "boolean") {
        return "";
    }
    if (Array.isArray(node)) {
        let text = "";
        for (const part of node) {
            const partText = labelText(part);
            if (partText === undefined) return undefined;
            text += partText;
        }
        return text;
    }
    if (React.isValidElement(node)) {
        const { children } = node.props as { children?: React.ReactNode };
        return children === undefined ? undefined : labelText(children);
    }
    return undefined;
}

/** Equal by text when both labels have text, otherwise by identity. */
function sameLabel(a: React.ReactNode, b: React.ReactNode): boolean {
    if (a === b) return true;
    const textA = labelText(a);
    return textA !== undefined && textA === labelText(b);
}

/**
 * Two item lists are "the same" when their values and labels match. A label
 * like `{name} ({count} items)` is a fresh array of nodes on every render, so
 * comparing those by identity would never settle; they are compared by text.
 * A label whose text can't be derived is compared by identity instead, so a
 * stale label never sticks (it costs one `items` update per parent render).
 */
function sameItems(
    a: readonly ISelectItemEntry[],
    b: readonly ISelectItemEntry[],
): boolean {
    return (
        a.length === b.length &&
        a.every((item, i) => {
            const other = b[i];
            return (
                item.value === other.value && sameLabel(item.label, other.label)
            );
        })
    );
}

export type ISelectProps = Omit<
    SelectPrimitive.Root.Props<string, false>,
    "value" | "defaultValue" | "onValueChange" | "items" | "multiple"
> & {
    /** Controlled value. An empty string means no selection (placeholder). */
    value?: string;
    defaultValue?: string;
    /** Called with the chosen item's value (never `null`). */
    onValueChange?: (value: string) => void;
};

/**
 * Pass `name` (and `defaultValue`/`required`) to submit with a form; Base UI
 * renders the hidden input that carries the value.
 */
export function Select({
    children,
    value,
    defaultValue,
    onValueChange,
    ...props
}: ISelectProps) {
    // Keep `items` referentially stable across renders that don't change it,
    // without touching a ref during render: adjust state in render, and only
    // when the values or label text really differ.
    const collected = collectItems(children);
    const [items, setItems] = React.useState(collected);
    if (!sameItems(items, collected)) setItems(collected);

    return (
        <SelectPrimitive.Root<string>
            items={items}
            value={value === undefined ? undefined : value || null}
            defaultValue={
                defaultValue === undefined ? undefined : defaultValue || null
            }
            onValueChange={
                onValueChange && ((next) => onValueChange(next ?? ""))
            }
            {...props}
        >
            {children}
        </SelectPrimitive.Root>
    );
}

export function SelectGroup(props: SelectPrimitive.Group.Props) {
    return <SelectPrimitive.Group data-slot="select-group" {...props} />;
}

export function SelectValue(props: SelectPrimitive.Value.Props) {
    return <SelectPrimitive.Value data-slot="select-value" {...props} />;
}

export function SelectTrigger({
    className,
    children,
    ...props
}: SelectPrimitive.Trigger.Props) {
    return (
        <SelectPrimitive.Trigger
            data-slot="select-trigger"
            className={cn(
                "flex h-10 w-full items-center justify-between gap-2 rounded-sm border border-input bg-neutral px-3 text-copy-14 text-on-surface transition-colors outline-none data-placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 [&>span]:truncate",
                className,
            )}
            {...props}
        >
            {children}
            <SelectPrimitive.Icon
                render={
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                }
            />
        </SelectPrimitive.Trigger>
    );
}

export function SelectContent({
    className,
    children,
    side = "bottom",
    sideOffset = 4,
    align = "center",
    alignOffset = 0,
    alignItemWithTrigger = false,
    ...props
}: SelectPrimitive.Popup.Props &
    Pick<
        SelectPrimitive.Positioner.Props,
        "align" | "alignOffset" | "side" | "sideOffset" | "alignItemWithTrigger"
    >) {
    return (
        <SelectPrimitive.Portal>
            <SelectPrimitive.Positioner
                side={side}
                sideOffset={sideOffset}
                align={align}
                alignOffset={alignOffset}
                alignItemWithTrigger={alignItemWithTrigger}
                className="z-50 outline-none"
            >
                <SelectPrimitive.Popup
                    data-slot="select-content"
                    className={cn(
                        "relative max-h-(--available-height) w-(--anchor-width) min-w-[8rem] origin-(--transform-origin) overflow-x-hidden overflow-y-auto rounded-md border border-border bg-neutral duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                        className,
                    )}
                    {...props}
                >
                    <SelectPrimitive.ScrollUpArrow className="flex items-center justify-center py-1 text-muted-foreground">
                        <ChevronUp className="h-4 w-4" />
                    </SelectPrimitive.ScrollUpArrow>
                    <SelectPrimitive.List className="p-1">
                        {children}
                    </SelectPrimitive.List>
                    <SelectPrimitive.ScrollDownArrow className="flex items-center justify-center py-1 text-muted-foreground">
                        <ChevronDown className="h-4 w-4" />
                    </SelectPrimitive.ScrollDownArrow>
                </SelectPrimitive.Popup>
            </SelectPrimitive.Positioner>
        </SelectPrimitive.Portal>
    );
}

export function SelectItem({
    className,
    children,
    ...props
}: SelectPrimitive.Item.Props) {
    return (
        <SelectPrimitive.Item
            data-slot="select-item"
            className={cn(
                "relative flex w-full cursor-default select-none items-center rounded-sm py-2 pl-3 pr-8 text-copy-14 text-on-surface outline-none data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50",
                className,
            )}
            {...props}
        >
            <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
            <SelectPrimitive.ItemIndicator
                render={
                    <span className="absolute right-2 flex h-4 w-4 items-center justify-center" />
                }
            >
                <Check className="h-4 w-4 text-accent-text" />
            </SelectPrimitive.ItemIndicator>
        </SelectPrimitive.Item>
    );
}

/** Must sit inside a `SelectGroup`. */
export function SelectLabel({
    className,
    ...props
}: SelectPrimitive.GroupLabel.Props) {
    return (
        <SelectPrimitive.GroupLabel
            data-slot="select-label"
            className={cn(
                "px-3 py-1.5 text-label-12 text-muted-foreground",
                className,
            )}
            {...props}
        />
    );
}

export function SelectSeparator({
    className,
    ...props
}: SelectPrimitive.Separator.Props) {
    return (
        <SelectPrimitive.Separator
            data-slot="select-separator"
            className={cn("my-1 h-px bg-border", className)}
            {...props}
        />
    );
}
