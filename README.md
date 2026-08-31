# Jalin

**A programmable execution router for the STRK20 shielded pool.**

*jalin* (Indonesian) — to weave separate strands into one.

Jalin lets a single private transaction carry an arbitrary multi-step, multi-token
plan: swap, lend, stake, bridge, or anything else reachable by a Starknet contract
call — executed inside one `privacy_invoke`, with the resulting value credited
straight back into shielded notes.

---

## The problem

STRK20 reaches the outside world through one primitive, the *atomic sandwich*:

```
pool  --withdraw-->  helper
pool  --privacy_invoke()-->  helper
helper  --approve-->  pool
helper  --returns Span<OpenNoteDeposit>-->  pool
```

Two protocol rules shape everything downstream:

- **One `invoke` per transaction.** At most one external call per pool transaction.
- **Every token's balance must end at exactly zero.** No value created or destroyed.

Together they mean a private DeFi action is only as expressive as the single helper
contract it calls. Want a private swap? Deploy and audit a swap helper. Lend?
Another helper. Swap-then-lend? A third. Every new interaction is a new Cairo
contract, and that is why almost everything built on STRK20 today is a payment app —
payments are the only thing you can ship without writing Cairo.

## What Jalin does

Jalin is one helper that takes a **plan** instead of fixed parameters.

```cairo
fn privacy_invoke(
    ref self: ContractState,
    pool_address: ContractAddress,
    steps: Array<Step>,
    outputs: Array<Output>,
) -> Span<OpenNoteDeposit>
```

A plan is a bounded list of steps. Each step names a target, a selector, calldata,
and the approvals the step needs. Jalin executes them in order, credits each declared
output, enforces the floor the caller set on it, approves the pool, and returns the
deposits. Composition moves *inside* the single invoke, where the protocol allows it.

Each output is credited its **whole** balance rather than a measured delta. That is
only sound because of I4 below: anything left on the router is unreachable, so there
is nothing a delta would be protecting against and one less thing to get wrong.

Outputs may be empty. The pool accepts an empty `Span`, which is what makes a plan
that sends value away for good — a bridge leg, an escrow funding, a ballot —
expressible at all.

Nothing is whitelisted. Any Starknet contract is a valid target and calldata is
free-form, which is what makes a bridge call, a DEX route, and a lending deposit the
same object: a plan.

## Why free calldata is safe here

The obvious objection to an unrestricted router is that it can be told to do
anything. The answer is that **Jalin is non-custodial and holds nothing between
transactions**, so a hostile plan can only harm its own author — who is spending
their own notes. Safety comes from invariants enforced in Cairo, not from a
gatekeeper's list:

| # | Invariant | Attack it closes |
|---|---|---|
| I1 | Caller must be the pool | Anyone calling the router directly |
| I2 | No step may target the pool or the router | Reentrancy into the sandwich |
| I3 | Every approval granted by a step is reset to zero after that step | Stale allowance draining the next user |
| I4 | Zero residue: every token Jalin touches ends the transaction at zero balance | Sweeping another user's dust |
| I5 | Each declared output must clear its `min_amount` | Slippage and hostile routes |
| I6 | Step count and calldata length are bounded | Griefing the proof budget |

I4 deliberately mirrors the pool's own rule. If a token cannot be brought back to
zero, the transaction reverts rather than leaving a balance behind for someone else
to find.

## When not to use Jalin

Private swaps are already live on AVNU, routed through its own anonymizer, and
Ekubo is next. For a single swap, use those. They are purpose-built, audited by
people who own the venue, and they will price better than a generic router
calling the same pool.

Jalin and a venue's own anonymizer are not complementary — they are candidates for
the same slot. The pool allows one invoke per transaction, so a transaction goes
through AVNU's helper *or* through Jalin, never both. Picking Jalin costs you the
venue-specific optimisations and buys you exactly one thing: more than one step.

That is also the argument for the router existing. AVNU had to write an anonymizer.
Ekubo is writing another. Every venue that wants private execution writes its own,
and none of them compose, because composition would need a second invoke that the
protocol does not grant. Jalin moves the composition inside the one invoke that is
allowed.

So: one action at one venue, use the venue. Two actions, or an action at a venue
that has not written a helper yet, and there is nothing else to use.

## A venue that never wrote a helper

Endur has no anonymizer. It has an ERC-4626 vault, and that is enough:

```ts
depositStep({
  market: ENDUR_VAULT,          // 0x28d709c8…0954b0a, verified on mainnet
  selector: getSelectorFromName('deposit'),
  asset: STRK,
  amount,
  receiver: ROUTER_ADDRESS,
})
```

The router approves the vault, calls `deposit(assets, receiver)` with itself as
receiver, and the xSTRK shares land in a shielded note. `asset()` returns STRK and
0.25 STRK quotes at 0.2126 xSTRK — both checked against the live contract before
this was written.

Nothing in that step is Endur-specific on our side. No adapter was registered, no
contract was deployed for it, and no permission was asked for. AVNU had to write
an anonymizer to offer private swaps and Ekubo is writing another; every venue
that wants private execution writes its own, and none of them compose. This is
the alternative, and it runs today.

## A DEX route as a step

The same argument, made with a swap. AVNU's aggregator is asked for a quote
with the router as taker; it builds `multi_route_swap` on its exchange —
`0x0427…3b0f`, whose ABI was read from the chain before this was written —
with the router named as beneficiary and the route it found across pools, and
those 23 felts *are* the step's calldata:

```ts
callStep({
  target: AVNU_EXCHANGE,
  selector: getSelectorFromName('multi_route_swap'),
  spend: { token: STRK, amount },
  calldata: swap.calldata,           // from /api/swap, verbatim
})
```

The composer's "Swap half on AVNU, stake half on Endur" preset puts that step
beside the Endur deposit: two venues, two outputs, one invoke, with AVNU's own
`buy_token_min_amount` as the USDC floor. It is fetched when clicked rather than
written into the page, because a route is a price at a block.

It buys native USDC (`0x33068f…`), not the bridged USDC.e (`0x53c9…`), and the
reason is the pool's own history rather than a preference: over the pool's life
native USDC has been shielded 71 times and USDC.e once. A note in USDC.e would
sit in a cell of one — the "you, alone" the disclosure panel warns about — and
no router can fix that; choosing the token the crowd holds can.

This is not AVNU's private-swap route, and it is worth being precise about the
difference. That route is AVNU's anonymizer — one venue, in the one invoke the
pool allows. This is AVNU as a step among others, in the same invoke as a stake,
which is the composition the anonymizer cannot express. The approve call AVNU
also returns is dropped: the router grants and resets approvals itself (I3).

## Sub-accounts, and what stands in for them

`sdk/src/subaccounts.ts` implements the sub-account portfolio layer — deriving a
stable label per strategy, rolling unlinkable positions back into one balance
sheet, and saying out loud when a portfolio has no internal anonymity left.
`sdk/src/shadow.ts` builds the Wallet API action for it.

An earlier version of this section said the Wallet API exposed no sub-account
method. It does now: starknet.js 10.6.0 (29 July 2026) added the handling, and
`@starknet-io/types-js` 0.10.4 carries `shadow_account_invoke` — calls made from
a shadow account the wallet derives per `(dapp, nonce)`, with a `collect_policy`
that settles only what the interaction gained — and
`wallet_strk20ShadowAccountCommitment`. Whether a given wallet implements them
is a separate question, so the composer asks the connected wallet and shows its
answer verbatim: the partial commitment when it has one, the refusal when it
does not. Nothing on that panel is rendered from a constant.

The SDK route (`transfers.build().shadowAccounts(name).invoke(...)`, rc.5) still
needs a proving service URL that is not published for mainnet — see
[starkience/strk20-hackathon#121](https://github.com/starkience/strk20-hackathon/issues/121)
and the three issues alongside it.

**What the router does instead.** Every external step is dispatched by the router
itself, so from the venue's side the caller is always the same address. Endur sees
`0x8498d79…` deposit into its vault; it cannot see which pool user asked. The
`PlanExecuted` event carries a plan id and two counts and deliberately no token,
amount or note id.

That is a different shape of privacy from a sub-account, and for flow-through
actions it is the better one:

| | Sub-account | Jalin router |
|---|---|---|
| Identity seen by the venue | fresh, and yours alone | shared by every user of the router |
| Anonymity | unlinked from your wallet | unlinked, *and* in a crowd |
| Grows with usage | no | yes |

A fresh address is unlinked and alone, which is why a single transaction from one
is often still identifiable by amount and timing. A shared router puts you in a
set, and the set grows every time someone else runs a plan.

**Where it genuinely falls short.** This only holds for actions that flow through:
swap, or stake-and-take-the-shares, where nothing is left owned afterwards. A
protocol that records a persistent owner — a lending position, a vault
subscription — cannot have the router hold it, because the router holds nothing
between transactions by construction (invariant I4). For those, sub-accounts are
the right answer and this is not a substitute for them.

And the honest caveat on the crowd: it is only as large as the number of people
using the router, which today is small. The mechanism is right; the set has to be
earned.

## What the composer asks the wallet

Everything the composer says to Ready goes through `app/lib/wallet.ts`, typed by
the Wallet API's own request map (`@starknet-io/types-js` 0.10.4) rather than
cast around it. That is not tidiness: two bugs — a call carrying a field too
many, and a call spelling the entrypoint the JSON-RPC way — hid behind `as never`
for days, and the types that refuse both were installed the whole time.

| Method | What the page does with the answer |
|---|---|
| `wallet_supportedWalletApi` | Names the API version beside the wallet, so a refusal can be read against it |
| `wallet_strk20Balances` | Shows what the pool holds for this account, and gates every run on `amount + pool fee` against it, naming the shortfall |
| `wallet_strk20PrepareInvoke` (simulate) | *Dry run*: the wallet assembles the transaction and reports what it would refuse, with nothing proved, sent or charged |
| `wallet_strk20InvokeTransaction` | The real thing |
| `wallet_strk20ShadowAccountCommitment` | The partial commitment for dapp `jalin`, computed inside the wallet, or the wallet's refusal — verbatim |

Support is detected by asking, per method, per session. A wallet that answers the
balance call and not the shadow-account one gets a page that says exactly that.

## The demo video

[jalin-five.vercel.app/jalin-demo.mp4](https://jalin-five.vercel.app/jalin-demo.mp4) —
two minutes forty-nine, captioned, and named in `strk20.json`.

It is not a screen recording of a rehearsal. Playwright drives the deployed app
through the same selectors the end-to-end suite uses, so the transaction it
checks on screen is one of the three mainnet hashes listed above and the verdict
beside it is computed from the chain while the recording runs. The narration is
synthesised, the captions come from the speech engine's own sentence timings,
and the whole thing rebuilds from this repository:

```sh
python scripts/demo-video/tts.py        # narration and caption cues
node scripts/record-demo.mjs <dir>      # footage, against the live site
python scripts/demo-video/compose.py    # cut to the narration, burn captions
```

Recording against production rather than a local build is deliberate: a demo of
something that only works on a laptop is a demo of nothing.

## How far into STRK20 this goes

Automated stack detection reads `package.json`, so it records this project as not
using the privacy SDK. It does — built from source rather than depended on, which
is the one shape a dependency scan cannot see. The whole of it, including what is
missing:

| Part of the stack | Here |
|---|---|
| Shielded notes | Every plan output is credited straight back into one, above a floor the caller sets |
| `privacy_invoke` | The router *is* a helper the pool calls; the plan executes inside that single invoke |
| Anonymizer contract | `contracts/` — the router, a governor and a private ballot, in Cairo, on mainnet |
| Privacy SDK | Built from source into `vendor/` by [`scripts/build-privacy-sdk.sh`](./scripts/build-privacy-sdk.sh) and used by [`scripts/mainnet.mjs`](./scripts/mainnet.mjs) |
| Proving and discovery | Self-hosted: the official discovery service and proof interceptor run from [`prover/`](./prover/) |
| Shadow accounts | Asked of the wallet at runtime and shown verbatim, including the refusal — the SDK route needs a mainnet proving URL that is not published |
| Private transfers | Not the product. Jalin routes value through venues; a note-to-note transfer is what the pool already does without a helper |

The last two rows are the honest ones. Shadow accounts are reachable in the
protocol and not from here yet, and private transfer is deliberately somebody
else's problem.

## Repository layout

| Path | What it holds |
|---|---|
| `contracts/` | Cairo: the router, the governor, the private ballot |
| `sdk/` | TypeScript: plan encoding, recipes, sub-account portfolio — packaged as [`jalin-sdk`](./sdk/README.md) |
| `app/` | The demo anyone can open |
| `prover/` | Self-hosted discovery and screening services |
| `docs/` | [Threat model](./docs/threat-model.md), [deploying](./docs/deploying.md), [cross-chain](./docs/cross-chain.md) |

There is no `bridge/`. Cross-chain is not a feature of the router, it is a plan —
which is the whole argument, and it is made in [docs/cross-chain.md](./docs/cross-chain.md).

The SDK is published, so it can be used without this repository:

```sh
npm install jalin-sdk
```

Verified the way a stranger would: installed from the registry into an empty
directory, imported, and typechecked under both `bundler` and `NodeNext`
resolution with `skipLibCheck` off. Thirty-eight exports resolve, and a plan
encodes to felts. What ships is compiled
JavaScript with its own declarations, staged by
[`scripts/publish-sdk.mjs`](./scripts/publish-sdk.mjs), which builds the tarball
and imports its entry point before packing — a package nobody imported is a
package nobody tested.

```sh
npm run publish:sdk           # build, stage, verify, pack
npm run publish:sdk -- --publish
```

The workspace itself keeps resolving the TypeScript source. The entry a consumer
needs and the entry the app builds against are not the same file, and npm cannot
swap them at publish time — `publishConfig` only overrides npm's own config, and
the field replacement people remember is pnpm's. Staging the tarball separately
leaves the production build graph untouched, which is the property worth buying.

## Is the mainnet code this code?

```bash
scarb build --manifest-path contracts/Scarb.toml
node scripts/verify-classes.mjs
```

It hashes the Sierra artifacts and compares each against the class deployed at
the addresses in `strk20.json`. Both match, which is the only way to know that
the source above is what runs.

Worth knowing before you try it: `snforge test` overwrites the release artifact
with a test build of the same contract. Hash that and the router does not match,
with nothing on screen to say why — it cost a real scare here. Run `scarb build`
after testing; the script warns when it sees test artifacts in `target/`.

## Checking your own entry

```bash
node scripts/verify-transactions.mjs                    # this repository
node scripts/verify-transactions.mjs ../other/strk20.json
```

The sprint rules say a listed transaction must exist, have succeeded, have
touched the pool, and — if you deployed contracts — have run through one of
yours. All four are checkable, so there is no reason to discover on 31 August
that a hash does not qualify.

It is read-only and takes any manifest, which is also how it was checked: against
a transaction known to touch the pool, one known not to, and a hash that does not
exist. Point it at your own entry if it is useful.

The verify page also reads the sprint hub's own `projects.json` and shows its
verdict beside this one — the count the panel will read, which requirements it
marks met, and whether the two verifiers agree. For this repository they do.

## Building and testing

Cairo:

```bash
scarb build --manifest-path contracts/Scarb.toml
sh contracts/test.sh          # snforge in a pinned container
```

`test.sh` runs in Docker because starknet-foundry publishes no Windows binary, and
because pinning the toolchain is worth more than saving a container. The scarb
cache lives in a named volume, so only the first run pays for the plugin build.

44 tests, two of them fuzzed at 256 runs each, covering every line of every
contract — `sh contracts/coverage.sh && node scripts/coverage-gate.mjs` fails if
any line of `src/` never runs. Line coverage is a floor, not a proof: it says
every line ran, not that it ran under the conditions that would break it. Four of them fork Starknet mainnet at a
pinned block and run a plan through Endur's deployed xSTRK vault - and one through AVNU's exchange into Ekubo's STRK/USDC pool - funded by the
STRK20 pool's own STRK — which is where the STRK comes from in a real
transaction. A mock ERC-4626 returns what the mock was told to return; those
three prove the router works against a contract nobody here wrote. They need
network, and use a public node that takes no key.

TypeScript:

```bash
npm test                      # 129 SDK tests, no build step
npm run typecheck             # tsc over the whole SDK, imported or not
npm run lint                  # eslint over the app
npm run check:links           # every path this repository names
npm run test:e2e              # 348 Playwright tests, six projects, three engines
```

The browser suite has no fixtures in it. It reads the live chain, so it asserts
invariants rather than values: that one STRK buys strictly fewer than one xSTRK
share, that the crowd count is bounded by the deposit count, that a real mainnet
transaction which touched the pool without going through our router does not
qualify. A test that asserts a fixture only proves the fixture loaded.

## Three mainnet transactions, and what each route costs

The sprint asks for three and this project lists three. All three are plan
executions: each one carries a `PlanExecuted` event emitted by the router at
`0x008498d79…`, not merely a transaction that brushed the pool.

There are two ways to reach `privacy_invoke`, and they fail differently.

**Through a wallet.** `wallet_strk20InvokeTransaction` has the wallet build and
prove the transaction itself, which takes about thirty seconds. This works, and
it is how all three of these landed — from the composer, in a browser, against
Ready. Anyone with a wallet implementing the STRK20 methods and a shielded
balance can run a plan today.

**Through the SDK, headlessly.** `scripts/mainnet.mjs` needs a
`PROVING_SERVICE_URL`, and the mainnet proving service URL has not been
published. Six teams have open issues asking for it:
[#121](https://github.com/starkience/strk20-hackathon/issues/121),
[#124](https://github.com/starkience/strk20-hackathon/issues/124),
[#135](https://github.com/starkience/strk20-hackathon/issues/135),
[#147](https://github.com/starkience/strk20-hackathon/issues/147),
[#204](https://github.com/starkience/strk20-hackathon/issues/204),
[#221](https://github.com/starkience/strk20-hackathon/issues/221). The script
says so plainly rather than failing obscurely.

**Those six issues ask for the wrong artifact.** There is no hosted mainnet
endpoint and StarkWare's own demo ships `TODO_MAINNET_PROVER_URL`, but the prover
is public and has been all along — just not in the repository everyone was
searching:

```sh
docker run --rm -p 3000:3000   -e RPC_URL=<a mainnet RPC on JSON-RPC spec 0.10> -e CHAIN_ID=SN_MAIN   ghcr.io/starkware-libs/starknet-privacy/transaction-prover:PRIVACY-0.14.3-RC.2
```

Then `provingProvider: { url: 'http://localhost:3000' }`. The image is
anonymously pullable — an unauthenticated `ghcr.io/token` request returns a
token and the tag list answers. The source is
`crates/starknet_transaction_prover/` in `starkware-libs/sequencer`, not in
`starkware-libs/starknet-privacy`, which is why looking there finds nothing.

It is not free, and it does not run everywhere. Upstream recommends 48 vCPU and
96 GB; one team in this sprint ran it on 32 GB at about fifty seconds a proof.
The published build also carries an undisclosed `-C target-cpu`, and on the
machine this was written on — a 12th-generation Core i3-12100F, where AVX-512 is
fused off — the container dies immediately:

```
docker run … transaction-prover:PRIVACY-0.14.3-RC.2
Exited (132)          # SIGILL, no log output at all
```

The escape is a portable rebuild from
`crates/starknet_transaction_prover/Dockerfile` in `starkware-libs/sequencer`
with `TARGET_CPU=""`, which is a nightly-Rust build of the sequencer workspace
and not a ten-minute job.

So the count here is three rather than thirty because that cost was not paid. A
decision, and now a documented one — with the part that is genuinely blocked
named separately below.

That gap is why scripted, repeatable runs are not part of this repository, and
why the steps that need one — the AVNU multi-route swap beside the Endur stake,
as a single plan — are exercised against a mainnet fork with the real contracts
at their real addresses.

What is genuinely unreachable from here is narrower than the transaction count
suggests: the shadow-account route. `wallet_strk20ShadowAccountCommitment`
answers "Not implemented" on the wallet the composer asks, and the composer
prints that refusal verbatim rather than a constant.

## What we found on mainnet

[`docs/what-mainnet-says.md`](./docs/what-mainnet-says.md) collects the findings
that came from reading the chain rather than the documentation — including the
one that removed a feature from this SDK.

They were written down for other people to use, and at least one measurement has
been: another team took the block time from that document, checked it against the
thirty seconds they had hardcoded, and found a seven-day campaign window that
would really have closed in under three hours. The re-measurement that followed
is in there too, across five sample sizes, because the first figure this project
published was itself drawn from a sample short enough to lie.

Two other things here answer for anybody, not only for this project.
[`/api/manifest`](https://jalin-five.vercel.app/api/manifest?owner=PugarHuda&repo=jalin)
reads any repository's `strk20.json` and says which of its hashes count and why
one does not — a transaction that succeeded but never reached the pool is
invisible in a block explorer unless you already know to look for it.
[`/api/hub`](https://jalin-five.vercel.app/api/hub?repo=PugarHuda/jalin) returns
the sprint hub's own verdict on any entry without reading a file of 174 of them.

## Status

Built for the STRK20 Private Sprint, 14–31 August 2026. Deployed addresses,
mainnet transaction hashes and the demo link are in [`strk20.json`](./strk20.json).

## License

MIT — see [LICENSE](./LICENSE).
