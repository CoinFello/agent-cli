import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { type Hex, createPublicClient, createWalletClient, formatEther, formatUnits, http, parseEther } from "viem";
import { base, baseSepolia } from "viem/chains";
import { createSmartAccount } from "../../src/account.js";
import { returnRemainingFunds } from "./services.js";
import { signInWithAgent } from "../../src/siwe.js";
import { BASE_URL } from "../../src/api.js";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { getChainTransport } from "../../src/services/createPublicClient.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, "../../dist/index.js");
const SIWE_BASE_URL = `${BASE_URL}api/auth`;

// NOTE: This test makes real network calls, writes to
// ~/.clawdbot/skills/coinfello/config.json, and requires a prior `pnpm build`.

function runCli(
  args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn("node", [CLI_PATH, ...args], {
      timeout: 360_000,
      env: { ...process.env, CI: "true" },
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
  describe('testnet', () => {
    const testnetPrivateKey = generatePrivateKey()
    let testnetSmartAcctAddress: Hex = '0x'

    beforeAll(async () => {
      const { address } = await createSmartAccount(testnetPrivateKey, "baseSepolia");
      testnetSmartAcctAddress = address as Hex
      console.log('new testnet smart account address ', testnetSmartAcctAddress)

      // Fund the smart account with 0.002 Base Sepolia ETH
      if (!process.env.PRIVATE_KEY){
        throw new Error('no PRIVATE_KEY set')
      }
      const fundingKey = process.env.PRIVATE_KEY as Hex;
      const fundingAccount = privateKeyToAccount(fundingKey);
      const balance = await sepoliaPublicClient.getBalance({ address: fundingAccount.address });
      console.log(`Funding account: ${fundingAccount.address}`);
      console.log(`Funding account Base Sepolia balance: ${formatEther(balance)} ETH`);

      const walletClient = createWalletClient({
        account: fundingAccount,
        chain: baseSepolia,
        transport: getChainTransport(baseSepolia.id),
      });
      const txHash = await walletClient.sendTransaction({
        to: testnetSmartAcctAddress as Hex,
        value: parseEther("0.002"),
      });
      await sepoliaPublicClient.waitForTransactionReceipt({ hash: txHash });

      const config = {
        private_key: testnetPrivateKey as Hex,
        smart_account_address: address,
        chain: "baseSepolia",
      };

      await signInWithAgent(SIWE_BASE_URL, config);
      await new Promise((resolve)=>setTimeout(()=>{resolve(1)}, 4000))
    });

    afterAll(async () => {
      const fundingAddress = privateKeyToAccount(process.env.PRIVATE_KEY as Hex).address;

      try {
        await returnRemainingFunds({
          privateKey: testnetPrivateKey,
          chain: baseSepolia,
          publicClient: sepoliaPublicClient,
          smartAccountAddress: testnetSmartAcctAddress,
          fundingAddress,
          ethGasBuffer: parseEther("0.0005"),
        });
      } catch (err) {
        console.error("Cleanup (Base Sepolia) failed:", err);
      }
    }, 120_000);


    // needs to happen after sign in and account creation
    it("returns a text response for a read-only prompt via the CLI", async () => {
      await runCli(["new_chat"]);
      const { stdout, stderr, exitCode } = await runCli(["send_prompt", "hello"]);

      console.log(stdout)
      console.error(stderr)

      expect(exitCode).toBe(0);
      expect(stdout.trim()).toBeTruthy();
    });

    /**
     * @dev tests deploying a new smart acct & sending eth in 1 txn
     * then sending eth with the deployed account in a separate txn
     */
    it("completes the delegation flow when asked to send ETH via the CLI", async () => {
      await runCli(["new_chat"]);
      const balanceBefore = await sepoliaPublicClient.getBalance({ address: testnetSmartAcctAddress });
      console.log(`Smart account Base Sepolia balance before send: ${formatEther(balanceBefore)} ETH`);

      const { stdout, stderr} = await runCli([
        "send_prompt",
        "send 0.0001 ETH on Base Sepolia to 0x000000000000000000000000000000000000dEaD",
      ]);

      console.log(stdout)
      console.error(stderr)

      // wait for 2 blocks so balance check gets fresh data
      await new Promise((resolve)=>setTimeout(()=>{resolve(1)}, 6000))

      const balanceAfterFirst = await sepoliaPublicClient.getBalance({ address: testnetSmartAcctAddress });
      console.log(`Smart account Base Sepolia balance after first send: ${formatEther(balanceAfterFirst)} ETH`);
      expect(balanceAfterFirst).toBeLessThan(balanceBefore);
      expect(balanceBefore - balanceAfterFirst).toBeGreaterThanOrEqual(parseEther("0.0001"));

      // now we check again which will use the deployed smart account sig flow
      const { stdout: stdout2, stderr: stderr2} = await runCli([
        "send_prompt",
        "send 0.0001 ETH on Base Sepolia to 0x000000000000000000000000000000000000dEaD",
      ]);

      console.log(stdout2)
      console.error(stderr2)

      // wait for 2 blocks so balance check gets fresh data
      await new Promise((resolve)=>setTimeout(()=>{resolve(1)}, 6000))

      const balanceAfter = await sepoliaPublicClient.getBalance({ address: testnetSmartAcctAddress });
      console.log(`Smart account Base Sepolia balance after send: ${formatEther(balanceAfter)} ETH`);
      expect(balanceAfter).toBeLessThan(balanceBefore);
      expect(balanceBefore - balanceAfter).toBeGreaterThanOrEqual(parseEther("0.0001"));
    });
  })

  describe('base', ()=>{
    let baseSmartAccountAddress: Hex;
    let basePrivateKey: Hex;

    beforeAll(async () => {
      if (!process.env.PRIVATE_KEY_BASE_WALLET){
        throw new Error('no PRIVATE_KEY_BASE_WALLET set')
      }
      basePrivateKey = process.env.PRIVATE_KEY_BASE_WALLET as Hex
      const { address } = await createSmartAccount(basePrivateKey, 'base');
      console.log('base mainnet smart acct address ', address)
      baseSmartAccountAddress = address as Hex;

      // Fund the smart account on Base mainnet (swaps only work on real Base)
      const baseBalance = await basePublicClient.getBalance({ address: baseSmartAccountAddress });
      console.log(`Account on Base mainnet has balance: ${formatEther(baseBalance)} ETH`);

      const config = {
        private_key: basePrivateKey as Hex,
        smart_account_address: address,
        chain: 'base',
      };

      await signInWithAgent(SIWE_BASE_URL, config);
      await new Promise((resolve)=>setTimeout(()=>{resolve(1)}, 4000))
    });

    it("completes the delegation flow when asked to swap ETH for USDC via the CLI", async () => {
      await runCli(["new_chat"]);

      const balanceBefore = await basePublicClient.getBalance({ address: baseSmartAccountAddress });
      console.log(`Smart account Base mainnet balance before swap: ${formatEther(balanceBefore)} ETH`);

      const { stdout, stderr } = await runCli([
        "send_prompt",
        "Swap 0.0001 ETH for USDC on base",
      ]);

      console.log(stdout);
      console.error(stderr);

      const balanceAfter = await basePublicClient.getBalance({ address: baseSmartAccountAddress });
      console.log(`Smart account Base mainnet balance after swap: ${formatEther(balanceAfter)} ETH`);
      expect(balanceAfter).toBeLessThan(balanceBefore);
      expect(balanceBefore - balanceAfter).toBeGreaterThanOrEqual(parseEther("0.00000001"));

      // clean up 
      const { stdout: stdoutCleanup, stderr: stderrCleanup } = await runCli([
        "send_prompt",
        "Swap 0.2 USDC for ETH on base",
      ]);
      console.log(stdoutCleanup);
      console.error(stderrCleanup);
    });

    it("completes the staking/unstaking flow for USDC in the fluid vault on Base via the CLI", async () => {
      await runCli(["new_chat"]);

      const USDC_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as Hex;
      const ERC20_ABI = [
        {
          name: "balanceOf",
          type: "function",
          inputs: [{ name: "account", type: "address" }],
          outputs: [{ name: "", type: "uint256" }],
          stateMutability: "view",
        },
      ] as const;

      const usdcBefore = await basePublicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [baseSmartAccountAddress],
      });
      console.log(`Smart account USDC balance before staking: ${formatUnits(usdcBefore, 6)} USDC`);
      expect(usdcBefore).toBeGreaterThan(0n);

      // Step 1: Get staking opportunities (read-only)
      const { stdout: stdout1, stderr: stderr1 } = await runCli([
        "send_prompt",
        "get staking opportunities for usdc on base",
      ]);
      console.log(stdout1);
      console.error(stderr1);
      expect(stdout1).toContain("Sending prompt...");
      expect(stdout1.trim()).toBeTruthy();

      // Step 2: Stake entire USDC balance into the fluid vault
      const { stdout: stdout2, stderr: stderr2 } = await runCli([
        "send_prompt",
        "stake 2 USDC into the fluid vault on Base",
      ]);
      console.log(stdout2);
      console.error(stderr2);
      
      // wait for 2 blocks so balance check gets fresh data
      await new Promise((resolve)=>setTimeout(()=>{resolve(1)}, 4000))

      const usdcAfterStake = await basePublicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [baseSmartAccountAddress],
      });
      console.log(`Smart account USDC balance after staking: ${formatUnits(usdcAfterStake, 6)} USDC`);
      expect(usdcAfterStake).toBeLessThan(usdcBefore);

      // Step 3: Unstake entire USDC balance from the fluid vault
      const { stdout: stdout3, stderr: stderr3 } = await runCli([
        "send_prompt",
        "swap ALL of my FUSDC to USDC on Base",
      ]);
      console.log(stdout3);
      console.error(stderr3);
      
      // wait for 2 blocks so balance check gets fresh data
      await new Promise((resolve)=>setTimeout(()=>{resolve(1)}, 4000))

      const usdcAfterUnstake = await basePublicClient.readContract({
        address: USDC_ADDRESS,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [baseSmartAccountAddress],
      });
      console.log(`Smart account USDC balance after unstaking: ${formatUnits(usdcAfterUnstake, 6)} USDC`);
      expect(usdcAfterUnstake).toBeGreaterThan(usdcAfterStake);
    });
  })
});
