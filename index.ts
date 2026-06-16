import { join } from "path";
import { tmpdir } from "os";
import { mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { secrets } from "bun";
import { Command } from "commander";
import chalk from "chalk";

function compressWaveform(samples: number[], targetWidth: number): number[] {
  const n = samples.length;
  const chunkSize = Math.ceil(n / targetWidth);
  const compressed: number[] = [];
  for (let i = 0; i < n; i += chunkSize) {
    let sum = 0;
    const end = Math.min(i + chunkSize, n);
    for (let j = i; j < end; j++) {
      sum += samples[j]!;
    }
    compressed.push(sum / (end - i));
  }
  return compressed;
}

function clampIndex(value: number, max: number): number {
  return Math.min(Math.floor(value), max);
}

const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.114 Safari/537.36";
const CACHE_FILE = join(process.env.HOME || ".", ".downcloud_client_id");

interface Transcoding {
  url: string;
  format: { protocol: string; mime_type: string };
}

interface Track {
  id: number;
  title: string;
  description: string;
  downloadable: boolean;
  has_downloads_left: boolean;
  user: { username: string; permalink: string; };
  permalink: string;
  media: { transcodings: Transcoding[] };
  publisher_metadata?: {
    artist: string,
    album_title?: string,
    explicit: boolean,
  };
  artwork_url: string;
  waveform_url?: string;
  duration?: number;
}

interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  description?: string;
  url?: string;
  artworkUrl?: string;
}

interface SaveAudioOptions {
  streamUrl: string;
  isDownload: boolean;
  customOutFile?: string;
  user: { username: string; permalink: string };
  permalink: string;
  mimeType?: string;
  debug?: boolean;
  outDir?: string;
  duration?: number;
  waveformUrl?: string;
  metadata?: AudioMetadata;
}

async function resolveOauthToken(tokenOption?: string): Promise<string | undefined> {
  let token = tokenOption || process.env.SOUNDCLOUD_OAUTH_TOKEN;
  try {
    if (!token) {
      token = (await secrets.get({
        service: "downcloud",
        name: "soundcloud-oauth-token",
      })) || undefined;
    }
  } catch (e) {
    token = undefined;
  }
  return token;
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

async function resolveUrl(url: string, clientId: string): Promise<Record<string, unknown>> {
  const res = await fetch(
    `https://api-v2.soundcloud.com/resolve?url=${encodeURIComponent(url)}&client_id=${clientId}`,
    { headers: { "User-Agent": userAgent } },
  );
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return await res.json() as Record<string, unknown>;
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

async function fetchWaveformRows(url: string, width: number): Promise<{ top: string; bottom: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const { samples } = await res.json() as { samples: number[] };
    if (!samples?.length) return null;

    const compressed = compressWaveform(samples, width);
    let maxVal = 0;
    for (let i = 0; i < compressed.length; i++) {
      if (compressed[i]! > maxVal) maxVal = compressed[i]!;
    }
    maxVal = maxVal || 1;

    const topSet = [" ", "▖", "▌"];
    const botSet = [" ", "▘", "▌"];

    const top = compressed.map(v => {
      const n = v / maxVal;
      return topSet[clampIndex(n * topSet.length, topSet.length - 1)]!;
    }).join("");

    const bottom = compressed.map(v => {
      const n = v / maxVal;
      return botSet[clampIndex(n * botSet.length, botSet.length - 1)]!;
    }).join("");

    return { top, bottom };
  } catch {
    return null;
  }
}

async function printAsciiWaveform(waveformUrl: string) {
  const rows = await fetchWaveformRows(waveformUrl, 75);
  if (!rows) return;
  console.log();
  console.log(rows.top);
  console.log(`${chalk.hex("#555555")(rows.bottom)}\n`);
}

async function saveAudio(options: SaveAudioOptions) {
  const { streamUrl, isDownload, customOutFile, user, permalink, mimeType, debug, outDir, duration, waveformUrl, metadata } = options;

  let format = "";

  if (isDownload) {
    const head = await fetch(streamUrl, { method: "HEAD" });
    format = head.headers.get("content-type") || "";
  } else if (mimeType) {
    format = mimeType;
  }

  const outFileBase = customOutFile || `${user.permalink}_${permalink}`;
  const isDefaultName = !customOutFile;

  const ext = format.includes("flac") ? ".flac"
    : (format.includes("wav") || format.includes("x-wav") || format.includes("aiff")) ? ".flac"
      : ".m4a";

  let outFile = outDir ? join(outDir, outFileBase) : outFileBase;
  if (isDefaultName) outFile += ext;

  let coverFile: string | undefined;
  if (metadata?.artworkUrl) {
    try {
      const res = await fetch(metadata.artworkUrl);
      if (res.ok) {
        coverFile = join(tmpdir(), `downcloud_cover_${randomUUID()}.jpg`);
        await Bun.write(coverFile, new Uint8Array(await res.arrayBuffer()));
      }
    } catch (e) {
      console.debug("failed to fetch cover art:", e);
    }
  }

  const buildArgs = (): string[] => {
    const hasCover = !!coverFile;
    let args: string[];

    if (format.includes("flac")) {
      args = ["ffmpeg", "-i", streamUrl];
      if (hasCover) {
        args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-compression_level", "8", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
      } else {
        args.push("-c", "copy");
      }
    } else if (format.includes("wav") || format.includes("x-wav") || format.includes("aiff")) {
      args = ["ffmpeg", "-i", streamUrl];
      if (hasCover) {
        args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-compression_level", "8", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
      } else {
        args.push("-c:a", "flac", "-compression_level", "8", "-map_metadata", "0");
      }
    } else {
      args = ["ffmpeg", "-i", streamUrl];
      if (hasCover) {
        args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "copy", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic", "-movflags", "+faststart");
      } else {
        args.push("-c", "copy", "-movflags", "+faststart");
      }
    }

    if (metadata) {
      args.push("-metadata", `title=${metadata.title}`);
      args.push("-metadata", `artist=${metadata.artist}`);
      args.push("-metadata", `album=${metadata.album}`);
      if (metadata.description) args.push("-metadata", `description=${metadata.description}`);
      if (metadata.url) args.push("-metadata", `url=${metadata.url}`);
    }

    args.push("-y", outFile);
    return args;
  };

  let args = buildArgs();

  const bright = chalk.hex("#E64D16");
  const pastel = chalk.hex("#FF9E6A");
  const dim = chalk.hex("#555555");
  const dimmer = chalk.hex("#666666");

  const waveWidth = 75;

  const waveformRowsPromise = (!debug && waveformUrl)
    ? fetchWaveformRows(waveformUrl, waveWidth)
    : Promise.resolve(null);

  if (debug) {
    const proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
    await proc.exited;
    if (waveformUrl) {
      await printAsciiWaveform(waveformUrl);
    }
    if (coverFile) await unlink(coverFile).catch(() => { });
    console.log(`saved to ${outFile}`);
    return;
  }

  args.push("-progress", "pipe:1", "-loglevel", "quiet");

  const [waveformRows, proc] = await Promise.all([
    waveformRowsPromise,
    Promise.resolve(Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })),
  ]);

  process.stdout.write("\x1b[?25l");

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  let elapsed = 0;

  const ft = (ms: number) => {
    const sec = Math.floor(ms / 1000);
    return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
  };

  const draw = (pct: number) => {
    const timeStr = duration ? `${ft(elapsed)} / ${ft(duration)}` : `${Math.round(pct * 100)}%`;

    if (!waveformRows) {
      process.stdout.write(`\r\x1b[K${timeStr}\n\x1b[K${bright("▌".repeat(Math.max(0, Math.floor(pct * 75) - 1)))}\x1b[A`);
      return;
    }

    const idx = clampIndex(pct * waveWidth, waveWidth);
    const topLine = bright(waveformRows.top.slice(0, idx)) + dim(waveformRows.top.slice(idx));
    const botLine = pastel(waveformRows.bottom.slice(0, idx)) + dimmer(waveformRows.bottom.slice(idx));
    process.stdout.write(`\r\x1b[K${timeStr}\n\x1b[K${topLine}\n\x1b[K${botLine}\x1b[A\x1b[A`);
  };

  draw(0);

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    const lines = buf.split("\n");
    buf = lines.pop()!;

    for (const line of lines) {
      if (line.startsWith("out_time_ms=")) {
        const us = parseInt(line.slice("out_time_ms=".length));
        if (!isNaN(us) && us > 0 && duration) {
          elapsed = us / 1000;
          draw(Math.min(elapsed / duration, 1));
        }
      }
    }
  }

  await proc.exited;
  reader.cancel();
  await proc.stderr?.cancel();

  elapsed = duration || elapsed;
  draw(1);
  process.stdout.write("\n\n\n");
  process.stdout.write("\x1b[?25h");

  console.log(`saved to ${outFile}`);
  if (coverFile) await unlink(coverFile).catch(() => { });
}

async function downloadTrack(track: Track, clientId: string, oauthToken: string | undefined, outDir?: string, debug?: boolean, albumName?: string, customOutFile?: string) {
  const { id, title, description, publisher_metadata, media, user, permalink, downloadable, has_downloads_left, waveform_url, duration, artwork_url } = track;
  const artist = publisher_metadata?.artist || user.username;
  console.log(`${title} — ${artist}`);

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

  const trackUrl = `https://soundcloud.com/${user.permalink}/${permalink}`;
  const artwork = artwork_url ? artwork_url.replace(/-(large|t\d+x\d+)(?=\.\w+)/, "-original") : undefined;


  const metadata: AudioMetadata = {
    title,
    artist,
    album: albumName || publisher_metadata?.album_title || title,
    description: description || undefined,
    url: trackUrl,
    artworkUrl: artwork,
  };

  await saveAudio({
    streamUrl, isDownload, customOutFile, user, permalink, mimeType, debug, outDir,
    duration, waveformUrl: waveform_url, metadata,
  });
}

const { version } = await Bun.file(join(import.meta.dir!, "package.json")).json() as { version: string };

const program = new Command();

program
  .name("downcloud")
  .description("a simple (and fast) soundcloud downloader")
  .version(version);

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
  });

function validateUrl(url: string): void {
  if (!url.includes("soundcloud.com")) {
    console.error("error: url must be a soundcloud.com url");
    process.exit(1);
  }
}

program
  .command("track")
  .description("download a track")
  .argument("<url>", "track url")
  .argument("[outfile]", "path to save output file")
  .option("-t, --token <string>", "use a temporary soundcloud oauth token")
  .option("-o, --output <directory>", "output directory")
  .option("--debug", "print ffmpeg execution logs", false)
  .action(async (trackUrl, customOutFile, options) => {
    validateUrl(trackUrl);
    const debug = options.debug;
    const oauthToken = await resolveOauthToken(options.token);
    const clientId = await resolveClientId();
    const data = await resolveUrl(trackUrl, clientId) as unknown as Track;

    await downloadTrack(data, clientId, oauthToken, options.output, debug, undefined, customOutFile);
  });

interface PlaylistData {
  title: string;
  user: { username: string; permalink: string };
  permalink: string;
  tracks: Track[];
}

program
  .command("playlist")
  .description("download all tracks from a playlist")
  .argument("<url>", "playlist url")
  .option("-t, --token <string>", "use a temporary soundcloud oauth token")
  .option("-o, --output <directory>", "output directory (default: playlist name)")
  .option("--debug", "print ffmpeg execution logs", false)
  .action(async (playlistUrl, options) => {
    validateUrl(playlistUrl);
    const debug = options.debug;
    const oauthToken = await resolveOauthToken(options.token);
    const clientId = await resolveClientId();
    const data = await resolveUrl(playlistUrl, clientId) as unknown as PlaylistData;

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
              const full = await res.json() as Record<string, unknown>;
              Object.assign(track, full);
            }
          } catch (e) {
            console.debug("failed to fetch full track data:", e);
          }
        }
      }
      if (!track.user || !track.media?.transcodings?.length) {
        console.error(`skipped: ${track.title || track.id || "unknown"} (no data)`);
        continue;
      }
      try {
        await downloadTrack(track, clientId, oauthToken, outDir, debug, title);
        console.log();
      } catch (e) {
        console.error(`failed: ${track.title}: ${e}`);
      }
    }
  });

await program.parseAsync(Bun.argv);
