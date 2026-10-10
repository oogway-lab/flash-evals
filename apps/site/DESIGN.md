---
name: flashevals.dev
description: One thermal receipt roll feeding out of a printer on a canary carbonless-copy counter.
colors:
    counter: "oklch(0.93 0.11 102)"
    counter-ink: "oklch(0.24 0.05 85)"
    counter-ink-soft: "oklch(0.38 0.06 95)"
    paper: "oklch(0.988 0.003 250)"
    paper-shade: "oklch(0.95 0.005 250)"
    print: "oklch(0.22 0.025 290)"
    print-soft: "oklch(0.45 0.02 290)"
    rule: "oklch(0.22 0.025 290 / 0.6)"
    stamp: "oklch(0.47 0.2 285)"
    hit-wash: "oklch(0.94 0.02 285)"
    miss: "oklch(0.52 0.2 12)"
    miss-wash: "oklch(0.94 0.045 12)"
    roll-stripe: "oklch(0.7 0.17 5)"
    printer: "oklch(0.235 0.012 265)"
    printer-edge: "oklch(0.34 0.012 265)"
    printer-ink: "oklch(0.9 0.13 96)"
typography:
    display:
        fontFamily: "Martian Mono Variable, ui-monospace, SFMono-Regular, monospace"
        fontSize: "clamp(31px, 6.6vw, 58px)"
        fontWeight: 780
        lineHeight: 1.04
        letterSpacing: "-0.035em"
        fontVariation: "'wdth' 100"
    masthead:
        fontFamily: "Martian Mono Variable, ui-monospace, monospace"
        fontSize: "clamp(20px, 5vw, 30px)"
        fontWeight: 760
        lineHeight: 1.25
        letterSpacing: "0"
        fontVariation: "'wdth' 75"
    headline:
        fontFamily: "Martian Mono Variable, ui-monospace, monospace"
        fontSize: "15px"
        fontWeight: 760
        lineHeight: 1.65
        letterSpacing: "0.08em"
        fontVariation: "'wdth' 112.5"
    body:
        fontFamily: "Martian Mono Variable, ui-monospace, monospace"
        fontSize: "14px"
        fontWeight: 400
        lineHeight: 1.65
        fontFeature: "'tnum'"
        fontVariation: "'wdth' 87.5"
    lede:
        fontFamily: "Martian Mono Variable, ui-monospace, monospace"
        fontSize: "14.5px"
        fontWeight: 400
        lineHeight: 1.7
        fontVariation: "'wdth' 87.5"
    label:
        fontFamily: "Martian Mono Variable, ui-monospace, monospace"
        fontSize: "13px"
        fontWeight: 650
        lineHeight: 1
        letterSpacing: "0.06em"
        fontVariation: "'wdth' 87.5"
    note:
        fontFamily: "Geist Variable, ui-sans-serif, system-ui, sans-serif"
        fontSize: "15px"
        fontWeight: 400
        lineHeight: 1.5
rounded:
    none: "0px"
    photo: "3px"
    lcd: "4px"
    key: "6px"
    printer: "16px"
spacing:
    roll: "min(704px, calc(100vw - 24px))"
    roll-pad: "clamp(18px, 5vw, 44px)"
    segment: "34px"
    printer-h: "76px"
components:
    roll:
        backgroundColor: "{colors.paper}"
        textColor: "{colors.print}"
        typography: "{typography.body}"
        rounded: "{rounded.none}"
        width: "{spacing.roll}"
    copy-tab:
        backgroundColor: "{colors.print}"
        textColor: "{colors.paper}"
        typography: "{typography.label}"
        rounded: "{rounded.none}"
        padding: "0 18px"
    copy-tab-hover:
        backgroundColor: "{colors.stamp}"
        textColor: "{colors.paper}"
    printer:
        backgroundColor: "{colors.printer}"
        textColor: "{colors.paper}"
        rounded: "{rounded.printer}"
        height: "{spacing.printer-h}"
    printer-feed-key:
        backgroundColor: "{colors.counter}"
        textColor: "{colors.counter-ink}"
        typography: "{typography.label}"
        rounded: "{rounded.key}"
        padding: "0 16px"
        height: "40px"
    printer-lcd:
        backgroundColor: "oklch(0.16 0.01 265)"
        textColor: "{colors.printer-ink}"
        rounded: "{rounded.lcd}"
        height: "38px"
        padding: "0 12px"
    stamp:
        textColor: "{colors.stamp}"
        rounded: "{rounded.key}"
        padding: "5px 10px 4px"
    code-chip:
        backgroundColor: "{colors.print}"
        textColor: "{colors.paper}"
        rounded: "{rounded.none}"
        padding: "0 0.3em"
    field-miss:
        backgroundColor: "{colors.miss-wash}"
        textColor: "{colors.miss}"
    margin-note:
        backgroundColor: "{colors.counter}"
        textColor: "{colors.counter-ink}"
        typography: "{typography.note}"
        padding: "14px 16px"
---

# Design System: flashevals.dev

This system governs the `apps/site` marketing site only. The product app keeps its own Geist workbench system in the repository-root `DESIGN.md`; neither borrows from the other.

## Overview

**Creative North Star: "Keep the Receipts"**

The page is one continuous thermal receipt roll, fed out of a dark printer that sits fixed at the bottom of the viewport, lying on a canary carbonless-copy counter. Everything that claims something is printed on the paper: every model call is itemized (input, field checks, score, latency, cost), subtotalled into a leaderboard, and totalled at the end above a real Code 128 barcode. Everything that comments sits on the yellow counter beside or between the paper.

The paper speaks in one voice: a single variable-width monospace for every line, prose included, with true thermal double width for headers. Density is a receipt's: tight 14px lines, tabular figures, dotted leaders carrying labels to their values, dashed rules between segments. Ornament comes only from the receipt and the printer themselves (serrated tear edges, pixel asterisk rules, rubber stamps, the pink end-of-roll stripe, the lit LCD), never from screen glow or card grids. The world refuses the dark dev-tool landing: centred headline over a glowing screenshot and a feature-card grid.

Motion is mechanical: paper feeds, lines print in discrete steps, inked stamps slam, a tab tears. Nothing floats, fades in from nowhere, or bounces. Every line is fully printed without JavaScript or under reduced motion; motion only re-performs what is already there.

**Key Characteristics:**

- Canary counter ground, one cool-white paper roll centred at up to 704px.
- Martian Mono Variable (wdth 75–112.5) for everything on the paper; Geist only on the counter.
- True double width: condensed glyphs in an n×2ch box, ink scaled 2× horizontally.
- Serrated conic-mask tear edges; dotted leaders; dashed segment rules; pixel-asterisk rule.
- Stamps are verdict-only marks printed in their own leaderboard lane.
- The fixed bottom printer is the persistent call to action.
- Demo data is illustrative and labelled as such, on the paper and in the footer.

## Colors

A warm yellow ground against a cool violet-black print system, with one stamp violet and one failure pink; no other hues.

### Primary

- **Rubber-Stamp Violet** (stamp): verdict stamps (MOST ACCURATE / FASTEST / CHEAPEST), the copy tab's hover, the focus ring, and text selection. It is the colour of judgement and of the single action affordance; it never fills a surface.
- **Stamp Wash** (hit-wash): the faint violet ground behind the agent endpoint line, the one place a "hit" is tinted.

### Secondary

- **Failure Pink** (miss): crosses, missed field values, wrong transcript words, judge flags, the destructive-seed warning. Only failures and warnings wear it.
- **Miss Wash** (miss-wash): the band behind a missed field row, substituted transcript words, and the warning strip.
- **End-of-Roll Stripe** (roll-stripe): the single vertical gradient stripe at the bottom of the roll, at 0.55 opacity. Decorative but native: real rolls carry it.

### Neutral

- **Canary Counter** (counter): the page ground, margin-note slips, and the printer's feed key.
- **Counter Ink** (counter-ink) and **Counter Ink Soft** (counter-ink-soft): nav, footer, note text, note connectors on the yellow.
- **Thermal Paper** (paper) with **Paper Shade** (paper-shade): the roll, shaded toward both edges by a 7%/93% horizontal gradient under a faint fractal-noise grain.
- **Thermal Print** (print) and **Faded Print** (print-soft): all ink on the paper; soft for meta lines, expected values, and secondary columns. Print also fills inverse blocks (copy tab, code chips, install steps, copy banner).
- **Print Rule** (rule): dotted leaders, dotted row dividers, and dashed segment rules, always at 60% print.
- **Printer Body** (printer), **Printer Edge** (printer-edge), **LCD Amber** (printer-ink): the fixed printer housing, its lit top edge, and the LCD/LED readout and step numerals.

### Named Rules

**The Two Grounds Rule.** Paper is for the record, the counter is for commentary. A claim, number, or action prints on the paper; a margin note never does.

**The Verdict Colour Rule.** Stamp violet marks judgement and the action affordance; failure pink marks failure. Neither is used to decorate.

## Typography

**Paper Font:** Martian Mono Variable (with ui-monospace, SFMono-Regular, monospace), width axis 75–112.5
**Counter Font:** Geist Variable (with ui-sans-serif, system-ui, sans-serif)

**Character:** One thermal head printing at several widths: condensed (75%) for double-width headers, model names, and stamps; 87.5% for body and labels; 100% for the headline and keys; expanded (112.5%) for the wordmark, section headers, and the copy banner. Geist is the hand-written aside beside the roll.

### Hierarchy

- **Display** (780, clamp(31px, 6.6vw, 58px), 1.04, -0.035em, uppercase, balanced): the one printed headline in the masthead.
- **Masthead** (760, clamp(20px, 5vw, 30px), double width): the printed name FLASH EVALS, standing in for a logo that does not exist.
- **Headline** (760, 15px, 0.08em, uppercase, wdth 112.5): section titles, whose lead text prints in double width with a soft right-aligned qualifier on the same line (for example "illustrative run").
- **Body** (400, 14px, 1.65, tabular figures, wdth 87.5): every line on the roll, prose included. Ledes run 14.5px/1.7 at 58ch; the pitch runs to 52ch.
- **Label** (650–760, 12.5–13px, 0.04–0.08em, uppercase): buttons, links under the clone command, nav, table headers, the LCD.
- **Note** (Geist 400, 15px, 1.5): margin notes on the counter, and the footer's legal line.

### Named Rules

**The One Head Rule.** Everything on the paper is Martian Mono, prose included; vary the width axis and weight, never the family.

**The True Double Width Rule.** Double width is a print mode, not a large size: condensed glyphs (wdth 75, 760) in a box exactly n×2ch wide, ink scaled 2× horizontally from the left. Use the DoubleWidth component; never fake it with letter-spacing or font-size.

## Layout

A single centred column: the roll is `min(704px, 100vw - 24px)` wide with `clamp(18px, 5vw, 44px)` side padding, 30px from its serrated top. Segments stack with 34px block padding, separated by a 2px dashed rule (7px dash, 5px gap). Rows align with dotted leaders, grids with fixed em columns (field rows 1.2em / 9.5em / 1fr; line items 2.6em / 1fr). The topbar runs to 1280px on the counter; the footer matches the roll width.

The body reserves `printer-h` (76px, 68px at ≤560px) plus the safe-area inset at the bottom so the fixed printer never covers the last line.

Responsive behaviour:

- **≥1360px:** margin notes sit absolutely on the counter, 248px wide, 52px plus the roll padding outside the roll, alternating left and right, each with a 26px connector rule pointing at the paper.
- **<1360px:** notes become slips stacked inside the segment flow: counter-yellow, 14px 16px padding, rotated -0.6deg, a soft drop shadow.
- **<1200px:** stamps shrink to 12px with a 2.5px border.
- **≤760px:** the nav keeps only Self-host and GitHub.
- **≤600px:** the clone command wraps; response latency drops to its own line.
- **≤560px:** the leaderboard becomes a grid per row (2.4em code, model across, three labelled metric cells, the verdict stamp pinned top-right); the printer hides its LCD and the feed key fills the panel; the input photo stacks above the reference.

## Elevation & Depth

Depth is physical and sparse: objects that are really above the counter cast shadows, ink never does. The roll lifts off the counter with a long warm shadow; slips rest on it; the printer shadows upward over the paper; stamp ink sits in the paper via multiply blending, not above it.

### Shadow Vocabulary

- **Roll lift** (`box-shadow: 0 1px 1px oklch(0.45 0.09 90 / 0.25), 0 30px 60px -22px oklch(0.42 0.1 95 / 0.55), 0 0 0 1px oklch(0.5 0.08 95 / 0.12)`): the paper roll only.
- **Slip rest** (`box-shadow: 0 6px 14px -8px oklch(0.4 0.1 85 / 0.5)`): stacked margin notes below 1360px.
- **Printer overhang** (`box-shadow: 0 -10px 30px -10px oklch(0.3 0.08 85 / 0.45)`): the fixed printer.
- **Slot and LCD wells** (`inset 0 2px 2px oklch(0 0 0 / 0.8)`; `inset 0 1px 3px oklch(0 0 0 / 0.7)`): recesses in the printer housing.
- **Feed key travel** (`0 2px 0 oklch(0.62 0.13 90), 0 4px 8px oklch(0 0 0 / 0.35)`, collapsing on press with a 2px translate): the printer's physical key only.

### Named Rules

**The Objects Cast, Ink Doesn't Rule.** Shadows belong to the roll, slips, and printer. Text, rules, stamps, and blocks on the paper are flat.

## Shapes

The paper is square-cornered and torn, never rounded: a 12px serrated edge made by a conic-gradient mask tiled at 16px, on the top of the roll and (rotated) at its foot. Rules are typographic: 2px dotted leaders and row dividers, 2px dashed segment rules, 3px double rule above the grand total, 2px solid frames for the clone command and judge box. The pixel-asterisk rule is a row of 7×7 crisp-edged pixel asterisks spaced across the line.

Rounding belongs to hardware only: the printer housing (16px top corners, 12px on mobile), feed key (6px), LCD (4px), the input photo (3px). The stamp's 6px corners are the stamp face. Icons are drawn on an 8×8 pixel grid with crisp edges, sized 1em and coloured by currentColor.

## Components

### Clone Command with Tear Tab

The masthead's primary action. A 2px print-framed strip holding the `$ git clone` line (prompt in faded print, unselectable), joined to a solid print COPY tab whose left edge is a column of paper-coloured perforation dots. Hover turns the tab stamp violet; on copy the label swaps to COPIED and, with motion, the tab twitches as if torn (translate 7px, -4px, rotate 4deg, 0.5s ease-out). Under it, uppercase links with a 2px underline whose pixel arrow slides 4px on hover.

### Printer (Persistent CTA)

Fixed to the viewport bottom, roll width plus 72px, with the paper slot drawn across its top so the roll appears to emerge from it. Its panel holds an amber LCD with a lit LED ("Ready · git clone flash-evals", reporting copy success or failure), the canary feed key (Copy clone command, with physical press travel), and a GitHub link that turns amber on hover.

### Leaderboard and Stamps

A rule-framed table: 2px solid print under the header, 2px dotted between rows, codes in inverse print chips, model ids in condensed width and breaking only after the provider slash (ModelId). Stamps are uppercase condensed 800 text in stamp violet with a 3px border plus 1.5px offset outline, 6px corners, a per-stamp tilt, 0.88 opacity, multiply blend, and a noise mask for uneven ink. They print only in the verdict column.

### Response Block

A model's response printed as a receipt sub-block: inverse code chip, model, elapsed time; then field rows with pixel tick or cross, expected values beneath misses, and a miss-wash band on failed rows; then a summary line.

### Margin Note

Geist prose on the counter with a soft line connector at ≥1360px, a slightly rotated yellow slip below that.

### Navigation

Mono uppercase at 13px, wdth 87.5, on the counter; hover draws a 1.5px underline from the left (0.35s ease-out). The wordmark is the plain name in expanded 760 uppercase.

### Motion Grammar

- **Feed:** the roll translates up 90px into place on load (1.3s, cubic-bezier(0.16, 1, 0.3, 1)).
- **Line print:** masthead lines and printed response rows reveal top-down with `clip-path` in `steps()` (0.2s steps(5) at 85ms stagger; 0.16s steps(4) at 60ms), like a thermal head.
- **Develop:** lines marked to develop go from 0.4 opacity and 0.5px blur to full on a `view()` scroll timeline as they clear the printer slot; only where scroll timelines are supported.
- **Stamp slam:** stamps drop from 1.9× scale and 3px blur, overshoot to 0.96, settle (0.42s, 260ms stagger), once the board is half visible.
- **Tear tab:** described above.
- **Waiting:** a square cursor blinks with steps(2) while a demo response is pending.

Motion arms only when a pre-paint script adds a `motion` class (skipped under reduced motion), and the demo's waiting state arms only when its script runs. Without either, every line is printed.

## Do's and Don'ts

### Do:

- **Do** print every claim, number, and action on the paper in Martian Mono, and keep commentary on the counter in Geist.
- **Do** set receipt headers in true double width through the DoubleWidth component (n×2ch box, ink scaleX(2)).
- **Do** carry labels to values with 2px dotted leaders, and separate segments with the dashed rule.
- **Do** label demo data as illustrative where it appears (section header qualifier, table caption) and in the footer; use only figures and claims the product can support.
- **Do** keep the printer as the single persistent CTA and the clone command as the in-page primary action.
- **Do** make every motion re-perform content that is already rendered; with no JS or with reduced motion, the page is fully printed.
- **Do** draw icons on the 8×8 pixel grid in currentColor.

### Don't:

- **Don't** invent customers, stars, benchmarks, pricing, or a hosted plan; the roll records, it doesn't boast.
- **Don't** use stamps for anything but verdicts, or place them outside the leaderboard's verdict lane.
- **Don't** round the paper or replace its torn edges with borders or radius.
- **Don't** add glow or gradients beyond the world's own: the paper's edge shading, the printer housing's lit edge, the LCD's LED, and the end-of-roll stripe.
- **Don't** add floating or bouncing motion, or a feature-card grid.
- **Don't** introduce ink hues beyond stamp violet and failure pink on the paper; illustrated input imagery (the photographed slip) is the only exception.
