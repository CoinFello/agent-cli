import { fetchWithCookies } from './cookies.js'
import { SignedSubdelegation } from './types.js'

export const BASE_URL =
  process.env.COINFELLO_BASE_URL || 'https://app.coinfello.com/'
export const BASE_URL_V1 = BASE_URL + 'api/v1'

export async function getCoinFelloAddress(): Promise<string> {
  const response = await fetchWithCookies(`${BASE_URL_V1}/automation/coinfello-address`)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to get CoinFello address (${response.status}): ${text}`)
  }

  const data = (await response.json()) as { address: string }
  return data.address
}

export interface CoinFelloAgent {
  id: number
  name: string
}

export async function getCoinFelloAgents(): Promise<CoinFelloAgent[]> {
  const response = await fetchWithCookies(`${BASE_URL_V1}/automation/coinfello-agents`)

  if (!response.ok) {
    const text = await response.text()
    console.error(`Error getting CoinFello agents ${text}`)
    throw new Error(`Failed to get CoinFello agents (${response.status}): ${text}`)
  }

  const data = (await response.json()) as { availableAgents: CoinFelloAgent[] }
  return data.availableAgents
}

export interface ToolCall {
  type: 'function_call'
  arguments: string
  name: string
  callId: string
}

export interface ConversationResponse {
  responseText?: string
  txn_id?: string
  clientToolCalls?: ToolCall[]
  chatId?: string | null
}

export interface SendConversationParams {
  prompt: string
  signedSubdelegation?: SignedSubdelegation
  chatId?: string | null
  /* eslint-disable-next-line */
  delegationArguments?: any
  callId?: string
}

export async function sendConversation({
  prompt,
  signedSubdelegation,
  chatId,
  delegationArguments,
  callId,
}: SendConversationParams): Promise<ConversationResponse> {
  const agents = await getCoinFelloAgents()
  const body: Record<string, unknown> = {
    inputMessage: prompt,
    stream: false,
  }
  if (agents.length) {
    body.agentId = agents[0].id
  }
  if (signedSubdelegation !== undefined) {
    body.clientToolCallResponse = {
      output: JSON.stringify({
        success: true,
        delegation: signedSubdelegation,
        chainId: delegationArguments ? JSON.parse(delegationArguments).chainId : undefined,
      }),
      type: 'function_call_output',
      callId: callId,
      name: 'ask_for_delegation',
      arguments: delegationArguments,
    }
  }
  if (chatId) {
    body.chatId = chatId
  }

  const response = await fetchWithCookies(`${BASE_URL}api/conversation`, {
    method: 'POST',
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Conversation request failed (${response.status}): ${text}`)
  }

  return response.json() as Promise<ConversationResponse>
}

export async function getTransactionStatus(txnId: string): Promise<Record<string, unknown>> {
  const response = await fetchWithCookies(
    `${BASE_URL_V1}/transaction_status?txn_id=${encodeURIComponent(txnId)}`
  )

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Transaction status request failed (${response.status}): ${text}`)
  }

  return response.json() as Promise<Record<string, unknown>>
}
