"use client";

import * as React from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { Check, ChevronRight, Circle } from "lucide-react";
import { cn } from "@/lib/cn";

export function DropdownMenu(props: MenuPrimitive.Root.Props) {
    return <MenuPrimitive.Root data-slot="dropdown-menu" {...props} />;
}

/**
 * Renders a `<button>`. To use your own button, compose with `render`:
 * `<DropdownMenuTrigger render={<Button variant="ghost" size="icon" />} />`.
 */
export function DropdownMenuTrigger(props: MenuPrimitive.Trigger.Props) {
    return (
        <MenuPrimitive.Trigger data-slot="dropdown-menu-trigger" {...props} />
    );
}

export function DropdownMenuPortal(props: MenuPrimitive.Portal.Props) {
    return <MenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

export function DropdownMenuGroup(props: MenuPrimitive.Group.Props) {
    return <MenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

export function DropdownMenuSub(props: MenuPrimitive.SubmenuRoot.Props) {
    return (
        <MenuPrimitive.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
    );
}

export function DropdownMenuRadioGroup(props: MenuPrimitive.RadioGroup.Props) {
    return (
        <MenuPrimitive.RadioGroup
            data-slot="dropdown-menu-radio-group"
            {...props}
        />
    );
}

const contentClasses =
    "z-50 min-w-[8rem] overflow-hidden rounded-md border border-border bg-neutral p-1 text-on-surface outline-none origin-(--transform-origin) data-open:animate-in data-closed:animate-out data-closed:fade-out-0 data-open:fade-in-0 data-closed:zoom-out-95 data-open:zoom-in-95";

// Base UI moves real focus onto the highlighted item, so the highlight is the
// focus indicator (same convention as SelectItem).
const itemClasses =
    "relative flex cursor-default select-none items-center gap-2 rounded-sm px-3 py-2 text-copy-14 outline-none transition-colors data-highlighted:bg-muted data-disabled:pointer-events-none data-disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0";

type IMenuPlacement = Pick<
    MenuPrimitive.Positioner.Props,
    "align" | "alignOffset" | "side" | "sideOffset"
>;

export function DropdownMenuContent({
    className,
    align,
    alignOffset,
    side,
    sideOffset = 4,
    ...props
}: MenuPrimitive.Popup.Props & IMenuPlacement) {
    return (
        <MenuPrimitive.Portal>
            <MenuPrimitive.Positioner
                align={align}
                alignOffset={alignOffset}
                side={side}
                sideOffset={sideOffset}
                className="z-50 outline-none"
            >
                <MenuPrimitive.Popup
                    data-slot="dropdown-menu-content"
                    className={cn(contentClasses, className)}
                    {...props}
                />
            </MenuPrimitive.Positioner>
        </MenuPrimitive.Portal>
    );
}

/**
 * Runs its handler through `onClick` (Radix's `onSelect`). Keyboard
 * activation (Enter, Space) also fires `onClick`, and the menu closes after.
 */
export function DropdownMenuItem({
    className,
    inset,
    variant = "default",
    ...props
}: MenuPrimitive.Item.Props & {
    inset?: boolean;
    variant?: "default" | "destructive";
}) {
    return (
        <MenuPrimitive.Item
            data-slot="dropdown-menu-item"
            data-variant={variant}
            className={cn(
                itemClasses,
                variant === "destructive" && "text-error",
                inset && "pl-8",
                className,
            )}
            {...props}
        />
    );
}

export function DropdownMenuCheckboxItem({
    className,
    children,
    ...props
}: MenuPrimitive.CheckboxItem.Props) {
    return (
        <MenuPrimitive.CheckboxItem
            data-slot="dropdown-menu-checkbox-item"
            className={cn(itemClasses, "pl-8", className)}
            {...props}
        >
            <span className="absolute left-2 flex size-4 items-center justify-center">
                <MenuPrimitive.CheckboxItemIndicator>
                    <Check className="text-accent-text" />
                </MenuPrimitive.CheckboxItemIndicator>
            </span>
            {children}
        </MenuPrimitive.CheckboxItem>
    );
}

export function DropdownMenuRadioItem({
    className,
    children,
    ...props
}: MenuPrimitive.RadioItem.Props) {
    return (
        <MenuPrimitive.RadioItem
            data-slot="dropdown-menu-radio-item"
            className={cn(itemClasses, "pl-8", className)}
            {...props}
        >
            <span className="absolute left-2 flex size-4 items-center justify-center">
                <MenuPrimitive.RadioItemIndicator>
                    <Circle className="size-2 fill-current text-accent-text" />
                </MenuPrimitive.RadioItemIndicator>
            </span>
            {children}
        </MenuPrimitive.RadioItem>
    );
}

/**
 * Must sit inside a `DropdownMenuGroup` (or radio group): Base UI ties the
 * label to its group for `aria-labelledby`, and throws outside one.
 */
export function DropdownMenuLabel({
    className,
    inset,
    ...props
}: MenuPrimitive.GroupLabel.Props & {
    inset?: boolean;
}) {
    return (
        <MenuPrimitive.GroupLabel
            data-slot="dropdown-menu-label"
            className={cn(
                "px-3 py-1.5 text-label-12 text-muted-foreground",
                inset && "pl-8",
                className,
            )}
            {...props}
        />
    );
}

export function DropdownMenuSeparator({
    className,
    ...props
}: MenuPrimitive.Separator.Props) {
    return (
        <MenuPrimitive.Separator
            data-slot="dropdown-menu-separator"
            className={cn("-mx-1 my-1 h-px bg-border", className)}
            {...props}
        />
    );
}

export function DropdownMenuShortcut({
    className,
    ...props
}: React.HTMLAttributes<HTMLSpanElement>) {
    return (
        <span
            data-slot="dropdown-menu-shortcut"
            className={cn(
                "ml-auto text-mono-13 text-muted-foreground",
                className,
            )}
            {...props}
        />
    );
}

export function DropdownMenuSubTrigger({
    className,
    inset,
    children,
    ...props
}: MenuPrimitive.SubmenuTrigger.Props & {
    inset?: boolean;
}) {
    return (
        <MenuPrimitive.SubmenuTrigger
            data-slot="dropdown-menu-sub-trigger"
            className={cn(
                itemClasses,
                "data-popup-open:bg-muted",
                inset && "pl-8",
                className,
            )}
            {...props}
        >
            {children}
            <ChevronRight className="ml-auto text-muted-foreground" />
        </MenuPrimitive.SubmenuTrigger>
    );
}

export function DropdownMenuSubContent({
    className,
    align = "start",
    alignOffset = -4,
    side = "right",
    sideOffset = 0,
    ...props
}: MenuPrimitive.Popup.Props & IMenuPlacement) {
    return (
        <DropdownMenuContent
            data-slot="dropdown-menu-sub-content"
            className={className}
            align={align}
            alignOffset={alignOffset}
            side={side}
            sideOffset={sideOffset}
            {...props}
        />
    );
}
