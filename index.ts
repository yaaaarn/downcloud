import { join } from "path";
import { tmpdir } from "os";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { file, secrets } from "bun";
import { Command } from "commander";
import chalk from "chalk";
import { name, description, version } from './package.json'
import { appendFile } from "node:fs/promises";

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
const WAVE_WIDTH = 75;

const bright = chalk.hex("#E64D16");
const pastel = chalk.hex("#FF9E6A");
const dim = chalk.hex("#555555");
const dimmer = chalk.hex("#666666");

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
  format?: string;
  coverFile?: string;
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

    const topChars = new Array<string>(compressed.length);
    const botChars = new Array<string>(compressed.length);
    for (let i = 0; i < compressed.length; i++) {
      const n = compressed[i]! / maxVal;
      topChars[i] = topSet[clampIndex(n * topSet.length, topSet.length - 1)]!;
      botChars[i] = botSet[clampIndex(n * botSet.length, botSet.length - 1)]!;
    }
    const top = topChars.join("");
    const bottom = botChars.join("");

    return { top, bottom };
  } catch {
    return null;
  }
}

async function printAsciiWaveform(waveformUrl: string) {
  const rows = await fetchWaveformRows(waveformUrl, WAVE_WIDTH);
  if (!rows) return;
  console.log();
  console.log(rows.top);
  console.log(`${dim(rows.bottom)}\n`);
}

class ArchiveHelper {
  entries: Map<string, string>;
  processed: Set<string>;
  archive?: Bun.BunFile;
  enabled: boolean;

  constructor(public archiveFile?: string) {
    this.enabled = !!archiveFile;
    this.entries = new Map();
    this.processed = new Set();
    if (this.enabled) this.archive = Bun.file(archiveFile!);
  }

  async init() {
    if (!this.archive) return;
    try {
      if (!(await this.archive.exists())) return;
      const data = await this.archive.text();
      for (const line of data.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const firstSpace = trimmed.indexOf(" ");
        if (firstSpace === -1) continue;
        const secondSpace = trimmed.indexOf(" ", firstSpace + 1);
        if (secondSpace === -1) continue;
        this.entries.set(trimmed.slice(0, secondSpace), trimmed.slice(secondSpace + 1));
      }
    } catch { }
  }

  isArchived(trackId: number): boolean {
    return this.entries.has(`soundcloud ${trackId}`);
  }

  async append(trackId: number, filePath: string) {
    const key = `soundcloud ${trackId}`;
    if (!this.entries.has(key)) {
      await appendFile(this.archiveFile!, `${key} ${filePath}\n`);
      this.entries.set(key, filePath);
    }
  }

  getPath(trackId: number): string | undefined {
    return this.entries.get(`soundcloud ${trackId}`);
  }

  markProcessed(trackId: number, filePath: string) {
    const key = `soundcloud ${trackId}`;
    this.processed.add(key);
    this.entries.set(key, filePath);
  }

  async finalize() {
    if (!this.archive) return;

    await Promise.all(
      [...this.entries].map(async ([key, filePath]) => {
        if (!this.processed.has(key)) {
          try { await Bun.file(filePath).delete(); } catch { }
        }
      })
    );

    const lines = [...this.processed].map(k => `${k} ${this.entries.get(k)}`);
    await Bun.write(this.archive!, lines.length ? lines.join("\n") + "\n" : "");
  }
}

function buildFfmpegArgs(
  streamUrl: string,
  coverFile: string | undefined,
  sourceFormat: string,
  outFormat: string | undefined,
  metadata: AudioMetadata | undefined,
  outFile: string,
): string[] {
  const hasCover = !!coverFile;
  let args: string[];

  if (outFormat === "mp3") {
    args = ["ffmpeg", "-i", streamUrl];
    if (hasCover) {
      args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-q:a", "2", "-c:v", "mjpeg", "-id3v2_version", "3", "-disposition:v:0", "attached_pic");
    } else {
      args.push("-c:a", "libmp3lame", "-q:a", "2", "-map_metadata", "0");
    }
  } else if (sourceFormat.includes("flac")) {
    args = ["ffmpeg", "-i", streamUrl];
    if (hasCover) {
      args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-compression_level", "8", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
    } else {
      args.push("-c", "copy");
    }
  } else if (sourceFormat.includes("wav") || sourceFormat.includes("x-wav") || sourceFormat.includes("aiff")) {
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
}

async function saveAudio(options: SaveAudioOptions): Promise<string | undefined> {
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

  const ext = options.format === "mp3" ? ".mp3"
    : format.includes("flac") ? ".flac"
      : (format.includes("wav") || format.includes("x-wav") || format.includes("aiff")) ? ".flac"
        : ".m4a";

  let outFile = outDir ? join(outDir, outFileBase) : outFileBase;
  if (isDefaultName) outFile += ext;

  let coverFile = options.coverFile;
  if (!coverFile && metadata?.artworkUrl) {
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

  let args = buildFfmpegArgs(streamUrl, coverFile, format, options.format, metadata, outFile);

  const waveformRowsPromise = (!debug && waveformUrl)
    ? fetchWaveformRows(waveformUrl, WAVE_WIDTH)
    : Promise.resolve(null);

  if (debug) {
    const proc = Bun.spawn(args, { stdout: "inherit", stderr: "inherit" });
    await proc.exited;
    if (waveformUrl) {
      await printAsciiWaveform(waveformUrl);
    }
    if (coverFile) await Bun.file(coverFile).delete().catch(() => { });
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
      process.stdout.write(`\r\x1b[K${timeStr}\n\x1b[K${bright("▌".repeat(Math.max(0, Math.floor(pct * WAVE_WIDTH) - 1)))}\x1b[A`);
      return;
    }

    const idx = clampIndex(pct * WAVE_WIDTH, WAVE_WIDTH);
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
  if (coverFile) await Bun.file(coverFile).delete().catch(() => { });
  return outFile;
}

async function downloadTrack(track: Track, clientId: string, oauthToken: string | undefined, outDir?: string, debug?: boolean, albumName?: string, customOutFile?: string, outFormat?: string): Promise<string | undefined> {
  const { id, title, description, publisher_metadata, media, user, permalink, downloadable, has_downloads_left, waveform_url, duration, artwork_url } = track;
  const artist = publisher_metadata?.artist || user.username;
  console.log(`${title} — ${artist}`);

  if (downloadable && has_downloads_left && !oauthToken) {
    console.warn("this track is downloadable, provide an oauth_token to download original file.");
  }

  console.log();

  const trackUrl = `https://soundcloud.com/${user.permalink}/${permalink}`;
  const artwork = artwork_url ? artwork_url.replace(/-(large|t\d+x\d+)(?=\.\w+)/, "-original") : undefined;

  const coverFilePromise = artwork
    ? (async () => {
      try {
        const res = await fetch(artwork);
        if (res.ok) {
          const cf = join(tmpdir(), `downcloud_cover_${randomUUID()}.jpg`);
          await Bun.write(cf, new Uint8Array(await res.arrayBuffer()));
          return cf;
        }
      } catch (e) {
        console.debug("failed to fetch cover art:", e);
      }
      return undefined;
    })()
    : Promise.resolve(undefined);

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

  const coverFile = await coverFilePromise;

  const metadata: AudioMetadata = {
    title,
    artist,
    album: albumName || publisher_metadata?.album_title || title,
    description: description || undefined,
    url: trackUrl,
    artworkUrl: artwork,
  };

  return await saveAudio({
    streamUrl, isDownload, customOutFile, user, permalink, mimeType, format: outFormat, debug, outDir,
    duration, waveformUrl: waveform_url, metadata, coverFile,
  });
}

const program = new Command();

program
  .name(name)
  .description(description)
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
  .option("-f, --format <format>", "output format (mp3, m4a, flac)")
  .option("--download-archive <file>", "download archive file (skip already archived tracks)")
  .option("--sync <file>", "sync archive file (download new, remove deleted, rewrite archive)")
  .option("--debug", "print ffmpeg execution logs", false)
  .action(async (trackUrl, customOutFile, options) => {
    validateUrl(trackUrl);
    const debug = options.debug;
    const oauthToken = await resolveOauthToken(options.token);
    const clientId = await resolveClientId();
    const data = await resolveUrl(trackUrl, clientId) as unknown as Track;
    const archiveFile = options.downloadArchive || options.sync;

    if (archiveFile) {
      const archive = new ArchiveHelper(archiveFile);
      await archive.init();
      if (archive.isArchived(data.id)) {
        console.log(`${data.title} is already in archive, skipping`);
        return;
      }
      const filePath = await downloadTrack(data, clientId, oauthToken, options.output, debug, undefined, customOutFile, options.format);
      if (!filePath) throw new Error('an error occurred')
      if (options.downloadArchive) {
        await archive.append(data.id, filePath);
      }
      if (options.sync) {
        archive.markProcessed(data.id, filePath);
        await archive.finalize();
      }
    } else {
      await downloadTrack(data, clientId, oauthToken, options.output, debug, undefined, customOutFile, options.format);
    }
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
  .option("-f, --format <format>", "output format (mp3, m4a, flac)")
  .option("--download-archive <file>", "download archive file (skip already archived tracks)")
  .option("--sync <file>", "sync archive file (download new, remove deleted, rewrite archive)")
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

    const archiveFile = options.downloadArchive || options.sync;
    const archive = archiveFile ? new ArchiveHelper(archiveFile) : undefined;
    if (archive) await archive.init();

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

      if (archive?.isArchived(track.id)) {
        if (options.sync) {
          archive.markProcessed(track.id, archive.getPath(track.id)!);
        }
        console.log(`${track.title} is already in archive, skipping`);
        continue;
      }

      try {
        const filePath = await downloadTrack(track, clientId, oauthToken, outDir, debug, title, undefined, options.format);
        if (!filePath) throw new Error('an error occurred')
        if (archive) {
          if (options.downloadArchive) {
            await archive.append(track.id, filePath);
          } else if (options.sync) {
            archive.markProcessed(track.id, filePath);
          }
        }
        console.log();
      } catch (e) {
        console.error(`failed: ${track.title}: ${e}`);
      }
    }

    if (options.sync && archive) {
      await archive.finalize();
    }
  });

await program.parseAsync(Bun.argv);
