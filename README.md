# CoinFello Agent CLI

## Setup

```bash
pnpm install
pnpm build
```

## Manual Testing

You can run the CLI via `node dist/index.js` after building.

### 1. create_account

Creates a MetaMask Hybrid smart account on the specified chain. By default, the signing key is generated in the **macOS Secure Enclave** (hardware-backed, non-exportable). If Secure Enclave is unavailable, the CLI warns and falls back to a software key.

Pass `--use-unsafe-private-key` to explicitly use a plaintext software key (development/testing only).

```bash
# Default: Secure Enclave
node dist/index.js create_account sepolia

# Development/testing: plaintext private key
node dist/index.js create_account sepolia --use-unsafe-private-key
```

Expected output (Secure Enclave):

```
Creating Secure Enclave-backed smart account on sepolia...
Secure Enclave smart account created successfully.
Address: 0x...
Key tag: ...
Config saved to: /home/<user>/.clawdbot/skills/coinfello/config.json
```

Expected output (unsafe private key):

```
Creating smart account on sepolia...
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

### 5. send_prompt

Sends a natural language prompt to CoinFello. If the server requires a delegation to execute the action, the CLI creates and signs a subdelegation automatically based on the server's requested scope and chain. Requires `create_account` and `sign_in` to have been run first.

```bash
node dist/index.js send_prompt "send 5 USDC to 0xRecipient..."
```

Expected output:

```
Sending prompt...
Delegation requested: scope=erc20, chainId=8453
Fetching CoinFello delegate address...
Loading smart account...
Creating subdelegation...
Signing subdelegation...
Sending signed delegation...
Transaction submitted successfully.
Transaction ID: <txn_id>
```

### 6. get_transaction_status

Checks the status of a previously submitted transaction.

```bash
node dist/index.js get_transaction_status <txn_id>
```

Expected output is a JSON object with the transaction status.

### Help

View all commands and options:

```bash
node dist/index.js --help
node dist/index.js create_account --help
node dist/index.js send_prompt --help
```
