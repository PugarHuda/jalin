# Self-hosted infrastructure

```bash
cp .env.example .env          # STARKNET_RPC_URL is the only one discovery needs
docker compose up -d discovery
curl -s localhost:8081/health
```

Verified against mainnet on 26 August 2026:

```json
{"status":"OK","chain_head":{"block_number":13852335,...},"lag_secs":4}
```

The screening sidecar lives in its own compose file:

```bash
docker compose -f docker-compose.yml -f docker-compose.screening.yml up -d
```

It is a separate file rather than a profile on purpose. Compose interpolates the
whole file whatever the profile, so a profile would have forced `SCREENING_URL`
to be optional - and an empty `SCREENING_URL` makes the sidecar a pass-through
that allows everything while `/health` still reports OK. Split out, it stays
required, and bringing screening up without an endpoint fails instead of quietly
screening nothing.

**Configuration goes through environment variables, not the TOML file.** Upstream
documents both and says of Docker: *"set env vars in compose (no config file
needed)"*. The file route needs `${VAR}` expansion that the loader rejected here -
including on a plain `${STARKNET_RPC_URL}` - and env vars win over the file
anyway, so the file was not worth the failure. `discovery.toml` is kept as a
reference for anyone running the binary directly.

Then point the SDK at your own services:

```ts
createPrivateTransfers({
  discoveryProvider: { url: 'http://localhost:8081' },
  provingProvider: { url: process.env.PROVING_SERVICE_URL!, chainId: constants.StarknetChainId.SN_MAIN },
  poolContractAddress: process.env.POOL_ADDRESS!,
  // ...
})
```

## What is actually self-hostable, and what is not

Being precise about this matters, because "run your own prover" is usually said as
though it were one thing.

| Component | Self-hostable | Where it comes from |
|---|---|---|
| **Discovery service** | yes | `ghcr.io/starkware-libs/starknet-privacy/discovery-service` |
| **Proof interceptor** (screening sidecar) | yes | `ghcr.io/starkware-libs/starknet-privacy/proof-interceptor` |
| **Transaction prover** | not published | point `PROVING_SERVICE_URL` at a prover you operate, or the hosted one |

The prover binary itself is not in the public monorepo, so this compose file does
not pretend to stand one up. What it does stand up is the part that carries the
privacy weight, and the part that carries the compliance weight.

## Why the discovery service is the one worth running yourself

Discovery is where a viewing key goes. The upstream design is explicit that keys
are *"provided per request, never stored"* — which is a good property, and still
means that on every sync your decryption key is transmitted to whoever operates
that endpoint. Trusting them not to keep it is a policy assumption, not a
cryptographic one.

Running it yourself removes the assumption. The key never leaves your
infrastructure, and the RPC reads happen from your node key rather than from a
shared one that sees every user's queries side by side.

If you cannot self-host, the upstream service supports **Oblivious HTTP**
(RFC 9458, `OHTTP_ENABLED` plus an `OHTTP_KEY`): a relay sees your IP but not your
request, and the service sees your request but not your IP. That splits the
metadata rather than removing the trust, which is weaker than self-hosting but a
great deal better than nothing.

## The screening sidecar, and what it means for Jalin plans

The interceptor screens **deposits** into the pool. Jalin plans are not deposits,
so they land in the upstream category *"pool call with no Deposit action"*, which
is allowed and is unaffected by `SCREENING_BLOCK_NON_POOL_TX`. A plan does not
route around screening; the shielding that funded it was screened when it happened,
and the pool verifies the FPI signature on chain regardless of which prover made
the proof.

The compose file departs from the shipped defaults on two settings, following the
upstream production checklist:

- `SCREENING_BLOCK_NON_POOL_TX=true` — turns the multi-call and non-canonical-felt
  bypasses into blocks. Upstream calls this the single most important toggle.
- `SCREENING_FAIL_OPEN=false` — a screening failure blocks rather than waves
  through. It is already the default; it is set explicitly so a future default
  change cannot quietly loosen it.

Leaving `SCREENING_URL` empty makes the sidecar a pass-through that always allows,
while `/health` still reports OK. Confirm `proof_interceptor_screening_results_total`
on `/metrics` is non-zero before believing screening is on.

## Binding

Neither service has application-level authentication, so the host binding *is* the
security boundary. Both publish on `127.0.0.1` only. `HOST=0.0.0.0` inside the
interceptor container is what lets a prover container reach it across the compose
network; it is not reachable from outside the host. If you move either service onto
a shared network, put a proxy or a service mesh in front of it first.

## Version pinning

`DISCOVERY_TAG` and `INTERCEPTOR_TAG` default to `latest`, which is wrong for
anything you depend on. Pin both to a digest once your pool ABI is known good —
upstream warns that ABI drift causes silent fail-open on deposit detection.
