const BASE_URL = "https://app.coinfello.com/api/v1";

export async function getCoinFelloAddress(): Promise<string> {
  const response = await fetch(`${BASE_URL}/coinfello-address`);

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to get CoinFello address (${response.status}): ${text}`);
  }

  const data = (await response.json()) as { address: string };
  return data.address;
}

export interface ToolCall {
  type: "function_call";
  arguments: string;
  name: string;
  callId: string;
}

export interface ConversationResponse {
  txn_id?: string;
  toolCalls?: ToolCall[];
}

export interface SendConversationParams {
  prompt: string;
  smartAccountAddress: string;
  signedSubdelegation?: unknown;
}

export async function sendConversation({
  prompt,
  signedSubdelegation,
  smartAccountAddress,
}: SendConversationParams): Promise<ConversationResponse> {
  const body: Record<string, unknown> = {
    prompt,
    smart_account_address: smartAccountAddress,
  };
  if (signedSubdelegation !== undefined) {
    body.signed_subdelegation = signedSubdelegation;
  }

  const response = await fetch(`${BASE_URL}/conversation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Conversation request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<ConversationResponse>;
}

export async function getTransactionStatus(
  txnId: string
): Promise<Record<string, unknown>> {
  const response = await fetch(
    `${BASE_URL}/transaction_status?txn_id=${encodeURIComponent(txnId)}`
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Transaction status request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}
