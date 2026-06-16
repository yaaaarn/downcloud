import { join } from "path";
import { secrets } from "bun";
import { Command } from "commander";

const userAgent = "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)";
const CACHE_FILE = join(process.env.HOME || ".", ".downcloud_client_id");

interface Transcoding {
  url: string;
  format: { protocol: string; mime_type: string };
}

interface Track {
  id: number;
  title: string;
  downloadable: boolean;
  has_downloads_left: boolean;
  user: { username: string; permalink: string; };
  permalink: string;
  media: { transcodings: Transcoding[] };
  publisher_metadata: {
    artist: string,
    explicit: boolean
  },
  waveform_url?: string;
}

interface Hydration {
  hydratable: string;
  data: Track;
}

function startSpinner(message: string) {
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;

  process.stdout.write("\x1b[?25l");
  process.stdout.write(`${frames[0]} ${message}`);

  const timer = setInterval(() => {
    process.stdout.write(`\r${frames[i++ % frames.length]} ${message}`);
  }, 80);

  return {
    stop: () => {
      clearInterval(timer);
      process.stdout.write("\r\x1b[K\x1b[?25h");
    }
  };
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
      return match[1];
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

async function printAsciiWaveform(waveformUrl: string) {
  try {
    const res = await fetch(waveformUrl);
    if (!res.ok) return;

    const { samples } = await res.json() as { samples: number[] };
    if (!samples || samples.length === 0) return;

    const targetWidth = 75;
    const maxVal = Math.max(...samples) || 1;

    const compressed: number[] = [];
    const chunkSize = Math.ceil(samples.length / targetWidth);

    for (let i = 0; i < samples.length; i += chunkSize) {
      const chunk = samples.slice(i, i + chunkSize);
      const avg = chunk.reduce((sum, v) => sum + v, 0) / chunk.length;
      compressed.push(avg);
    }

    const topSet = [" ", "▖", "▌"];
    const botSet = [" ", "▘", "▌"];

    const topRow = compressed
      .map(v => {
        const norm = v / maxVal;
        const index = Math.min(Math.floor(norm * topSet.length), topSet.length - 1);
        return topSet[index];
      })
      .join("");

    const bottomRow = compressed
      .map(v => {
        const norm = v / maxVal;
        const index = Math.min(Math.floor(norm * botSet.length), botSet.length - 1);
        return botSet[index];
      })
      .join("");

    const hexDarkGrey = "\x1b[38;2;85;85;85m";
    const resetColor = "\x1b[0m";

    console.log()
    console.log(topRow);
    console.log(`${hexDarkGrey}${bottomRow}${resetColor}\n`);

  } catch (e) { }
}

async function saveAudio(streamUrl: string, isDownload: boolean, customOutFile: string | undefined, user: any, permalink: string, mimeType?: string, debug?: boolean) {
  let format = "";

  if (isDownload) {
    const head = await fetch(streamUrl, { method: "HEAD" });
    format = head.headers.get("content-type") || "";
  } else if (mimeType) {
    format = mimeType;
  }

  let outFile = customOutFile;
  const isDefaultName = !outFile;
  if (isDefaultName) {
    outFile = `${user.permalink}_${permalink}`;
  }

  let cmd;

  if (format.includes("flac")) {
    if (isDefaultName) outFile += ".flac";
    cmd = Bun.$`ffmpeg -i ${streamUrl} -c copy -y ${outFile}`;
  } else if (format.includes("wav") || format.includes("x-wav") || format.includes("aiff")) {
    if (isDefaultName) outFile += ".flac";
    cmd = Bun.$`ffmpeg -i ${streamUrl} -c:a flac -compression_level 8 -map_metadata 0 -y ${outFile}`;
  } else {
    if (isDefaultName) outFile += ".m4a";
    cmd = Bun.$`ffmpeg -i ${streamUrl} -c copy -movflags +faststart -y ${outFile}`;
  }

  if (!debug) cmd = cmd.quiet();

  const spinner = !debug ? startSpinner("downloading...") : null;

  try {
    await cmd;
  } finally {
    if (spinner) spinner.stop();
  }

  console.log(`saved to ${outFile}`);
}

const program = new Command();

program
  .name("downcloud")
  .description("a simple (and fast) soundcloud downloader")
  .version("1.0.0");

program
  .command("set-token")
  .description("save a soundcloud oauth token into your keyring")
  .argument("<token>", "soundcloud oauth token")
  .action(async (tokenArg) => {
    await secrets.set({
      service: "downcloud",
      name: "soundcloud-oauth-token",
      value: tokenArg,
    });
    console.log("soundcloud oauth token saved in keyring");
    process.exit(0);
  });

program
  .command("track")
  .description("download a track")
  .argument("<url>", "track url")
  .argument("[outfile]", "path to save output file")
  .option("-t, --token <string>", "use a temporary soundcloud oauth token")
  .option("--debug", "print ffmpeg execution logs", false)
  .action(async (trackUrl, customOutFile, options) => {
    const debug = options.debug;

    let oauthToken = options.token;
    if (!oauthToken) {
      oauthToken = await secrets.get({
        service: "downcloud",
        name: "soundcloud-oauth-token",
      }) || undefined;
    }

    const html = await fetch(trackUrl, {
      headers: { "User-Agent": userAgent, "Accept-Language": "en-US" },
    }).then(r => r.text());

    let clientId = process.env.SOUNDCLOUD_CLIENT_ID;
    const cacheFile = Bun.file(CACHE_FILE);
    if (!clientId && await cacheFile.exists()) {
      clientId = await cacheFile.text();
    }

    if (!clientId) {
      const assetRegex = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
      const assetUrls = Array.from(html.matchAll(assetRegex), m => m[1]);

      clientId = await findClientId(assetUrls.filter(x => x != null));

      if (clientId) {
        await cacheFile.write(clientId);
      }
    }

    if (!clientId) throw new Error("could not find client_id");

    const hydrationMatch = html.match(
      /window\.__sc_hydration\s*=\s*(\[[\s\S]*?\]);/
    );

    if (!hydrationMatch?.[1]) throw new Error("could not find hydration data");

    const hydration = JSON.parse(hydrationMatch[1]) as Hydration[];
    const soundHydration = hydration.find(e => e.hydratable === "sound");
    if (!soundHydration) throw new Error("no track found");

    const { id, title, publisher_metadata, media, user, permalink, downloadable, has_downloads_left, waveform_url } = soundHydration.data;
    console.log(`${title} — ${publisher_metadata.artist}`);

    if (downloadable && has_downloads_left && !oauthToken) {
      console.warn("this track is downloadable, provide an oauth_token to download original file.");
    }

    console.log();

    let streamUrl: string | undefined;
    let isDownload = false;
    let mimeType: string | undefined;

    if (downloadable && has_downloads_left && oauthToken) {
      const res = await fetch(`https://api-v2.soundcloud.com/tracks/${id}/download?client_id=${clientId}`, {
        headers: { Authorization: `OAuth ${oauthToken}`, "User-Agent": userAgent },
      });

      if (res.ok) {
        const { redirectUri } = await res.json() as { redirectUri?: string };
        if (redirectUri) {
          streamUrl = redirectUri;
          isDownload = true;
        }
      }
    }

    if (!streamUrl) {
      const hls = media.transcodings.find(t => t.format.protocol === "hls" && t.format.mime_type.includes("fmp4"))
        ?? media.transcodings.find(t => t.format.protocol === "hls");
      if (!hls) throw new Error("no hls stream found");
      mimeType = hls.format.mime_type;
      streamUrl = (await fetch(`${hls.url}?client_id=${clientId}`).then(r => r.json()) as { url: string }).url;
    }

    await saveAudio(streamUrl, isDownload, customOutFile, user, permalink, mimeType, debug);

    if (waveform_url) {
      await printAsciiWaveform(waveform_url);
    }
  });

await program.parseAsync(Bun.argv);
