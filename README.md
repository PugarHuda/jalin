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
