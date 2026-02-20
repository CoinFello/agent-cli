import { describe, it, expect, beforeAll } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { createSmartAccount } from "../../src/account.js";
import { signInWithAgent } from "../../src/siwe.js";
import { BASE_URL, sendConversation } from "../../src/api.js";

const SIWE_BASE_URL = `${BASE_URL}api/auth`;
const CHAIN = "sepolia";

// NOTE: This test makes real network calls and writes to
// ~/.clawdbot/skills/coinfello/config.json as a side effect of sign-in.

describe("send_prompt read-only flow", () => {
  let smartAccountAddress: string;

  beforeAll(async () => {
    const privateKey = generatePrivateKey();
    const { address } = await createSmartAccount(privateKey, CHAIN);
    smartAccountAddress = address;

    const config = {
      private_key: privateKey as Hex,
      smart_account_address: address,
      chain: CHAIN,
    };

    await signInWithAgent(SIWE_BASE_URL, config);
  });

  it("returns responseText with no tool calls when sending a greeting", async () => {
    const response = await sendConversation({
      prompt: "hello",
    });

    expect(response.responseText).toBeTruthy();
    expect(response.txn_id).toBeUndefined();
    expect(response.clientToolCalls?.length ?? 0).toBe(0);
  });

  it("returns responseText with no tool calls when asking for the chain id of Base", async () => {
    const response = await sendConversation({
      prompt: "what is the chain id for base?",
    });

    expect(response.responseText).toBeTruthy();
    expect(response.txn_id).toBeUndefined();
    expect(response.clientToolCalls?.length ?? 0).toBe(0);
  });

  it("returns responseText with no tool calls when asking for the native currency of Arbitrum", async () => {
    const response = await sendConversation({
      prompt: "what is the native currency for arbitrum?",
    });

    expect(response.responseText).toBeTruthy();
    expect(response.txn_id).toBeUndefined();
    expect(response.clientToolCalls?.length ?? 0).toBe(0);
  });

  it("returns responseText with no tool calls when asking for token balances", async () => {
    const response = await sendConversation({
      prompt: "what are my token balances?",
    });

    expect(response.responseText).toBeTruthy();
    expect(response.txn_id).toBeUndefined();
    expect(response.clientToolCalls?.length ?? 0).toBe(0);
  });
});

describe("send_prompt delegation flow", () => {
  let smartAccountAddress: string;

  beforeAll(async () => {
    const privateKey = generatePrivateKey();
    const { address } = await createSmartAccount(privateKey, CHAIN);
    smartAccountAddress = address;

    const config = {
      private_key: privateKey as Hex,
      smart_account_address: address,
      chain: CHAIN,
    };

    await signInWithAgent(SIWE_BASE_URL, config);
  });

  it("requests a delegation when asked to send 0.001 USDC on Base", async () => {
    const response = await sendConversation({
      prompt:
        "send 0.001 USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) on Base to 0x000000000000000000000000000000000000dEaD. call ask_for_delegation",
    });

    expect(response.txn_id).toBeUndefined();

    const delegationCall = response.clientToolCalls?.find(
      (tc) => tc.name === "ask_for_delegation"
    );
    expect(delegationCall).toBeDefined();

    const args = JSON.parse(delegationCall!.arguments);
    expect(args.chainId).toBeDefined();
    expect(args.scope).toBeDefined();
  });

  it.skip("requests a delegation when asked to swap 0.001 USDC to ETH on Base", async () => {
    const response = await sendConversation({
      prompt: "swap 0.001 USDC to ETH on Base.",
    });

    expect(response.txn_id).toBeUndefined();

    const delegationCall = response.clientToolCalls?.find(
      (tc) => tc.name === "ask_for_delegation"
    );
    expect(delegationCall).toBeDefined();

    const args = JSON.parse(delegationCall!.arguments);
    expect(args.chainId).toBeDefined();
    expect(args.scope).toBeDefined();
  });
});
