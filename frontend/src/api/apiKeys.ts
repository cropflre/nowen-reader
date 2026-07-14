import { apiClient } from "@/lib/apiClient";

export interface APIKeyRecord {
  id: string;
  userId: string;
  name: string;
  keyPrefix: string;
  expiresAt: string | null;
  lastUsedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
}

export async function listAPIKeys(): Promise<APIKeyRecord[]> {
  const response = await apiClient.get<{ apiKeys: APIKeyRecord[] }>("/api/auth/api-keys");
  return response.apiKeys;
}

export async function createAPIKey(input: {
  name: string;
  currentPassword: string;
  expiresInDays: number;
}): Promise<{ apiKey: APIKeyRecord; key: string }> {
  return apiClient.post("/api/auth/api-keys", input);
}

export async function revokeAPIKey(id: string): Promise<void> {
  await apiClient.delete(`/api/auth/api-keys/${encodeURIComponent(id)}`);
}

export async function revokeAllAPIKeys(currentPassword: string): Promise<number> {
  const response = await apiClient.delete<{ revokedCount: number }>("/api/auth/api-keys", {
    currentPassword,
  });
  return response.revokedCount;
}
