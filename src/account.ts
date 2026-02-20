import {
  Implementation,
  toMetaMaskSmartAccount,
  createDelegation,
  type ToMetaMaskSmartAccountReturnType,
  type Delegation,
  type CreateDelegationOptions,
} from '@metamask/smart-accounts-kit'
import { PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { createPublicClient, http, type Hex, type Chain } from 'viem'
import * as chains from 'viem/chains'

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
  if (typeof chainInput === 'number') {
    return resolveChainById(chainInput)
  }
  return resolveChain(chainInput)
}

export async function createSmartAccount(
  privateKey: Hex,
  chainInput: string | number
): Promise<{ smartAccount: HybridSmartAccount; address: string; owner: PrivateKeyAccount }> {
  const chain = resolveChainInput(chainInput)

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
  })
}
