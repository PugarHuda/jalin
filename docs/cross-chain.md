# Cross-chain

## Jalin does not ship a bridge

StarkWare already does. [`starkware-libs/privacy-bridge`](https://github.com/starkware-libs/privacy-bridge)
moves USDC between EVM wallets and the pool over Circle's CCTP, with its own
`OutboundAnonymizer` and `InboundAnonymizer` so that the deposit side and the
withdrawal side cannot be linked on chain. Writing a second one would be a worse
version of that, and would fragment the anonymity set between them, which makes
both of them weaker.

What is missing is not a bridge. It is the ability to put a bridge **in the middle
of something else**.

## What Jalin adds

The pool allows one `invoke` per transaction. So today:

```
tx 1:  shielded USDC  ->  swap helper   ->  shielded ETH
tx 2:  shielded ETH   ->  bridge helper ->  gone to Base
```

Two transactions, two public footprints, and a gap between them. That gap is the
correlation: an observer who sees the pool pay a swap helper and then, ninety
seconds later, pay a bridge helper for a matching amount has learned that one
person did both.

With Jalin it is one transaction, because composition happens inside the invoke
rather than across invokes:

```ts
import { callStep, oneWay } from 'jalin-sdk'

const plan = oneWay(
  callStep({
    target: bridge,                 // whatever the bridge is
    selector: DEPOSIT_FOR_BURN,     // whatever it calls the entry point
    spend: { token: USDC, amount },
    calldata: [...],                // whatever it needs
  }),
)
```

**This has never been run.** No bridge leg has executed on mainnet, and none is
in the forking tests — those cover Endur's vault and AVNU's exchange, which are
the two integrations this project can show rather than argue. Everything below is
the shape a bridge step would take, and the reason to believe it is that a bridge
call is not a special case in the router: it is `callStep`, the same object the
AVNU swap already is on mainnet. That is an argument from the type system, not a
result, and it is listed here as one.

The router has no bridge-specific code, and neither does the SDK. There is no
`bridgeStep`, on purpose: a recipe that encodes a guessed argument order reads as
supported and fails after a proof has been paid for. `callStep` takes the shape
the bridge actually documents. The only recipe with a fixed shape is
`depositStep`, because ERC-4626 fixes the order and it was checked against a live
vault.

## Plans that credit nothing back

A bridge leg sends value off Starknet, so nothing returns to be shielded. The
router accepts a plan with no outputs, and the pool accepts an empty
`Span<OpenNoteDeposit>` — the escrow example in the STRK20 documentation relies on
the same thing.

That is only safe because of invariant I4: every token a step was allowed to move
must end the transaction at zero. So "it all went to the bridge" is checked, not
assumed. If the bridge takes less than it was approved — a fee change, a cap, a
partial fill — the residue check reverts the whole plan rather than leaving the
remainder sitting on the router. Declare a change output when a partial take is expected behaviour rather than a
fault.

## Hidden and visible

Being specific about this matters more here than anywhere else in Jalin, because
a bridge deliberately publishes something on a chain that has no pool on it.

| | Hidden | Visible |
|---|---|---|
| **On Starknet** | which note funded the plan; who authored it; the link between the swap leg and the bridge leg | that the pool paid the router; that the router called a DEX and a bridge; every amount |
| **In the bridge message** | nothing Jalin controls | whatever the bridge attests — for CCTP that includes the destination domain and the mint recipient |
| **On the destination chain** | the link back to a Starknet identity, provided the recipient is fresh | the arrival, the amount, and everything the recipient address does next |

The privacy gain is the **break in the chain of custody**, not invisibility. The
pool stands between your Starknet wallet and the destination address, so the two
are not publicly the same person. Everything after arrival is as transparent as
the destination chain is.

Three ways to give that back by accident:

- **A reused destination address.** If the address on the far side has history, the
  arrival attaches your shielded funds to that history. Bridge to a fresh one.
- **A distinctive amount.** Bridging 1,337.42 out and seeing 1,337.42 arrive within
  the minute is a match no cryptography prevents. Round, common amounts hide better.
- **Timing.** One arrival in a quiet window is linkable by clock alone. This is a
  property of the anonymity set, not of the plan.

`unclaimedTokens()` in the SDK will tell you which tokens a plan expects to leave
entirely. It will not tell you whether the amount you chose is distinctive, and no
tool can tell you whether the destination address is really fresh.

## Inbound

The inbound direction — EVM wallet into the pool — is the privacy-bridge's own
path, and it pairs `privacy_invoke` with the pool's `privacy_compute` so that the
attested cross-chain message and the private note are bound in one transaction.
Jalin does not sit on that leg and should not: binding an attestation to a note is
exactly the kind of thing that wants a purpose-built contract rather than a general
one.

Upstream describes that repository as early and moving fast. Read its README before
planning around it.
