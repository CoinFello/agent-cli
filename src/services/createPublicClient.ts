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
  5000: '.mantle-mainnet',
  42161: '.arbitrum-mainnet',
  11155111: '.ethereum-sepolia',
}

/**
 * Returns the best available RPC transport for the given chain.
 * Priority: RPC_URL_OVERRIDE > QuickNode > default public RPC.
 */
export function getChainTransport(chainId: number): Transport {
  if (process.env.RPC_URL_OVERRIDE) {
    return http(process.env.RPC_URL_OVERRIDE)
  }

  if (getBaseUrl() && getApiKey()) {
    const slug = QUICKNODE_SLUGS[chainId]
    if (slug !== undefined) {
      return http(`${getBaseUrl()}${slug}.quiknode.pro/${getApiKey()}`)
    }
  }

  return http()
}

export function createPublicClient(chain: Chain) {
  return viemCreatePublicClient({ chain, transport: getChainTransport(chain.id) })
}
