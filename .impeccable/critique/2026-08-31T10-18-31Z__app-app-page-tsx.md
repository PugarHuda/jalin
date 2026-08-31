---
target: the Jalin landing page
total_score: 21
max_score: 36
na_heuristics: 7
p0_count: 1
p1_count: 4
timestamp: 2026-08-31T10-18-31Z
slug: app-app-page-tsx
---
Method: dual-agent (A: design review, isolated · B: detector + browser evidence, isolated)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 2 | `revalidate = 60` under copy saying "read when this page was served" — no block height, no timestamp; a failed chain read shows no status at all |
| 2 | Match System / Real World | 3 | Domain-fluent and glosses the hard terms, but `note` — the noun the product rests on, and a hero label — is never defined |
| 3 | User Control and Freedom | 3 | No traps; wordmark correctly non-linking on home; external links open new tabs with no indicator |
| 4 | Consistency and Standards | 3 | Rigorous section grammar, but gold is spent on the `I1`–`I6` ordinals — six per viewport carrying no value, against the page's own One Thread and Meaning rules |
| 5 | Error Prevention | 2 | `ROUTER_ADDRESS ?? ''` lets `Address` return null under a "Deployed" heading; `Trend` returns null under 3 periods; no fallback copy guards any of it |
| 6 | Recognition Rather Than Recall | 2 | The three qualifying mainnet hashes appear nowhere on the page; the reader must recall the sprint rule and connect it to "3 plans executed" himself |
| 7 | Flexibility and Efficiency | n/a | One-column read-and-click Persuade surface, single action, no repeated task to accelerate |
| 8 | Aesthetic and Minimalist Design | 3 | The strongest dimension — flat, hairline-ruled, one gold thread, every element load-bearing; held back by the weave's labels rendering at ~5.5px on a phone |
| 9 | Error Recovery | 1 | Every failure path is silent omission: an unreachable chain deletes three counters, the anonymity passage and the chart, with no message |
| 10 | Help and Documentation | 2 | `docs/threat-model.md`, `docs/what-mainnet-says.md` and the test counts — the exact evidence this audience wants — are unlinked behind a bare "source" |
| **Total** | | **21/36** | **Acceptable (58%)** |

Heuristic 7 scored `n/a`; the maximum is renormalised to 36. Heuristic 10 was *not* taken as `n/a` even though the mode permits it: explaining a mechanism to builders is this page's job.

## Design Specificity Verdict

**LLM assessment: authored for this product, unambiguously.** Not a template with the nouns swapped. The evidence is structural: the hero diagram is the protocol constraint drawn — four named steps interlacing, the strands drawn last carrying a ground-coloured halo so they read as passing over rather than funnelling, converging on a 5px gold `privacy_invoke` and fanning back into notes. That figure is the name, the Cairo signature and the one-invoke rule at once. The palette is semantic rather than a dark-mode default: green means hidden, gold means visible *and* action, red-clay means would-fail. Two structures no template contains: a section called "When not to use Jalin" naming AVNU and Ekubo as better choices, and an invariants table pairing each rule to the attack it kills. Every category tell is absent — no eyebrow, gradient, glass, pill, nested card, feature triptych, logo wall or testimonial.

One element is interchangeable: the header — wordmark left, four lowercase mono links right — is the stock crypto-dev-tool header, and it is also the element that breaks at 390px.

**Deterministic scan: clean.** `detect.mjs --json app/app/page.tsx` and `--json app/app` both returned `[]`, exit 0, with and without the project config. The detector was verified not to be a silent no-op: a deliberately bad throwaway file returned exit 2 with three findings (`overused-font`, `gradient-text`, `bounce-easing`), then was deleted. The one suppression in `.impeccable/config.json` (`first-viewport-column-overflow`) is scoped to the composer and changed nothing here.

So the two assessments do not overlap: the detector found no mechanical slop, and every issue below is one no rule engine catches.

**Visual overlays:** the injected detector reported `[impeccable] No anti-patterns found.` at both 1280×800 and an emulated 390×844. The live server was started, injected, read and stopped; the overlay tab is closed, so no overlay is visible in a browser now.

## Overall Impression

This is a beautifully authored essay with no failure states and no receipts. The visual world is the strongest thing here and the least in need of work — which is the opposite of what a "redesign" would touch. What is actually broken is that the one artifact the sprint panel scores against, the three qualifying mainnet hashes, is in a JSON file rather than on the page; that the only call to action is sliced by the fold; that every chain-read failure is a silent deletion; and that the hero diagram, the whole argument, degrades to an unlabelled smudge on a phone.

## What's Working

**The weave.** It is not an illustration of the argument, it *is* the argument, in the same figure as the name and the protocol constraint. The halo detail — a ground-coloured 7px stroke under the strands drawn last — is what makes it a weave rather than a funnel, and that distinction is the product thesis. Self-drawn SVG, animates once, never loops, `aria-label` describing meaning rather than appearance.

**"When not to use Jalin."** A full section telling the reader to use a competitor for the common case. It buys credibility no self-description can, and it does the positioning work: by conceding the single swap, it defines the product as several venues in one invoke — the thing an anonymizer cannot express.

**The anonymity honesty.** Publishing a median effective anonymity set of 1.00 in 30px red-clay, explaining that it is a perplexity rather than a headcount, then plotting typical and best across forty-four windows positioned by block. This demonstrates the "every number comes from the chain" principle instead of claiming it.

## Priority Issues

**[P0] The three qualifying mainnet transactions are not on the page.**
`strk20.json` holds three hashes. The landing page shows none and never names the path to them. The closest proxy is `3 · plans executed, read from the router` at y≈2,707, never connected to the sprint rule that makes it matter. `/verify`, which applies the sprint's own four-part rule, is a 12px muted word among four nav siblings.
*Why it matters:* the panel opens this once looking for exactly this, and the builder audience judges the tool by whether its numbers came from somewhere real.
*Fix:* a block under the hero CTA, above "The constraint" — "Three qualifying transactions on mainnet", the three hashes in Plex Mono each linking to Voyager, and one link reading "check them against the sprint's rules → verify".
*Suggested command:* `/impeccable layout`

**[P1] The only CTA is sliced by the fold, and there is no closing action.**
At 1280×800 the gold button's top edge is at y≈770; on 1366×768 it is entirely below the fold. Beside it, "Live on Starknet mainnet" — the load-bearing credibility string — is the smallest, dimmest text on the first screen. 3,834px later the page ends with no action at all.
*Why it matters:* on a Persuade surface with one action, a half-visible button plus nothing at the end is most of the conversion surface gone.
*Fix:* tighten the hero (`mt-12` on the diagram and `mt-6` on the CTA row are what push it over) or place the CTA above the weave; set the mainnet line in `--cloth`; add a closing action so the page ends on capability rather than on `1.00`.
*Suggested command:* `/impeccable layout`

**[P1] The header collapses at 390px — and it is copied four times.**
Both assessments found this independently. Measured: the wordmark's right edge and the nav's left edge are both at x = 87.5 — a 0px gap, so "jalin" and "composer" render as one word — and the nav's right edge is at 375.5 against a padding boundary of 356, so `source` sits 4.5px from the screen edge against the 24px gutter every section uses. Nav links are 16px tall, under any touch-target floor. The header is hand-rolled in four places (`page.tsx:319`, `composer.tsx:1213`, `governance/page.tsx:98`, `verify/page.tsx:173`), the landing one at `gap-6` and the other three at `gap-5`, none with `flex-wrap` — while the footer has both `flex-wrap` and `gap-4`.
*Why it matters:* it is the first thing a judge sees on a phone, and it reads as unfinished before a word of the argument is heard.
*Fix:* one shared header component with `flex-wrap`, a real gap, and padded links; below `sm:` keep the wordmark and a single `composer` link.
*Suggested command:* `/impeccable adapt`

**[P1] Every chain-read failure is silent.**
`chain.reachable === false` removes all three counters, the entire anonymity passage and the trend chart, including the sentence that would have acknowledged the hole. `ROUTER_ADDRESS ?? ''` leaves a "Deployed" heading over nothing. `largestEffectiveSet` null renders "the biggest crowd anywhere in the pool is ." and `aloneShare` null silently rewrites the claim from "62% of the resulting cells" to "the resulting cells".
*Why it matters:* a judge landing during an RPC hiccup sees a page with no evidence and no sign anything is missing — worse than an error, because the page still looks finished.
*Fix:* keep the labels, render em-dashes for missing values, and add one red-clay line naming the failed read and inviting a refresh.
*Suggested command:* `/impeccable harden`

**[P1] Both SVGs render sub-6px type on a phone.**
Both use a fixed 720-wide `viewBox` scaled into a 332px container at 390px (0.46×). The weave's `fontSize="12"` labels land at ~5.5 CSS px; the trend chart's `fontSize="10"` axis at ~4.6px. DESIGN.md's own Label rule says never below 12px.
*Why it matters:* on mobile the single most product-specific thing on the page degrades to an unlabelled smudge, exactly where the honesty case is made.
*Fix:* absolutely-positioned HTML labels over the SVG so they keep real px, or a stacked mobile variant of the weave below `sm:`.
*Suggested command:* `/impeccable adapt`

## Persona Red Flags

**Priya (StarkWare judge, 90 seconds — project-specific).** No transaction hash appears anywhere on the page; the thing she is scoring is in a JSON file she has not opened. "Live on Starknet mainnet" is the smallest, dimmest string on the first screen and sits on the fold line, so the mainnet claim reads as a caption. The only CTA visible to her is half-cut and leads to a composer that wants a wallet, not to evidence. `/verify` is a 12px muted word among four. `3 · plans executed` sits 2,707px down beside `1 · governance proposal` at identical type weight. If she scrolls to the end, the page closes on a red `1.00`, a chart at the floor, and the word `unaudited`. At 90 seconds she leaves with the thesis and none of the proof.

**Riley (Deliberate Stress Tester).** Finds four silent failures in ten minutes: kill the RPC and three counters, the anonymity section and the chart vanish with nothing acknowledging the hole; unset `NEXT_PUBLIC_ROUTER_ADDRESS` and "Deployed" is a heading over nothing; null `largestEffectiveSet` yields "the biggest crowd anywhere in the pool is ."; null `aloneShare` quietly changes what the sentence claims. None produce an error; all produce a page that still looks complete.

**Casey (Distracted Mobile User).** The header reads "jalincomposer" and `source` is clipped at the edge; four 16px-tall links in a row, 4.5px from the border; the weave's labels at ~5.5px and the chart's axis at ~4.6px; 4,967px of page with one CTA and nothing at the bottom. Credit where due: the CTA is comfortably above the fold at 390 and sized well for a thumb.

**Jordan (Confused First-Timer).** Not this page's audience and it is right not to court him, but: `note` is a hero label never defined, `STRK20` is never expanded, and `calldata`, `selector`, `felt`, `ERC-4626`, `anonymity set` and `perplexity` all arrive unglossed. He leaves in the hero.

## Minor Observations

- Six gold `I1`–`I6` ordinals in one viewport with no gold action to anchor them — decorative gold, against the page's own Meaning Rule. Set them in muted mono.
- The deck, the sentence carrying the value proposition, is `text-muted` — the second-most-important text on the page set in the secondary colour.
- `revalidate = 60` against copy reading "when this page was served" is true of the cached render and misleading to a reader who assumes *now*. A block height beside the numbers closes it and is more convincing besides.
- `Address` rows link to Voyager with no affordance until hover.
- The trend chart has no y-axis label; `14.2` floats with no unit.
- `MIT · unaudited` is admirable and sits in the least-read position; it would strengthen the invariants section.
- `strk20.json` advertises `demo_video: /jalin-demo.mp4`; the landing page never mentions it, and PRODUCT.md still records that no video exists. Reconcile before the panel clicks that field.
- Right half of the hero is empty at 1280 while the CTA is pushed off-screen — whitespace bought with the primary action.
- Contrast is not a problem: 18 distinct pairs computed, zero failures, tightest is warn-on-ground at 5.11:1.

## Questions to Consider

- The three hashes are the only artifact the panel is scored against. Why are they in a JSON file instead of being the second element on the page?
- What breaks if "Deployed" moves directly under the hero and "The constraint" comes second? The builder audience scrolls; the judge gains everything.
- The most persuasive thing on this page is the section telling people not to use it. What else can you afford to admit?
- If the RPC were down for the ninety seconds the judge is on the page, what would she see — and is that the page you are willing to ship?
- The weave is the entire argument and it is unreadable on a phone. Is the answer a bigger diagram, or a different one below `sm:`?
- Why does `1.00`, the number that argues least well for the product, get the largest and reddest treatment, while `3 plans executed` gets the same weight as `1 governance proposal`?
