const BASE_URL = "https://app.coinfello.com/api/v1";

export async function getSubdelegation(
  prompt: string,
  smartAccountAddress: string,
  delegation: string
): Promise<Record<string, unknown>> {
  const response = await fetch(`${BASE_URL}/subdelegation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      smart_account_address: smartAccountAddress,
      delegation,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Subdelegation request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<Record<string, unknown>>;
}

export interface SendConversationParams {
  prompt: string;
  subdelegation: unknown;
  signature: string;
  smartAccountAddress: string;
  delegation: string;
}

export async function sendConversation({
  prompt,
  subdelegation,
  signature,
  smartAccountAddress,
  delegation,
}: SendConversationParams): Promise<{ txn_id: string }> {
  const response = await fetch(`${BASE_URL}/conversation`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      subdelegation,
      signature,
      smart_account_address: smartAccountAddress,
      delegation,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Conversation request failed (${response.status}): ${text}`);
  }

  return response.json() as Promise<{ txn_id: string }>;
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
