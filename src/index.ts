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
import { signInWithAgent } from "./siwe.js";
import { parseScope, type RawScope } from "./scope.js";
import type { Hex } from "viem";
import { generatePrivateKey } from "viem/accounts";
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
      console.log(`Creating smart account on ${chain}...`);
      const privateKey = generatePrivateKey();
      const { address } = await createSmartAccount(privateKey, chain);

      const config = await loadConfig();
      config.private_key = privateKey;
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

// ── get_account ─────────────────────────────────────────────────
program
  .command("get_account")
  .description("Display the current smart account address from local config")
  .action(async () => {
    try {
      const config = await loadConfig();
      if (!config.smart_account_address) {
        console.error(
          "Error: No smart account found. Run 'create_account' first."
        );
        process.exit(1);
      }

      console.log(config.smart_account_address);
    } catch (err) {
      console.error(`Failed to get account: ${(err as Error).message}`);
      process.exit(1);
    }
  });

// ── sign_in ─────────────────────────────────────────────────────
program
  .command("sign_in")
  .description("Sign in to a server using SIWE with your smart account")
  .option("--base-url <baseUrl>", "The server base URL override (e.g. https://api.example.com)", "https://app.coinfello.com/api/auth")
  .action(async (opts: {baseUrl: string}) => {
    try {
      console.log("Signing in with smart account...");
      const config = await loadConfig();
      const result = await signInWithAgent(opts.baseUrl, config);
      console.log("Sign-in successful.");
      console.log(`User ID: ${result.user.id}`);
      console.log(`Session token saved to config.`);
    } catch (err) {
      console.error(`Failed to sign in: ${(err as Error).message}`);
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
    "Send a prompt to CoinFello, creating a delegation if requested by the server"
  )
  .argument("<prompt>", "The prompt to send")
  .option(
    "--use-redelegation",
    "Create a redelegation from a stored parent delegation"
  )
  .action(
    async (
      prompt: string,
      opts: {
        useRedelegation?: boolean;
      }
    ) => {
      try {
        const config = await loadConfig();
        if (!config.private_key) {
          console.error(
            "Error: No private key found in config. Run 'create_account' first."
          );
          process.exit(1);
        }
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

        // 1. Send prompt-only to conversation endpoint
        console.log("Sending prompt...");
        const initialResponse = await sendConversation({
          prompt,
          smartAccountAddress: config.smart_account_address,
        });

        // If we got a direct txn_id with no tool calls, we're done
        if (initialResponse.txn_id && !initialResponse.toolCalls?.length) {
          console.log("Transaction submitted successfully.");
          console.log(`Transaction ID: ${initialResponse.txn_id}`);
          return;
        }

        // 2. Look for ask_for_delegation tool call
        const delegationToolCall = initialResponse.toolCalls?.find(
          (tc) => tc.name === "ask_for_delegation"
        );
        if (!delegationToolCall) {
          console.error("Error: No delegation request received from the server.");
          console.log("Response:", JSON.stringify(initialResponse, null, 2));
          process.exit(1);
        }

        // 3. Parse tool call arguments
        const args = JSON.parse(delegationToolCall.arguments) as {
          chainId: number;
          scope: RawScope;
        };
        console.log(`Delegation requested: scope=${args.scope.type}, chainId=${args.chainId}`);

        // 4. Get CoinFello delegate address
        console.log("Fetching CoinFello delegate address...");
        const delegateAddress = await getCoinFelloAddress();

        // 5. Rebuild smart account using chainId from tool call
        console.log("Loading smart account...");
        const smartAccount = await getSmartAccount(
          config.private_key as Hex,
          args.chainId
        );

        // 6. Parse scope and create subdelegation
        const scope = parseScope(args.scope);
        console.log("Creating subdelegation...");
        const subdelegation = createSubdelegation({
          smartAccount,
          delegateAddress: delegateAddress as Hex,
          parentDelegation: opts.useRedelegation ? config.delegation : undefined,
          scope,
        });

        // 7. Sign the subdelegation
        console.log("Signing subdelegation...");
        const signature = await smartAccount.signDelegation({
          delegation: subdelegation,
        });
        const signedSubdelegation = { ...subdelegation, signature };

        // 8. Send signed delegation back to conversation endpoint
        console.log("Sending signed delegation...");
        const finalResponse = await sendConversation({
          prompt,
          signedSubdelegation,
          smartAccountAddress: config.smart_account_address,
        });

        if (finalResponse.txn_id) {
          console.log("Transaction submitted successfully.");
          console.log(`Transaction ID: ${finalResponse.txn_id}`);
        } else {
          console.log("Response:", JSON.stringify(finalResponse, null, 2));
        }
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
