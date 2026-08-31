# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

STRK20 builders: teams who want a private DeFi action — a swap, a stake, a
lending deposit, a bridge leg, or two of those at once — without writing and
auditing a Cairo helper contract for it. They read source, verify claims against
the chain, and judge a tool by whether its numbers came from somewhere real.
Confirmed by the user on 2026-08-28.

Two secondary audiences use the same pages and are not designed for separately:
the STRK20 Private Sprint panel, who open the demo once and look for three
qualifying mainnet transactions; and a holder of STRK with the Ready wallet who
runs the guided mainnet run. (Inferred from the sprint rules and the composer's
own copy; not confirmed as audiences in their own right.)

## Product Purpose

The STRK20 shielded pool allows one external `invoke` per private transaction,
so a private DeFi action is only as expressive as the single helper contract it
calls. Jalin is one helper that takes a *plan* — a bounded list of steps, each
naming a contract, a selector, calldata and the approvals it needs — and runs the
whole plan inside that single invoke, crediting each declared output back into a
shielded note. Composition moves inside the one invoke the protocol permits.

Success is a plan that reaches a venue nobody wrote an adapter for and lands its
output in a note, on mainnet, with the reader able to check every step of that
claim from the page.

## Positioning

Any Starknet contract with an ABI is reachable from inside a private
transaction, with no adapter registered and no contract deployed for it. Endur's
ERC-4626 vault and AVNU's `multi_route_swap` are both live steps on mainnet, and
both are ordinary calls. A venue's own anonymizer (AVNU's, Ekubo's) is one
venue in the one invoke; Jalin is several venues in the same invoke, which is
the composition an anonymizer cannot express. Safety comes from six invariants
enforced in Cairo, not from an allow-list.

## Operating Context

- Starknet mainnet, the STRK20 pool at `0x040337…812a`, the router at
  `0x008498…3a7e` and the governor at `0x05bd98…6984`.
- Signing goes through the Ready wallet's STRK20 methods
  (`wallet_strk20Balances`, `wallet_strk20PrepareInvoke`,
  `wallet_strk20InvokeTransaction`). The wallet holds the viewing key, proves
  and submits; the page never sees a key.
- The pool charges a flat fee per private operation (6 STRK on mainnet, read
  from `get_fee_amount`), and every window is expressed in blocks at a measured
  block time (~1.70 s over 20,000 blocks). Both are read live, never hardcoded.
- Judged against the sprint's rules: a listed transaction must exist, have
  succeeded, have touched the pool, and have run through one of the project's
  contracts. The verify page and `scripts/verify-transactions.mjs` apply the
  same rule, from the SDK.

## Capabilities and Constraints

- Composer: build a plan by hand or from presets (Endur stake, two deposits in
  one invoke, round trip, AVNU swap beside an Endur stake with a live route),
  see what it reveals, dry-run it in the wallet, sign it.
- Guided mainnet run: shield sized from the live pool fee, then three numbered
  runs, gated on the account's shielded balance with the shortfall named.
- Governance page: every router parameter read from the governor; propose,
  execute and sweep as public transactions.
- Verify page: judge pasted hashes or a whole repository's `strk20.json`.
- Shadow accounts exist in the Wallet API since starknet.js 10.6.0; the page
  asks the connected wallet and shows its answer. Ready does not implement the
  method yet (checked 2026-08-28), and the page says so rather than pretending.
- Undecided: nothing on the product side. The one recorded design exception is
  in `.impeccable/config.json`.

## Brand Commitments

**The name.** *Jalin* (Indonesian) — to weave separate strands into one. The
name, the strand mark, the weave diagram in the hero and the vocabulary
(`plan`, `step`, `note`, `weave the plan inside it`) are binding. Confirmed by
the user on 2026-08-28 as the one commitment every future piece of design work
must preserve.

The rest of the incumbent identity is recorded in DESIGN.md as the system in
place — indigo and gold from tarum dye and songket thread; Bricolage Grotesque
with IBM Plex Sans and Mono; only self-drawn SVG, no stock imagery — and is
authority for refinement, not a commitment the user has pinned.

## Evidence on Hand

- Three qualifying mainnet transactions in `strk20.json`, verifiable with
  `node scripts/verify-transactions.mjs`.
- Mainnet findings with the queries that produced them in
  `docs/what-mainnet-says.md`; threat model in `docs/threat-model.md`.
- 129 SDK tests, 347 Playwright tests across four projects, 44 Cairo tests of
  which four fork mainnet and run the router against Endur's vault and AVNU's
  exchange. Count them before quoting them; this line has been stale twice.
- A demo video exists and ships from the app: `app/public/jalin-demo.mp4`,
  20.8 MB, 1920x1080, and `strk20.json` names it at `/jalin-demo.mp4`. This line
  said it did not exist, which was true when it was written and had stopped being
  true; a design agent reading it would have deleted a link that works. Its
  duration and thumbnail are still not to be invented - read them off the file.
- No testimonials, customers, press or benchmarks exist. Do not invent any.

## Product Principles

1. Every number on screen comes from the chain or the wallet, or it is not shown.
2. What a plan reveals is said as plainly as what it hides.
3. A refusal names the problem and the recovery, in the wallet's own words when
   the wallet gave them.
4. The guided path is the default; the editor is the advanced path and says so.
5. A measurement beats a documented value; a documented value beats a guess; a
   guess is not shipped.

## Accessibility & Inclusion

WCAG 2.1 AA is enforced by the Playwright suite (axe on every page, heading
order, control names, visible focus, 3:1 edges on every control). Keep it.
