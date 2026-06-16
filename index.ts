import { join } from "path";
import { tmpdir } from "os";
import { mkdir, unlink } from "node:fs/promises";
import { secrets } from "bun";
import { Command } from "commander";
import chalk from "chalk";
import {
  extractAssetUrls,
  findClientIdInChunk,
  normalizeWaveform,
  renderAsciiWaveform,
  originalArtworkUrl,
  formatTime,
} from "./lib";

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

  const assetUrls = extractAssetUrls(html);
  clientId = await findClientId(assetUrls);
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

    const clientId = findClientIdInChunk(chunk);
    if (clientId) {
      return clientId;
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

    const { top: topRow, bottom: bottomRow } = renderAsciiWaveform(samples, 75);

    console.log()
    console.log(topRow);
    console.log(`${chalk.hex("#555555")(bottomRow)}\n`);

  } catch (e) { }
}

async function saveAudio(streamUrl: string, isDownload: boolean, customOutFile: string | undefined, user: any, permalink: string, mimeType?: string, debug?: boolean, outDir?: string, duration?: number, waveformUrl?: string, metadata?: AudioMetadata) {
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

  let coverFile: string | undefined;
  if (metadata?.artworkUrl) {
    try {
      const res = await fetch(metadata.artworkUrl);
      if (res.ok) {
        coverFile = join(tmpdir(), `downcloud_cover_${Date.now()}.jpg`);
        await Bun.write(coverFile, new Uint8Array(await res.arrayBuffer()));
      }
    } catch {}
  }

  const buildArgs = (): string[] => {
    const hasCover = !!coverFile;
    let args: string[];

    if (format.includes("flac")) {
      if (isDefaultName) outFile += ".flac";
      args = ["ffmpeg", "-i", streamUrl];
      if (hasCover) {
        args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-compression_level", "8", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
      } else {
        args.push("-c", "copy");
      }
    } else if (format.includes("wav") || format.includes("x-wav") || format.includes("aiff")) {
      if (isDefaultName) outFile += ".flac";
      args = ["ffmpeg", "-i", streamUrl];
      if (hasCover) {
        args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-compression_level", "8", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
      } else {
        args.push("-c:a", "flac", "-compression_level", "8", "-map_metadata", "0");
      }
    } else {
      if (isDefaultName) outFile += ".m4a";
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

    args.push("-y", outFile!);
    return args;
  };

  let args = buildArgs();

  const bright = chalk.hex("#E64D16");
  const pastel = chalk.hex("#FF9E6A");
  const dim = chalk.hex("#555555");
  const dimmer = chalk.hex("#666666");

  let samples: number[] | undefined;
  let preTop = "";
  let preBot = "";
  const waveWidth = 75;

  if (!debug && waveformUrl) {
    try {
      const res = await fetch(waveformUrl);
      if (res.ok) {
        const { samples: raw } = await res.json() as { samples: number[] };
        if (raw?.length) {
          samples = normalizeWaveform(raw, waveWidth);
          const topSetW = [" ", "▖", "▌"];
          const botSetW = [" ", "▘", "▌"];
          for (let i = 0; i < waveWidth; i++) {
            const val = samples[Math.floor((i / waveWidth) * samples.length)] || 0;
            preTop += topSetW[val > 0.66 ? 2 : val > 0.33 ? 1 : 0];
            preBot += botSetW[val > 0.66 ? 2 : val > 0.33 ? 1 : 0];
          }
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
    if (coverFile) await unlink(coverFile).catch(() => {});
    console.log(`saved to ${outFile}`);
    return;
  }

  args.push("-progress", "pipe:1", "-loglevel", "quiet");

  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" });

  process.stdout.write("\x1b[?25l");

  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  let elapsed = 0;

  const fmt = formatTime;

  const draw = (pct: number) => {
    const timeStr = duration ? `${fmt(elapsed)} / ${fmt(duration)}` : `${Math.round(pct * 100)}%`;

    if (!samples) {
      process.stdout.write(`\r\x1b[K${timeStr}\n\x1b[K${bright("▌".repeat(Math.max(0, Math.floor(pct * 75) - 1)))}\x1b[A`);
      return;
    }

    const idx = Math.min(Math.floor(pct * waveWidth), waveWidth);
    const topLine = bright(preTop.slice(0, idx)) + dim(preTop.slice(idx));
    const botLine = pastel(preBot.slice(0, idx)) + dimmer(preBot.slice(idx));
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
  if (coverFile) await unlink(coverFile).catch(() => {});
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
  const artwork = artwork_url ? originalArtworkUrl(artwork_url) : undefined;

  const metadata: AudioMetadata = {
    title,
    artist,
    album: albumName || publisher_metadata?.album_title || title,
    description: description || undefined,
    url: trackUrl,
    artworkUrl: artwork,
  };

  await saveAudio(streamUrl, isDownload, customOutFile, user, permalink, mimeType, debug, outDir, duration, waveform_url, metadata);
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

    await downloadTrack(data, clientId, oauthToken, options.output, debug, undefined, customOutFile);
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
        await downloadTrack(track, clientId, oauthToken, outDir, debug, title);
        console.log();
      } catch (e) {
        console.error(`failed: ${track.title}: ${e}`);
      }
    }
  });

await program.parseAsync(Bun.argv);
