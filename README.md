# CoinFello Agent CLI

## Setup

```bash
pnpm install
pnpm build
```

## Manual Testing

You can run the CLI via `node dist/index.js` after building.

### 1. create_account

Generates a new private key, creates a MetaMask smart account on the specified chain, and saves both the key and address to `~/.clawdbot/skills/coinfello/config.json`.

```bash
node dist/index.js create_account sepolia
```

Expected output:

```
Creating smart account on sepolia...
Smart account created successfully.
Address: 0x...
Config saved to: /home/<user>/.clawdbot/skills/coinfello/config.json
```

Verify the config was written:

```bash
cat ~/.clawdbot/skills/coinfello/config.json
```

### 2. set_delegation

Stores a parent delegation JSON object in config. Only needed if you plan to use `--use-redelegation` with `send_prompt`.

```bash
node dist/index.js set_delegation '{"delegate":"0x0000000000000000000000000000000000000001","delegator":"0x...","authority":"0x0","caveats":[],"salt":"0x0","signature":"0x..."}'
```

Expected output:

```
Delegation saved successfully.
Config saved to: /home/<user>/.clawdbot/skills/coinfello/config.json
```

### 3. send_prompt

Sends a prompt to CoinFello with a locally-created ERC-20 subdelegation. Requires `create_account` to have been run first. The private key is read from the config file.

```bash
node dist/index.js send_prompt "swap 5 USDC for ETH" \
  --token-address 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --max-amount 5 \
  --decimals 6
```

With redelegation (requires `set_delegation` first):

```bash
node dist/index.js send_prompt "swap 5 USDC for ETH" \
  --token-address 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48 \
  --max-amount 5 \
  --decimals 6 \
  --use-redelegation
```

Expected output:

```
Fetching CoinFello delegate address...
Loading smart account...
Creating subdelegation...
Signing subdelegation...
Sending to conversation endpoint...
Transaction submitted successfully.
Transaction ID: <txn_id>
```

### 4. get_transaction_status

Checks the status of a previously submitted transaction.

```bash
node dist/index.js get_transaction_status <txn_id>
```

Expected output is a JSON object with the transaction status.

### Help

View all commands and options:

```bash
node dist/index.js --help
node dist/index.js send_prompt --help
```
