# CoinFello CLI Reference

## Config File

Location: `~/.clawdbot/skills/coinfello/config.json`

Created automatically by `create_account`. The schema depends on the signer type.

**Default (Secure Enclave):**

```json
{
  "signer_type": "secureEnclave",
  "smart_account_address": "0x1234...abcd",
  "chat_id": "chat_abc123...",
  "secure_enclave": {
    "key_tag": "...",
    "public_key_x": "0x...",
    "public_key_y": "0x...",
    "key_id": "0x..."
  },
  "session_token": "...",
  "delegation": { ... }
}
```

**With `--use-unsafe-private-key` (development/testing only):**

```json
{
  "signer_type": "privateKey",
  "private_key": "0xabc123...def",
  "smart_account_address": "0x1234...abcd",
  "chat_id": "chat_abc123...",
  "session_token": "...",
  "delegation": { ... }
}
```

| Field                         | Type     | Set by           | Description                                                                                         |
| ----------------------------- | -------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| `signer_type`                 | `string` | `create_account` | `"secureEnclave"` (default) or `"privateKey"` (with `--use-unsafe-private-key`)                     |
| `smart_account_address`       | `string` | `create_account` | Counterfactual address of the smart account                                                         |
| `secure_enclave.key_tag`      | `string` | `create_account` | Secure Enclave key tag (only with `secureEnclave` signer)                                           |
| `secure_enclave.public_key_x` | `string` | `create_account` | P256 public key X coordinate (only with `secureEnclave` signer)                                     |
| `secure_enclave.public_key_y` | `string` | `create_account` | P256 public key Y coordinate (only with `secureEnclave` signer)                                     |
| `secure_enclave.key_id`       | `string` | `create_account` | On-chain key identifier (only with `secureEnclave` signer)                                          |
| `private_key`                 | `string` | `create_account` | Plaintext hex private key (**only** with `--use-unsafe-private-key`, absent in Secure Enclave mode) |
| `session_token`               | `string` | `sign_in`        | SIWE session token for authenticated API calls                                                      |
| `delegation`                  | `object` | `set_delegation` | Optional stored delegation                                                                          |
| `chat_id`                     | `string` | `send_prompt`    | Persisted conversation chat ID reused across prompts; removed by `new_chat`                         |

## Pending Delegation File

Location: `~/.clawdbot/skills/coinfello/pending_delegation.json`

Created by `send_prompt` when the server requests a delegation. Read and cleared by `approve_delegation_request`.

```json
{
  "delegationArgs": {
    "chainId": 8453,
    "scope": {
      "type": "erc20TransferAmount",
      "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "maxAmount": "5000000"
    },
    "justification": "Transfer 5 USDC to 0xRecipient on Base"
  },
  "callId": "call_abc123",
  "chatId": "chat_xyz789",
  "originalPrompt": "send 5 USDC to 0xRecipient...",
  "createdAt": "2026-03-16T12:34:56.789Z",
  "description": "Delegation for scope=erc20TransferAmount, chainId=8453"
}
```

| Field            | Type     | Description                                                               |
| ---------------- | -------- | ------------------------------------------------------------------------- |
| `delegationArgs` | `object` | Tool call arguments from the server (chainId, scope, justification, etc.) |
| `callId`         | `string` | Tool call ID from the `ask_for_delegation` response                       |
| `chatId`         | `string` | Chat session ID for conversation continuity                               |
| `originalPrompt` | `string` | The prompt that triggered the delegation request                          |
| `createdAt`      | `string` | ISO-8601 timestamp of when the request was received                       |
| `description`    | `string` | Human-readable summary of the delegation request                          |

## Command Reference

### npx @coinfello/agent-cli@latest create_account

```
npx @coinfello/agent-cli@latest create_account [--use-unsafe-private-key] [--delete-existing-private-key]
```

| Parameter                       | Type | Required | Description                                                                |
| ------------------------------- | ---- | -------- | -------------------------------------------------------------------------- |
| `--use-unsafe-private-key`      | flag | No       | Use a plaintext software key instead of hardware-backed Secure Enclave key |
| `--delete-existing-private-key` | flag | No       | Overwrite an existing account                                              |

By default, generates a hardware-backed P256 key in the macOS Secure Enclave (the private key never leaves the hardware). If Secure Enclave is unavailable, the CLI warns and falls back to a software key. Pass `--use-unsafe-private-key` to explicitly use a plaintext private key (development/testing only). The chain is no longer specified at account creation time — it is determined dynamically by the server when a delegation is requested via `send_prompt`.

### npx @coinfello/agent-cli@latest get_account

```
npx @coinfello/agent-cli@latest get_account
```

No parameters. Prints the stored smart account address from config. Exits with an error if no account has been created.

### npx @coinfello/agent-cli@latest sign_in

```
npx @coinfello/agent-cli@latest sign_in [--base-url <url>]
```

| Parameter    | Type     | Required | Default                         | Description                                                                         |
| ------------ | -------- | -------- | ------------------------------- | ----------------------------------------------------------------------------------- |
| `--base-url` | `string` | No       | `${COINFELLO_BASE_URL}api/auth` | Auth server base URL. `COINFELLO_BASE_URL` defaults to `https://app.coinfello.com/` |

The default resolves using the `COINFELLO_BASE_URL` environment variable (defaults to `https://app.coinfello.com/`).

Performs a Sign-In with Ethereum (SIWE) flow using the signing key from config (Secure Enclave or private key, depending on `signer_type`). Saves the `session_token` to config on success. The session token is automatically injected as a cookie for subsequent API calls.

### npx @coinfello/agent-cli@latest set_delegation

```
npx @coinfello/agent-cli@latest set_delegation <delegation>
```

| Parameter    | Type     | Required | Description                                                     |
| ------------ | -------- | -------- | --------------------------------------------------------------- |
| `delegation` | `string` | Yes      | JSON-encoded Delegation object from MetaMask Smart Accounts Kit |

### npx @coinfello/agent-cli@latest new_chat

```
npx @coinfello/agent-cli@latest new_chat
```

No parameters. Clears the stored `chat_id` from config so the next `send_prompt` call starts a new chat session.

### npx @coinfello/agent-cli@latest signer-daemon

```
npx @coinfello/agent-cli@latest signer-daemon <start|stop|status>
```

| Subcommand | Description                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------- |
| `start`    | Start the signing daemon. Authenticates via Touch ID / password once and caches authorization. |
| `stop`     | Stop the signing daemon. Cleans up the socket and PID files.                                   |
| `status`   | Check if the signing daemon is running (pings the daemon via its Unix socket).                 |

The daemon listens on a user-scoped Unix domain socket at `/tmp/coinfello-se-signer-{username}.sock` and stores its PID at `/tmp/coinfello-se-signer-{username}.pid`. Socket permissions are set to `0600`.

When the daemon is running, all Secure Enclave operations (`generateKey`, `signPayload`, `getPublicKey`) are routed through the socket, reusing the cached `LAContext` and avoiding repeated Touch ID prompts. When the daemon is not running, operations fall back to direct binary execution (which triggers a new authentication each time).

### npx @coinfello/agent-cli@latest send_prompt

```
npx @coinfello/agent-cli@latest send_prompt <prompt>
```

| Parameter | Type     | Required | Default | Description                                  |
| --------- | -------- | -------- | ------- | -------------------------------------------- |
| `prompt`  | `string` | Yes      | —       | Natural language prompt to send to CoinFello |

The server determines whether a delegation is needed and, if so, what scope and chain to use. If the server responds with an `ask_for_delegation` tool call, the delegation request is saved to `~/.clawdbot/skills/coinfello/pending_delegation.json` and logged to the terminal. The delegation is **not** signed automatically — run `approve_delegation_request` to approve it.

`send_prompt` reuses `chat_id` from config when available and persists server-returned `chatId` values for continued context across calls.

### npx @coinfello/agent-cli@latest approve_delegation_request

```
npx @coinfello/agent-cli@latest approve_delegation_request
```

No parameters. Reads the pending delegation request from `~/.clawdbot/skills/coinfello/pending_delegation.json`, creates and signs a subdelegation, and submits it to CoinFello. Clears the pending delegation file on success.

Each subdelegation is created with a unique random salt to ensure delegation uniqueness.

**ERC-6492 signature wrapping**: If the smart account has not yet been deployed on-chain, the CLI wraps the delegation signature using ERC-6492 (`serializeErc6492Signature`) with the account's factory address and factory data. This allows the delegation to be verified even before the account contract exists.

## Supported Chains

Any chain exported by `viem/chains` is supported. Chains with a QuickNode slug configured get routed through the paid QuickNode RPC when `RPC_BASE_URL` and `RPC_API_KEY` are set; all others fall back to the chain's default public RPC.

| Chain Name    | Chain ID | Network                  | QuickNode Support |
| ------------- | -------- | ------------------------ | ----------------- |
| `mainnet`     | 1        | Ethereum mainnet         | Yes               |
| `sepolia`     | 11155111 | Ethereum Sepolia testnet | Yes               |
| `polygon`     | 137      | Polygon PoS              | Yes               |
| `arbitrum`    | 42161    | Arbitrum One             | Yes               |
| `optimism`    | 10       | OP Mainnet               | Yes               |
| `base`        | 8453     | Base                     | Yes               |
| `baseSepolia` | 84532    | Base Sepolia testnet     | Yes               |
| `linea`       | 59144    | Linea mainnet            | Yes               |
| `bsc`         | 56       | BNB Smart Chain          | Yes               |
| `avalanche`   | 43114    | Avalanche C-Chain        | No (public RPC)   |

## API Endpoints

Base URL: Configured via the `COINFELLO_BASE_URL` environment variable (defaults to `https://app.coinfello.com/`).

| Endpoint                                 | Method | Description                                          |
| ---------------------------------------- | ------ | ---------------------------------------------------- |
| `/api/v1/automation/coinfello-address`   | GET    | Returns CoinFello's delegate address                 |
| `/api/v1/automation/coinfello-agents`    | GET    | Returns available CoinFello agents (id, name)        |
| `/api/conversation`                      | POST   | Submits prompt (and optionally client tool response) |
| `/api/v1/transaction_status?txn_id=<id>` | GET    | Returns transaction status                           |

### GET /api/v1/automation/coinfello-agents response

```json
{
  "availableAgents": [{ "id": 1, "name": "CoinFello Agent" }]
}
```

The `send_prompt` command fetches this list and uses the first agent's `id` as `agentId` in conversation requests.

### POST /api/conversation body

Initial request (prompt only, sent by `send_prompt`):

```json
{
  "inputMessage": "send 5 USDC to 0xRecipient...",
  "agentId": 1,
  "stream": false
}
```

`agentId` is dynamically resolved from the `/api/v1/automation/coinfello-agents` endpoint (not hardcoded).

The follow-up request (sending the signed delegation back) is handled internally by `approve_delegation_request` — no manual construction is needed.

### POST /api/conversation response

Read-only response:

```json
{
  "responseText": "The chain ID for Base is 8453."
}
```

Delegation request (server asks client to sign):

```json
{
  "clientToolCalls": [
    {
      "type": "function_call",
      "name": "ask_for_delegation",
      "callId": "call_abc123...",
      "arguments": "{\"chainId\": 8453, \"scope\": {\"type\": \"erc20TransferAmount\", \"tokenAddress\": \"0x...\", \"maxAmount\": \"5000000\"}}"
    }
  ],
  "chatId": "chat_abc123..."
}
```

Final response (after delegation submitted):

```json
{
  "txn_id": "abc123..."
}
```

| Field             | Type      | Description                                                    |
| ----------------- | --------- | -------------------------------------------------------------- |
| `responseText`    | `string?` | Text response for read-only prompts                            |
| `txn_id`          | `string?` | Transaction ID when a transaction has been submitted           |
| `clientToolCalls` | `array?`  | Server-requested client tool calls (e.g. `ask_for_delegation`) |
| `chatId`          | `string?` | Chat session ID, sent back in follow-up requests               |

## Delegation Scope Types

The server may request any of the following scope types via `ask_for_delegation`. The CLI parses and creates the appropriate delegation caveat automatically.

| Scope Type                  | Fields                                                                       |
| --------------------------- | ---------------------------------------------------------------------------- |
| `erc20TransferAmount`       | `tokenAddress`, `maxAmount`                                                  |
| `erc20PeriodTransfer`       | `tokenAddress`, `periodAmount`, `periodDuration`, `startDate`                |
| `erc20Streaming`            | `tokenAddress`, `initialAmount`, `maxAmount`, `amountPerSecond`, `startTime` |
| `nativeTokenTransferAmount` | `maxAmount`                                                                  |
| `nativeTokenPeriodTransfer` | `periodAmount`, `periodDuration`, `startDate`                                |
| `nativeTokenStreaming`      | `initialAmount`, `maxAmount`, `amountPerSecond`, `startTime`                 |
| `erc721Transfer`            | `tokenAddress`, `tokenId`                                                    |
| `functionCall`              | `targets`, `selectors`                                                       |

All `amount` fields are in the token's smallest unit (e.g. `5000000` for 5 USDC with 6 decimals).

## Common Token Decimals

| Token | Decimals | Note                          |
| ----- | -------- | ----------------------------- |
| USDC  | 6        | amounts use 6 decimal places  |
| USDT  | 6        | amounts use 6 decimal places  |
| DAI   | 18       | amounts use 18 decimal places |
| WETH  | 18       | amounts use 18 decimal places |

## Environment Variables

| Variable             | Required | Default                      | Description                                                                        |
| -------------------- | -------- | ---------------------------- | ---------------------------------------------------------------------------------- |
| `COINFELLO_BASE_URL` | No       | `https://app.coinfello.com/` | Base URL for the CoinFello API                                                     |
| `RPC_BASE_URL`       | No       | —                            | QuickNode RPC base URL (e.g. `https://your-endpoint-name`)                         |
| `RPC_API_KEY`        | No       | —                            | QuickNode API key                                                                  |
| `RPC_URL_OVERRIDE`   | No       | —                            | Custom RPC URL override for development/testing (overrides all other RPC settings) |

**RPC resolution order:**

1. If `RPC_URL_OVERRIDE` is set, all RPC calls go through the specified URL (any chain).
2. If `RPC_BASE_URL` and `RPC_API_KEY` are both set and the chain has a QuickNode slug, requests use `{RPC_BASE_URL}{slug}.quiknode.pro/{RPC_API_KEY}`.
3. Otherwise, the chain's default public RPC is used.

## Security Considerations

- **Key generation and storage**: By default, `create_account` generates a hardware-backed P256 key in the **macOS Secure Enclave**. The private key never leaves the hardware and cannot be exported — only public key coordinates and a key tag are saved to `~/.clawdbot/skills/coinfello/config.json`. A plaintext private key is **only** stored when `--use-unsafe-private-key` is explicitly passed (intended for development/testing). Restrict file permissions (e.g. `chmod 600`) and do not share or commit this file.
- **Signer daemon**: The daemon caches a single authenticated `LAContext` on startup, so all signing operations within the session reuse the same authorization. The Unix domain socket is created with `0600` permissions and scoped to the current OS user. The daemon cleans up socket and PID files on `SIGTERM`/`SIGINT`.
- **Session token storage**: `sign_in` stores a SIWE session token in the same config file.
- **Delegation signing**: `send_prompt` saves delegation requests from the server to a local file. `approve_delegation_request` creates and signs the delegation, then submits it to the CoinFello API endpoint. Ensure the `COINFELLO_BASE_URL` points to a trusted endpoint before approving delegation requests.

## Error Messages

| Error                                                         | Cause                                 | Fix                                                  |
| ------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------- |
| `No private key found in config. Run 'create_account' first.` | Missing signing key in config         | Run `npx @coinfello/agent-cli@latest create_account` |
| `Secure Enclave config missing. Run 'create_account' first.`  | Missing Secure Enclave key data       | Run `npx @coinfello/agent-cli@latest create_account` |
| `No smart account found. Run 'create_account' first.`         | Missing smart account in config       | Run `npx @coinfello/agent-cli@latest create_account` |
| `No delegation request received from the server.`             | Server returned unexpected response   | Check the full response JSON printed                 |
| `No pending delegation request found.`                        | No delegation saved by `send_prompt`  | Run `send_prompt` first to generate a request        |
| `Signing daemon is already running.`                          | Daemon already started                | Use `signer-daemon status` to confirm                |
| `Signing daemon is not running.`                              | Daemon not started or already stopped | Run `signer-daemon start`                            |
