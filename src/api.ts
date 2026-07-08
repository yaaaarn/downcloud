import { userAgent } from "./constants";
import type { Track, ArtistData } from "./types";

export async function resolveUrl(url: string, clientId: string, oauthToken?: string): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
    { headers: { "User-Agent": userAgent, Authorization: oauthToken != null ? `OAuth ${oauthToken}` : '' } },
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
}

export async function fetchArtistTracks(url: string, clientId: string, oauthToken?: string): Promise<ArtistData> {
  const resolved = await resolveUrl(url, clientId, oauthToken) as Record<string, unknown>;
  const user = { id: resolved.id as number, username: resolved.username as string, permalink: resolved.permalink as string };

  const tracks: Track[] = [];
  let nextUrl: string | null = `https://api-v2.soundcloud.com/users/${user.id}/tracks?client_id=${clientId}&limit=50`;

  while (nextUrl) {
    const res = await fetch(nextUrl, {
      headers: { "User-Agent": userAgent, Authorization: oauthToken != null ? `OAuth ${oauthToken}` : '' },
    }); 
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const data = await res.json() as { collection: Track[]; next_href?: string };
    tracks.push(...data.collection);
    nextUrl = data.next_href ?? null;
    
    if (nextUrl != null) {
      const url = new URL(nextUrl)
      url.searchParams.append('client_id', clientId)
      nextUrl = url.toString()
    } 
  }

  return { user, tracks };
}
