import type { Hex } from 'viem'
import type { DelegationScope } from './account.js'

export interface RawScope {
  type: string
  tokenAddress?: string
  maxAmount?: string
  periodAmount?: string
  periodDuration?: number
  startDate?: number
  initialAmount?: string
  amountPerSecond?: string
  startTime?: number
  tokenId?: string
  targets?: string[]
  selectors?: string[]
}

export function parseScope(raw: RawScope): DelegationScope {
  switch (raw.type) {
    case 'erc20TransferAmount':
      return {
        type: 'erc20TransferAmount',
        tokenAddress: raw.tokenAddress! as Hex,
        maxAmount: BigInt(raw.maxAmount!),
      }

    case 'erc20PeriodTransfer':
      return {
        type: 'erc20PeriodTransfer',
        tokenAddress: raw.tokenAddress! as Hex,
        periodAmount: BigInt(raw.periodAmount!),
        periodDuration: raw.periodDuration!,
        startDate: raw.startDate!,
      }

    case 'erc20Streaming':
      return {
        type: 'erc20Streaming',
        tokenAddress: raw.tokenAddress! as Hex,
        initialAmount: BigInt(raw.initialAmount!),
        maxAmount: BigInt(raw.maxAmount!),
        amountPerSecond: BigInt(raw.amountPerSecond!),
        startTime: raw.startTime!,
      }

    case 'nativeTokenTransferAmount':
      return {
        type: 'nativeTokenTransferAmount',
        maxAmount: BigInt(raw.maxAmount!),
      }

    case 'nativeTokenPeriodTransfer':
      return {
        type: 'nativeTokenPeriodTransfer',
        periodAmount: BigInt(raw.periodAmount!),
        periodDuration: raw.periodDuration!,
        startDate: raw.startDate!,
      }

    case 'nativeTokenStreaming':
      return {
        type: 'nativeTokenStreaming',
        initialAmount: BigInt(raw.initialAmount!),
        maxAmount: BigInt(raw.maxAmount!),
        amountPerSecond: BigInt(raw.amountPerSecond!),
        startTime: raw.startTime!,
      }

    case 'erc721Transfer':
      return {
        type: 'erc721Transfer',
        tokenAddress: raw.tokenAddress! as Hex,
        tokenId: BigInt(raw.tokenId!),
      }

    case 'functionCall':
      return {
        type: 'functionCall',
        targets: (raw.targets ?? []).map((t) => t as Hex),
        selectors: (raw.selectors ?? []).map((s) => s as Hex),
      }

    default:
      throw new Error(`Unsupported delegation scope type: "${raw.type}"`)
  }
}
