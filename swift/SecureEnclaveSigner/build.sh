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

# Sign the binary. Persistent Secure Enclave key storage requires a Developer ID
# certificate with the keychain-access-groups entitlement.
#
# Production (set SIGN_IDENTITY to your "Developer ID Application: ..." cert):
#   SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" npm run build:swift
#
# Development (default): ad-hoc sign — SE key generation will fail at runtime
#   with errSecMissingEntitlement (-34018); the integration test skips gracefully.
SIGN_IDENTITY="${SIGN_IDENTITY:--}"
if [ "$SIGN_IDENTITY" = "-" ]; then
  codesign --force --sign - ../../dist/secure-enclave-signer
else
  codesign --force --sign "$SIGN_IDENTITY" \
    --entitlements entitlements.plist \
    ../../dist/secure-enclave-signer
fi

echo "Built secure-enclave-signer -> dist/secure-enclave-signer (signed: ${SIGN_IDENTITY})"
