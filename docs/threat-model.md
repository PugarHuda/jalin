# Threat model

Jalin accepts any target address and any calldata. This document is the argument
that this is safe, and the list of things it is explicitly not safe against.

## The shape of the trust problem

An anonymizer helper sits inside a sandwich it does not control:

```
pool  --transfer-->        helper      (phase order: withdraw < invoke)
pool  --privacy_invoke-->  helper
helper  --approve-->       pool
helper  --Span<OpenNoteDeposit>-->  pool
```

The pool hands the helper real tokens before calling it. A helper that can be told
to do anything with those tokens sounds like a helper that can be robbed. The
reason it cannot be is structural rather than procedural:

**Jalin is non-custodial and stateless across transactions.** It never holds a
balance between plans, and the only party whose funds are in the contract during a
plan is the party who authored that plan. A hostile plan is a person spending their
own notes badly. There is no pooled balance to steal, so there is nothing for a
whitelist to protect.

That claim only holds if the contract really does end every transaction empty,
which is what invariant I4 enforces, and if no allowance survives a plan, which is
what I3 enforces. The invariants are the security model. The rest of this document
walks each one against the attack it closes.

## Invariants

### I1 — the pool is the only caller

```cairo
assert(pool_address.is_non_zero(), errors::ZERO_POOL);
assert(get_caller_address() == pool_address, errors::CALLER_NOT_POOL);
```

`pool_address` arrives as the wallet placeholder `${poolAddress}`, and is checked
against the actual caller rather than trusted. A direct call from any other address
reverts before a single step runs, so the contract has no reachable behaviour
outside a sandwich.

**Closes:** calling the router directly to make it approve or move a balance that a
sandwich left mid-flight.

### I2 — no step may re-enter the sandwich

```cairo
assert(target != pool_address, errors::TARGET_IS_POOL);
assert(target != self_addr, errors::TARGET_IS_SELF);
```

The protocol already allows only one `invoke` per pool transaction. I2 removes the
router as a way to attempt a second one, and removes the router as a way to call
back into itself with different arguments.

**Closes:** reentrancy into the pool mid-plan; recursive plans that would escape the
step bound in I6.

### I3 — no allowance outlives its step

Approvals are granted immediately before a step and reset to zero immediately after
it, inside the same loop iteration.

This is the invariant that matters most in practice. A router that approves a DEX
for the input amount and does not clear the remainder leaves a live allowance owned
by a contract that will hold someone else's funds tomorrow. Because Jalin is used by
strangers in sequence, a stale allowance is not a slow leak, it is a standing
withdrawal right against the next user.

**Closes:** a target that deliberately spends less than approved, then returns in a
later transaction to spend the rest against a different user.

### I4 — zero residue

Every token named in any step approval must end the transaction at zero balance,
unless it is a declared output.

```cairo
if !contains(output_tokens.span(), token) {
    assert(residue.is_zero(), errors::RESIDUE_LEFT);
}
```

Output tokens are excluded because their balance at that moment is standing in an
allowance the pool is about to pull; after the pull they are zero too.

This deliberately mirrors the rule the pool enforces on itself — *every token's
balance must end at exactly zero*. It is what makes the non-custodial claim true
rather than aspirational: there is never a leftover balance for a later plan to
sweep into its own outputs.

**Closes:** a plan that quietly leaves value behind, and a later plan that declares
that token as an output and takes it.

### I5 — the floor holds on what is received

`min_amount` is checked against the credited amount, after the protocol fee, not
against the gross balance. A user reading the number they signed sees the number
they get.

**Closes:** slippage, hostile routes, and a fee change landing between signing and
execution.

### I6 — bounded work

Step count and per-step calldata length are capped by governance. Proof generation
runs over a virtual Starknet execution, so an unbounded plan is a way to make proofs
that never finish.

**Closes:** griefing the proving budget.

## The donation problem, and why `sweep` exists

I4 says a touched token must end at zero. If somebody transfers tokens directly to
the router address, the balance is not zero, and every future plan that touches that
token reverts. A pure invariant with no escape hatch is a denial of service that
costs the attacker one transfer.

`sweep(token)` is the escape hatch. It is:

- **permissionless** — anyone may call it, so the fix is never gated on a maintainer
- **undirected** — the destination is the governor's fee recipient, chosen by vote,
  never by the caller, so calling it is not profitable
- **locked out during a plan** — a `locked` latch is held for the whole of
  `privacy_invoke`, so a hostile ERC-20 cannot call back into `sweep` mid-plan and
  push in-flight funds to the treasury
- **reachable** — `/governance` reads the router's balance in every token the app
  knows and offers the call when one is not zero. Permissionless is not true of a
  function that only somebody willing to hand-encode a call can reach. The page
  states its own blind spot: a contract cannot enumerate its own balances, so a
  token nobody has heard of does not appear there.

`MockAttacker` in `contracts/src/mocks.cairo` is a step target that does exactly
that: handed control and an allowance, the first thing it does is call `sweep` on
the router that called it. `a_hostile_target_cannot_sweep_the_funds_it_was_handed`
asserts the plan reverts with `JALIN_SWEEP_DURING_INVOKE`, and
`the_latch_lifts_once_the_plan_is_over` asserts the latch is not a permanent denial
of service on the thing it protects. A second mode calls `privacy_invoke` again;
I1 stops that one, before the latch is reached.

That last test was written wrong first and passed for the wrong reason.
`start_cheat_caller_address` spoofs the caller of *every* call into the target, so
the re-entrant call also looked like the pool and failed later, on step count.
`CheatSpan::TargetCalls(1)` cheats only the outer call, which is what makes the
inner one show its real caller.

## What Jalin does not protect against

Stated plainly, because a threat model that only lists wins is marketing.

**A plan that is bad for its author.** If you sign a plan that sends your input to a
contract that keeps it, you lose it. `min_amount` is the only backstop, and it is
one you set yourself. This is the same trust boundary as signing a swap calldata
blob in any wallet.

**Tokens that arrive but were never declared.** The zero-residue check runs over the
tokens named in step approvals. A step can cause a token nobody declared to land on
the router, and the contract cannot enumerate its own balances to notice. That token
becomes sweepable dust rather than stolen funds — `sweep` sends it to the treasury,
not to a caller — but it is not returned to the person whose plan produced it.
Declare every token you expect to touch.

**A redemption in flight can be front-run.** A ballot is escrowed against
`poseidon(BALLOT_TAG, secret)` and released by presenting the secret. The release
travels as an ordinary STRK20 invoke action, and an invoke action's target and
calldata are public — the same fact the composer's disclosure panel states about
every plan. So the secret is visible in the pending transaction that spends it,
and an observer who resubmits it first takes the stake into a note of their own.

The governor cannot close this. It never learns who receives the note: `note_id`
is a placeholder the wallet resolves to a note belonging to whoever submitted the
transaction, so there is nothing for the contract to bind the commitment to. A
recipient chosen at cast time would bind it and would also un-anonymise the voter,
which is the property the scheme exists for.

What is left is scope. The window is one transaction wide, the amount is the
voter's own stake rather than a pool, and a redemption that loses the race can be
retried only by whoever still holds an unclaimed ballot — the attacker's copy
marks it claimed, so the loss is bounded by that one stake. Treat the secret as a
bearer instrument: it is worth exactly the stake, and it stops being worth
anything the moment it is spent.

**Malicious or broken ERC-20s.** A token that lies about `balance_of` can make the
credited amount wrong. Since the pool pulls exactly what was approved, this harms
the plan author. Fee-on-transfer tokens will under-deliver against `min_amount` and
revert, which is the correct outcome rather than a silent loss.

**Metadata leakage outside the contract.** Jalin hides the link between a note and an
action. It does not hide that an action happened. The pool's withdraw leg to the
router and the router's calls to a DEX are public, and amounts are public. Timing
correlation between a shield and a plan is a real deanonymisation route, and the
size of the anonymity set is a property of the pool, not of this contract.

How large that set actually is, measured rather than assumed, is in
[what-mainnet-says.md](./what-mainnet-says.md): the median deposit lands in a cell
whose effective anonymity set is 1.00. The composer says so for your specific
amount before you sign, because a privacy tool that lets you believe otherwise is
worse than none.

**Governance capture.** Ballot weight is stake routed through the pool. Enough stake
buys a fee change or a deny-list entry, bounded by the timelock and by `fee_bps`
being capped at 1000 (10%) in the contract regardless of what a vote says. The
router cannot be pointed at a different governor after deployment.

## What the app reaches out to, and what the edge is allowed to keep

The contracts are the trust boundary the sections above are about. The app in
front of them has a smaller one, and it is worth stating because two of its
routes call services that are not ours.

| Route | Reaches | Accepts from the caller | Kept at the edge |
|---|---|---|---|
| `/api/params`, `/api/crowd`, `/api/quote`, `/api/tx` | a Starknet node, on one shared key | felts, bounded in count | 30 s – 5 min; a landed receipt for an hour |
| `/api/manifest` | `raw.githubusercontent.com` | an owner, a repo and a ref, matched against GitHub's own name rules | 1 min |
| `/api/swap` | `starknet.api.avnu.fi` | two tokens from this app's own list and an amount | nothing |

**No route fetches a URL the caller supplies.** The manifest route builds its
one URL from three validated names; the demo and video URLs a manifest names
are rendered as links and never requested by the server. A server that fetches
what it is told to fetches the cloud metadata endpoint on a stranger's say-so,
and this app removed one such route already, when the landing page fetched its
own API through the incoming `Host` header.

**The swap route trusts AVNU for a route and nothing else.** The contract AVNU
names must be the exchange this app read the ABI of; the beneficiary inside the
calldata must be the router; the calldata must fit the router's own
`max_calldata`, read from the governor in the same request. A quote that fails
any of those is refused with a sentence, and none is served twice: a route is a
price at a block.

**The edge is the rate limit.** Chain reads are the same for everyone, so the
CDN serves repeats and the node sees one cold read per region per window rather
than one per visitor. That is what stands between the shared key and anyone
reloading `/api/crowd` in a loop during judging; it is not authentication, and
the routes have none, because they hold nothing that needs it.

## Audit status

Unaudited. Written during an 18-day sprint. Every invariant above has a test in
`contracts/tests/`, which is evidence of intent, not evidence of safety.
