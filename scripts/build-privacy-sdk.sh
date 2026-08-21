#!/usr/bin/env sh
# Build @starkware-libs/starknet-privacy-sdk from source into vendor/.
#
#   sh scripts/build-privacy-sdk.sh
#
# The package is not on npm - the registry returns 404 - and the GitHub Packages
# mirror needs a token with read:packages, which is an interactive OAuth grant.
# The monorepo itself is public and the generated ABI files are committed, so the
# build is just `tsc` and needs neither.
#
# Pinned to a commit on purpose: an rc dependency that moves under you is a
# debugging session nobody wants during a sprint.
set -eu

REPO=https://github.com/starkware-libs/starknet-privacy.git
COMMIT=36eac4ea88cd8c59dde1493176e16501c6e90328   # sdk 0.14.3-rc.5, 2026-08-20
DEST=vendor/starknet-privacy

cd "$(dirname "$0")/.."

if [ -d "$DEST/.git" ]; then
  echo "vendor/ exists; fetching the pinned commit"
  git -C "$DEST" fetch --quiet --depth 1 origin "$COMMIT"
else
  echo "cloning $REPO"
  mkdir -p vendor
  git init --quiet "$DEST"
  git -C "$DEST" remote add origin "$REPO"
  git -C "$DEST" fetch --quiet --depth 1 origin "$COMMIT"
fi

git -C "$DEST" checkout --quiet FETCH_HEAD
echo "at $(git -C "$DEST" rev-parse --short HEAD)"

cd "$DEST/sdk"
npm install --no-audit --no-fund --silent
npm run build --silent

echo
echo "built $(node -p "require('./package.json').version")"
echo "install it into the workspace with:"
echo "  npm install ./$DEST/sdk --workspace @jalin/sdk"
