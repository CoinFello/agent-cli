import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { serializeErc6492Signature, type Hex } from 'viem'
import {
  getSmartAccount,
  getSmartAccountFromSecureEnclave,
  createSubdelegation,
  resolveChainInput,
  type HybridSmartAccount,
} from './account.js'
import { getCoinFelloAddress, sendConversation, type ConversationResponse } from './api.js'
import { CONFIG_DIR, type Config, saveConfig } from './config.js'
import { parseScope } from './scope.js'
import type { RawScope } from './scope.js'
import { SignedSubdelegation } from './types.js'
import { createPublicClient } from './services/createPublicClient.js'

// ── Pending delegation file ────────────────────────────────────

export const PENDING_DELEGATION_PATH = join(CONFIG_DIR, 'pending_delegation.json')

export interface PendingDelegationRequest {
  delegationArgs: {
    chainId: string | number
    scope: RawScope
    [key: string]: unknown
    justification?: string
  }
  callId: string
  chatId: string
  originalPrompt: string
  createdAt: string
  description: string
}

export async function savePendingDelegation(request: PendingDelegationRequest): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(PENDING_DELEGATION_PATH, JSON.stringify(request, null, 2), 'utf-8')
}

export async function loadPendingDelegation(): Promise<PendingDelegationRequest> {
  try {
    const raw = await readFile(PENDING_DELEGATION_PATH, 'utf-8')
    return JSON.parse(raw) as PendingDelegationRequest
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(
        "No pending delegation request found. Run 'send_prompt' first to generate a delegation request."
      )
    }
    throw err
  }
}

export async function clearPendingDelegation(): Promise<void> {
  try {
    await unlink(PENDING_DELEGATION_PATH)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
  }
}

// ── Display formatting ─────────────────────────────────────────

export function formatDelegationRequestForDisplay(request: PendingDelegationRequest): string {
  const { delegationArgs, callId, chatId, originalPrompt, createdAt } = request
  const scope = delegationArgs.scope
  const justification = delegationArgs.justification

  const lines: string[] = [
    '=== Delegation Request ===',
    `Scope type: ${scope.type}`,
    `Chain ID: ${delegationArgs.chainId}`,
  ]

  if (scope.tokenAddress) lines.push(`Token address: ${scope.tokenAddress}`)
  if (scope.maxAmount) lines.push(`Max amount: ${scope.maxAmount}`)
  if (scope.periodAmount) lines.push(`Period amount: ${scope.periodAmount}`)
  if (scope.periodDuration) lines.push(`Period duration: ${scope.periodDuration}`)
  if (scope.startDate) lines.push(`Start date: ${scope.startDate}`)
  if (scope.initialAmount) lines.push(`Initial amount: ${scope.initialAmount}`)
  if (scope.amountPerSecond) lines.push(`Amount per second: ${scope.amountPerSecond}`)
  if (scope.startTime) lines.push(`Start time: ${scope.startTime}`)
  if (scope.tokenId) lines.push(`Token ID: ${scope.tokenId}`)
  if (scope.targets?.length) lines.push(`Targets: ${scope.targets.join(', ')}`)
  if (scope.selectors?.length) lines.push(`Selectors: ${scope.selectors.join(', ')}`)
  if (scope.valueLte?.maxValue) lines.push(`Value <= ${scope.valueLte.maxValue}`)

  lines.push(`Original prompt: "${originalPrompt}"`)
  if (justification) {
    lines.push(`Justification: "${justification}"`)
  }
  lines.push(`Requested at: ${createdAt}`)
  lines.push(`Chat ID: ${chatId}`)
  lines.push(`Call ID: ${callId}`)
  lines.push('==========================')

  return lines.join('\n')
}

// ── Shared response handling ───────────────────────────────────

/**
 * Handles a ConversationResponse uniformly — used by both send_prompt
 * and approve_delegation_request so that chained delegation requests
 * are handled identically.
 *
 * Returns true if the response was fully handled, false otherwise.
 */
export async function handleConversationResponse(
  response: ConversationResponse,
  config: Config,
  originalPrompt: string
): Promise<void> {
  if (response.chatId && response.chatId !== config.chat_id) {
    config.chat_id = response.chatId
    await saveConfig(config)
  }

  // Read-only response
  if (!response.clientToolCalls?.length && !response.txn_id) {
    console.log(response.responseText ?? '')
    return
  }

  // Direct transaction (no delegation needed)
  if (response.txn_id && !response.clientToolCalls?.length) {
    console.log('Transaction submitted successfully.')
    console.log(`Transaction ID: ${response.txn_id}`)
    return
  }

  // Delegation requested — save for review instead of auto-approving
  const delegationToolCall = response.clientToolCalls?.find(
    (tc) => tc.name === 'ask_for_delegation'
  )
  if (!delegationToolCall) {
    console.error('Error: No delegation request received from the server.')
    console.log('Response:', JSON.stringify(response, null, 2))
    process.exit(1)
  }

  /* eslint-disable-next-line */
  const args = JSON.parse(delegationToolCall.arguments) as any
  const pending = {
    delegationArgs: args,
    callId: delegationToolCall.callId,
    chatId: response.chatId ?? config.chat_id ?? '',
    originalPrompt,
    createdAt: new Date().toISOString(),
    description: `Delegation for scope=${args.scope?.type}, chainId=${args.chainId}`,
  }

  await savePendingDelegation(pending)

  console.log(formatDelegationRequestForDisplay(pending))
  console.log(`Delegation request saved to: ${PENDING_DELEGATION_PATH}`)
  console.log("Run 'approve_delegation_request' to sign and submit this delegation.")
}

// ── Shared signing & submission ────────────────────────────────

export async function signAndSubmitDelegation(
  config: Config,
  pending: PendingDelegationRequest
): Promise<ConversationResponse> {
  const { delegationArgs, callId, chatId } = pending

  // 1. Get CoinFello delegate address
  console.log('Fetching CoinFello delegate address...')
  const delegateAddress = await getCoinFelloAddress()

  // 2. Load smart account for the requested chain
  console.log('Loading smart account...')
  let smartAccount: HybridSmartAccount
  if (config.signer_type === 'secureEnclave') {
    if (!config.secure_enclave) {
      throw new Error("Secure Enclave config missing. Run 'create_account' first.")
    }
    smartAccount = await getSmartAccountFromSecureEnclave(
      config.secure_enclave.key_tag,
      config.secure_enclave.public_key_x,
      config.secure_enclave.public_key_y,
      config.secure_enclave.key_id as Hex,
      delegationArgs.chainId
    )
  } else {
    smartAccount = await getSmartAccount(config.private_key as Hex, delegationArgs.chainId)
  }

  // 3. Parse scope and create subdelegation
  const scope = parseScope(delegationArgs.scope)
  console.log('Creating subdelegation...')
  const subdelegation = createSubdelegation({
    smartAccount,
    delegateAddress: delegateAddress as Hex,
    scope,
  })

  // 4. Sign the subdelegation
  console.log('Signing subdelegation...')
  const signature = await smartAccount.signDelegation({ delegation: subdelegation })
  let sig = signature

  // 5. Wrap with ERC-6492 if account is not deployed
  const chain = resolveChainInput(delegationArgs.chainId)
  const publicClient = createPublicClient(chain)
  const code = await publicClient.getCode({ address: smartAccount.address })
  const isDeployed = !!(code && code !== '0x')
  if (!isDeployed) {
    const factoryArgs = await smartAccount.getFactoryArgs()
    if (factoryArgs.factory && factoryArgs.factoryData) {
      sig = serializeErc6492Signature({
        signature,
        address: factoryArgs.factory as `0x${string}`,
        data: factoryArgs.factoryData as `0x${string}`,
      })
    }
  }

  const signedSubdelegation: SignedSubdelegation = { ...subdelegation, signature: sig }

  // 6. Send signed delegation back to conversation endpoint
  console.log('Sending signed delegation...')
  return sendConversation({
    prompt: 'Please refer to the previous conversation messages and redeem this delegation.',
    signedSubdelegation,
    chatId,
    delegationArguments: JSON.stringify(delegationArgs),
    callId,
  })
}
