#!/usr/bin/env sh
# Line coverage for the Cairo contracts, as coverage/coverage.lcov.
#
# snforge produces trace data and hands it to cairo-coverage, which needs the
# debug info the [profile.dev.cairo] flags in Scarb.toml turn on. Same pinned
# image as test.sh, for the same reason.
set -eu
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."
docker build -q -t jalin-cairo:2.20.0 contracts >/dev/null
exec docker run --rm \
  -v "$(pwd):/work" \
  -v jalin-scarb-cache:/root/.cache/scarb \
  -w /work/contracts \
  jalin-cairo:2.20.0 snforge test --coverage "$@"
