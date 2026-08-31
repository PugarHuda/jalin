# What mainnet says

Findings that came from reading the chain rather than the documentation, each
with the query that produced it. Written down because every one of them cost a
wrong assumption first, and because the sprint's other teams are hitting the
same walls.

All figures are over the pool's life — a 600,000 block window ending at the head
on 26 August 2026, which is roughly eleven days at the measured block time.

## Block time is about 1.7 seconds, and a short sample lies

First measured across a 2,000 block sample as 1.68. It matters because every
window in this project is expressed in blocks: 50,000 blocks sounds like a long
baseline and is under a day.

Re-measured on 27 August at head 13,951,896, because another team took the
1.68 from this document, checked it against their own hardcoded 30 seconds, and
found a seven-day campaign window that would have closed in under three hours:

```
  1,000 blocks   1.720 s/block
  2,000 blocks   1.723 s/block
 20,000 blocks   1.738 s/block
200,000 blocks   1.702 s/block
600,000 blocks   1.695 s/block
```

The 2,000-block figure moved by 2.5% in a week; their 1,000-block sample read
2.03 against a true 1.70 on the same day. Short spans are jitter. The composer
now measures over 20,000 blocks on every read (`/api/params` →
`secondsPerBlock`) and says blocks alone when the node will not give it two
timestamps, rather than minutes from a number nobody checked.

## You cannot shield and spend in the same transaction

The obvious way to onboard somebody in one step is a deposit action followed by
a withdrawal that spends it. The pool applies actions in order, so it looks like
it should work. It does not — mainnet answers `INSUFFICIENT_PRIVATE_BALANCE`.

Corroborated by the fact that nobody has ever done it:

```
transactions carrying a Deposit          342
transactions carrying an invoke          247
transactions carrying both                 0
```

Not one, across every team using the pool. `toWalletActions` used to accept a
`deposits` option that built exactly this transaction. It has been removed
rather than documented, because an option that builds a transaction which
reverts is worse than no option.

## A shield with no exit still emits a Withdrawal

That event is the fee leg, and its recipient is the fee collector or the
paymaster that relayed the gas. Counting `Withdrawal` events as departures
therefore counts people leaving who never left.

Seen most clearly in `0x04816dbb…0278` at block 13,876,176, a single Ready
shield of 10 STRK, which emitted:

```
ViewingKeySet    the registration
Deposit          10 STRK
EncNoteCreated   the note
Withdrawal       the fee leg, to the paymaster
```

## Registration is not a dapp's to perform

There is no register method in the Wallet API. The wallet emits `ViewingKeySet`
itself, on the first shield made from inside it — the same transaction above.
Any flow that sends people to a website to register first is sending them
somewhere they do not need to go.

## Counting arrivals needs no filters; counting exits needs three

Three kinds of destination are not people: anonymizer helper contracts, the fee
collector, and a relaying paymaster. All three appear on the withdrawal side.
None has ever appeared on the deposit side:

```
anonymizer helpers seen (ExternalContractInvoked)   31
distinct depositors                                158
helpers that also appear as a depositor              0
paymaster ever a depositor                          no
fee collector ever a depositor                      no
```

A helper receives from the pool and returns `OpenNoteDeposit`; the note is
credited to the user, so the helper never lands in `keys[1]` of a `Deposit`.

## The pool's fee collector must be asked for, not guessed

`get_fee_collector()` returns
`0xd79041634625e5288296fbc648088788710ba44903a3a49468a66567749e77`. The address
often mistaken for it, `0x127021a1…`, is a paymaster — its class carries
`get_gas_fees_recipient`, `execute_sponsored` and `is_whitelisted`, which a fee
sink would not.

## The crowd is per cell, not per pool

An observer of the public deposit leg sees the asset, the order of magnitude and
roughly when. Two deposits only cover each other if they agree on all three.
Grouped that way:

```
cells                  169
median effective set   1.00
cells holding one      72%
largest headcount        15
largest effective set  14.20
```

The effective set is `2^H` over the flow distribution rather than a headcount,
because a cell where one address carries most of the volume is not the crowd its
headcount claims. See `sdk/src/anonymity.ts`.

## The headless SDK path costs three times what the browser does

`register` through the SDK landed at
[`0x2c72e438…855753`](https://voyager.online/tx/0x2c72e438b9572da3c36048491d6c90bce1234588582818e860dff017c855753),
block 14,157,582, four events, pool among the emitters. It cost:

```
pool fee     6.00 STRK
gas          2.79 STRK   proof verification is not cheap
approve      ~0.05 STRK  the pool must be allowed to pull its own fee
```

Nine STRK for one operation. The same operation from the browser costs the six,
because Ready relays through a paymaster and the pool fee pays for the relay.
Anyone budgeting a headless run should triple the number they expect.

Two blockers found on the way, both of which return errors that name something
else:

- `register` fails with `Insufficient ERC20 allowance` from the pool, not from a
  wallet. The SDK does not include the `approve` the pool needs to draw its own
  fee; it has to be sent first, as an ordinary public transaction.
- Every builder path that carries `surplusTo(...)` fails with `Missing channel
  context for recipient` until the account is registered - including `shield`,
  which is the operation people reach for to register. Register is genuinely
  first, and it is the one that costs nine STRK before anything is shielded.

## Note discovery is a service, and it reads your viewing key

`https://discovery-service.alpha-mainnet.sw-dev.io` answers, and without it the
SDK cannot resolve which notes an account owns: the shadow-account flow stops at
`discoverChannels` with a TypeError rather than a message. It takes the viewing
key in cleartext, so the operator of that service can read the balances of any
account pointed at it. That is a real trade for a headless integration and it is
not mentioned where the endpoint is.

## The shadow-account anonymizer is deployed, and almost nobody has used it

`0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7`, class
`0x7ffaf4f4…7f5e6`. Verified rather than copied: `get_privacy_contract()` on it
returns this project's pool, so it is bound to the same pool the router runs
against.

It is documented in starknet.js under "Address of a shadow account" and in none
of the places this project looked first - not beside the Ekubo and Vesu entries
in the privacy monorepo's README, not in the docs mirror, not in the SDK's own
package, which is not on public npm at all.

Do not derive the address locally. The SDK's derivation does not reproduce what
this anonymizer deploys; the on-chain `get_shadow_account(commitment)` view
does, and returns `0x0` for a commitment whose account has not been deployed
yet.

## The proving service was never the wall, and this document said it was

`https://transaction-prover.alpha-mainnet.sw-dev.io` answers `/health` with
`{"status":"ok"}` and proves: pointed at it, `scripts/mainnet.mjs register`
builds a real `apply_actions` against the pool with proof data attached.

This section previously read "the proving service is still the wall" and stated
that `PROVING_SERVICE_URL` for mainnet is unpublished. That was false. The URL
sits in another team's `.env.example` in a public repository, and it was found
by reading their repository rather than by anyone publishing anything new.

The error is worth keeping visible rather than editing away, because of its
direction: it excused the shallowest part of this project's integration. Every
claim in this file was measured except the one that let something go unbuilt,
and that is the one that was wrong.

Four issues on the hackathon repository still say the same thing:
[#121](https://github.com/starkience/strk20-hackathon/issues/121),
[#124](https://github.com/starkience/strk20-hackathon/issues/124),
[#135](https://github.com/starkience/strk20-hackathon/issues/135),
[#147](https://github.com/starkience/strk20-hackathon/issues/147).

## The pool charges 6 STRK per private operation, not 4

`get_fee_amount()` on the pool returns `0x53444835ec580000`, which is 6e18. The
agent skill shipped in this repository says 4 STRK, and says to read it rather
than hardcode it — advice that was right and that we followed for the router's
own parameters while missing it here.

Corroborated by the fee leg rather than by the view alone. The shield in
`0x04816dbb…0278`, the transaction this project already cites for
`ViewingKeySet`, deposited 10 STRK and emitted a `Withdrawal` of exactly 6:

```
Deposit      10 STRK
Withdrawal    6 STRK   the fee leg
```

It is flat, so it dwarfs small amounts rather than scaling with them, and it is
paid out of the private balance. The composer's mainnet run was sized at a 1
STRK shield to cover three runs of 0.5, 0.25 and 0.1 — arithmetic that counted
the value moved and none of the fees. Four operations at 6 STRK is 24, so the
first spend answered `not enough private balance for both the amount and the
privacy fee`, which is the wallet naming a shortfall the page had designed in.

The shield is now derived from the live fee: once for itself, once per run,
plus what the runs spend. A demo that hardcodes any of those numbers is a demo
that works until a vote changes one.

## Two USDCs, and the one with a route is not the one with a crowd

The pool has no token list — ten different ERC-20s have been shielded into it —
so an output note can be in anything. Which anything matters more than it
looks. Over the pool's life:

```
STRK       295 deposits
USDC       71    0x33068f…  native
strkBTC    16    0x787150…
ETH         8
USDC.e      1    0x53c9…    bridged "USD Coin"
```

This project's config labelled `0x53c9…` "USDC". A note in it is a cell of one
— the "you, alone" the disclosure panel warns about — and no router can fix
that. The swap preset buys native USDC for that reason.

AVNU, asked with the router as taker on 28 August:

```
                 0.25 STRK      1 STRK       5 STRK      25 STRK
USDC native      0dAMM          0dAMM        0dAMM       0dAMM      fair
USDC.e           Ekubo 5.0×     Ekubo 5.0×   Ekubo 5.0×  0dAMM      -
ETH              no route       no route     JediSwapCL  0dAMM
```

The USDC.e quotes through Ekubo return five times the sell value in USD. That
is not a market, it is a pool nobody has priced in months, and a swap "into"
it is a swap into whatever its next arbitrage leaves. The native quotes are at
value — and intermittent: five "no route" answers in a row one minute, a route
at every size the next. `/api/swap` returns AVNU's refusal as a 404 in AVNU's
own words rather than falling back to the mispriced pair, and the tests skip
on that answer rather than fail on it.
