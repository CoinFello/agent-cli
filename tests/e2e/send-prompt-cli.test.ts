import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Hex, createWalletClient, http, parseEther } from "viem";
import { baseSepolia } from "viem/chains";
import { createSmartAccount } from "../../src/account.js";
import { signInWithAgent } from "../../src/siwe.js";
import { BASE_URL } from "../../src/api.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "../../dist/index.js");
const SIWE_BASE_URL = `${BASE_URL}api/auth`;
const CHAIN = "baseSepolia";

// NOTE: This test makes real network calls, writes to
// ~/.clawdbot/skills/coinfello/config.json, and requires a prior `pnpm build`.

function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      timeout: 180_000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (data: Buffer) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data: Buffer) => {
      stderr += data.toString();
    });
    child.on("close", (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
  });
}

describe("send_prompt CLI end-to-end", () => {
  beforeAll(async () => {
    console.log("[beforeAll] Starting setup...");
    console.log("[beforeAll] PRIVATE_KEY present:", !!process.env.PRIVATE_KEY);
    console.log("[beforeAll] BASE_URL:", BASE_URL);
    console.log("[beforeAll] CLI_PATH:", CLI_PATH);

    const privateKey = generatePrivateKey();
    console.log("[beforeAll] Generated ephemeral private key");

    const { address } = await createSmartAccount(privateKey, CHAIN);
    console.log("[beforeAll] Smart account address:", address);

    // Fund the smart account with 0.002 Base Sepolia ETH
    const fundingKey = process.env.PRIVATE_KEY as Hex;
    const fundingAccount = privateKeyToAccount(fundingKey);
    console.log("[beforeAll] Funding account address:", fundingAccount.address);

    const walletClient = createWalletClient({
      account: fundingAccount,
      chain: baseSepolia,
      transport: http(),
    });

    console.log("[beforeAll] Sending 0.002 ETH to smart account...");
    const txHash = await walletClient.sendTransaction({
      to: address as Hex,
      value: parseEther("0.002"),
    });
    console.log("[beforeAll] Funding tx hash:", txHash);

    const config = {
      private_key: privateKey as Hex,
      smart_account_address: address,
      chain: CHAIN,
    };

    console.log("[beforeAll] Signing in with agent...");
    await signInWithAgent(SIWE_BASE_URL, config);
    console.log("[beforeAll] Setup complete");
  });

  it("returns a text response for a read-only prompt via the CLI", async () => {
    console.log("[test:read-only] Running CLI with 'hello' prompt...");
    const { stdout, stderr, exitCode } = await runCli(["send_prompt", "hello"]);

    console.log("[test:read-only] exitCode:", exitCode);
    console.log("[test:read-only] stdout:", stdout);
    console.error("[test:read-only] stderr:", stderr);

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBeTruthy();
  });

  it("completes the delegation flow when asked to send ETH via the CLI", async () => {
    console.log("[test:delegation] Running CLI with delegation prompt...");
    const { stdout, stderr} = await runCli([
      "send_prompt",
      "send 0.001 ETH on Base Sepolia to 0x000000000000000000000000000000000000dEaD. call ask_for_delegation",
    ]);

    console.log("[test:delegation] stdout:", stdout);
    console.error("[test:delegation] stderr:", stderr);

    expect(stdout).toContain("Sending prompt...");
    expect(stdout).toContain("Delegation requested");
    expect(stdout).toContain("Creating subdelegation...");
    expect(stdout).toContain("Signing subdelegation...");
    expect(stdout).toContain("Sending signed delegation...");
  });
});
