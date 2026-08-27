# What mainnet says

Findings that came from reading the chain rather than the documentation, each
with the query that produced it. Written down because every one of them cost a
wrong assumption first, and because the sprint's other teams are hitting the
same walls.

All figures are over the pool's life — a 600,000 block window ending at the head
on 26 August 2026, which is roughly eleven days at the measured block time.

## Block time is 1.68 seconds

Measured across a 2,000 block sample. It matters because every window in this
project is expressed in blocks: 50,000 blocks sounds like a long baseline and is
under a day.

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

## The proving service is still the wall

`PROVING_SERVICE_URL` for mainnet is unpublished. Measurement needs nothing and
a contract can be deployed and verified, but acting on a plan stops here. Four
issues on the hackathon repository say the same thing:
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
