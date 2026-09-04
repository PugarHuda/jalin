# Deploying

Two contracts, in one order: the governor first, because the router constructor
takes its address. Nothing points back the other way, so there is no second
wiring step and no window in which the router is live with an unset governor.

```bash
cp .env.example .env        # fill it in, see below
sh contracts/deploy.sh      # dry run - prints what it would do
sh contracts/deploy.sh --execute
```

## The deployer has to exist on chain first

This is the step that catches people, so it is first here rather than buried.

A Starknet address exists before there is a contract at it. Wallets show you an
address the moment you create an account, but that address is *counterfactual* —
computed from the key and the class hash — and nothing is deployed until the
first transaction pays for it. A `declare` is sent **from** the deployer, so an
address with no contract behind it cannot send one.

`deploy.sh` checks this before it builds anything or imports a key. If you want
to check by hand, or you are not sure which of several values is even the
address:

```bash
node contracts/identify-account.mjs 0xA 0xB 0xC
```

It is read-only, checks mainnet and Sepolia, reports balances, and — when it
finds a live account — tells you which of the remaining values is the private key
and which is the public key, by comparing against the account's own
`get_public_key()`. Output is truncated, so it is safe to paste into a chat.

Three outcomes and what each means:

| What it says | What it is | What to do |
|---|---|---|
| deployed on **sepolia** | a testnet account | get a mainnet one; the sprint is scored on mainnet |
| holds STRK, no contract | counterfactual | run "deploy account" in the wallet, then retry |
| nothing anywhere | never funded | send STRK to it, then deploy the account |

## `.env`

```
# Use the versioned path. The default /v2/<key> serves RPC spec 0.8.1, and
# sncast 0.63 rejects it with a bare "Invalid block id".
STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_10/<YOUR_ALCHEMY_KEY>
POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a

ACCOUNT_ADDRESS=
ACCOUNT_PRIVATE_KEY=
ACCOUNT_TYPE=oz            # oz | argent | braavos - must match the wallet

BALLOT_TOKEN=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
FEE_RECIPIENT=             # where a governed fee would go; the deployer is fine

MAX_STEPS=8
MAX_CALLDATA=64
VOTING_BLOCKS=2000         # ~57 min at the measured 1.70s block time
TIMELOCK_BLOCKS=500        # ~14 min, so ~71 min from proposal to execution
QUORUM=1000000000000000000 # 1 STRK
```

`.env` is gitignored. Keep it that way — a key in a public repository is a key
that is gone.

`ACCOUNT_TYPE` has to match the wallet the key came from. `sncast` derives the
account differently for each, and the wrong one imports an account whose address
does not match, which fails at the first transaction rather than at import.
`identify-account.mjs` prints the class hash; that is what tells you which.

## Governance parameters are a decision, not a default

`VOTING_BLOCKS` and `TIMELOCK_BLOCKS` are the window in which a hostile proposal
can be noticed and the window in which it can be answered. Short values make
governance responsive and capture cheap. The values above are deliberately modest
for a sprint; a real deployment should be arguing about them.

`QUORUM` is denominated in `BALLOT_TOKEN`. Set it too low and one holder decides
everything; too high and nothing ever passes and the parameters are frozen at
whatever they were deployed with. Frozen is the safer failure, which is why the
default errs high.

`fee_bps` starts at zero and is capped at 1000 (10%) in the contract regardless of
what any vote says. That cap is not governed and cannot be raised.

## Running it

The dry run prints every command it would send. Read it. Then:

```bash
sh contracts/deploy.sh --execute
```

It imports the deployer into `sncast`, declares both classes, and stops. Deployment
is left as two commands you paste yourself, with the class hashes it printed. That
is deliberate: a class hash should be read by a person before anything is deployed
against it, and a script that hides that step is a script that quietly deploys the
wrong class.

```bash
sncast --account jalin deploy --url "$STARKNET_RPC_URL" \
  --class-hash <GOVERNOR_CLASS_HASH> \
  --constructor-calldata <POOL> <BALLOT_TOKEN> <FEE_RECIPIENT> 8 64 2000 500 1000000000000000000

sncast --account jalin deploy --url "$STARKNET_RPC_URL" \
  --class-hash <ROUTER_CLASS_HASH> \
  --constructor-calldata <GOVERNOR_ADDRESS>
```

## After

Check the router points where you think it does:

```bash
sncast call --url "$STARKNET_RPC_URL" --contract-address <ROUTER> --function governor
```

Then record both addresses:

- `strk20.json` → `contracts`, which is what the panel reads
- `NEXT_PUBLIC_ROUTER_ADDRESS` in the demo's environment, which is what turns
  signing on. Until it is set the composer still works — the plan, the calldata
  and the disclosure all come from the plan alone — but the submit button stays
  disabled.

## Redeploying, once something is already listed

A second deployment is not the first one again. The router takes its governor in
the constructor and has no setter, so a corrected governor means a new router
too — two new addresses — and the transactions already in `strk20.json` ran
through the old pair.

The rule the sprint applies, and that `sdk/src/receipt.ts` implements, is that a
listed transaction must have run through **one of** the project's contracts. So
the answer is not to swap the addresses, it is to list both generations:

```json
"contracts": [
  "0x008498…3a7e",   // router, first deployment — carries T1..T3
  "0x05bd98…6984",   // governor, first deployment — carries T4
  "0x…",             // router, corrected
  "0x…"              // governor, corrected
]
```

`parseManifest` accepts up to 16, so four is not near any limit. Swapping instead
of appending takes four qualifying transactions down to zero, and it does it
silently — the manifest still parses, the hashes still exist, and every one of
them fails the fourth condition.

Then, and only then, move `NEXT_PUBLIC_ROUTER_ADDRESS` and
`NEXT_PUBLIC_GOVERNOR_ADDRESS`. Be aware of what that costs on the site:
`/governance` reads proposals from whichever governor it is pointed at, and a
fresh governor has none, so the landing page's governance count goes to zero
until somebody proposes. Proposing is an ordinary public transaction — no STRK20
support, no proving service — so the cheapest way to restore that evidence is to
make one immediately after the deploy.

## Cost

Two declares and two deploys. A declare pays for the whole Sierra class, so it is
by far the expensive part.

Measured on mainnet in August 2026:

| | Bound |
|---|---|
| `declare JalinGovernor` | 39.95 STRK |
| `declare JalinRouter` | 25.44 STRK |
| two deploys | ~0.2 STRK |
| **total** | **~65.6 STRK** |

Almost all of it is L2 gas — 783,718,980 units for the governor at 50,973,799,348
FRI each. You can measure your own numbers for free: a declare that fails
validation on balance is rejected before it runs, so it costs nothing and the
error names the bound. Run it against an underfunded account on purpose.

That number is the *bound*, not the bill. The account has to hold it at submission
or validation rejects the transaction before anything runs; what actually gets
charged is lower. Budget **80 STRK** for the whole deployment and you will not
think about it again.

As of 4 September the deployer `0x012947…73ca` holds **2.178 STRK**, which is why
the corrected governor is source and tests rather than an address. The blocker is
funding, not the toolchain and not the code: 47 Cairo tests pass in the pinned
container on this machine.

Getting this wrong is cheap but slow: validation fails, nothing is spent, and you
find out after the toolchain has compiled. The error names both numbers:

```
Error: Contract failed the validation = Resources bounds (...) exceed balance (2341763398609452084)
```

The trailing number is your balance in FRI. Divide by 1e18 for STRK.

## Reproducing the classes

Both contracts build in a pinned container, so the class hashes are reproducible:

```bash
sh contracts/test.sh                                   # 47 tests
scarb build --manifest-path contracts/Scarb.toml       # or natively
```

Toolchain is pinned in `contracts/Dockerfile`: scarb 2.20.0, starknet-foundry
0.63.0, universal-sierra-compiler 2.10.0. If your class hash differs from the one
in `strk20.json`, the toolchain moved, not the source.
