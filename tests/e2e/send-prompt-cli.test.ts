import { describe, it, expect, beforeAll } from "vitest";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { createSmartAccount } from "../../src/account.js";
import { signInWithAgent } from "../../src/siwe.js";
import { BASE_URL } from "../../src/api.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "../../dist/index.js");
const SIWE_BASE_URL = `${BASE_URL}api/auth`;
const CHAIN = "sepolia";

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
    const privateKey = generatePrivateKey();
    const { address } = await createSmartAccount(privateKey, CHAIN);

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

  it.only("completes the delegation flow when asked to send USDC via the CLI", async () => {
    const { stdout, stderr} = await runCli([
      "send_prompt",
      "send 0.001 USDC (0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913) on Base to 0x000000000000000000000000000000000000dEaD. call ask_for_delegation",
    ]);

    console.log(stdout)
    console.error(stderr)

    expect(stdout).toContain("Sending prompt...");
    expect(stdout).toContain("Delegation requested");
    expect(stdout).toContain("Creating subdelegation...");
    expect(stdout).toContain("Signing subdelegation...");
    expect(stdout).toContain("Sending signed delegation...");
  });
});
