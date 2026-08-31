---
name: Jalin
description: A programmable execution router for the STRK20 shielded pool — a plan routed through the one invoke the protocol allows.
colors:
  ground: "#0b0e0d"
  raised: "#131816"
  thread: "#26302c"
  strand: "#7d9287"
  cloth: "#e9ece7"
  muted: "#9aa8a0"
  gold: "#e0a53c"
  hidden: "#3fae74"
  warn: "#e2694a"
typography:
  display:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "clamp(2.25rem, 6vw, 3.75rem)"
    fontWeight: 800
    lineHeight: 1.05
    letterSpacing: "-0.025em"
  headline:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.3
  body:
    fontFamily: "Archivo, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.625
  label:
    fontFamily: "Azeret Mono, ui-monospace, monospace"
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
    padding: "12px 20px"
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
    padding: "10px 4px"
---

# Design System: Jalin

## Overview

**Creative North Star: "The Gerber Set"**

The file family a circuit board is manufactured from: copper layers, solder
mask, silkscreen legend, drill table, board outline. Not a board glowing in a
stock photograph — the *fabrication drawing*, where nothing exists until it is
dimensioned, designated and tabulated.

The mechanism chose it. A board's whole job is routing many signals across one
substrate, which is Jalin's sentence in another material: many calls through
the one invoke the pool allows. The product's pinned figure survives the change
of world rather than fighting it — the strands of the mark are conductors, and
the trunk they converge into is the `privacy_invoke` trace.

Gold stopped being a brand accent. An immersion-gold pad is the place electrical
contact is actually made, so spending gold only where value lands is a
fabrication fact rather than a style rule: the primary action, a hash that
landed, the trunk trace. Mask green is what is covered, which is what the pool
does. Rework red is what would fail.

The register is a drawing released to a fab house: every figure dimensioned,
every absence deliberate. Flat surfaces, hairline rules, no shadows.

**This replaced "The Loom at Night"** — indigo and songket gold — on 2026-08-31,
at the user's instruction, through a full direction round. The previous world
was not failing: a dual-agent critique scored the page 21/36 and found the visual
identity its strongest dimension. It was replaced because the user asked for a
replacement, and the reasons the score was low (evidence not surfaced, the fold,
silent failure states, mobile diagrams) were fixed in the same pass rather than
by the change of world.

**Key characteristics:**
- Matte solder-mask ground with a 0.1-inch drill grid behind everything
- Gold only where contact is made; never to index, rank or decorate
- Flat surfaces, hairline rules for structure, no shadows anywhere
- One lettering system: Archivo for the legend, Azeret Mono for every figure
- Tabular numerals by default, because a drill table that does not align is not a table
- Green for what is covered, gold for what is contacted, rework red for what would fail
- Only self-drawn SVG: the mark, the weave, the anonymity chart

## Colors

Two mask tones and two conductor tones for structure, one legend white for
reading, one gold for contact, and two colours that mean something.

### Primary
- **Immersion Gold** (#e0a53c): the pad. Primary buttons, the `privacy_invoke`
  trace, the marker beside a hash that landed, the focus ring, text selection.
  Its rarity is the point, and it is never an ordinal or an index.

### Neutral
- **Solder Mask** (#0b0e0d): the page. Every page, every state. Dark is not a
  default here: the scene is a builder reading a trace at night and a judge on a
  laptop between two other submissions, and the drawing is legible in both.
- **Mask Over Pour** (#131816): the surface a form or a section sits on. One step
  up, never two.
- **Dimension Line** (#26302c): the hairline. Rules between sections, dividers,
  and the drill grid behind the page at 55% strength.
- **Exposed Trace** (#7d9287): the conductor you are meant to follow. Control
  edges (5.85:1 on the mask), the weave, the scrollbar thumb.
- **Legend White** (#e9ece7): text. Silkscreen, not paper white.
- **Legend Grey** (#9aa8a0): secondary text, notes, labels. Tinted from the mask,
  never plain grey.

### Semantic
- **Mask Green** (#3fae74): what the pool conceals, a transaction that qualifies,
  a connected wallet.
- **Immersion Gold** (#e0a53c): doubles as *visible* — what a plan reveals. The
  same colour as action, deliberately: what you do is what is seen.
- **Rework Red** (#e2694a): what would fail — a shortfall, a refusal, a read that
  did not come back. Text colour only.

Every pair that occurs on the page is computed against WCAG AA by
`e2e/contrast.spec.ts`, which reads the tokens off the live document rather than
a copy of them. The tightest pair that ships is rework red on a grid dot at 4.96.

### Named Rules
**The Pad Rule.** Gold appears on at most one control and a handful of data
points per viewport, and only where value or contact actually lands. An ordinal,
a bullet or a section number is never gold. If two things on a screen are gold
and neither is the action, one of them is wrong.

**The Meaning Rule.** Green, gold and rework red carry meaning (covered,
contacted, would fail) and are never used decoratively.

**The Absent Slot Rule.** A value that could not be read renders as an em-dash in
its own slot, with a rework-red line naming the read that failed. Nothing is
deleted for being unavailable: a reader cannot tell a product with no evidence
from a page whose evidence did not load.

## Typography

**Legend:** Archivo (with ui-sans-serif, system-ui) — display, headings and body.
**Drill table:** Azeret Mono (with ui-monospace) — every address, amount, block,
hash, felt and verdict.

**Character:** a fabrication drawing letters everything in one system, so this
world runs one family for the legend and one for the figures rather than three
faces. Archivo carries an industrial spine and is variable, so the display weight
and the caption weight are the same drawing at two masses. Azeret Mono is
engineered rather than editorial, and its numerals hold a column.

Bricolage Grotesque and IBM Plex were the previous pair. They were dropped
because both are on the list of faces Impeccable names as the sign that the
search stopped, not because they read badly.

### Hierarchy
- **Display** (800, clamp 2.25–3.75rem, 1.05): the landing h1 only.
- **Headline** (600, 1.5rem): page and section titles.
- **Title** (600, 1.25rem): section headings inside a page.
- **Body** (400, 0.875–1.125rem, 1.625): running text at a measure of 60–62ch.
- **Label** (400, 0.75rem, mono): field labels, notes, and every figure. Never
  below 12px *as rendered* — see the Rendered Size Rule.

### Named Rules
**The Data Is Mono Rule.** Anything read from the chain or the wallet — an
address, an amount, a block, a felt, a verdict — is Azeret Mono with tabular
figures. Prose is never mono; mono is never a costume.

**The Measure Rule.** Running text is capped at 60–62ch. Data rows get the same
cap; a 66-character hash fits in 62ch of mono.

**The Rendered Size Rule.** Type inside an SVG is in user units, so its rendered
size is the declared size times the viewBox scale. Both diagrams are lettered
per breakpoint rather than once: the weave's labels were landing at 5.5 CSS px on
a 390px screen at the size that reads correctly on a desktop. Declare the size
the reader actually gets.

## Layout

A single centred column: 72rem for the composer, 64rem for the landing page,
56rem for governance, 48rem for verify. Horizontal padding 1.25rem on the app
pages and 1.5rem on the landing. Behind everything, the drill grid: a fixed 1px
dot at every 48px, in Dimension Line at 55%, masked at the top and fading past
70% of the viewport.

Spacing follows Tailwind's 4px scale. Related things sit tight (4–8px); distinct
groups separate generously (24–40px); a heading has more space above than below.

**First viewport contract.** On the landing page the heading, the deck, the
primary action, the mainnet claim and the qualifying transaction hashes all land
above the fold at 1280×800. The action used to sit under the hero diagram, which
put its top edge at y=770 and pushed it off a 1366×768 laptop entirely. The
diagram is the argument and it survives being read second.

## Elevation & Depth

None. No shadows anywhere; depth is one step of tonal layering (Mask → Mask Over
Pour) and hairline rules in Dimension Line. Controls carry a 1px edge in Exposed
Trace because a control's boundary is a component and needs 3:1 against what is
behind it (WCAG 1.4.11).

### Named Rules
**The Flat Rule.** A bordered block never contains another bordered block. If a
panel needs structure, it gets a rule above it.

**The Only Alert Rule.** One box is allowed on a page: an alert the reader has to
find again (the ballot secret). Every other warning is rework-red text on the
page's own surface.

## Shapes

Near-square. 2px on primary buttons, 4px elsewhere. Nothing is pill-shaped.
Borders are 1px; the only thicker strokes are the 2px gold rule on the landing
page's two quotations and the 5px gold `privacy_invoke` trunk in the hero.
Recurring geometry is the conductor: a bezier entering at the left and converging
on a single horizontal line. A landed value is marked by a 6px gold square — a
pad, not a bullet.

## Components

### Buttons
- **Primary:** Immersion Gold on Solder Mask, 500 at 0.875rem, padding 12px 20px.
  One per viewport.
- **Hover / Focus:** primary dims to 90%; every focusable element gets a 2px gold
  outline at 2px offset on `:focus-visible`.
- **Secondary:** transparent, 1px Exposed Trace edge, mono 0.75rem, padding
  4px 12px; edge turns gold on hover. Disabled: 40% opacity, no hover.

### The Legend Strip (signature)
Every page opens with the same row: the mark and wordmark at the left, the other
three destinations plus `source ↗` at the right, mono 0.75rem in Legend Grey, a
Dimension Line rule beneath. It wraps, it carries a real gap, and its links are
padded to a hit area rather than a 16px line box. It is one component, because
four hand-rolled copies is how three of them ended up without `flex-wrap` and
collided at 390px.

### Cards / Containers
- 4px corners, Mask Over Pour for a section holding a form or a list, no shadow,
  1px Dimension Line on the outer section only. Inside, rules above, never boxes.

### Inputs / Fields
- Mask Over Pour fill, 1px Exposed Trace edge, 4px radius, mono 0.75rem.
  Placeholder in Legend Grey at 70%. Caret in gold. Focus: 2px gold outline.
  Error: the message beneath in Rework Red; the field's edge does not change.

### The Feedback Line (signature)
Every button that asks the wallet for something renders the wallet's answer
directly beneath itself — the wallet list, the proving status, the refusal, the
dry-run verdict — separated by a rule above, in mono 0.75rem. Green for a pass,
rework red for a refusal, legend white for status. Nothing the machine says
appears anywhere but under the thing that asked.

### The Weave (signature, pinned)
Four conductors in Exposed Trace (the ones drawn last carry a mask-coloured halo
so they read as passing over), converging on a 5px gold trunk labelled
`privacy_invoke`, then fanning into notes. Drawn once with `stroke-dashoffset`,
1.1s exponential ease-out, staggered 120ms; it never loops. The mark in the
legend strip is the fan-in half of the same figure. This figure, the name, and
the vocabulary (`plan`, `step`, `note`) are pinned in PRODUCT.md and survive any
change of world.

## Do's and Don'ts

### Do:
- **Do** set every chain or wallet value in Azeret Mono with tabular figures.
- **Do** cap running text and data rows at 60–62ch.
- **Do** separate sections and panels with a 1px rule above them.
- **Do** spend gold on one action per viewport and on landed value only.
- **Do** render an em-dash and name the failed read, rather than deleting a slot.
- **Do** letter SVG type for the size it is actually rendered at.

### Don't:
- **Don't** draw a glowing circuit trace. This world is the fabrication drawing,
  not the sci-fi board; the moment a trace glows, the direction is dead.
- **Don't** put a bordered block inside a bordered block.
- **Don't** add a shadow, a gradient, a glass effect or a pill.
- **Don't** place a kicker or eyebrow above a heading.
- **Don't** use grey for secondary text; tint it from the mask.
- **Don't** render a number the chain or the wallet did not give.
- **Don't** add a light theme.
