import { Command } from "commander";
import { secrets } from "bun";
import { mkdir } from "node:fs/promises";
import { name, description, version } from '../package.json'
import { resolveOauthToken } from "./auth";
import { resolveClientId } from "./auth";
import { resolveUrl } from "./api";
import { downloadTrack } from "./audio";
import type { Track, PlaylistData } from "./types";
import { ArchiveHelper } from "./archive";

function validateUrl(url: string): void {
  if (!url.includes("soundcloud.com")) {
    console.error("error: url must be a soundcloud.com url");
    process.exit(1);
  }
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
    const data = await resolveUrl(trackUrl, clientId, oauthToken) as unknown as Track;
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
    const data = await resolveUrl(playlistUrl, clientId, oauthToken) as unknown as PlaylistData;

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

export { program };
