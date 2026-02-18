#!/usr/bin/env bash
# setup-and-send.sh — End-to-end CoinFello workflow
#
# Usage:
#   ./setup-and-send.sh <chain> <token-address> <amount> <prompt> [decimals]
#
# Example:
#   ./setup-and-send.sh sepolia \
#     0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
#     5 \
#     "send 3 USDC to 0xRecipient" \
#     6

set -euo pipefail

CHAIN="${1:?Usage: $0 <chain> <token-address> <amount> <prompt> [decimals]}"
TOKEN_ADDRESS="${2:?Missing token-address}"
AMOUNT="${3:?Missing amount}"
PROMPT="${4:?Missing prompt}"
DECIMALS="${5:-18}"

echo "==> Creating smart account on ${CHAIN}..."
openclaw create_account "$CHAIN"

echo ""
echo "==> Sending prompt..."
OUTPUT=$(openclaw send_prompt "$PROMPT" \
  --token-address "$TOKEN_ADDRESS" \
  --amount "$AMOUNT" \
  --decimals "$DECIMALS")

echo "$OUTPUT"

# Extract txn_id from output
TXN_ID=$(echo "$OUTPUT" | grep -oP 'Transaction ID: \K.*')

if [ -n "$TXN_ID" ]; then
  echo ""
  echo "==> Checking transaction status..."
  openclaw get_transaction_status "$TXN_ID"
fi
