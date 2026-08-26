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

## Sub-accounts, and what stands in for them

`sdk/src/subaccounts.ts` implements the sub-account portfolio layer — deriving a
stable label per strategy, rolling unlinkable positions back into one balance
sheet, and saying out loud when a portfolio has no internal anonymity left. It is
tested and it is not wired into the app, which is deliberate and worth explaining
rather than hiding.

Two things block it. The Wallet API exposes no sub-account method, and the SDK
route that does (`transfers.build().subaccounts(name).invoke(...)`, from Privacy
SDK 0.14.3-rc.4) needs a proving service URL that is not published for mainnet —
see [starkience/strk20-hackathon#121](https://github.com/starkience/strk20-hackathon/issues/121)
and the three issues alongside it. So the helpers ship in the SDK for anyone who
holds keys and has prover access, and the product does something else.

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

## Repository layout

| Path | What it holds |
|---|---|
| `contracts/` | Cairo: the router, the governor, the private ballot |
| `sdk/` | TypeScript: plan encoding, recipes, sub-account portfolio |
| `app/` | The demo anyone can open |
| `prover/` | Self-hosted discovery and screening services |
| `docs/` | [Threat model](./docs/threat-model.md), [deploying](./docs/deploying.md), [cross-chain](./docs/cross-chain.md) |

There is no `bridge/`. Cross-chain is not a feature of the router, it is a plan —
which is the whole argument, and it is made in [docs/cross-chain.md](./docs/cross-chain.md).

## Building and testing

Cairo:

```bash
scarb build --manifest-path contracts/Scarb.toml
sh contracts/test.sh          # snforge in a pinned container
```

`test.sh` runs in Docker because starknet-foundry publishes no Windows binary, and
because pinning the toolchain is worth more than saving a container. The scarb
cache lives in a named volume, so only the first run pays for the plugin build.

TypeScript:

```bash
cd sdk && npm test
```

## Status

Built for the STRK20 Private Sprint, 14–31 August 2026. Deployed addresses,
mainnet transaction hashes and the demo link are in [`strk20.json`](./strk20.json).

## License

MIT — see [LICENSE](./LICENSE).
