import { createPublicClient as viemCreatePublicClient, http, type Chain } from 'viem'

const INFURA_API_KEY = process.env.INFURA_API_KEY ?? 'b6bf7d3508c941499b10025c0776eaf8'

const INFURA_CHAIN_NAMES: Record<number, string> = {
  1: 'mainnet',
  11155111: 'sepolia',
  137: 'polygon-mainnet',
  80002: 'polygon-amoy',
  42161: 'arbitrum-mainnet',
  421614: 'arbitrum-sepolia',
  10: 'optimism-mainnet',
  11155420: 'optimism-sepolia',
  8453: 'base-mainnet',
  84532: 'base-sepolia',
  59144: 'linea-mainnet',
  59141: 'linea-sepolia',
  43114: 'avalanche-mainnet',
  43113: 'avalanche-fuji',
  56: 'bsc-mainnet',
  97: 'bsc-testnet',
}

export function createPublicClient(chain: Chain) {
  const infuraName = INFURA_CHAIN_NAMES[chain.id]
  const transport = infuraName
    ? http(`https://${infuraName}.infura.io/v3/${INFURA_API_KEY}`)
    : http()

  return viemCreatePublicClient({ chain, transport })
}
