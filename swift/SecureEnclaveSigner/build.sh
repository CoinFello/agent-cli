#!/bin/bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Skipping Swift build (not macOS)"
  exit 0
fi

cd "$(dirname "$0")"
swift build -c release
mkdir -p ../../dist
cp .build/release/SecureEnclaveSigner ../../dist/secure-enclave-signer
echo "Built secure-enclave-signer -> dist/secure-enclave-signer"
