# QA: what the machine checks, and what only you can

The automated suite is large and it stops at the wallet. Every path that ends in
a signature needs a person with a funded account, because a signature cannot be
faked without also faking the thing being tested.

This page splits the two, so nobody re-runs by hand what CI already proves, and
nobody assumes CI covered a path it structurally cannot reach.

## What the machine already checks

Run all of it with three commands:

```sh
npm test          # 129 SDK tests
npm run test:e2e  # 370 browser tests, six projects, three engines
sh contracts/test.sh   # 44 Cairo tests, four of which fork mainnet
```

| Suite | What it establishes |
|---|---|
| Cairo, 44 | Each of the six invariants rejects the plan it exists to reject. Four fork mainnet and run the router against Endur's real vault and AVNU's real exchange, so the integration is tested against the deployed contracts rather than a mock. |
| SDK, 129 | Plan encoding round-trips, calldata bounds hold, and the receipt reader applies the sprint's four-part rule the same way `/verify` does. |
| Browser, 370 | Every page renders without a console error, passes axe at WCAG 2.1 AA, keeps a visible focus ring under real Tab presses, never scrolls sideways at 390px, and computes every colour pair on the page against the WCAG formula from the tokens on the live document. |

Two properties of that suite are worth knowing before you trust it:

- **There are no fixtures.** The browser tests read the live chain, so they
  assert invariants rather than values: that one STRK buys strictly fewer than
  one xSTRK share, that the crowd count is bounded by the deposit count. A test
  that hardcoded today's number would pass forever and mean nothing.
- **It is honest about what it cannot reach.** `e2e/ready.spec.ts` loads the real
  Ready extension from a Chrome profile and asserts only what it can prove
  without an onboarded wallet: that the service worker is alive and the content
  script arrives. It skips cleanly on a machine without the extension, which is
  why CI stays green without pretending to have signed anything.

## What only a person can check

Everything below needs the Ready wallet, a funded account, and about twenty
minutes. Nothing here can be automated without a wallet that will sign
unattended, which is a wallet nobody should have.

**Before you start:** the pool charges a flat fee per private operation, read
live from `get_fee_amount` — 6 STRK at the time of writing. Every case below
costs that fee whether it succeeds or fails, so read the whole list before
spending.

### 1. The account is registered

| | |
|---|---|
| Where | Ready wallet, its own privacy screen |
| Do | Shield any amount once |
| Expect | One transaction emitting `ViewingKeySet`, `Deposit` and `EncNoteCreated` together |
| Why by hand | There is no register method in the Wallet API. No dapp can do this for you, so no test can either. |

If you skip it, every later case fails with `NOT_REGISTERED`, and that is the
correct behaviour rather than a bug.

### 2. The composer reads your real shielded balance

| | |
|---|---|
| Where | `/compose` |
| Do | Connect Ready |
| Expect | Under "In the pool, for this account", the same figures the wallet shows on its own screen |
| Watch for | Any number here that the wallet does not also show. The page reads `wallet_strk20Balances` and holds no viewing key; if it displays a balance the wallet does not, something is inventing it. |

### 3. A dry run refuses without charging

| | |
|---|---|
| Where | `/compose`, the editor's **Dry run**, or the ballot's |
| Do | Press **dry run** |
| Expect | Ready opens its own screen and reports what it would refuse. Nothing is proved, sent or charged either way. |
| Watch for | A dry run that costs STRK, or that reports success for a plan the run button says you cannot afford. Those two must agree. |

### 4. A shortfall is named before you can spend into it

| | |
|---|---|
| Where | `/compose`, with less shielded STRK than the ballot needs |
| Do | Read the line under the ballot |
| Expect | The exact arithmetic: what the run spends, what the pool charges, what you hold, and what you are short by |
| Watch for | A run button that is enabled while the shortfall line is showing. The button must be disabled — otherwise you pay a proof to discover you could not afford the transaction. The editor's own button does not do this arithmetic; there the wallet is what refuses, and it names the shortfall in its own words. |

### 5. A plan lands and the hash is kept

| | |
|---|---|
| Where | `/compose`, any preset plus **Sign and submit** |
| Do | Press a preset, then **Sign and submit**, sign in Ready, and **wait for the hash to appear** |
| Expect | A hash, linked to Voyager, and a verdict line under it computed from the chain |
| Watch for | **Do not press another button while "Proving" is still on screen.** This is the one defect this project has actually shipped: a second click replaced the proving line, the hash lived nowhere else, and a transaction that succeeded on mainnet was reported here as never sent. The page now keeps landed hashes per account, but the discipline still matters. |

### 6. The ballot refuses when there is nothing to vote on

| | |
|---|---|
| Where | `/compose`, the ballot |
| Do | Look at it while no proposal is open |
| Expect | The run button disabled, and a line saying no proposal is taking votes |
| Why it matters | A ballot with no open proposal is a transaction that reverts *after* it has been paid for and proved. Offering the button would be charging somebody to find that out. |

To exercise the happy path, make a proposal on `/governance` first — it is an
ordinary public transaction, needs no STRK20 support and no proving service —
then come back within the hour.

### 7. Verify agrees with the chain, and disagrees when it should

| | |
|---|---|
| Where | `/verify` |
| Do | Paste your own landed hash. Then paste a plain STRK transfer of yours. |
| Expect | The first counts. The second does not, and the page says which of the four conditions it failed. |
| Watch for | Anything that counts a transaction which did not touch the pool, or did not run through a declared contract. `/verify` and `scripts/verify-transactions.mjs` share the SDK, so they must give the same verdict for the same hash. |

### 8. The failure states are real

| | |
|---|---|
| Where | anywhere |
| Do | Turn off your network and reload the landing page |
| Expect | Em-dashes where the figures were, and a red line naming the read that failed |
| Watch for | A page that simply omits the numbers and still looks finished. That was the old behaviour and it is the worst of the three outcomes — worse than an error, because a reader cannot tell a product with no evidence from a read that did not load. |

## The two-minute version

If you have time for one pass and not eight:

1. Connect Ready on `/compose` and check the shielded balance matches the wallet.
2. Dry-run the plan in the editor; confirm nothing is charged.
3. Run it, wait for the hash, and paste that hash into `/verify`.
4. Kill your network, reload `/`, and confirm the page says what failed.

That covers the wallet boundary, the money boundary, the verification path and
the failure path — which is every place this project could lie to you.

## If something fails

Say what you did, what you expected, and what the page said, in that order. The
page is written so that the third one is usually enough: every button that asks
the wallet for something renders the wallet's own answer directly beneath itself,
in the wallet's own words. If the answer is missing rather than wrong, that is
itself the bug.
