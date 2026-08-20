#!/usr/bin/env sh
# Declare and deploy Jalin, in the same pinned container the tests run in.
#
#   cp .env.example .env && edit it
#   sh contracts/deploy.sh            # dry run: prints what it would do
#   sh contracts/deploy.sh --execute  # for real
#
# The governor goes first because the router constructor takes its address.
# Nothing points back the other way, so there is no second wiring step and no
# window in which the router is live with an unset governor.
set -eu

cd "$(dirname "$0")/.."
[ -f .env ] && . ./.env

: "${STARKNET_RPC_URL:?set STARKNET_RPC_URL}"
: "${ACCOUNT_ADDRESS:?set ACCOUNT_ADDRESS}"
: "${ACCOUNT_PRIVATE_KEY:?set ACCOUNT_PRIVATE_KEY}"
: "${POOL_ADDRESS:?set POOL_ADDRESS}"
: "${BALLOT_TOKEN:?set BALLOT_TOKEN - the token a governance ballot is denominated in}"
: "${FEE_RECIPIENT:?set FEE_RECIPIENT - where a governed fee would go}"

ACCOUNT_TYPE="${ACCOUNT_TYPE:-oz}"
MAX_STEPS="${MAX_STEPS:-8}"
MAX_CALLDATA="${MAX_CALLDATA:-64}"
VOTING_BLOCKS="${VOTING_BLOCKS:-2000}"
TIMELOCK_BLOCKS="${TIMELOCK_BLOCKS:-500}"
QUORUM="${QUORUM:-1000000000000000000}"

EXECUTE=0
[ "${1:-}" = "--execute" ] && EXECUTE=1

run() {
  if [ "$EXECUTE" -eq 1 ]; then
    docker run --rm \
      -v "$(pwd):/work" -v jalin-scarb-cache:/root/.cache/scarb \
      -w /work/contracts \
      -e ACCOUNT_PRIVATE_KEY \
      jalin-cairo:2.20.0 "$@"
  else
    printf '  would run: %s\n' "$*"
  fi
}

docker build -q -t jalin-cairo:2.20.0 contracts >/dev/null

echo "network:  $STARKNET_RPC_URL"
echo "pool:     $POOL_ADDRESS"
echo "deployer: $ACCOUNT_ADDRESS"
[ "$EXECUTE" -eq 1 ] || echo "(dry run - pass --execute to actually send transactions)"
echo

echo "1. import the deployer account"
run sncast account import --silent --name jalin --type "$ACCOUNT_TYPE" \
  --address "$ACCOUNT_ADDRESS" --private-key "$ACCOUNT_PRIVATE_KEY" \
  --url "$STARKNET_RPC_URL" --add-profile jalin

echo "2. declare both classes"
run sncast --account jalin declare --url "$STARKNET_RPC_URL" --contract-name JalinGovernor
run sncast --account jalin declare --url "$STARKNET_RPC_URL" --contract-name JalinRouter

cat <<NOTE

3. deploy, in this order, using the class hashes printed above:

   sncast --account jalin deploy --url "\$STARKNET_RPC_URL" \\
     --class-hash <GOVERNOR_CLASS_HASH> \\
     --constructor-calldata \\
       $POOL_ADDRESS \\
       $BALLOT_TOKEN \\
       $FEE_RECIPIENT \\
       $MAX_STEPS \\
       $MAX_CALLDATA \\
       $VOTING_BLOCKS \\
       $TIMELOCK_BLOCKS \\
       $QUORUM

   sncast --account jalin deploy --url "\$STARKNET_RPC_URL" \\
     --class-hash <ROUTER_CLASS_HASH> \\
     --constructor-calldata <GOVERNOR_ADDRESS>

Then record both addresses in strk20.json under "contracts", and check the
router points where you think it does:

   sncast call --url "\$STARKNET_RPC_URL" \\
     --contract-address <ROUTER_ADDRESS> --function governor

The deploy is left as two explicit commands rather than being chained: a class
hash has to be read and checked by a person before anything is deployed against
it, and a script that hides that step is a script that deploys the wrong class.
NOTE
