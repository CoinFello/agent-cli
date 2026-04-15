import {
  Implementation,
  toMetaMaskSmartAccount,
  createDelegation,
  type ToMetaMaskSmartAccountReturnType,
  type Delegation,
  type CreateDelegationOptions,
} from '@metamask/smart-accounts-kit'
import { PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { toWebAuthnAccount } from 'viem/account-abstraction'
import { type Hex, type Chain } from 'viem'
import * as chains from 'viem/chains'
import { randomBytes } from 'node:crypto'
import { generateKey, createSecureEnclaveGetFn } from './secure-enclave/index.js'
import { createPublicClient } from './services/createPublicClient.js'

export type HybridSmartAccount = ToMetaMaskSmartAccountReturnType<Implementation.Hybrid>
export type DelegationScope = CreateDelegationOptions['scope']

export function resolveChain(chainName: string): Chain {
  const chain = (chains as Record<string, Chain | undefined>)[chainName]
  if (!chain) {
    throw new Error(
      `Unknown chain "${chainName}". Use a viem chain name (e.g. sepolia, mainnet, polygon, arbitrum).`
    )
  }
  return chain
}

export function resolveChainById(chainId: number): Chain {
  const chain = Object.values(chains as Record<string, Chain>).find(
    (c) => typeof c === 'object' && c !== null && 'id' in c && c.id === chainId
  )
  if (!chain) {
    throw new Error(`Unknown chain ID ${chainId}. No viem chain found with that ID.`)
  }
  return chain
}

export function resolveChainInput(chainInput: string | number): Chain {
  const chain =
    typeof chainInput === 'number' ? resolveChainById(chainInput) : resolveChain(chainInput)

  assertChainSupported(chain)

  return chain
}

/**
 * Chains where both the MetaMask delegation framework contracts are deployed
 * AND CoinFello infrastructure (RPC, backend) is configured. Using a chain
 * outside this set would result in permanently locked funds.
 */
const SUPPORTED_CHAINS_MAP: Record<number, string> = {
  1: 'Ethereum',
  10: 'OP Mainnet',
  56: 'BNB Smart Chain',
  137: 'Polygon',
  8453: 'Base',
  5000: 'Mantle',
  42161: 'Arbitrum One',
  59144: 'Linea',
  11155111: 'Sepolia (testnet)',
  84532: 'Base Sepolia (testnet)',
}

const SUPPORTED_CHAIN_IDS = new Set(Object.keys(SUPPORTED_CHAINS_MAP).map(Number))

export function getSupportedChainNames(): string[] {
  return Object.values(SUPPORTED_CHAINS_MAP)
}

export function printSupportedChainsWarning(): void {
  console.warn(
    `⚠️  Only fund this address on supported networks: ${getSupportedChainNames().join(', ')}.`
  )
  console.warn('   Funds sent on unsupported networks cannot be recovered.')
}

function assertChainSupported(chain: Chain): void {
  if (!SUPPORTED_CHAIN_IDS.has(chain.id)) {
    throw new Error(
      `Chain "${chain.name}" (ID: ${chain.id}) is not supported by CoinFello. ` +
        `Sending funds to a smart account on an unsupported chain will result in locked funds. ` +
        `Supported chains: ${getSupportedChainNames().join(', ')}.`
    )
  }
}

export async function createSmartAccount(
  privateKey: Hex,
  chainInput: string | number
): Promise<{ smartAccount: HybridSmartAccount; address: string; owner: PrivateKeyAccount }> {
  const chain = resolveChainInput(chainInput)
  const publicClient = createPublicClient(chain)

  const owner = privateKeyToAccount(privateKey)

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [owner.address, [], [], []],
    deploySalt: '0x',
    signer: { account: owner },
  })

  const address = await smartAccount.getAddress()
  return { smartAccount, address, owner }
}

export async function getSmartAccount(
  privateKey: Hex,
  chainInput: string | number
): Promise<HybridSmartAccount> {
  const { smartAccount } = await createSmartAccount(privateKey, chainInput)
  return smartAccount
}

export function createSubdelegation({
  smartAccount,
  delegateAddress,
  parentDelegation,
  scope,
}: {
  smartAccount: HybridSmartAccount
  delegateAddress: Hex
  parentDelegation?: Delegation
  scope: DelegationScope
}): Delegation {
  return createDelegation({
    scope,
    to: delegateAddress,
    from: smartAccount.address,
    parentDelegation,
    environment: smartAccount.environment,
    salt: `0x${randomBytes(32).toString('hex')}` as Hex,
  })
}

// ── Secure Enclave P256 account functions ────────────────────────

export async function createSmartAccountWithSecureEnclave(): Promise<{
  smartAccount: HybridSmartAccount
  address: string
  keyTag: string
  publicKeyX: string
  publicKeyY: string
  keyId: Hex
}> {
  const chain = resolveChainInput(1)
  const publicClient = createPublicClient(chain)

  // Generate P256 key in Secure Enclave
  const keyPair = await generateKey()

  // On-chain key identifier
  const keyId = `0x${randomBytes(32).toString('hex')}` as Hex

  // Encode uncompressed public key: 0x04 || x (32 bytes) || y (32 bytes)
  const xHex = keyPair.x.toString(16).padStart(64, '0')
  const yHex = keyPair.y.toString(16).padStart(64, '0')
  const publicKeyHex = `0x04${xHex}${yHex}` as Hex
  const credentialId = Buffer.from(keyPair.tag).toString('base64url')

  const webAuthnAccount = toWebAuthnAccount({
    credential: {
      id: credentialId,
      publicKey: publicKeyHex,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getFn: createSecureEnclaveGetFn(keyPair.tag) as any,
    rpId: 'localhost',
  })

  const smartAccount = await toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [
      '0x0000000000000000000000000000000000000000' as Hex,
      [keyId],
      [keyPair.x],
      [keyPair.y],
    ],
    deploySalt: '0x',
    signer: { webAuthnAccount, keyId },
  })

  const address = await smartAccount.getAddress()

  return {
    smartAccount,
    address,
    keyTag: keyPair.tag,
    publicKeyX: `0x${xHex}`,
    publicKeyY: `0x${yHex}`,
    keyId,
  }
}

export async function getSmartAccountFromSecureEnclave(
  keyTag: string,
  publicKeyX: string,
  publicKeyY: string,
  keyId: Hex,
  chainInput: string | number
): Promise<HybridSmartAccount> {
  const chain = resolveChainInput(chainInput)
  const publicClient = createPublicClient(chain)

  const xBigInt = BigInt(publicKeyX)
  const yBigInt = BigInt(publicKeyY)

  const xHex = xBigInt.toString(16).padStart(64, '0')
  const yHex = yBigInt.toString(16).padStart(64, '0')
  const publicKeyHex = `0x04${xHex}${yHex}` as Hex
  const credentialId = Buffer.from(keyTag).toString('base64url')

  const webAuthnAccount = toWebAuthnAccount({
    credential: {
      id: credentialId,
      publicKey: publicKeyHex,
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getFn: createSecureEnclaveGetFn(keyTag) as any,
    rpId: 'localhost',
  })

  return toMetaMaskSmartAccount({
    client: publicClient,
    implementation: Implementation.Hybrid,
    deployParams: [
      '0x0000000000000000000000000000000000000000' as Hex,
      [keyId],
      [xBigInt],
      [yBigInt],
    ],
    deploySalt: '0x',
    signer: { webAuthnAccount, keyId },
  })
}
