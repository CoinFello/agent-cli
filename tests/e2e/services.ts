import {
  type Hex,
  type Chain,
  encodeFunctionData,
  formatEther,
  formatUnits,
  http,
  parseEther,
} from "viem";
import { createSmartAccount } from "../../src/account.js";
import { createInfuraBundlerClient } from "@metamask/smart-accounts-kit";

const INFURA_API_KEY =
  process.env.INFURA_API_KEY ?? "b6bf7d3508c941499b10025c0776eaf8";

const INFURA_CHAIN_NAMES: Record<number, string> = {
  1: "mainnet",
  8453: "base-mainnet",
  84532: "base-sepolia",
};

const USDC_ADDRESSES: Partial<Record<number, Hex>> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
};

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
  },
] as const;

const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
  },
] as const;

/** A public client with the methods we need for cleanup. */
type ReadClient = {
  getBalance(args: { address: Hex }): Promise<bigint>;
  readContract(args: {
    address: Hex;
    abi: readonly unknown[];
    functionName: string;
    args: readonly unknown[];
  }): Promise<unknown>;
};

export async function createBundlerForChain(privateKey: Hex, chain: Chain) {
  const infuraName = INFURA_CHAIN_NAMES[chain.id];
  if (!infuraName) {
    throw new Error(`No Infura bundler mapping for chain ID ${chain.id}`);
  }

  const { smartAccount } = await createSmartAccount(privateKey, chain.id);
  return createInfuraBundlerClient({
    transport: http(
      `https://${infuraName}.infura.io/v3/${INFURA_API_KEY}`
    ),
    chain,
    account: smartAccount,
  });
}

export async function getUsdcBalance(
  publicClient: ReadClient,
  chainId: number,
  address: Hex
): Promise<bigint> {
  const usdcAddress = USDC_ADDRESSES[chainId];
  if (!usdcAddress) return 0n;

  return publicClient.readContract({
    address: usdcAddress,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [address],
  }) as Promise<bigint>;
}

function buildUsdcTransferCall(
  chainId: number,
  to: Hex,
  amount: bigint
): { to: Hex; data: Hex } | null {
  const usdcAddress = USDC_ADDRESSES[chainId];
  if (!usdcAddress || amount <= 0n) return null;

  return {
    to: usdcAddress,
    data: encodeFunctionData({
      abi: ERC20_TRANSFER_ABI,
      functionName: "transfer",
      args: [to, amount],
    }),
  };
}

export async function returnRemainingFunds({
  privateKey,
  chain,
  publicClient,
  smartAccountAddress,
  fundingAddress,
  ethGasBuffer = parseEther("0.0005"),
}: {
  privateKey: Hex;
  chain: Chain;
  publicClient: ReadClient;
  smartAccountAddress: Hex;
  fundingAddress: Hex;
  ethGasBuffer?: bigint;
}): Promise<void> {
  const ethBalance = await publicClient.getBalance({
    address: smartAccountAddress,
  });
  const usdcBalance = await getUsdcBalance(
    publicClient,
    chain.id,
    smartAccountAddress
  );
  const chainName = chain.name;

  console.log(
    `Cleanup [${chainName}]: ${formatEther(ethBalance)} ETH, ${formatUnits(usdcBalance, 6)} USDC`
  );

  const calls: { to: Hex; value?: bigint; data?: Hex }[] = [];

  const usdcCall = buildUsdcTransferCall(chain.id, fundingAddress, usdcBalance);
  if (usdcCall) calls.push(usdcCall);

  if (ethBalance > ethGasBuffer) {
    calls.push({ to: fundingAddress, value: ethBalance - ethGasBuffer });
  }

  if (calls.length === 0) {
    console.log(`Cleanup [${chainName}]: Nothing to return`);
    return;
  }

  const bundler = await createBundlerForChain(privateKey, chain);
  const hash = await bundler.sendUserOperation({ calls });
  await bundler.waitForUserOperationReceipt({ hash });
  console.log(
    `Cleanup [${chainName}]: Returned remaining funds to funding account`
  );
}
