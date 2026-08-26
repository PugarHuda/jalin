# Pinned Cairo toolchain. Also the only way to run snforge on Windows, which
# ships no native binary - see docs/building.md.
#
# Rust is here because snforge compiles its Scarb proc-macro plugin from source
# on first run; a plain Debian base fails at that step with a bare ENOENT.
FROM rust:1-slim-bookworm

ARG SCARB_VERSION=2.20.0
ARG FOUNDRY_VERSION=0.63.0
ARG USC_VERSION=2.10.0
ARG COVERAGE_VERSION=0.6.1

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates git \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://github.com/software-mansion/scarb/releases/download/v${SCARB_VERSION}/scarb-v${SCARB_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
      | tar xz -C /opt \
 && ln -s "/opt/scarb-v${SCARB_VERSION}-x86_64-unknown-linux-gnu/bin/scarb" /usr/local/bin/scarb

RUN curl -fsSL "https://github.com/foundry-rs/starknet-foundry/releases/download/v${FOUNDRY_VERSION}/starknet-foundry-v${FOUNDRY_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
      | tar xz -C /opt \
 && ln -s "/opt/starknet-foundry-v${FOUNDRY_VERSION}-x86_64-unknown-linux-gnu/bin/snforge" /usr/local/bin/snforge \
 && ln -s "/opt/starknet-foundry-v${FOUNDRY_VERSION}-x86_64-unknown-linux-gnu/bin/sncast" /usr/local/bin/sncast

# snforge shells out to this to compile Sierra for the test runner.
RUN curl -fsSL "https://github.com/software-mansion/universal-sierra-compiler/releases/download/v${USC_VERSION}/universal-sierra-compiler-v${USC_VERSION}-x86_64-unknown-linux-gnu.tar.gz" \
      | tar xz -C /opt \
 && find /opt -name universal-sierra-compiler -type f -exec ln -s {} /usr/local/bin/universal-sierra-compiler \;

# snforge --coverage shells out to this. Coverage over Sierra needs the debug
# info that the cairo profile flags in Scarb.toml turn on.
RUN curl -fsSL "https://github.com/software-mansion/cairo-coverage/releases/download/v${COVERAGE_VERSION}/cairo-coverage-v${COVERAGE_VERSION}-x86_64-unknown-linux-gnu.tar.gz"       | tar xz -C /opt  && find /opt -name cairo-coverage -type f -exec ln -s {} /usr/local/bin/cairo-coverage \;

WORKDIR /work
CMD ["snforge", "test"]
