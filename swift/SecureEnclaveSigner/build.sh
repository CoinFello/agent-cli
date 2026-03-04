#!/bin/bash
set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "Skipping Swift build (not macOS)"
  exit 0
fi

cd "$(dirname "$0")"
swift build -c release

SIGN_IDENTITY="${SIGN_IDENTITY:--}"
PROVISIONING_PROFILE="${PROVISIONING_PROFILE:-}"
APP_BUNDLE="../../dist/secure-enclave-signer.app"
BINARY_OUT="../../dist/secure-enclave-signer"

if [ "$SIGN_IDENTITY" = "-" ]; then
  # Ad-hoc sign — SE key generation will fail at runtime
  # with errSecMissingEntitlement (-34018); integration tests skip gracefully.
  mkdir -p ../../dist
  cp .build/release/SecureEnclaveSigner "$BINARY_OUT"
  codesign --force --sign - "$BINARY_OUT"
else
  # Create a minimal .app bundle so macOS AMFI can find the embedded
  # provisioning profile for restricted entitlements (keychain-access-groups).
  MACOS_DIR="$APP_BUNDLE/Contents/MacOS"
  mkdir -p "$MACOS_DIR"
  cp .build/release/SecureEnclaveSigner "$MACOS_DIR/secure-enclave-signer"

  # Write a minimal Info.plist
  cat > "$APP_BUNDLE/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>com.coinfello.agent-cli</string>
    <key>CFBundleExecutable</key>
    <string>secure-enclave-signer</string>
    <key>CFBundleName</key>
    <string>secure-enclave-signer</string>
    <key>CFBundleVersion</key>
    <string>1</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>13.0</string>
</dict>
</plist>
PLIST

  # Embed provisioning profile
  if [ -n "$PROVISIONING_PROFILE" ]; then
    cp "$PROVISIONING_PROFILE" "$APP_BUNDLE/Contents/embedded.provisionprofile"
  fi

  codesign --force --sign "$SIGN_IDENTITY" \
    --entitlements entitlements.plist \
    --options runtime \
    "$APP_BUNDLE"

  # Symlink the binary at the expected flat path for the TS bridge
  rm -f "$BINARY_OUT"
  ln -s "secure-enclave-signer.app/Contents/MacOS/secure-enclave-signer" "$BINARY_OUT"
fi

echo "Built secure-enclave-signer -> dist/secure-enclave-signer (signed: ${SIGN_IDENTITY})"
