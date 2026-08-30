# @jalin/sdk

Plan encoding and sub-account portfolio helpers for [Jalin](https://github.com/PugarHuda/jalin),
a programmable execution router for the STRK20 shielded pool on Starknet.

STRK20 allows one external call per pool transaction, and every token balance
must end at exactly zero. A private DeFi action is therefore only as expressive
as the single helper contract it calls — which is why almost everything built on
STRK20 today is a payment app. Jalin is one helper that takes a **plan** instead
of fixed parameters: a bounded list of steps, each naming a target, a selector,
calldata and the approvals it needs, all executed inside a single
`privacy_invoke`.

This package is the client half: it builds those plans, validates them against
the router's limits before you spend gas, and encodes them as calldata.

```sh
npm install @jalin/sdk
```

## Building a plan

```js
import { PlanBuilder, callStep, openNote } from '@jalin/sdk'

const plan = PlanBuilder.create()
  .call(
    callStep({
      target: VAULT,
      selector: DEPOSIT_SELECTOR,
      spend: { token: STRK, amount: 10n ** 18n },
      calldata: [10n ** 18n, 0n, ROUTER],
    }),
  )
  // Credit the shares back into the first open note, but only above a floor.
  .creditTo(SHARES, openNote(0), 9n * 10n ** 17n)
  .build()

const calldata = PlanBuilder.create().call(step).creditTo(SHARES, openNote(0)).encode()
```

`build()` runs `validatePlan`, which rejects a plan the router would reject:
too many steps, oversized calldata, an approval the step never spends, or a
token moved by a step and credited to nobody. `openNote(n)` is the placeholder
the wallet resolves at submit time, so the note id never has to be known here.

## What else is in it

| | |
|---|---|
| `plan.ts` | `PlanBuilder`, `validatePlan`, `encodePlan`, `unclaimedTokens`, limits |
| `recipes.ts` | `callStep` for any ABI, `depositStep` for ERC-4626, `oneWay` |
| `receipt.ts` | reads a transaction receipt and says whether it really touched the pool |
| `subaccounts.ts` | sub-account portfolios, and when one has no anonymity left |
| `shadow.ts` | the Wallet API action for `shadow_account_invoke` |
| `crowd.ts`, `anonymity.ts` | the anonymity set a plan actually lands in |
| `disclosure.ts`, `share.ts` | selective disclosure of a transaction you made |

Every export is typed, and the package ships its own declarations.

## Verifying a submission

The router's deployment also answers for anyone, not just for Jalin:

```
https://jalin-five.vercel.app/api/manifest?owner=<owner>&repo=<repo>
```

It reads that repository's `strk20.json`, checks each hash against Starknet
mainnet — exists, succeeded, touched the pool, ran through your own contract —
and reports how many of them count.

## License

MIT. The router contract, the Cairo tests and the full design notes are in the
[repository](https://github.com/PugarHuda/jalin).
