// Clerk's sign-in, sign-up and user button themed to DESIGN.md: Geist type,
// near-black primary, 40px rounded-sm controls, a bordered rounded-sm card
// and no drop shadows (the user menu popover included). Values point at the
// tokens in app/globals.css, which are `light-dark()` pairs, so Clerk follows
// prefers-color-scheme with no separate dark appearance or `baseTheme`.

/** Clerk's own CSS goes in this layer, below Tailwind utilities. */
export const CLERK_CSS_LAYER = "clerk";

const CONTROL =
    "h-10 rounded-sm text-label-14 shadow-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

export const clerkAppearance = {
    cssLayerName: CLERK_CSS_LAYER,
    variables: {
        colorPrimary: "var(--primary)",
        colorPrimaryForeground: "var(--primary-foreground)",
        colorForeground: "var(--foreground)",
        colorMutedForeground: "var(--muted-foreground)",
        colorMuted: "var(--muted)",
        colorBackground: "var(--background)",
        colorInput: "var(--background)",
        colorInputForeground: "var(--foreground)",
        colorBorder: "var(--border)",
        colorRing: "var(--ring)",
        colorDanger: "var(--error)",
        colorModalBackdrop: "var(--color-scrim)",
        colorShadow: "transparent",
        fontFamily: "var(--font-sans)",
        fontFamilyButtons: "var(--font-sans)",
        fontSize: "14px",
        borderRadius: "6px",
    },
    elements: {
        cardBox: "rounded-sm border border-border shadow-none",
        card: "shadow-none",
        headerTitle: "text-heading-20 text-on-surface",
        headerSubtitle: "text-copy-14 text-muted-foreground",
        formButtonPrimary: CONTROL,
        socialButtonsBlockButton: `${CONTROL} border border-border`,
        formFieldInput: "h-10 rounded-sm text-copy-14",
        footer: "bg-surface",
        userButtonTrigger:
            "rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        userButtonAvatarBox: "size-8",
        userButtonPopoverCard: "border border-border shadow-none",
    },
} as const;
