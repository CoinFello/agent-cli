# CoinFello CLI Reference

## Config File

Location: `~/.clawdbot/skills/coinfello/config.json`

Created automatically by `create_account`. Schema:

```json
{
  "private_key": "0xabc123...def",
  "smart_account_address": "0x1234...abcd",
  "chain": "sepolia",
  "delegation": {
    "delegate": "0x...",
    "delegator": "0x...",
    "authority": "0x...",
    "caveats": [],
    "salt": "0x...",
    "signature": "0x..."
  }
}
```

| Field                   | Type     | Set by           | Description                                 |
| ----------------------- | -------- | ---------------- | ------------------------------------------- |
| `private_key`           | `string` | `create_account` | Auto-generated hex private key              |
| `smart_account_address` | `string` | `create_account` | Counterfactual address of the smart account |
| `chain`                 | `string` | `create_account` | viem chain name used for account creation   |
| `delegation`            | `object` | `set_delegation` | Optional parent delegation for redelegation |

## Command Reference

### openclaw create_account

```
openclaw create_account <chain>
```

| Parameter | Type     | Required | Description                 |
| --------- | -------- | -------- | --------------------------- |
| `chain`   | `string` | Yes      | viem chain name (see below) |

Generates a new private key automatically and saves it along with the smart account address and chain to config.

### openclaw get_account

```
openclaw get_account
```

No parameters. Prints the stored smart account address from config. Exits with an error if no account has been created.

### openclaw set_delegation

```
openclaw set_delegation <delegation>
```

| Parameter    | Type     | Required | Description                                                     |
| ------------ | -------- | -------- | --------------------------------------------------------------- |
| `delegation` | `string` | Yes      | JSON-encoded Delegation object from MetaMask Smart Accounts Kit |

### openclaw send_prompt

```
openclaw send_prompt <prompt> --token-address <addr> --amount <amt> [--decimals <n>] [--use-redelegation]
```

| Parameter            | Type      | Required | Default | Description                                   |
| -------------------- | --------- | -------- | ------- | --------------------------------------------- |
| `prompt`             | `string`  | Yes      | —       | Natural language prompt to send to CoinFello  |
| `--token-address`    | `string`  | Yes      | —       | ERC-20 token contract address                 |
| `--amount`           | `string`  | Yes      | —       | Max token amount (human-readable, e.g. `"5"`) |
| `--decimals`         | `string`  | No       | `"18"`  | Token decimals for parsing amount             |
| `--use-redelegation` | `boolean` | No       | `false` | Use stored parent delegation for redelegation |

Uses the private key and chain stored in config (from `create_account`).

### openclaw get_transaction_status

```
openclaw get_transaction_status <txn_id>
```

| Parameter | Type     | Required | Description                     |
| --------- | -------- | -------- | ------------------------------- |
| `txn_id`  | `string` | Yes      | Transaction ID from send_prompt |

## Supported Chains

Any chain exported by `viem/chains`. Common examples:

| Chain Name  | Chain ID | Network                  |
| ----------- | -------- | ------------------------ |
| `mainnet`   | 1        | Ethereum mainnet         |
| `sepolia`   | 11155111 | Ethereum Sepolia testnet |
| `polygon`   | 137      | Polygon PoS              |
| `arbitrum`  | 42161    | Arbitrum One             |
| `optimism`  | 10       | OP Mainnet               |
| `base`      | 8453     | Base                     |
| `avalanche` | 43114    | Avalanche C-Chain        |
| `bsc`       | 56       | BNB Smart Chain          |

## API Endpoints

Base URL: `https://app.coinfello.com/api/v1`

| Endpoint                          | Method | Description                           |
| --------------------------------- | ------ | ------------------------------------- |
| `/coinfello-address`              | GET    | Returns CoinFello's delegate address  |
| `/conversation`                   | POST   | Submits prompt + signed subdelegation |
| `/transaction_status?txn_id=<id>` | GET    | Returns transaction status            |

### POST /conversation body

```json
{
  "prompt": "swap 5 USDC for ETH",
  "signed_subdelegation": { "...delegation object with signature..." },
  "smart_account_address": "0x..."
}
```

## Common Token Decimals

| Token | Decimals | Note                            |
| ----- | -------- | ------------------------------- |
| USDC  | 6        | Use `--decimals 6`              |
| USDT  | 6        | Use `--decimals 6`              |
| DAI   | 18       | Default, no `--decimals` needed |
| WETH  | 18       | Default, no `--decimals` needed |

## Error Messages

| Error                                                                          | Cause                           | Fix                                    |
| ------------------------------------------------------------------------------ | ------------------------------- | -------------------------------------- |
| `Unknown chain "<name>"`                                                       | Invalid chain name              | Use a valid viem chain name            |
| `No private key found in config. Run 'create_account' first.`                  | Missing private key in config   | Run `openclaw create_account <chain>`  |
| `No smart account found. Run 'create_account' first.`                          | Missing smart account in config | Run `openclaw create_account <chain>`  |
| `No chain found in config. Run 'create_account' first.`                        | Missing chain in config         | Run `openclaw create_account <chain>`  |
| `--use-redelegation requires a parent delegation. Run 'set_delegation' first.` | No stored delegation            | Run `openclaw set_delegation '<json>'` |
