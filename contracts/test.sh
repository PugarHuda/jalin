#!/usr/bin/env sh
# Runs the Cairo test suite in the pinned toolchain image.
# The named volume keeps the compiled snforge plugin between runs; without it
# every run rebuilds it from source, which takes minutes.
set -eu

# Git Bash rewrites unix-looking paths in a command line, which turns
# `-w /work/contracts` into C:/Program Files/Git/work/contracts at the daemon.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."
docker build -q -t jalin-cairo:2.20.0 contracts >/dev/null
exec docker run --rm \
  -v "$(pwd):/work" \
  -v jalin-scarb-cache:/root/.cache/scarb \
  -w /work/contracts \
  jalin-cairo:2.20.0 snforge test "$@"
