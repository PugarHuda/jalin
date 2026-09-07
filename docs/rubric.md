# The rubric, and where the evidence for each line is

The panel scores four things. This page maps each to the file, transaction or
command that settles it, so nothing here has to be taken on the README's word.
Where the honest answer is "we did not do that", it says so — a map that only
points at strengths is a sales page, and the parts of this project worth
trusting are the ones that survived being checked.

Every claim below is either a path in this repository, a mainnet transaction
hash, or a command you can run.

---

## 30% — STRK20 integration depth

The criterion names five things: shielded balances, private transfers,
anonymizer contracts, the SDK, and stealth accounts.

| | Where | Depth |
|---|---|---|
| **Anonymizer contracts** | [`contracts/src/router.cairo`](../contracts/src/router.cairo), [`governor.cairo`](../contracts/src/governor.cairo) | Two, both deployed on mainnet, both called by the pool through `privacy_invoke` and gated on `get_caller_address() == pool`. 49 Cairo tests, six of them against a pinned mainnet fork — AVNU, Endur, Vesu, and one plan carrying two of them at once. |
| **Shielded balances** | [`app/lib/wallet.ts`](../app/lib/wallet.ts) | `wallet_strk20Balances`, read from the wallet on every connect. Every run is gated on it, and the shield button is sized from the live pool fee rather than a constant. |
| **Private transfers** | [`sdk/src/wallet.ts`](../sdk/src/wallet.ts), [`sdk/src/ballot.ts`](../sdk/src/ballot.ts) | The withdraw/OPEN-transfer/invoke action sequence the pool requires, encoded once and used by the composer, the redeem panel and `scripts/mainnet.mjs`. |
| **The Privacy SDK** | [`scripts/mainnet.mjs`](../scripts/mainnet.mjs), [`scripts/build-privacy-sdk.sh`](../scripts/build-privacy-sdk.sh) | Built from source at a pinned commit and driven headlessly: `register`, `shield`, `transfer`, `plan`, `shadow`, `propose`, `ballot`, `redeem`. It proves through the hosted mainnet prover. |
| **Stealth / shadow accounts** | [`sdk/src/shadow.ts`](../sdk/src/shadow.ts), [`app/app/api/params/route.ts`](../app/app/api/params/route.ts) | Partial, and this is the weakest row. The wallet is asked for `wallet_strk20ShadowAccountCommitment` and its refusal is printed verbatim; the anonymizer is read on chain and shown beside our own pool address. **No shadow-account transaction has been sent.** |
| **The services underneath** | [`app/app/api/services/route.ts`](../app/app/api/services/route.ts) | The prover, note discovery and AVNU's SNIP-29 paymaster, asked at request time and printed on [`/verify`](https://jalin-five.vercel.app/verify) — including how far behind the chain discovery is. |

**What a judge should look at first:** `contracts/tests/fork_test.cairo`. It runs
plans through the *deployed* AVNU exchange, Endur vault and Vesu STRK market at
a pinned block, including two of them in a single invoke. Nothing in it is
mocked.

---

## 30% — Working mainnet product

Live at **https://jalin-five.vercel.app**, four qualifying transactions in
[`strk20.json`](../strk20.json), two contracts.

| Transaction | What it did |
|---|---|
| [`0x060a2512…ed311`](https://voyager.online/tx/0x060a25127edcca8a5f310fa711c1566dd39c688c8b30406d7482388d715ed311) | A plan through the router |
| [`0x023f7828…cdf70`](https://voyager.online/tx/0x023f7828c9be1a04c54ab0d2b95e48506a807906c76fd6646f2c6cedc77cdf70) | A plan through the router |
| [`0x07edfb70…f9cab`](https://voyager.online/tx/0x07edfb70871f834236ff00f330ae20f214c0bfefa11f219a69d681d5627f9cab) | A plan through the router |
| [`0x0694f9d7…a96bc`](https://voyager.online/tx/0x0694f9d76480b957a0badeb1ea72a637dba903bf33c833716c5ff956f96a96bc) | A private ballot through the governor |

Four is fewer than the leaders have, and the reason is worth stating rather than
hiding: the pool charges a flat fee per private operation — 6 STRK on mainnet
today, read live by [`/api/params`](https://jalin-five.vercel.app/api/params) —
and this project funded its own. Every transaction above cost that fee on top of
whatever it moved.

**Verify them without trusting this page.** The same rule the sprint applies:

```sh
node scripts/verify-transactions.mjs strk20.json
```

or point the deployed checker at any repository, including this one:

```
https://jalin-five.vercel.app/api/manifest?owner=PugarHuda&repo=jalin
```

**What is not finished**, stated here rather than found later:

- The deployed governor at `0x05bd985e…6984` carries the unbacked-ballot-weight
  defect described in [the threat model](./threat-model.md). It is fixed in
  source and in tests, and not redeployed: the deployer holds about 2 STRK
  against a declare bound near 66. `scripts/verify-classes.mjs` refuses to call
  that address current, and the entry self-cleans if it ever matches source.
- Bridging has not been run. Lending has, on a fork, against Vesu's live STRK market. See the top of the README.
- No shadow-account transaction has been sent.

---

## 25% — Innovation

The claim is narrow and checkable: **every other project on this pool is an
application with a helper contract behind it, and this is the layer each of them
would otherwise write.**

That is not a rhetorical position. Two of the strongest entries in this sprint —
a prediction market and a deal room — implement the same withdraw/invoke/OPEN
sequence inside their own Cairo helpers, one venue each. Searching the hub's own
project descriptions for a claim of *many steps inside one invoke* returns this
project and nothing else.

The mechanism: the README's *The mechanism* section if you want the reasoning,
[`contracts/src/router.cairo`](../contracts/src/router.cairo) if you want the
120 lines that do it, and `a_swap_and_a_stake_in_the_same_invoke` in
[`contracts/tests/fork_test.cairo`](../contracts/tests/fork_test.cairo) if you
want it executed against two live protocols at once.

Safety is carried by six invariants in Cairo rather than by a whitelist, which
is what makes arbitrary calldata survivable. They are listed once, in
[`app/lib/config.ts`](../app/lib/config.ts), and rendered from there by both the
landing page and the deck so the wording cannot drift.

---

## 15% — Documentation and open-source quality

MIT. Every document below was written because something went wrong, and says
what.

| | |
|---|---|
| [`docs/threat-model.md`](./threat-model.md) | Names the deployed governor's defect, the capture window, the undeclared-token blind spot and the ballot front-running vector |
| [`docs/strk20-endpoints.md`](./strk20-endpoints.md) | The three endpoints six tracker issues asked for while they were answering; now checked live on `/verify` |
| [`docs/what-mainnet-says.md`](./what-mainnet-says.md) | Findings from reading the chain, including two this project later had to retract |
| [`docs/qa.md`](./qa.md) | What CI proves and what only a human can |
| [`docs/deploying.md`](./deploying.md) | The runbook, including the trap that silently fails four qualifying transactions |
| [`sdk/README.md`](../sdk/README.md) | `jalin-sdk` on npm: the plan encoder and both ballot operations |

**Prose is enforced, not proofread.** Three gates fail the build when a claim
drifts from what produces it:

```sh
npm run check:counts   # every test count quoted anywhere, against the suites
npm run check:links    # every path this repository names, against the repository
node scripts/verify-classes.mjs   # deployed classes against current source
```

The first exists because four stale test counts went out before it did. The
third exists because the class check reported "matches this source" against a
build nine days old.

---

## The bonus: another team depending on what we published

Honestly assessed: **not yet, in code.** `jalin-sdk` is on npm and no other
repository imports it.

What is real is smaller and easier to check. Six issues on the sprint tracker
asked where the mainnet proving service was; it had been answering the whole
time, and one of those issues was ours, saying there was no hosted endpoint.
`docs/strk20-endpoints.md` is the correction, and on 7 September it went to
eight issues on the tracker:

| Issue | What we gave them |
|---|---|
| [#135](https://github.com/starkience/strk20-hackathon/issues/135), [#158](https://github.com/starkience/strk20-hackathon/issues/158), [#204](https://github.com/starkience/strk20-hackathon/issues/204), [#221](https://github.com/starkience/strk20-hackathon/issues/221) | The prover URL, the discovery endpoint with its cleartext-viewing-key caveat, the shadow-account anonymizer, and the two errors that name the wrong thing |
| [#245](https://github.com/starkience/strk20-hackathon/issues/245) | A correction to our own issue, which had told six other issues there was no hosted prover |
| [#223](https://github.com/starkience/strk20-hackathon/issues/223) | Confirmation that no pool write is proof-free, with the measured 8.85 STRK a headless `register` costs |
| [#156](https://github.com/starkience/strk20-hackathon/issues/156) | Second-project confirmation of the 6 STRK pool fee, and the shield-sizing bug reading it as 4 caused here |
| [#240](https://github.com/starkience/strk20-hackathon/issues/240) | How to read an anonymizer's panic before proving, with the `simulate: true` call and the translation we do on it |

Whether any of that counts is the panel's to decide. It is at least checkable,
which is more than a claim of influence usually is.
