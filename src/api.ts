const BASE_URL = 'https://app.coinfello.com/api/v1'

export async function getCoinFelloAddress(): Promise<string> {
  const response = await fetch(`${BASE_URL}/coinfello-address`)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Failed to get CoinFello address (${response.status}): ${text}`)
  }

  const data = (await response.json()) as { address: string }
  return data.address
}

export interface SendConversationParams {
  prompt: string
  signedSubdelegation: unknown
  smartAccountAddress: string
}

export async function sendConversation({
  prompt,
  signedSubdelegation,
  smartAccountAddress,
}: SendConversationParams): Promise<{ txn_id: string }> {
  const response = await fetch(`${BASE_URL}/conversation`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt,
      signed_subdelegation: signedSubdelegation,
      smart_account_address: smartAccountAddress,
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Conversation request failed (${response.status}): ${text}`)
  }

  return response.json() as Promise<{ txn_id: string }>
}

export async function getTransactionStatus(txnId: string): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/transaction_status?txn_id=${encodeURIComponent(txnId)}`)

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Transaction status request failed (${response.status}): ${text}`)
  }

  return response.json() as Promise<Record<string, unknown>>
}
