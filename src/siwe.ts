import { createSiweMessage } from "viem/siwe";
import { type Hex, type Address, keccak256, toHex, hashMessage, encodeFunctionData, pad, verifyHash, createPublicClient, http, parseErc6492Signature } from "viem";
import { Config, loadConfig, saveConfig } from "./config.js";
import { createSmartAccount, getSmartAccount, resolveChain } from "./account.js";
import { signMessage } from "viem/experimental/erc7739";
import { hardhat } from "viem/chains";

export interface SignInResult {
  token: string;
  success: boolean;
  user: {
    id: string;
    walletAddress: string;
    chainId: number;
  };
}

const factoryAbi = [
  { inputs: [], name: 'Create2EmptyBytecode', type: 'error' },
  { inputs: [], name: 'Create2FailedDeployment', type: 'error' },
  {
    inputs: [
      { internalType: 'uint256', name: 'balance', type: 'uint256' },
      { internalType: 'uint256', name: 'needed', type: 'uint256' }
    ],
    name: 'Create2InsufficientBalance',
    type: 'error'
  },
  {
    inputs: [{ internalType: 'address', name: 'deployed', type: 'address' }],
    name: 'SimpleFactoryEmptyContract',
    type: 'error'
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, internalType: 'address', name: 'addr', type: 'address' }
    ],
    name: 'Deployed',
    type: 'event'
  },
  {
    inputs: [
      { internalType: 'bytes32', name: '_bytecodeHash', type: 'bytes32' },
      { internalType: 'bytes32', name: '_salt', type: 'bytes32' }
    ],
    name: 'computeAddress',
    outputs: [{ internalType: 'address', name: 'addr_', type: 'address' }],
    stateMutability: 'view',
    type: 'function'
  },
  {
    inputs: [
      { internalType: 'bytes', name: '_bytecode', type: 'bytes' },
      { internalType: 'bytes32', name: '_salt', type: 'bytes32' }
    ],
    name: 'deploy',
    outputs: [{ internalType: 'address', name: 'addr_', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function'
  }
]

export async function signInWithAgent(baseUrl: string, config: Config): Promise<SignInResult> {
  if (!config.private_key) {
    throw new Error(
      "No private key found in config. Run 'create_account' first."
    );
  }
  if (!config.smart_account_address) {
    throw new Error(
      "No smart account address found in config. Run 'create_account' first."
    );
  }
  if (!config.chain) {
    throw new Error(
      "No chain found in config. Run 'create_account' first."
    );
  }

  const chain = resolveChain(config.chain);
  const chainId = chain.id;
  const walletAddress = config.smart_account_address;

  const {smartAccount, owner} = await createSmartAccount(
    config.private_key as Hex,
    config.chain
  );

  // Extract domain info from baseUrl
  const url = new URL(baseUrl);
  const domain = url.host;

  // Fetch nonce from server
  console.log('fetching nonce...')
  const nonceResponse = await fetch(`${baseUrl}/siwe/nonce`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ walletAddress, chainId }),
  });

  if (!nonceResponse.ok) {
    const text = await nonceResponse.text();
    throw new Error(
      `Failed to fetch SIWE nonce (${nonceResponse.status}): ${text}`
    );
  }

  const { nonce } = (await nonceResponse.json()) as { nonce: string };

  // Construct SIWE message
  console.log('creating siwe message...')
  const message = createSiweMessage({
    address: walletAddress as Address,
    chainId: 1,
    domain,
    nonce,
    uri: url.origin,
    version: "1",
    scheme: url.protocol.replace(":", ""),
    issuedAt: new Date(),
  });

  // Sign with smart account  
  if (!smartAccount.signMessage) {
    throw new Error("Smart account does not support signMessage()");
  }
  const signature = await smartAccount.signMessage({ message: message });


  // Verify signature with server
  console.log('signing in with siwe message...')
  const verifyResponse = await fetch(`${baseUrl}/siwe/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature, walletAddress, chainId }),
  });

  if (!verifyResponse.ok) {
    const text = await verifyResponse.text();
    throw new Error(
      `SIWE verification failed (${verifyResponse.status}): ${text}`
    );
  }

  const result = (await verifyResponse.json()) as SignInResult;

  if (!result.success) {
    throw new Error("SIWE verification returned success: false");
  }

  // Persist session token
  console.log('saving token...')
  config.session_token = result.token;
  await saveConfig(config);

  return result;
}
