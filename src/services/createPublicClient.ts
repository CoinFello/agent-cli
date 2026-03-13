import { createPublicClient as viemCreatePublicClient, http, type Chain, Transport } from 'viem'

// @dev quicknode base url and api key
const getBaseUrl = () => process.env.RPC_BASE_URL
const getApiKey = () => process.env.RPC_API_KEY

const QUICKNODE_SLUGS: Record<number, string> = {
  1: '',
  137: '.matic',
  56: '.bsc',
  59144: '.linea-mainnet',
  8453: '.base-mainnet',
  84532: '.base-sepolia',
  10: '.optimism',
  42161: '.arbitrum-mainnet',
  11155111: '.ethereum-sepolia',
}

/**
 * Returns an `http()` transport using the paid QuickNode RPC for the given chain.
 * Falls back to the default public RPC if the chain has no QuickNode endpoint configured.
 */
export function getChainTransport(chainId: number): Transport {
  // Local development/testing: route all RPC calls through local anvil
  if (process.env.ANVIL_RPC_URL) {
    return http(process.env.ANVIL_RPC_URL)
  }
  const slug = QUICKNODE_SLUGS[chainId]
  if (slug === undefined) {
    return http()
  }
  return http(`${getBaseUrl()}${slug}.quiknode.pro/${getApiKey()}`)
}

export function createPublicClient(chain: Chain) {
  const transport = getBaseUrl() && getApiKey() ? getChainTransport(chain.id) : http()

  return viemCreatePublicClient({ chain, transport })
}
