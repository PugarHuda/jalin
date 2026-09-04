# The three STRK20 mainnet endpoints, and how to check them yourself

Every one of these was reported missing somewhere — in this repository, in the
sprint's own issue tracker, or in both. All three answer. This page exists
because the cost of the belief was not confusion, it was work not done: each
missing endpoint excused leaving part of an integration unbuilt.

Nothing here was published in response to anyone asking. They were already
public, in places nobody thought to read.

## Proving service

```
https://transaction-prover.alpha-mainnet.sw-dev.io
```

```sh
curl -s https://transaction-prover.alpha-mainnet.sw-dev.io/health
# {"status":"ok"}
```

A health check is weak evidence, so the real test is a proof. With
`PROVING_SERVICE_URL` set to it, `node scripts/mainnet.mjs register` builds an
`apply_actions` call against the pool with proof data attached, and
`--execute` landed
[`0x2c72e438…855753`](https://voyager.online/tx/0x2c72e438b9572da3c36048491d6c90bce1234588582818e860dff017c855753)
at block 14,157,582.

Six issues on `starkience/strk20-hackathon` ask for this URL:
[#121](https://github.com/starkience/strk20-hackathon/issues/121),
[#124](https://github.com/starkience/strk20-hackathon/issues/124),
[#135](https://github.com/starkience/strk20-hackathon/issues/135),
[#147](https://github.com/starkience/strk20-hackathon/issues/147),
[#204](https://github.com/starkience/strk20-hackathon/issues/204),
[#221](https://github.com/starkience/strk20-hackathon/issues/221).

Sepolia: `https://transaction-prover.alpha-sepolia.sw-dev.io`.

## Note discovery

```
https://discovery-service.alpha-mainnet.sw-dev.io
```

Set as `INDEXER_URL`. Without it the SDK cannot resolve which notes an account
owns, and the shadow-account flow fails at `discoverChannels` with a `TypeError`
rather than a message that names the missing service.

It answers `/health`, and the answer is worth more than a ping — it reports how
far behind the chain the indexer is, which is the number that decides whether a
note you just created is discoverable yet:

```sh
curl https://discovery-service.alpha-mainnet.sw-dev.io/health
```

```json
{"status":"OK","chain_head":{"block_number":14331721,...},"lag_secs":6}
```

The root path is a 404, which is what this document reported as the whole answer
until 4 September — a 404 on `/` was read as "no health endpoint" rather than as
"not that path".

**It receives the viewing key in cleartext.** The operator of that service can
read the shielded balances of any account pointed at it. That is a real trade
for a headless integration, it is not stated where the endpoint is, and it is
the reason to think about which account you point at it.

## Shadow-account anonymizer

```
0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7
```

Set as `shadowAccountAnonymizerAddress` in `createPrivateTransfers`. Without it,
`transfers.build().shadowAccounts(...)` throws.

Verified rather than copied:

```sh
node -e "
const { RpcProvider } = require('starknet')
const p = new RpcProvider({ nodeUrl: process.env.STARKNET_RPC_URL })
const A = '0x04f33230dc57855c6e7eabe66dfa0fde82c5458fd0e54827cdb7cb4c474888a7'
p.getClassHashAt(A).then(console.log)
p.callContract({ contractAddress: A, entrypoint: 'get_privacy_contract', calldata: [] }).then(console.log)
"
# class          0x7ffaf4f427c8de0ca35d32d44d97a31da3c24641e32b72f340660d5b9e7f5e6
# privacy pool   0x40337b1af3c663e86e333bab5a4b28da8d4652a15a69beee2b677776ffe812a
```

That second call is the one that matters: the anonymizer names the pool it is
bound to, and it is the same pool this project's router runs against.

Documented in starknet.js under *"Address of a shadow account"*. It is **not**
in the privacy monorepo's README beside the Ekubo and Vesu entries, not in
`llms-full.txt`, and not in the SDK package — which is not on public npm at all,
it publishes to `npm.pkg.github.com`.

Sepolia: `0x010a2285310c107c731d997afc147afb7495daff6397c2d242133d9fe8d9b147`.

**Do not derive the shadow account address locally.** The SDK's derivation does
not reproduce what this anonymizer deploys. Read it from the contract:

```
get_shadow_account(commitment) -> ContractAddress
```

It returns `0x0` for a commitment whose account has not been deployed yet, which
is how you tell a new one from an existing one.

## Two errors that name the wrong thing

Both cost an hour each, and neither says what is actually wrong.

**`Insufficient ERC20 allowance`, thrown by the pool.** The SDK does not send the
`approve` the pool needs in order to draw its own fee. Send it first, as an
ordinary public transaction, before any phase that pays a pool fee.

**`Missing channel context for recipient 0x…`.** The account is not registered.
Every builder path carrying `surplusTo(...)` hits this — including `shield`,
which is the operation people reach for *in order to* register. `register` is
genuinely first, and it is the one that costs a full pool fee before anything
has been shielded.

## What it costs

Measured on mainnet, one `register` through the SDK:

| | |
|---|---|
| Pool fee | 6.00 STRK |
| Gas | 2.79 STRK — proof verification is not cheap |
| `approve` | ~0.05 STRK |
| | **~8.85 STRK for one operation** |

The same operation from a browser wallet costs the 6, because Ready relays
through a paymaster and the pool fee pays for the relay. **Budget three times
the pool fee for anything headless**, and read
[what-mainnet-says.md](./what-mainnet-says.md) for the rest of what this project
measured rather than assumed.
