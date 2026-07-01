import { join } from "path";
import { tmpdir } from "os";
import { randomUUID } from "node:crypto";
import { WAVE_WIDTH, bright, pastel, dim, dimmer, userAgent } from "./constants";
import type { SaveAudioOptions, AudioMetadata, Track } from "./types";
import { fetchWaveformRows, printAsciiWaveform, clampIndex } from "./waveform";

function buildFfmpegArgs(
  streamUrl: string,
  coverFile: string | undefined,
  sourceFormat: string,
  outFormat: string | undefined,
  metadata: AudioMetadata | undefined,
  outFile: string,
  oauthToken?: string
): string[] {
  const hasCover = !!coverFile;
  let args: string[] = ["ffmpeg", "-i", streamUrl];

  if (outFormat === "mp3") {
    if (hasCover) {
      args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "libmp3lame", "-q:a", "2", "-c:v", "mjpeg", "-id3v2_version", "3", "-disposition:v:0", "attached_pic");
    } else {
      args.push("-c:a", "libmp3lame", "-q:a", "2", "-map_metadata", "0");
    }
  } else if (sourceFormat.includes("flac")) {
    if (hasCover) {
      args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-compression_level", "8", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
    } else {
      args.push("-c", "copy");
    }
  } else if (sourceFormat.includes("wav") || sourceFormat.includes("x-wav") || sourceFormat.includes("aiff")) {

    if (hasCover) {
      args.push("-i", coverFile!, "-map", "0:a", "-map", "1:v", "-c:a", "flac", "-compression_level", "8", "-c:v", "mjpeg", "-disposition:v:0", "attached_pic");
    } else {
      args.push("-c:a", "flac", "-compression_level", "8", "-map_metadata", "0");
    }
  } else {
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

  if (oauthToken != null) {
    args.push("-headers", `Authorization: OAuth ${oauthToken}`)
  }

  args.push("-y", outFile);
  return args;
}

async function saveAudio(options: SaveAudioOptions): Promise<string | undefined> {
  const { streamUrl, isDownload, customOutFile, user, permalink, mimeType, debug, outDir, duration, waveformUrl, metadata, oauthToken } = options;

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

  let args = buildFfmpegArgs(streamUrl, coverFile, format, options.format, metadata, outFile, oauthToken);

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

export async function downloadTrack(track: Track, clientId: string, oauthToken: string | undefined, outDir?: string, debug?: boolean, albumName?: string, customOutFile?: string, outFormat?: string): Promise<string | undefined> {
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
    streamUrl = (await fetch(`${hls.url}?client_id=${clientId}`, { headers: { Authorization: oauthToken != null ? `OAuth ${oauthToken}` : '' } }).then(r => r.json()) as { url: string }).url;
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
    duration, waveformUrl: waveform_url, metadata, coverFile, oauthToken
  });
}
