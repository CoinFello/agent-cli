---
name: coinfello
description: 'Interact with CoinFello using the openclaw CLI to create MetaMask smart accounts, manage delegations, send prompts with ERC-20 token subdelegations, and check transaction status. Use when the user wants to send crypto transactions via natural language prompts, manage smart account delegations, or check CoinFello transaction results.'
compatibility: Requires Node.js 20+ and pnpm.
metadata:
  {
    'clawdbot':
      { 'emoji': '👋', 'homepage': 'https://coinfello.com', 'requires': { 'bins': ['node'] } },
  }
---

# CoinFello CLI Skill

Use the `openclaw` CLI to interact with CoinFello through MetaMask Smart Accounts. The CLI handles smart account creation, delegation management, prompt-based ERC-20 token transactions, and transaction status checks.

## Prerequisites

- Node.js 20 or later
- pnpm package manager
- Build the CLI before first use: `pnpm build`

The CLI binary is available at `./dist/index.js` after building, or as `openclaw` if installed globally.

## Quick Start

```bash
# 1. Create a smart account on a chain (generates a new private key automatically)
openclaw create_account sepolia

# 2. Send a prompt with token subdelegation
openclaw send_prompt "swap 5 USDC for ETH" \
  --token-address 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --amount 5 \
  --decimals 6

# 3. Check transaction status
openclaw get_transaction_status <txn_id>
```

## Commands

### create_account

Creates a MetaMask Hybrid smart account with an auto-generated private key and saves it to local config.

```bash
openclaw create_account <chain>
```

- `<chain>` — A viem chain name: `sepolia`, `mainnet`, `polygon`, `arbitrum`, `optimism`, `base`, etc.
- Generates a new private key automatically
- Saves `private_key`, `smart_account_address`, and `chain` to `~/.clawdbot/skills/coinfello/config.json`
- Must be run before `send_prompt`

### get_account

Displays the current smart account address from local config.

```bash
openclaw get_account
```

- Prints the stored `smart_account_address`
- Exits with an error if no account has been created yet

### set_delegation

Stores a signed parent delegation (JSON) in local config for use with redelegation flows.

```bash
openclaw set_delegation '<delegation-json>'
```

- `<delegation-json>` — A JSON string representing a `Delegation` object from MetaMask Smart Accounts Kit
- Only needed if you plan to use `--use-redelegation` with `send_prompt`

### send_prompt

Sends a natural language prompt to CoinFello with a locally-created and signed ERC-20 token subdelegation.

```bash
openclaw send_prompt "<prompt>" \
  --token-address <erc20-address> \
  --amount <amount> \
  [--decimals <n>] \
  [--use-redelegation]
```

**Required options:**

- `--token-address <address>` — ERC-20 token contract address for the subdelegation scope
- `--amount <amount>` — Maximum token amount in human-readable form (e.g. `5`, `100.5`)

**Optional:**

- `--decimals <n>` — Token decimals for parsing `--amount` (default: `18`)
- `--use-redelegation` — Create a redelegation from a stored parent delegation (requires `set_delegation` first)

**What happens internally:**

1. Fetches CoinFello's delegate address from the API
2. Rebuilds the smart account from the stored private key and chain in config
3. Creates a subdelegation scoped to `erc20TransferAmount` with the specified token and max amount
4. Signs the subdelegation with the smart account
5. Sends the prompt + signed subdelegation to CoinFello's conversation endpoint
6. Returns a `txn_id` for tracking

### get_transaction_status

Checks the status of a previously submitted transaction.

```bash
openclaw get_transaction_status <txn_id>
```

- Returns a JSON object with the current transaction status

## Common Workflows

### Basic: Send a Token Transfer Prompt

```bash
# Create account if not already done
openclaw create_account sepolia

# Send prompt to transfer up to 10 USDC
openclaw send_prompt "send 5 USDC to 0xRecipient..." \
  --token-address 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --amount 10 \
  --decimals 6

# Check the result
openclaw get_transaction_status <txn_id-from-above>
```

### With Redelegation

Use this when you have a parent delegation from another delegator and want to create a subdelegation chain.

```bash
# Store the parent delegation
openclaw set_delegation '{"delegate":"0x...","delegator":"0x...","authority":"0x...","caveats":[],"salt":"0x...","signature":"0x..."}'

# Send with redelegation
openclaw send_prompt "swap tokens" \
  --token-address 0xTokenAddress \
  --amount 100 \
  --use-redelegation
```

## Edge Cases

- **No smart account**: Run `create_account` before `send_prompt`. The CLI checks for a saved private key and address in config.
- **Invalid chain name**: The CLI throws an error listing valid viem chain names.
- **Missing parent delegation with --use-redelegation**: The CLI exits with an error. Run `set_delegation` first.

## Reference

See [references/REFERENCE.md](references/REFERENCE.md) for the full config schema, supported chains, API details, and troubleshooting.

See [scripts/setup-and-send.sh](scripts/setup-and-send.sh) for an end-to-end automation script.
