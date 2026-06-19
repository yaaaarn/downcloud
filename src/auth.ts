import { secrets } from "bun";
import { userAgent, CACHE_FILE } from "./constants";

export async function resolveOauthToken(tokenOption?: string): Promise<string | undefined> {
  let token = tokenOption || process.env.SOUNDCLOUD_OAUTH_TOKEN;
  try {
    if (!token) {
      token = (await secrets.get({
        service: "downcloud",
        name: "soundcloud-oauth-token",
      })) || undefined;
    }
  } catch {
    token = undefined;
  }
  return token;
}

async function findClientIdInAsset(url: string, signal: AbortSignal) {
  const res = await fetch(url, { signal });
  if (!res.body) return null;

  const reader = res.body.getReader();
  const decoder = new TextDecoder();

  let chunk = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    chunk += decoder.decode(value, { stream: true });

    const match = chunk.match(/client_id:"([a-zA-Z0-9]+)"/);
    if (match) {
      return match[1]!;
    }

    if (chunk.length > 10000) {
      chunk = chunk.slice(-5000);
    }
  }

  return null;
}

async function findClientId(urls: string[]) {
  const controller = new AbortController();

  return Promise.any(
    urls.map(async (url) => {
      const match = await findClientIdInAsset(url, controller.signal);
      if (match) {
        controller.abort();
        return match;
      }
      throw new Error("not found");
    })
  );
}

export async function resolveClientId(): Promise<string> {
  let clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const cacheFile = Bun.file(CACHE_FILE);
  if (!clientId && await cacheFile.exists()) {
    clientId = await cacheFile.text();
  }
  if (clientId) return clientId;

  const html = await fetch("https://soundcloud.com", {
    headers: { "User-Agent": userAgent },
  }).then(r => r.text());

  const re = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
  const assetUrls: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    assetUrls.push(m[1]!);
  }
  clientId = await findClientId(assetUrls);
  if (!clientId) throw new Error("could not find client_id");
  await cacheFile.write(clientId);
  return clientId;
}
