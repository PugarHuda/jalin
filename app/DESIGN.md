---
name: Jalin
description: A programmable execution router for the STRK20 shielded pool — weaving a plan inside one invoke.
colors:
  ground: "#101423"
  raised: "#171d31"
  thread: "#2a3350"
  strand: "#5a67a0"
  cloth: "#e6e2d8"
  muted: "#8b93ad"
  gold: "#c9a227"
  hidden: "#6fbf9a"
  warn: "#d4674f"
typography:
  display:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.025em"
  title:
    fontFamily: "Bricolage Grotesque, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "IBM Plex Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "IBM Plex Mono, ui-monospace, monospace"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "2px"
  md: "4px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "40px"
components:
  button-primary:
    backgroundColor: "{colors.gold}"
    textColor: "{colors.ground}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 16px"
  button-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.cloth}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "4px 12px"
  input:
    backgroundColor: "{colors.raised}"
    textColor: "{colors.cloth}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "6px 8px"
  nav-link:
    backgroundColor: "transparent"
    textColor: "{colors.muted}"
    typography: "{typography.label}"
    padding: "0"
---

# Design System: Jalin

## Overview

**Creative North Star: "The Loom at Night"**

A weaver's workshop after dark. The ground is indigo — tarum dye, not a crypto
template's navy — and across it run fixed vertical threads, faint, the warp the
whole page is woven on. Content sits on that warp in thin strands of a lighter
indigo; one thread of songket gold runs through the whole cloth and is spent
only where value passes: the primary action, the `privacy_invoke` line in the
hero, a hash that landed. Everything else is cloth-coloured text on the dark,
set in a grotesque that reads as assembled rather than drawn, with an
engineering mono for anything that is data.

The register is a craftsman's precision, not a product's shine. Surfaces are
flat; depth is a hairline, never a shadow. The name means *to weave separate
strands into one*, and the protocol constraint the product exists for — one
invoke per transaction — has the same shape, so the mark, the hero diagram and
the vocabulary all draw the same figure: strands entering apart and leaving as
one. The one confirmed rejection: nothing that reads as a category default —
no kicker over a heading, no card inside a card, no gradient text, no glass.

**Key Characteristics:**
- Indigo ground with a fixed vertical warp; content woven across it in hairlines
- One gold thread, spent only on value and action
- Flat surfaces, hairline rules for structure, no shadows anywhere
- Grotesque display, Plex Sans body, Plex Mono for every number, address and felt
- Green for what is hidden, gold for what is visible, red-clay for what would fail
- Only self-drawn SVG: the strand mark, the weave, the anonymity chart

## Colors

Two indigos and two threads for structure, one cloth for reading, one gold for
value, and three colours that mean something.

### Primary
- **Songket Gold** (#c9a227): the one thread. Primary buttons, the
  `privacy_invoke` line, a landed hash, the focus ring, text selection. Its
  rarity is the point.

### Neutral
- **Tarum Ground** (#101423): the page. Every page, every state; there is no
  light mode and no reason for one at a loom after dark.
- **Raised Indigo** (#171d31): the surface a form or a section sits on. One
  step up, never two.
- **Thread** (#2a3350): the hairline. Rules between sections, dividers in a
  list, the warp behind the page at 55% strength.
- **Strand** (#5a67a0): the thread you are meant to see. Control edges (3.6:1
  on the ground), the weave diagram, the scrollbar thumb.
- **Cloth** (#e6e2d8): text. Warm, not white; it is the fabric the gold runs
  through.
- **Muted Cloth** (#8b93ad): secondary text, notes, labels. Tinted from the
  indigo, never plain grey.

### Semantic
- **Hidden Green** (#6fbf9a): what the pool conceals, a transaction that
  qualifies, a connected wallet's dot.
- **Songket Gold** (#c9a227): doubles as *visible* — what a plan reveals, what
  is public. The same colour as action, deliberately: what you do is what is
  seen.
- **Red Clay** (#d4674f): what would fail — a shortfall, a refusal, a warning
  the wallet gave. Text colour only; the tinted box it used to sit in is gone.

### Named Rules
**The One Thread Rule.** Gold appears on at most one control and a handful of
data points per viewport. If two things on a screen are gold, one of them is
wrong.

**The Meaning Rule.** Green, gold and red-clay carry meaning (hidden, visible,
would fail) and are never used decoratively.

## Typography

**Display Font:** Bricolage Grotesque (with ui-sans-serif, system-ui)
**Body Font:** IBM Plex Sans (with ui-sans-serif, system-ui)
**Label/Mono Font:** IBM Plex Mono (with ui-monospace)

**Character:** Bricolage reads as assembled rather than drawn — the right voice
for a product whose whole idea is composition. Plex carries the engineering
register underneath it: sober, legible, made for numbers.

### Hierarchy
- **Display** (800, clamp 2.25–3.75rem, 1.05): the landing h1 only. Two lines,
  balanced, tracking -0.025em.
- **Headline** (600, 1.875rem, 1.2): page titles — Composer, Governance, "Will
  these transactions count?"
- **Title** (600, 1.25rem, 1.3): section headings inside a page.
- **Body** (400, 0.875rem, 1.625): running text, in Plex Sans, at a measure of
  60–62ch.
- **Label** (400, 0.75rem, 1.5, mono): field labels, notes, every address,
  amount, hash and felt. Never below 12px.

### Named Rules
**The Data Is Mono Rule.** Anything read from the chain or the wallet — an
address, an amount, a block, a felt, a verdict — is set in Plex Mono. Prose is
never mono; mono is never a costume.

**The Measure Rule.** Running text is capped at 60–62ch, which the design
detector counts as ~76 characters. Data rows get the same cap; a 66-character
hash fits in 62ch of mono.

## Layout

A single centred column: 72rem (max-w-6xl) for the composer's two-column
editor, 64rem for the landing page, 56rem for governance, 48rem for verify.
Horizontal padding 1.25rem on the app pages and 1.5rem on the landing. Behind
everything, the warp: fixed 1px vertical lines every 88px in Thread at 55%,
masked out at the very top and fading past 70% of the viewport.

Spacing follows Tailwind's 4px scale. Related things sit tight (4–8px);
distinct groups separate generously (24–40px); a heading has more space above
it than below. The composer is a two-column grid at ≥1024px with the disclosure
column sticky at 1.5rem from the top, so it stays level with the step being
edited; below that, one column, editor first.

## Elevation & Depth

None. No shadows anywhere; depth is conveyed by one step of tonal layering
(Ground → Raised) and by hairline rules in Thread. Sections and lists are
separated by a 1px rule above, never by a box. Controls carry a 1px edge in
Strand because a control's boundary is a component and needs 3:1 against what
is behind it (WCAG 1.4.11); Thread is a rule, not an edge.

### Named Rules
**The Flat Rule.** A bordered block never contains another bordered block. If
a panel needs structure, it gets a rule above it.

**The Only Alert Rule.** One box is allowed on a page: an alert the reader has
to find again (the ballot secret). Everything else that is a warning is red-clay
text on the page's own surface.

## Shapes

Near-square. Corners are 2px on primary buttons and 4px on everything else
(`rounded-sm`, `rounded`). Nothing is pill-shaped. Borders are 1px; the only
thicker stroke on the site is the 2px gold left rule on the landing page's two
quotations and the 5px gold `privacy_invoke` strand in the hero SVG. Recurring
geometry is the strand: a bezier that enters at the left and converges on a
single horizontal line.

## Components

### Buttons
- **Shape:** near-square (2px primary, 4px secondary)
- **Primary:** Songket Gold on Tarum Ground, Plex Sans 500 at 0.875rem, padding
  8px 16px. One per view.
- **Hover / Focus:** primary dims to 90% opacity; every focusable element gets
  a 2px gold outline at 2px offset on `:focus-visible`.
- **Secondary:** transparent, 1px Strand edge, Plex Mono 0.75rem, padding 4px
  12px; edge turns gold on hover. Disabled: 40% opacity, no hover.
- **Tertiary (preset chips):** as secondary, on the Raised surface.

### Cards / Containers
- **Corner Style:** 4px
- **Background:** Raised Indigo for a section that holds a form or a list;
  Ground for everything inside it.
- **Shadow Strategy:** none (see Elevation).
- **Border:** 1px Thread on the outer section only. Inside, rules above, never
  boxes.
- **Internal Padding:** 16–20px.

### Inputs / Fields
- **Style:** Raised Indigo fill, 1px Strand edge, 4px radius, Plex Mono
  0.75rem, padding 6px 8px. Placeholder in Muted Cloth at 70%. Caret in gold.
- **Focus:** 2px gold outline, 2px offset.
- **Error:** the message beneath in Red Clay; the field's edge does not change.

### Navigation
- Plex Mono 0.75rem in Muted Cloth, lowercase page names, 1.25rem gaps; gold
  on hover; the strand mark and wordmark at the left link home on every page
  but home.

### The Feedback Line (signature)
Every button that asks the wallet for something renders the wallet's answer
directly beneath itself — the wallet list, the proving status, the refusal, the
dry-run verdict — separated from the button by a rule above, in Plex Mono at
0.75rem. Green for a pass, red-clay for a refusal, cloth for status. Nothing the
machine says appears anywhere but under the thing that asked.

### The Weave (signature)
The hero's SVG: four strands in Strand (the ones drawn last carry a ground-
coloured halo so they read as passing over), converging on a 5px gold line
labelled `privacy_invoke`, then fanning into notes. Drawn once with
`stroke-dashoffset`, 1.1s exponential ease-out, staggered 120ms; it never
loops. The strand mark in the header is the fan-in half of the same figure.

## Do's and Don'ts

### Do:
- **Do** set every chain or wallet value in Plex Mono, at 12px or larger.
- **Do** cap running text and data rows at 60–62ch.
- **Do** separate sections and panels with a 1px Thread rule above them.
- **Do** spend gold on one action per view and on landed value only.
- **Do** keep the 2px gold `:focus-visible` outline on every control.
- **Do** draw diagrams and marks as SVG in Strand, Gold and Ground.

### Don't:
- **Don't** put a bordered block inside a bordered block.
- **Don't** add a shadow, a gradient, a glass effect or a pill.
- **Don't** place a kicker or eyebrow above a heading.
- **Don't** use grey for secondary text; tint it from the indigo (Muted Cloth).
- **Don't** render a number the chain or the wallet did not give.
- **Don't** add a light theme.
