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
: "${ACCOUNT_ADDRESS:?set ACCOUNT_ADDRESS in .env - run: node contracts/identify-account.mjs <values> to work out which one it is}"
: "${ACCOUNT_PRIVATE_KEY:?set ACCOUNT_PRIVATE_KEY in .env}"
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

# Preflight. A declare is sent *from* the deployer, so an address with no
# contract behind it cannot send one - and the failure you get for that reads
# like an RPC problem rather than what it is. Cheaper to find out here.
echo "checking the deployer exists on this network..."
preflight=$(curl -s "$STARKNET_RPC_URL" -H 'content-type: application/json' \
  --data "{\"id\":1,\"jsonrpc\":\"2.0\",\"method\":\"starknet_getClassHashAt\",\"params\":{\"block_id\":\"latest\",\"contract_address\":\"$ACCOUNT_ADDRESS\"}}")

case "$preflight" in
  *'"result"'*)
    echo "  deployer is deployed here" ;;
  *'Contract not found'*)
    cat <<PREFLIGHT
  $ACCOUNT_ADDRESS has no contract on this network.

  A wallet address exists before its first transaction deploys it, so this is
  usually a funded-but-never-used account. Send it some STRK, run the "deploy
  account" step in your wallet, then come back.

  If you expected it to be live already, it may be on the other network -
  node contracts/identify-account.mjs checks both and reports balances.
PREFLIGHT
    exit 1 ;;
  *)
    echo "  could not check: $preflight"
    exit 1 ;;
esac

docker build -q -t jalin-cairo:2.20.0 contracts >/dev/null

echo
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
