import { Button as ButtonPrimitive } from "@base-ui/react/button";
import { cva, type VariantProps } from "class-variance-authority";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/cn";

export const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-sm text-label-14 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default:
                    "bg-primary text-primary-foreground hover:bg-primary-hover active:bg-primary-active disabled:bg-muted disabled:text-muted-foreground",
                secondary:
                    "border border-border bg-neutral text-on-surface hover:bg-muted active:bg-border",
                ghost: "text-on-surface hover:bg-muted",
                destructive:
                    "bg-destructive text-destructive-foreground hover:bg-destructive/90",
                link: "h-auto rounded-none p-0 text-label-14 text-accent-text hover:text-primary hover:underline underline-offset-4",
            },
            size: {
                default: "h-10 px-3",
                sm: "h-8 px-2.5 text-label-12",
                lg: "h-12 px-4 text-label-14",
                icon: "size-10 p-0",
            },
        },
        compoundVariants: [
            // A link is inline text: no control height or padding at any size
            // (the size classes would otherwise win over the link variant's).
            { variant: "link", class: "h-auto p-0" },
        ],
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

/**
 * Base UI button. To make another element look like a button, compose with
 * `render`. For a navigation link use `buttonVariants` on the `<Link>`
 * instead (Base UI's Button forces `role="button"`, which would replace the
 * link's own semantics):
 * `<Link href="/runs" className={buttonVariants({ variant: "secondary" })} />`.
 */
export interface ButtonProps
    extends
        Omit<ButtonPrimitive.Props, "className">,
        VariantProps<typeof buttonVariants> {
    className?: string;
    /**
     * Shows a spinner over the (invisible) label so the button keeps its
     * width, and sets `disabled` and `aria-busy`. With `render` only the
     * attributes are applied, because the rendered element's markup is not
     * ours to change.
     */
    loading?: boolean;
    /**
     * Accessible label while loading, e.g. "Saving…" (use U+2026, not three periods).
     * Defaults to the button's children.
     */
    loadingText?: string;
}

export function Button({
    className,
    variant,
    size,
    render,
    loading = false,
    loadingText,
    disabled,
    children,
    ...props
}: ButtonProps) {
    const showOverlay = loading && render === undefined;
    return (
        <ButtonPrimitive
            data-slot="button"
            className={cn(
                buttonVariants({ variant, size }),
                loading && "relative cursor-progress",
                className,
            )}
            render={render}
            disabled={disabled || loading || undefined}
            aria-busy={loading || undefined}
            data-loading={loading || undefined}
            {...props}
        >
            {showOverlay ? (
                <>
                    {/* `contents` keeps the label's layout (and so the
                        button width) identical to the idle state;
                        `invisible` hides it visually and from the a11y tree. */}
                    <span
                        data-slot="button-label"
                        aria-hidden="true"
                        className="invisible contents"
                    >
                        {children}
                    </span>
                    <span
                        data-slot="button-spinner"
                        className="absolute inset-0 flex items-center justify-center"
                    >
                        <Spinner size={size === "sm" ? "sm" : "default"} />
                    </span>
                    <span className="sr-only">{loadingText ?? children}</span>
                </>
            ) : (
                children
            )}
        </ButtonPrimitive>
    );
}
