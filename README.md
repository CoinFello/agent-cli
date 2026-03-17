# CoinFello Agent CLI

## Setup

```bash
pnpm install
pnpm build
```

## RPC Configuration

The CLI uses [QuickNode](https://www.quicknode.com/) as its RPC provider. Configure it via environment variables:

| Variable | Required | Description |
|---|---|---|
| `RPC_BASE_URL` | Yes (for paid RPC) | QuickNode base URL (e.g. `https://your-endpoint-name`) |
| `RPC_API_KEY` | Yes (for paid RPC) | QuickNode API key |
| `RPC_URL_OVERRIDE` | No | Custom RPC URL override for development/testing (overrides all other RPC settings) |

If `RPC_BASE_URL` and `RPC_API_KEY` are both set, the CLI routes requests through QuickNode for supported chains. If either is missing, it falls back to the chain's default public RPC.

**Supported chains:** Ethereum (1), Polygon (137), BSC (56), Linea (59144), Base (8453), Base Sepolia (84532), Optimism (10), Arbitrum (42161), Ethereum Sepolia (11155111). Unsupported chains fall back to the default public RPC.

**Local development:** Set `RPC_URL_OVERRIDE` (e.g. `http://127.0.0.1:8545`) to route all RPC calls through a custom URL, regardless of chain.

## Manual Testing

You can run the CLI via `node dist/index.js` after building.

### 1. create_account

Creates a MetaMask Hybrid smart account. By default, the signing key is generated in the **macOS Secure Enclave** (hardware-backed, non-exportable). If Secure Enclave is unavailable, the CLI warns and falls back to a software key. The chain is determined dynamically by the server when a delegation is requested via `send_prompt`.

Pass `--use-unsafe-private-key` to explicitly use a plaintext software key (development/testing only).

```bash
# Default: Secure Enclave
node dist/index.js create_account

# Development/testing: plaintext private key
node dist/index.js create_account --use-unsafe-private-key
```

Expected output (Secure Enclave):

```
Creating Secure Enclave-backed smart account...
Secure Enclave smart account created successfully.
Address: 0x...
Key tag: ...
Config saved to: /home/<user>/.clawdbot/skills/coinfello/config.json
```

Expected output (unsafe private key):

```
Creating smart account...
Smart account created successfully.
Address: 0x...
Config saved to: /home/<user>/.clawdbot/skills/coinfello/config.json
```

To overwrite an existing account, pass `--delete-existing-private-key`.

### 2. get_account

Displays the current smart account address from local config.

```bash
node dist/index.js get_account
```

### 3. sign_in

Authenticates with CoinFello using Sign-In with Ethereum (SIWE). Saves the session token to local config.

```bash
node dist/index.js sign_in
```

Expected output:

```
Signing in with smart account...
Sign-in successful.
User ID: ...
Session token saved to config.
```

### 4. set_delegation

Stores a parent delegation JSON object in config.

```bash
node dist/index.js set_delegation '{"delegate":"0x...","delegator":"0x...","authority":"0x0","caveats":[],"salt":"0x0","signature":"0x..."}'
```

### 5. new_chat

Clears the saved conversation chat ID from local config, forcing the next `send_prompt` call to start a fresh chat.

```bash
node dist/index.js new_chat
```

### 6. send_prompt

Sends a natural language prompt to CoinFello. If the server requires a delegation to execute the action, the CLI saves the delegation request to a local file and logs the details to the terminal. The delegation is **not** signed or submitted automatically — you must explicitly approve it with `approve_delegation_request`. Requires `create_account` and `sign_in` to have been run first.

```bash
node dist/index.js send_prompt "send 5 USDC to 0xRecipient..."
```

Expected output (when delegation is requested):

```
Sending prompt...
=== Delegation Request ===
Scope type: erc20TransferAmount
Chain ID: 8453
Token address: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
Max amount: 5000000
Original prompt: "send 5 USDC to 0xRecipient..."
Requested at: 2026-03-16T12:34:56.789Z
Chat ID: chat_abc123
Call ID: call_abc123
==========================
Delegation request saved to: /home/<user>/.clawdbot/skills/coinfello/pending_delegation.json
Run 'approve_delegation_request' to sign and submit this delegation.
```

### 7. approve_delegation_request

Approves and signs a pending delegation request saved by `send_prompt`, then submits it to CoinFello.

```bash
node dist/index.js approve_delegation_request
```

Expected output:

```
Approving delegation request...
=== Delegation Request ===
...
==========================
Fetching CoinFello delegate address...
Loading smart account...
Creating subdelegation...
Signing subdelegation...
Sending signed delegation...
Transaction submitted successfully.
Transaction ID: <txn_hash>
```

### 8. signer-daemon

Manages the Secure Enclave signing daemon. Without the daemon, each signing operation (account creation, sign-in, delegation signing) triggers a separate Touch ID / password prompt. Starting the daemon authenticates once and caches the authorization for subsequent operations.

```bash
# Start the daemon (prompts Touch ID / password once)
node dist/index.js signer-daemon start

# Check if the daemon is running
node dist/index.js signer-daemon status

# Stop the daemon
node dist/index.js signer-daemon stop
```

If the daemon is not running, all signing operations fall back to direct Secure Enclave binary execution (which prompts Touch ID each time).

### Help

View all commands and options:

```bash
node dist/index.js --help
node dist/index.js create_account --help
node dist/index.js send_prompt --help
node dist/index.js signer-daemon --help
```
