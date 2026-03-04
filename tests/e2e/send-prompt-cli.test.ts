import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Hex, createPublicClient, createWalletClient, formatEther, http, parseEther } from "viem";
import { base, baseSepolia } from "viem/chains";
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
      timeout: 360_000,
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

const sepoliaPublicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(),
});
const basePublicClient = createPublicClient({
  chain: base,
  transport: http(),
});

describe("send_prompt CLI end-to-end", () => {
  let smartAccountAddress: Hex;

  beforeAll(async () => {
    const privateKey = generatePrivateKey();
    const { address } = await createSmartAccount(privateKey, CHAIN);
    smartAccountAddress = address as Hex;

    // Fund the smart account with 0.002 Base Sepolia ETH
    const fundingKey = process.env.PRIVATE_KEY as Hex;
    const fundingAccount = privateKeyToAccount(fundingKey);
    const balance = await sepoliaPublicClient.getBalance({ address: fundingAccount.address });
    console.log(`Funding account: ${fundingAccount.address}`);
    console.log(`Funding account Base Sepolia balance: ${formatEther(balance)} ETH`);

    const walletClient = createWalletClient({
      account: fundingAccount,
      chain: baseSepolia,
      transport: http(),
    });
    await walletClient.sendTransaction({
      to: address as Hex,
      value: parseEther("0.002"),
    });

    // Fund the smart account on Base mainnet (swaps only work on real Base)
    const baseBalance = await basePublicClient.getBalance({ address: fundingAccount.address });
    console.log(`Funding account Base mainnet balance: ${formatEther(baseBalance)} ETH`);

    const baseWalletClient = createWalletClient({
      account: fundingAccount,
      chain: base,
      transport: http(),
    });
    await baseWalletClient.sendTransaction({
      to: address as Hex,
      value: parseEther("0.002"),
    });

    const config = {
      private_key: privateKey as Hex,
      smart_account_address: address,
      chain: CHAIN,
    };

    await signInWithAgent(SIWE_BASE_URL, config);
  });

  it("returns a text response for a read-only prompt via the CLI", async () => {
    const { stdout, stderr, exitCode } = await runCli(["send_prompt", "hello"]);

    console.log(stdout)
    console.error(stderr)

    expect(exitCode).toBe(0);
    expect(stdout.trim()).toBeTruthy();
  });

  it("completes the delegation flow when asked to send ETH via the CLI", async () => {
    const balanceBefore = await sepoliaPublicClient.getBalance({ address: smartAccountAddress });
    console.log(`Smart account Base Sepolia balance before send: ${formatEther(balanceBefore)} ETH`);

    const { stdout, stderr} = await runCli([
      "send_prompt",
      "send 0.0001 ETH on Base Sepolia to 0x000000000000000000000000000000000000dEaD",
    ]);

    console.log(stdout)
    console.error(stderr)

    expect(stdout).toContain("Sending prompt...");
    expect(stdout).toContain("Delegation requested");
    expect(stdout).toContain("Creating subdelegation...");
    expect(stdout).toContain("Signing subdelegation...");
    expect(stdout).toContain("Sending signed delegation...");

    const balanceAfterFirst = await sepoliaPublicClient.getBalance({ address: smartAccountAddress });
    console.log(`Smart account Base Sepolia balance after first send: ${formatEther(balanceAfterFirst)} ETH`);
    expect(balanceAfterFirst).toBeLessThan(balanceBefore);
    expect(balanceBefore - balanceAfterFirst).toBeGreaterThanOrEqual(parseEther("0.0001"));

    const { stdout: stdout2, stderr: stderr2} = await runCli([
      "send_prompt",
      "send 0.0001 ETH on Base Sepolia to 0x000000000000000000000000000000000000dEaD",
    ]);

    console.log(stdout2)
    console.error(stderr2)

    expect(stdout).toContain("Sending prompt...");
    expect(stdout).toContain("Delegation requested");
    expect(stdout).toContain("Creating subdelegation...");
    expect(stdout).toContain("Signing subdelegation...");
    expect(stdout).toContain("Sending signed delegation...");

    const balanceAfter = await sepoliaPublicClient.getBalance({ address: smartAccountAddress });
    console.log(`Smart account Base Sepolia balance after send: ${formatEther(balanceAfter)} ETH`);
    expect(balanceAfter).toBeLessThan(balanceBefore);
    expect(balanceBefore - balanceAfter).toBeGreaterThanOrEqual(parseEther("0.0002"));
  });

  it("completes the delegation flow when asked to swap ETH for USDC via the CLI", async () => {
    const balanceBefore = await basePublicClient.getBalance({ address: smartAccountAddress });
    console.log(`Smart account Base mainnet balance before swap: ${formatEther(balanceBefore)} ETH`);

    const { stdout, stderr } = await runCli([
      "send_prompt",
      "Swap 0.0001 ETH for USDC on base",
    ]);

    console.log(stdout);
    console.error(stderr);

    expect(stdout).toContain("Sending prompt...");
    expect(stdout).toContain("Delegation requested");
    expect(stdout).toContain("Creating subdelegation...");
    expect(stdout).toContain("Signing subdelegation...");
    expect(stdout).toContain("Sending signed delegation...");

    const balanceAfter = await basePublicClient.getBalance({ address: smartAccountAddress });
    console.log(`Smart account Base mainnet balance after swap: ${formatEther(balanceAfter)} ETH`);
    expect(balanceAfter).toBeLessThan(balanceBefore);
    expect(balanceBefore - balanceAfter).toBeGreaterThanOrEqual(parseEther("0.0001"));
  });
});
