"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";
import { cn } from "@/lib/cn";

/**
 * Shared delays. Mounted once in `app/layout.tsx`. `delay` is how long a
 * hover waits before the first tooltip opens; `timeout` is the window after
 * one closes in which a neighbour opens instantly. Base UI's Tooltip works
 * without a provider (unlike Radix), so no fallback provider is needed.
 */
export function TooltipProvider({
    delay = 300,
    timeout = 150,
    ...props
}: TooltipPrimitive.Provider.Props) {
    return (
        <TooltipPrimitive.Provider
            data-slot="tooltip-provider"
            delay={delay}
            timeout={timeout}
            {...props}
        />
    );
}

/**
 * Hints are read-only (full values have copy buttons), so the popup isn't
 * hoverable by default: leaving a trigger closes its tooltip at once.
 */
export function Tooltip({
    disableHoverablePopup = true,
    ...props
}: TooltipPrimitive.Root.Props) {
    return (
        <TooltipPrimitive.Root
            data-slot="tooltip"
            disableHoverablePopup={disableHoverablePopup}
            {...props}
        />
    );
}

/**
 * Renders a `<button>`. To attach a tooltip to your own element, compose with
 * `render`: `<TooltipTrigger render={<Button />}>…</TooltipTrigger>`.
 */
export function TooltipTrigger(props: TooltipPrimitive.Trigger.Props) {
    return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

export function TooltipContent({
    className,
    side = "top",
    sideOffset = 4,
    align = "center",
    alignOffset = 0,
    children,
    ...props
}: TooltipPrimitive.Popup.Props &
    Pick<
        TooltipPrimitive.Positioner.Props,
        "align" | "alignOffset" | "side" | "sideOffset"
    >) {
    return (
        <TooltipPrimitive.Portal>
            <TooltipPrimitive.Positioner
                align={align}
                alignOffset={alignOffset}
                side={side}
                sideOffset={sideOffset}
                className="z-50"
            >
                <TooltipPrimitive.Popup
                    data-slot="tooltip-content"
                    role="tooltip"
                    className={cn(
                        "max-w-xs origin-(--transform-origin) rounded-sm bg-primary px-2 py-1 text-label-12 text-primary-foreground data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95",
                        className,
                    )}
                    {...props}
                >
                    {children}
                </TooltipPrimitive.Popup>
            </TooltipPrimitive.Positioner>
        </TooltipPrimitive.Portal>
    );
}
