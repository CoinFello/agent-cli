import { Command } from "commander";
import {
  createSmartAccount,
  getSmartAccount,
  createSubdelegation,
} from "./account.js";
import { loadConfig, saveConfig, CONFIG_PATH } from "./config.js";
import {
  getCoinFelloAddress,
  sendConversation,
  getTransactionStatus,
} from "./api.js";
import { type Hex, parseUnits } from "viem";
import type { Delegation } from "@metamask/smart-accounts-kit";

const program = new Command();

program
  .name("openclaw")
  .description("CoinFello CLI - MetaMask Smart Account interactions")
  .version("1.0.0");

// ── create_account ──────────────────────────────────────────────
program
  .command("create_account")
  .description("Create a MetaMask smart account and save its address to local config")
  .argument("<chain>", "Chain name (e.g. sepolia, mainnet, polygon, arbitrum)")
  .action(async (chain: string) => {
    try {
      const privateKey = process.env.PRIVATE_KEY;
      if (!privateKey) {
        console.error("Error: PRIVATE_KEY environment variable is not set.");
        console.error("Usage: PRIVATE_KEY=0x... openclaw create_account <chain>");
        process.exit(1);
      }

      if (!privateKey.startsWith("0x")) {
        console.error("Error: PRIVATE_KEY must start with '0x'.");
        process.exit(1);
      }

      console.log(`Creating smart account on ${chain}...`);
      const { address } = await createSmartAccount(privateKey as Hex, chain);

      const config = await loadConfig();
      config.smart_account_address = address;
      config.chain = chain;
      await saveConfig(config);

      console.log("Smart account created successfully.");
      console.log(`Address: ${address}`);
      console.log(`Config saved to: ${CONFIG_PATH}`);
    } catch (err) {
      console.error(`Failed to create account: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── set_delegation ──────────────────────────────────────────────
program
  .command("set_delegation")
  .description("Store a signed delegation (JSON) in local config")
  .argument("<delegation>", "The signed delegation as a JSON string")
  .action(async (delegationJson: string) => {
    try {
      const delegation = JSON.parse(delegationJson) as Delegation;

      const config = await loadConfig();
      config.delegation = delegation;
      await saveConfig(config);

      console.log("Delegation saved successfully.");
      console.log(`Config saved to: ${CONFIG_PATH}`);
    } catch (err) {
      console.error(`Failed to set delegation: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── send_prompt ─────────────────────────────────────────────────
program
  .command("send_prompt")
  .description(
    "Send a prompt to CoinFello, creating and signing a subdelegation locally"
  )
  .argument("<prompt>", "The prompt to send")
  .requiredOption(
    "--token-address <address>",
    "ERC-20 token contract address for the subdelegation scope"
  )
  .requiredOption(
    "--max-amount <amount>",
    "Maximum token amount (human-readable, e.g. '5')"
  )
  .option(
    "--decimals <decimals>",
    "Token decimals for parsing max-amount",
    "18"
  )
  .option(
    "--use-redelegation",
    "Create a redelegation from a stored parent delegation"
  )
  .action(
    async (
      prompt: string,
      opts: {
        tokenAddress: string;
        maxAmount: string;
        decimals: string;
        useRedelegation?: boolean;
      }
    ) => {
      try {
        const privateKey = process.env.PRIVATE_KEY;
        if (!privateKey) {
          console.error("Error: PRIVATE_KEY environment variable is not set.");
          process.exit(1);
        }

        const config = await loadConfig();
        if (!config.smart_account_address) {
          console.error(
            "Error: No smart account found. Run 'create_account' first."
          );
          process.exit(1);
        }
        if (!config.chain) {
          console.error(
            "Error: No chain found in config. Run 'create_account' first."
          );
          process.exit(1);
        }
        if (opts.useRedelegation && !config.delegation) {
          console.error(
            "Error: --use-redelegation requires a parent delegation. Run 'set_delegation' first."
          );
          process.exit(1);
        }

        // 1. Get CoinFello delegate address
        console.log("Fetching CoinFello delegate address...");
        const delegateAddress = await getCoinFelloAddress();

        // 2. Rebuild smart account
        console.log("Loading smart account...");
        const smartAccount = await getSmartAccount(
          privateKey as Hex,
          config.chain
        );

        // 3. Create subdelegation locally
        console.log("Creating subdelegation...");
        const maxAmount = parseUnits(opts.maxAmount, Number(opts.decimals));
        const subdelegation = createSubdelegation({
          smartAccount,
          delegateAddress: delegateAddress as Hex,
          parentDelegation: opts.useRedelegation ? config.delegation : undefined,
          tokenAddress: opts.tokenAddress as Hex,
          maxAmount,
        });

        // 4. Sign the subdelegation
        console.log("Signing subdelegation...");
        const signature = await smartAccount.signDelegation({
          delegation: subdelegation,
        });
        const signedSubdelegation = { ...subdelegation, signature };

        // 5. Send to conversation endpoint
        console.log("Sending to conversation endpoint...");
        const result = await sendConversation({
          prompt,
          signedSubdelegation,
          smartAccountAddress: config.smart_account_address,
        });

        console.log("Transaction submitted successfully.");
        console.log(`Transaction ID: ${result.txn_id}`);
      } catch (err) {
        console.error(`Failed to send prompt: ${(err as Error).message}`);
        process.exit(1);
      }
    }
  );

// ── get_transaction_status ──────────────────────────────────────
program
  .command("get_transaction_status")
  .description("Check the status of a submitted transaction")
  .argument("<txn_id>", "The transaction ID to check")
  .action(async (txnId: string) => {
    try {
      const result = await getTransactionStatus(txnId);
      console.log(JSON.stringify(result, null, 2));
    } catch (err) {
      console.error(
        `Failed to get transaction status: ${(err as Error).message}`
      );
      process.exit(1);
    }
  });

program.parse();
