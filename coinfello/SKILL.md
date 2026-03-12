---
name: coinfello
description: 'Interact with CoinFello using the @coinfello/agent-cli to create a smart account, sign in with SIWE, manage delegations, send prompts with server-driven ERC-20 token subdelegations, and check transaction status. Use when the user wants to send crypto transactions via natural language prompts, manage smart account delegations, or check CoinFello transaction results.'
compatibility: Requires Node.js 20+ (npx is included with Node.js).
metadata:
  clawdbot:
    emoji: '👋'
    homepage: 'https://coinfello.com'
    requires:
      bins: ['node', 'npx']
      env:
        - name: COINFELLO_BASE_URL
          description: 'Base URL for the CoinFello API server'
          required: false
          default: 'https://app.coinfello.com/'
---

# CoinFello CLI Skill

Use the `npx @coinfello/agent-cli@latest` CLI to interact with CoinFello. The CLI handles smart account creation, SIWE authentication, delegation management, prompt-based transactions, and transaction status checks.

## Prerequisites

- Node.js 20 or later (npx is included with Node.js)

The CLI is available via `npx @coinfello/agent-cli@latest`. No manual build step is required.

## Environment Variables

| Variable             | Required | Default                      | Description                    |
| -------------------- | -------- | ---------------------------- | ------------------------------ |
| `COINFELLO_BASE_URL` | No       | `https://app.coinfello.com/` | Base URL for the CoinFello API |

## Security Notice

This skill performs the following sensitive operations:

- **Key generation and storage**: By default, `create_account` generates a hardware-backed P256 key in the **macOS Secure Enclave** (or TPM 2.0 where available). The private key never leaves the hardware and cannot be exported — only public key coordinates and a key tag are saved to `~/.clawdbot/skills/coinfello/config.json`. If hardware key support is not available, the CLI warns and falls back to a software private key. You can also explicitly opt into a plaintext software key by passing `--use-unsafe-private-key`, which stores a raw private key in the config file — **this is intended only for development and testing**.
- **Signer daemon**: Running `signer-daemon start` authenticates once via Touch ID / password and caches the authorization. All subsequent signing operations reuse this cached context, eliminating repeated auth prompts. The daemon communicates over a user-scoped Unix domain socket with restricted permissions (`0600`). If the daemon is not running, signing operations fall back to direct execution (prompting Touch ID each time).
- **Session token storage**: Running `sign_in` stores a SIWE session token in the same config file.
- **Delegation signing**: Running `send_prompt` may automatically create and sign blockchain delegations based on server-requested scopes, then submit them to the CoinFello API.

Users should ensure they trust the CoinFello API endpoint configured via `COINFELLO_BASE_URL` before running delegation flows.

## Quick Start

```bash
# 1. Start the signing daemon (optional, but avoids repeated Touch ID prompts)
npx @coinfello/agent-cli@latest signer-daemon start

# 2. Create a smart account (uses Secure Enclave by default)
npx @coinfello/agent-cli@latest create_account

# 3. Sign in to CoinFello with your smart account (SIWE)
npx @coinfello/agent-cli@latest sign_in

# 4. Send a natural language prompt — the server will request a delegation if needed
npx @coinfello/agent-cli@latest send_prompt "send 5 USDC to 0xRecipient..."
```

## Commands

### create_account

Creates a MetaMask Hybrid smart account. By default, the signing key is generated in the **macOS Secure Enclave** (hardware-backed, non-exportable). If Secure Enclave is unavailable, the CLI warns and falls back to a software key. Pass `--use-unsafe-private-key` to explicitly use a plaintext software key (development/testing only).

```bash
npx @coinfello/agent-cli@latest create_account [--use-unsafe-private-key]
```

- **Default (Secure Enclave)**: Generates a P256 key in hardware; saves `key_tag`, `public_key_x`, `public_key_y`, `key_id`, and `smart_account_address` to `~/.clawdbot/skills/coinfello/config.json`. The private key never leaves the Secure Enclave.
- **`--use-unsafe-private-key`**: Generates a random secp256k1 private key and stores it **in plaintext** in the config file. Use only for development and testing.
- Must be run before `send_prompt`

### get_account

Displays the current smart account address from local config.

```bash
npx @coinfello/agent-cli@latest get_account
```

- Prints the stored `smart_account_address`
- Exits with an error if no account has been created yet

### sign_in

Authenticates with CoinFello using Sign-In with Ethereum (SIWE) and your smart account. Saves the session token to local config.

```bash
npx @coinfello/agent-cli@latest sign_in
```

- Signs in using the private key stored in config
- Saves the session token to `~/.clawdbot/skills/coinfello/config.json`
- The session token is loaded automatically for subsequent `send_prompt` calls
- Must be run after `create_account` and before `send_prompt` for authenticated flows

### set_delegation

Stores a signed parent delegation (JSON) in local config.

```bash
npx @coinfello/agent-cli@latest set_delegation '<delegation-json>'
```

- `<delegation-json>` — A JSON string representing a `Delegation` object from MetaMask Smart Accounts Kit

### new_chat

Clears the saved chat session ID from local config so the next `send_prompt` starts a fresh conversation.

```bash
npx @coinfello/agent-cli@latest new_chat
```

- Removes `chat_id` from `~/.clawdbot/skills/coinfello/config.json`
- Use this when you want to reset conversation context (for example, after context-window errors)

### signer-daemon

Manages the Secure Enclave signing daemon. Starting the daemon authenticates once via Touch ID / password and caches the authorization, so subsequent signing operations (account creation, sign-in, delegation signing) do not prompt again.

```bash
npx @coinfello/agent-cli@latest signer-daemon start    # Start daemon (one-time auth)
npx @coinfello/agent-cli@latest signer-daemon status   # Check if daemon is running
npx @coinfello/agent-cli@latest signer-daemon stop     # Stop the daemon
```

- If the daemon is not running, all Secure Enclave operations fall back to direct execution (prompting Touch ID each time)
- The daemon is optional — all commands work without it

### send_prompt

Sends a natural language prompt to CoinFello. If the server requires a delegation to execute the action, the CLI creates and signs a subdelegation automatically based on the server's requested scope and chain.

```bash
npx @coinfello/agent-cli@latest send_prompt "<prompt>"
```

Note that if you receive
`Failed to send prompt: Conversation request failed (400): {"error":"Your input exceeds the context window of this model. Please adjust your input or start a new chat and try again."}`
then you should call `npx @coinfello/agent-cli@latest new_chat` to start a new chat with a new context window.

**What happens internally:**

1. Fetches available agents from `/api/v1/automation/coinfello-agents` and sends the prompt to CoinFello's conversation endpoint
2. If the server returns a read-only response (no `clientToolCalls` and no `txn_id`) → prints the response text and exits
3. If the server returns a `txn_id` directly with no tool calls → prints it and exits
4. If the server sends an `ask_for_delegation` client tool call with a `chainId` and `scope`:
   - Fetches CoinFello's delegate address
   - Rebuilds the smart account using the chain ID from the tool call
   - Parses the server-provided scope (supports ERC-20, native token, ERC-721, and function call scopes)
   - Creates and signs a subdelegation (wraps with ERC-6492 signature if the smart account is not yet deployed on-chain)
   - Sends the signed delegation back as a `clientToolCallResponse` along with the `chatId` and `callId` from the initial response
   - Returns a `txn_id` for tracking

## Common Workflows

### Basic: Send a Prompt (Server-Driven Delegation)

```bash
# Start the signing daemon (optional, reduces Touch ID prompts)
npx @coinfello/agent-cli@latest signer-daemon start

# Create account if not already done (uses Secure Enclave by default)
npx @coinfello/agent-cli@latest create_account

# Sign in (required for delegation flows)
npx @coinfello/agent-cli@latest sign_in

# Send a natural language prompt — delegation is handled automatically
npx @coinfello/agent-cli@latest send_prompt "send 5 USDC to 0xRecipient..."
```

### Read-Only Prompt

Some prompts don't require a transaction. The CLI detects this automatically and just prints the response.

```bash
npx @coinfello/agent-cli@latest send_prompt "what is the chain ID for Base?"
```

## Gas Cost Estimates

Actual on-chain gas costs vary by network. Do **not** assume mainnet Ethereum gas prices for L2 chains.

| Network | Swap / Transfer Gas Cost |
| ------- | ------------------------ |
| Base    | $0.0003 – $0.0006        |

These are approximate ranges under normal network conditions. L2s like Base are significantly cheaper than Ethereum mainnet.

## Edge Cases

- **No smart account**: Run `create_account` before `send_prompt`. The CLI checks for a saved private key and address in config.
- **Not signed in**: Run `sign_in` before `send_prompt` if the server requires authentication.
- **Invalid chain name**: The CLI throws an error listing valid viem chain names.
- **Read-only response**: If the server returns a text response with no transaction, the CLI prints it and exits without creating a delegation.

## Reference

See [references/REFERENCE.md](references/REFERENCE.md) for the full config schema, supported chains, API details, scope types, and troubleshooting.

---
