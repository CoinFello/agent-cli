import {
  Implementation,
  toMetaMaskSmartAccount,
  createDelegation,
  type ToMetaMaskSmartAccountReturnType,
  type Delegation,
} from '@metamask/smart-accounts-kit'
import { PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, type Hex, type Chain } from 'viem'
import * as chains from 'viem/chains'

export type HybridSmartAccount = ToMetaMaskSmartAccountReturnType<Implementation.Hybrid>

export function resolveChain(chainName: string): Chain {
  const chain = (chains as Record<string, Chain | undefined>)[chainName]
  if (!chain) {
    throw new Error(
      `Unknown chain "${chainName}". Use a viem chain name (e.g. sepolia, mainnet, polygon, arbitrum).`
    )
  }
  return chain
}

export async function createSmartAccount(
  privateKey: Hex,
  chainName: string
): Promise<{ smartAccount: HybridSmartAccount; address: string; owner: PrivateKeyAccount }> {
  const chain = resolveChain(chainName)

  const publicClient = createPublicClient({
    chain,
    transport: http(),
  })

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
  chainName: string
): Promise<HybridSmartAccount> {
  const { smartAccount } = await createSmartAccount(privateKey, chainName)
  return smartAccount
}

export function createSubdelegation({
  smartAccount,
  delegateAddress,
  parentDelegation,
  tokenAddress,
  maxAmount,
}: {
  smartAccount: HybridSmartAccount
  delegateAddress: Hex
  parentDelegation?: Delegation
  tokenAddress: Hex
  maxAmount: bigint
}): Delegation {
  return createDelegation({
    scope: {
      type: 'erc20TransferAmount',
      tokenAddress,
      maxAmount,
    },
    to: delegateAddress,
    from: smartAccount.address,
    parentDelegation,
    environment: smartAccount.environment,
  })
}
