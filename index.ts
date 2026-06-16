import { join } from "path";
import { mkdir } from "node:fs/promises";
import { secrets } from "bun";
import { Command } from "commander";
import chalk from "chalk";

const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.114 Safari/537.36";
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
  duration?: number;
}

async function resolveClientId(): Promise<string> {
  let clientId = process.env.SOUNDCLOUD_CLIENT_ID;
  const cacheFile = Bun.file(CACHE_FILE);
  if (!clientId && await cacheFile.exists()) {
    clientId = await cacheFile.text();
  }
  if (clientId) return clientId;

  const html = await fetch("https://soundcloud.com", {
    headers: { "User-Agent": userAgent },
  }).then(r => r.text());

  const assetRegex = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
  const assetUrls = Array.from(html.matchAll(assetRegex), m => m[1]);
  clientId = await findClientId(assetUrls.filter(x => x != null));
  if (!clientId) throw new Error("could not find client_id");
  await cacheFile.write(clientId);
  return clientId;
}

async function resolveUrl(url: string, clientId: string): Promise<any> {
  const res = await fetch(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
    { headers: { "User-Agent": userAgent } },
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json();
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

    console.log()
    console.log(topRow);
    console.log(`${chalk.hex("#555555")(bottomRow)}\n`);

  } catch (e) { }
}

async function saveAudio(streamUrl: string, isDownload: boolean, customOutFile: string | undefined, user: any, permalink: string, mimeType?: string, debug?: boolean, outDir?: string, duration?: number, waveformUrl?: string) {
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
    if (outDir) outFile = join(outDir, outFile);
  }

  let args: string[];

  if (format.includes("flac")) {
    if (isDefaultName) outFile += ".flac";
    args = ["ffmpeg", "-i", streamUrl, "-c", "copy", "-y", outFile!];
  } else if (format.includes("wav") || format.includes("x-wav") || format.includes("aiff")) {
    if (isDefaultName) outFile += ".flac";
    args = ["ffmpeg", "-i", streamUrl, "-c:a", "flac", "-compression_level", "8", "-map_metadata", "0", "-y", outFile!];
  } else {
    if (isDefaultName) outFile += ".m4a";
    args = ["ffmpeg", "-i", streamUrl, "-c", "copy", "-movflags", "+faststart", "-y", outFile!];
  }

  const bright = chalk.hex("#E64D16");
  const pastel = chalk.hex("#FF9E6A");
  const dim = chalk.hex("#555555");
  const dimmer = chalk.hex("#666666");

  let samples: number[] | undefined;
  if (!debug && waveformUrl) {
    try {
      const res = await fetch(waveformUrl);
      if (res.ok) {
        const { samples: raw } = await res.json() as { samples: number[] };
        if (raw?.length) {
          const targetWidth = 75;
          const chunkSize = Math.ceil(raw.length / targetWidth);
          const compressed: number[] = [];
          for (let i = 0; i < raw.length; i += chunkSize) {
            const chunk = raw.slice(i, i + chunkSize);
            compressed.push(chunk.reduce((s, v) => s + v, 0) / chunk.length);
          }
          const maxVal = Math.max(...compressed) || 1;
          samples = compressed.map(v => v / maxVal);
        }
      }
    } catch {}
  }

  if (debug) {
    const proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
    await proc.exited;
    if (waveformUrl) {
      await printAsciiWaveform(waveformUrl);
    }
    console.log(`saved to ${outFile}`);
    return;
  }

  args.push("-progress", "pipe:1", "-loglevel", "quiet");

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

  process.stdout.write("\x1b[?25l");

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  const topSetW = [" ", "▖", "▌"];
  const botSetW = [" ", "▘", "▌"];

  let elapsed = 0;

  const fmt = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };

  const draw = (pct: number) => {
    const timeStr = duration ? `${fmt(elapsed)} / ${fmt(duration)}` : `${Math.round(pct * 100)}%`;

    if (!samples) {
      process.stdout.write(`\r\x1b[K${timeStr}\n\x1b[K${bright("▌".repeat(Math.max(0, Math.floor(pct * 75) - 1)))}\x1b[A`);
      return;
    }

    const width = 75;
    let topLine = "";
    let botLine = "";
    for (let i = 0; i < width; i++) {
      const val = samples[Math.floor((i / width) * samples.length)] || 0;
      const topChar = topSetW[val > 0.66 ? 2 : val > 0.33 ? 1 : 0];
      const botChar = botSetW[val > 0.66 ? 2 : val > 0.33 ? 1 : 0];
      if (i / width < pct) {
        topLine += bright(topChar);
        botLine += pastel(botChar);
      } else {
        topLine += dim(topChar);
        botLine += dimmer(botChar);
      }
    }
    process.stdout.write(`\r\x1b[K${timeStr}\n\x1b[K${topLine}\n\x1b[K${botLine}\x1b[A\x1b[A`);
  };

  draw(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    if (duration) {
      const m = buf.match(/out_time=(\d+):(\d+):(\d+)\.(\d+)/);
      if (m) {
        const cur = ((+m[1]! * 60 + +m[2]!) * 60 + +m[3]!) * 1000 + Math.round(+m[4]! / 1000);
        elapsed = cur;
        draw(Math.min(cur / duration, 1));
      }
    }

    if (buf.length > 100000) buf = buf.slice(-5000);
  }

  await proc.exited;
  reader.cancel();
  await proc.stderr?.cancel();

  elapsed = duration || elapsed;
  draw(1);
  process.stdout.write("\n\n\n");
  process.stdout.write("\x1b[?25h");

  console.log(`saved to ${outFile}`);
}

async function downloadTrack(track: Track, clientId: string, oauthToken: string | undefined, outDir?: string, debug?: boolean) {
  const { id, title, publisher_metadata, media, user, permalink, downloadable, has_downloads_left, waveform_url, duration } = track;
  console.log(`${title} — ${publisher_metadata?.artist || user.username}`);

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
    if (!hls) throw new Error(`no hls stream found for "${title}"`);
    mimeType = hls.format.mime_type;
    streamUrl = (await fetch(`${hls.url}?client_id=${clientId}`).then(r => r.json()) as { url: string }).url;
  }

  await saveAudio(streamUrl, isDownload, undefined, user, permalink, mimeType, debug, outDir, duration, waveform_url);
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
  .option("-o, --output <directory>", "output directory")
  .option("--debug", "print ffmpeg execution logs", false)
  .action(async (trackUrl, customOutFile, options) => {
    const debug = options.debug;

    let oauthToken = options.token || process.env.SOUNDCLOUD_OAUTH_TOKEN;
    if (!oauthToken) {
      oauthToken = await secrets.get({
        service: "downcloud",
        name: "soundcloud-oauth-token",
      }) || undefined;
    }

    const clientId = await resolveClientId();
    const data = await resolveUrl(trackUrl, clientId) as Track;

    const { id, title, publisher_metadata, media, user, permalink, downloadable, has_downloads_left, waveform_url, duration } = data;
    console.log(`${title} — ${publisher_metadata?.artist || user.username}`);

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

    await saveAudio(streamUrl, isDownload, customOutFile, user, permalink, mimeType, debug, options.output, duration, waveform_url);
  });

program
  .command("playlist")
  .description("download all tracks from a playlist")
  .argument("<url>", "playlist url")
  .option("-t, --token <string>", "use a temporary soundcloud oauth token")
  .option("-o, --output <directory>", "output directory (default: playlist name)")
  .option("--debug", "print ffmpeg execution logs", false)
  .action(async (playlistUrl, options) => {
    const debug = options.debug;

    let oauthToken = options.token || process.env.SOUNDCLOUD_OAUTH_TOKEN;
    if (!oauthToken) {
      oauthToken = await secrets.get({
        service: "downcloud",
        name: "soundcloud-oauth-token",
      }) || undefined;
    }

    const clientId = await resolveClientId();
    const data = await resolveUrl(playlistUrl, clientId);

    const { title, user, permalink, tracks } = data;

    if (!tracks || tracks.length === 0) {
      console.log("playlist is empty");
      return;
    }

    const outDir = options.output || `${user.permalink}_${permalink}`;
    await mkdir(outDir, { recursive: true });

    console.log(`playlist: ${title} — ${tracks.length} tracks\n`);

    for (const track of tracks) {
      if (!track.user || !track.media?.transcodings?.length) {
        if (track.id) {
          try {
            const res = await fetch(`https://api-v2.soundcloud.com/tracks/${track.id}?client_id=${clientId}`);
            if (res.ok) {
              const full = await res.json();
              Object.assign(track, full);
            }
          } catch {}
        }
      }
      if (!track.user || !track.media?.transcodings?.length) {
        console.error(`skipped: ${track.title || track.id || "unknown"} (no data)`);
        continue;
      }
      try {
        await downloadTrack(track, clientId, oauthToken, outDir, debug);
        console.log();
      } catch (e) {
        console.error(`failed: ${track.title}: ${e}`);
      }
    }
  });

await program.parseAsync(Bun.argv);
