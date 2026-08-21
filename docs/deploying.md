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
STARKNET_RPC_URL=https://starknet-mainnet.g.alchemy.com/v2/<YOUR_ALCHEMY_KEY>
POOL_ADDRESS=0x040337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a

ACCOUNT_ADDRESS=
ACCOUNT_PRIVATE_KEY=
ACCOUNT_TYPE=oz            # oz | argent | braavos - must match the wallet

BALLOT_TOKEN=0x04718f5a0fc34cc1af16a1cdee98ffb20c31f5cd61d6ab07201858f4287c938d
FEE_RECIPIENT=             # where a governed fee would go; the deployer is fine

MAX_STEPS=8
MAX_CALLDATA=64
VOTING_BLOCKS=2000         # ~8 hours at mainnet block times
TIMELOCK_BLOCKS=500        # ~2 hours
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

## Cost

Two declares and two deploys. A declare pays for the whole Sierra class, so it is
the expensive part and the router is the larger of the two. Have more STRK than
you think you need; a declare that runs out mid-flight has still spent the fee.

## Reproducing the classes

Both contracts build in a pinned container, so the class hashes are reproducible:

```bash
sh contracts/test.sh                                   # 24 tests
scarb build --manifest-path contracts/Scarb.toml       # or natively
```

Toolchain is pinned in `contracts/Dockerfile`: scarb 2.20.0, starknet-foundry
0.63.0, universal-sierra-compiler 2.10.0. If your class hash differs from the one
in `strk20.json`, the toolchain moved, not the source.
