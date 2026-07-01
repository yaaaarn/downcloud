import { userAgent } from "./constants";

export async function resolveUrl(url: string, clientId: string, oauthToken?: string): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
    { headers: { "User-Agent": userAgent, Authorization: oauthToken != null ? `OAuth ${oauthToken}` : '' } },
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}
