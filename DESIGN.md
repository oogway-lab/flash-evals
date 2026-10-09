---
version: alpha
name: Flash Evals Geist
source: https://vercel.com/design.md
description: Geist-based light and dark interface system for dense evaluation workflows, following Vercel design guidance: monochrome, typographic, table-first, and component-driven.
colors:
  primary: "#171717"
  primary-hover: "#383838"
  primary-active: "#000000"
  primary-foreground: "#ffffff"
  secondary: "#ffffff"
  secondary-hover: "#f2f2f2"
  tertiary: "#006bff"
  neutral: "#ffffff"
  background-100: "#ffffff"
  background-200: "#fafafa"
  gray-100: "#f2f2f2"
  gray-200: "#e5e5e5"
  gray-300: "#d4d4d4"
  gray-400: "#a3a3a3"
  gray-500: "#737373"
  gray-600: "#525252"
  gray-700: "#404040"
  gray-800: "#262626"
  gray-900: "#171717"
  gray-1000: "#000000"
  gray-alpha-200: "#0000001a"
  gray-alpha-300: "#00000029"
  blue-700: "#006bff"
  blue-800: "#0059d6"
  red-800: "#ea001d"
  amber-900: "#a35200"
  green-800: "#008a2e"
  purple-700: "#7823bc"
typography:
  heading-48:
    fontFamily: Geist Sans
    fontSize: 48px
    fontWeight: 600
    lineHeight: 56px
    letterSpacing: 0px
  heading-32:
    fontFamily: Geist Sans
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: 0px
  heading-24:
    fontFamily: Geist Sans
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: 0px
  heading-20:
    fontFamily: Geist Sans
    fontSize: 20px
    fontWeight: 600
    lineHeight: 28px
    letterSpacing: 0px
  heading-16:
    fontFamily: Geist Sans
    fontSize: 16px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: 0px
  copy-16:
    fontFamily: Geist Sans
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: 0px
  copy-14:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  label-14:
    fontFamily: Geist Sans
    fontSize: 14px
    fontWeight: 500
    lineHeight: 20px
    letterSpacing: 0px
  label-12:
    fontFamily: Geist Sans
    fontSize: 12px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0px
  mono-13:
    fontFamily: Geist Mono
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0px
  stat-32:
    fontFamily: Geist Sans
    fontSize: 32px
    fontWeight: 600
    lineHeight: 40px
    letterSpacing: 0px
    fontVariantNumeric: tabular-nums
rounded:
  none: 0px
  sm: 6px
  md: 12px
  lg: 16px
  full: 9999px
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  6: 24px
  8: 32px
  10: 40px
  16: 64px
components:
  button-primary:
    backgroundColor: "{colors.gray-900}"
    textColor: "{colors.primary-foreground}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 12px"
  button-secondary:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.gray-900}"
    borderColor: "{colors.gray-alpha-200}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 12px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.gray-900}"
    typography: "{typography.label-14}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 12px"
  input:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.gray-900}"
    borderColor: "{colors.gray-alpha-200}"
    typography: "{typography.copy-14}"
    rounded: "{rounded.sm}"
    height: "40px"
    padding: "0 12px"
  card:
    backgroundColor: "{colors.background-100}"
    textColor: "{colors.gray-900}"
    borderColor: "{colors.gray-alpha-200}"
    rounded: "{rounded.sm}"
    padding: "16px"
---

# Flash Evals Geist Design System

This file is the canonical design spec for Flash Evals. It applies Vercel's Geist system and Vercel's current design guidance (https://vercel.com/design.md) to an evaluation product: one calm canvas, crisp type, compact controls, and color only where it carries meaning. Flash Evals is not a Vercel property: never use Vercel's wordmark, logo, or authorship shell.

## Overview

The interface is a serious workbench. Each screen answers one question first (which model won, what failed, what to do next) and keeps the audit detail (tables, raw outputs, provenance) below or behind disclosure. Hierarchy comes from typography, alignment, and spacing before surfaces, borders, or color.

Before adding a surface, border, badge, icon, or color, ask whether removing it loses meaning, affordance, or grouping. If not, remove it.

## Themes

Light and dark are both first-class and follow `prefers-color-scheme`. There is no visible theme switcher. Every semantic token has a light and a dark value, defined once in `apps/web/app/globals.css` with CSS `light-dark()` and `color-scheme: light dark`. Components never branch on theme; they use semantic tokens only.

Geist palette values (light, dark), from Vercel's published foundation:

| Token            | Light                         | Dark                          |
| ---------------- | ----------------------------- | ----------------------------- |
| `background-100` | `oklch(1 0 0)`                | `oklch(0 0 0)`                |
| `background-200` | `oklch(0.984 0 0)`            | `oklch(0.027 0 0)`            |
| `gray-100`       | `oklch(0.961 0 0)`            | `oklch(0.218 0 0)`            |
| `gray-200`       | `oklch(0.94 0 0)`             | `oklch(0.239 0 0)`            |
| `gray-300`       | `oklch(0.925 0 0)`            | `oklch(0.281 0 0)`            |
| `gray-500`       | `oklch(0.836 0 0)`            | `oklch(0.39 0 0)`             |
| `gray-600`       | `oklch(0.732 0 0)`            | `oklch(0.623 0 0)`            |
| `gray-900`       | `oklch(0.42 0 0)`             | `oklch(0.706 0 0)`            |
| `gray-1000`      | `oklch(0.205 0 0)`            | `oklch(0.946 0 0)`            |
| `gray-alpha-200` | `oklch(0 0 0 / 0.081)`        | `oklch(1 0 0 / 0.09)`         |
| `gray-alpha-400` | `oklch(0 0 0 / 0.08)`         | `oklch(1 0 0 / 0.14)`         |
| `gray-alpha-500` | `oklch(0 0 0 / 0.21)`         | `oklch(1 0 0 / 0.24)`         |
| `blue-100`       | `oklch(97.32% 0.0141 251.56)` | `oklch(22.17% 0.069 259.89)`  |
| `blue-700`       | `oklch(57.61% 0.2508 258.23)` | `oklch(57.61% 0.2321 258.23)` |
| `blue-900`       | `oklch(53.18% 0.2399 256.99)` | `oklch(71.7% 0.1648 250.794)` |
| `green-100`      | `oklch(97.59% 0.0289 145.42)` | `oklch(23.09% 0.0716 149.68)` |
| `green-900`      | `oklch(51.75% 0.1453 147.65)` | `oklch(73.1% 0.2158 148.29)`  |
| `amber-100`      | `oklch(97.48% 0.0331 85.79)`  | `oklch(22.46% 0.0538 76.04)`  |
| `amber-900`      | `oklch(52.79% 0.1496 54.65)`  | `oklch(77.21% 0.1991 64.28)`  |
| `red-100`        | `oklch(96.5% 0.0223 13.09)`   | `oklch(22.1% 0.0657 15.11)`   |
| `red-700`        | `oklch(62.56% 0.2524 23.03)`  | `oklch(62.56% 0.2234 23.03)`  |
| `red-900`        | `oklch(54.99% 0.232 25.29)`   | `oklch(69.96% 0.2136 22.03)`  |

Purple (reference model only) has no published foundation value; use `oklch(52% 0.22 305)` light / `oklch(72% 0.17 305)` dark text and `oklch(97% 0.02 305)` light / `oklch(24% 0.07 305)` dark muted surface. The light hex values in the frontmatter above remain valid sRGB approximations.

## Colors

Semantic roles (all theme-aware):

- `background` (`background-100`): the page canvas. Pages are one continuous canvas.
- `surface` (`background-200`): table headers, inactive tab rails, inset regions.
- `foreground` (`gray-1000`): default text. `muted-foreground` (`gray-900`): secondary text, never smaller than 12px.
- `primary` (`gray-1000`) with `primary-foreground` (`background-100`): the one primary action in an area. In dark mode the primary button is light on dark.
- `border` (`gray-alpha-400`): dividers and control borders. `border-strong` (`gray-alpha-500`): hover and selected outlines.
- `accent` / `ring` (`blue-700` fill, `blue-900` text): links, focus ring, selected state.
- State colors, always paired with text or an icon, never color alone:
    - success (`green-900` on `green-100`), warning (`amber-900` on `amber-100`), danger (`red-900` text, `red-700` fill, on `red-100`), reference model (purple).

Filled controls must reach WCAG AA (4.5:1) for 14px text in both themes. White on `red-700` is only 4.0:1 and on `blue-700` only 4.5:1 in dark mode, so the semantic fills step darker: `destructive` is `red-900` in light (5.3:1) and `oklch(52% 0.2234 23.03)` in dark (5.9:1); `accent` is `blue-900` in light (5.3:1) and `oklch(55% 0.2321 258.23)` in dark (5.0:1). Both foregrounds stay white. The fill tokens are defined in `globals.css`; text and focus colors still use the `-900` and `-700` palette steps above.

Monochrome first. Do not color a value green just because it is good or red just because it is bad unless it is a pass/fail state. Best-in-column markers use a text label or icon plus weight, not a colored fill.

Never use raw hex, `oklch()`, or Tailwind palette classes (`blue-500`, `neutral-900`) in JSX. Add a semantic token in `globals.css` when a new role is needed.

## Typography

Geist Sans for UI, prose, and all numbers (counts, costs, percentages, durations, KPIs), with `tabular-nums` wherever numbers align in columns. Geist Mono only for code, JSON, raw tokens, IDs, model IDs, and file paths; set only the identifier in mono, not its row or sentence.

Type roles (Tailwind utilities in parentheses):

| Role                             | Size / line height / weight | Use                              |
| -------------------------------- | --------------------------- | -------------------------------- |
| `heading-32` (`text-heading-32`) | 32 / 40 / 600               | Rare large page heading          |
| `heading-24` (`text-heading-24`) | 24 / 32 / 600               | Page title (`PageHeader`)        |
| `heading-20` (`text-heading-20`) | 20 / 28 / 600               | Section title                    |
| `heading-16` (`text-heading-16`) | 16 / 24 / 600               | Subsection and card title        |
| `copy-16` (`text-copy-16`)       | 16 / 24 / 400               | Explanatory prose                |
| `copy-14` (`text-copy-14`)       | 14 / 20 / 400               | Default UI body, table cells     |
| `label-14` (`text-label-14`)     | 14 / 20 / 500               | Buttons, tabs, nav, field labels |
| `label-12` (`text-label-12`)     | 12 / 16 / 500               | Table headers, dense metadata    |
| `mono-13` (`text-mono-13`)       | 13 / 20 / 400               | IDs, model IDs, code, JSON       |
| `stat-32` (`text-stat-32`)       | 32 / 40 / 600 tabular       | Single decisive KPI values       |

No other sizes or weights. Equal peers always share one role. All letter spacing is `0`. No serif, no negative tracking, no all-caps eyebrows or overlines.

## Copy

- Sentence case everywhere: page titles, headings, buttons, tabs, nav, labels, toasts (`Create dataset`, `New run`, `Run settings`). Proper nouns keep their case.
- Action labels are verb + noun when clarity needs it.
- No em dashes in UI copy. Use a period, comma, colon, or parentheses.
- Missing values render as an en dash `–` with an accessible label, never `—`.
- Error text says what happened and what to do next.
- Headings state the question or content, not the genre ("Leaderboard", "Failing items"), and never narrate how the page was built.

## Spacing and layout

4px scale only: `1, 2, 3, 4, 6, 8, 10, 12, 16` (4–64px). No `*-5`, `*-7`, `*-9`, or arbitrary pixel spacing.

Every gap has one owner: the parent `flex`/`grid` sets `gap-*`; children do not add competing margins.

- Within a group (label → control, title → description): `gap-1` to `gap-3`.
- Between fields: `gap-4`.
- Between groups inside a section: `gap-6`.
- Between page sections: `gap-10`.
- App shell gutters: `px-4 sm:px-6`, shared by header and main; `max-w-7xl`.
- Forms: `max-w-2xl`. Wide editors and tables: full content width. One width per page type; the settings page stacks all of its sections at `max-w-3xl`.
- A page is a `Page` (`flex flex-col gap-10`) holding one `PageHeader` and its sections. Pages, headers and sections never add their own top or bottom margins; `Tabs` owns the gap to its panels.

## Radius

- `6px` (`rounded-sm`): controls, cards, table containers, chips.
- `12px` (`rounded-md`): dialogs, popovers, menus, sheets.
- `16px` (`rounded-lg`): rare full-screen panels.
- `9999px` (`rounded-full`): avatars, progress bars, status dots, circular icon buttons only.

## Surfaces and elevation

The page is one canvas. Earn a surface or border only for interaction, selection, warning, or grouping that spacing cannot express.

- Use `Card` for a real, self-contained group. Use `Card variant="inset"` (surface fill, no shadow) for a region inside a card. Never put a bordered box inside a bordered box.
- Do not wrap every section, metric, or table in a card. A table owns the full content width of its section.
- Shadows only on floating layers (popovers, menus, dialogs, toasts). No glass, blur, gradients, glows, textures, or colored side rails.

## Tables and numbers

Tables are the main evidence surface in Flash Evals.

- Use the `Table` primitive with `<thead>`; numeric columns and their headers are right-aligned (`align="numeric"` on `TableHead` and `TableCell`), text columns left-aligned. Never center a header over right-aligned values.
- One unit and one precision per column. For costs, build the formatter once per column with `formatCostColumn(values)` from `lib/format.ts` (always `$`, decimals follow the smallest non-zero value); never mix `¢` and `$` in a column. A single standalone cost may use `fmtCost`.
- Scores render through `fmtScore` (two decimals) as aligned tabular text in tables, and as `ScorePill` only in grids and matrices.
- Body cells align to the first text baseline. Rows do not wrap short labels while other columns have room.
- Timestamps in lists render with `RelativeTime` (`3 days ago` inside `<time dateTime>`, exact UTC time in a tooltip). The server and the hydrating client render the same exact date; the relative text takes over after hydration. Detail pages may show exact times.
- Do not spend a column repeating the same value for every row.
- Row actions: one visible primary action at most; destructive and secondary actions live in an overflow `DropdownMenu`.
- Default a long audit table to the decision-relevant subset (for example, failures) when that is the reader's job, state the active filter, and show current and total counts.

## Components

Compose from `apps/web/components/ui/*` first. These are shadcn components on **Base UI** (`base-nova` style, `apps/web/components.json`), restyled to this spec. Add missing pieces with `pnpm dlx shadcn@latest add <component>` and restyle them; never duplicate a primitive under a page-specific name. Composition uses Base UI's `render` prop, not Radix `asChild`.

- Badges are for status only (run status, pass/fail, reference model). Ordinary metadata (modality, type, version, counts) is plain text.
- One status module (`status-badge.tsx`) owns every status-to-label/variant mapping (run, cell, transcript, branch, prompt, review verdict, key probe, import row, STT gate). A status badge always carries its text.
- `SectionTitle` is the one section heading (`h2` at `heading-20`, `as="h3"` at `heading-16`, optional description and actions). `CardTitle` is `heading-16`; pass `as="h2"` when the card is a top-level section.
- One score display (`ScorePill` in grids, aligned tabular text in tables).
- Icons only where an established icon speeds recognition; never decorative, never in colored tiles.
- Every page renders one `PageHeader` with exactly one `h1`. Sections use `SectionTitle`.

## Interaction and motion

- Default control height `40px`; compact `32px` (`size="sm"`) in dense toolbars and tables.
- Focus: visible 2px `ring` outline with offset on every interactive element.
- Hover: small neutral surface change; color shifts only for links and destructive actions.
- Disabled: reduced opacity, stable layout. Loading: preserve dimensions.
- Default to stillness. Motion only to explain a state change; respect `prefers-reduced-motion`. No decorative pulsing.

## Accessibility

Landmarks, a skip link, one descriptive `h1` per page, ordered headings, native controls, labelled fields, semantic tables, visible focus, WCAG AA contrast in both themes, and never color alone.

## Do's and Don'ts

Do:

- Use semantic tokens and the type roles above.
- Lead each screen with its answer; keep audit detail below.
- Keep controls compact and aligned; use tables for comparison.
- Verify light, dark, desktop, and mobile, plus focus, hover, disabled, loading, and empty states.

Don't:

- Use raw colors, arbitrary sizes, or off-scale spacing.
- Use Vercel's logos or authorship shell.
- Add a theme switcher, decorative gradients, glass, heavy shadows, or card-in-card layouts.
- Use badges for metadata, icons as decoration, or em dashes in copy.
- Create page-local replacements for existing primitives.
