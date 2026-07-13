import { mkdir } from "node:fs/promises";
import { resolveClientId, resolveOauthToken } from "./auth";
import { resolveUrl } from "./api";
import { downloadTrack } from "./audio";
import { ArchiveHelper } from "./archive";
import { userAgent } from "./constants";
import type {
  SoundCloudClient,
  ResolveResult,
  Track,
  PlaylistData,
  ArtistData,
  DownloadOptions,
  DownloadPlaylistOptions,
  DownloadArtistOptions,
  DownloadResult,
  PlaylistDownloadResult,
} from "./types";

async function fetchFullTrack(trackId: number, clientId: string): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`https://api-v2.soundcloud.com/tracks/${trackId}?client_id=${clientId}`);
    if (res.ok) return await res.json() as Record<string, unknown>;
  } catch {}
  return null;
}

export interface CreateClientOptions {
  token?: string;
}

export async function createClient(options?: CreateClientOptions): Promise<SoundCloudClient> {
  const oauthToken = await resolveOauthToken(options?.token);
  const clientId = await resolveClientId();

  async function resolve(url: string): Promise<ResolveResult> {
    return (await resolveUrl(url, clientId, oauthToken)) as unknown as ResolveResult;
  }

  async function download(url: string, opts?: Omit<DownloadOptions, "clientId">): Promise<DownloadResult> {
    const result = await resolve(url);
    if ("tracks" in result) {
      throw new Error("URL resolved to a playlist. Use client.downloadPlaylist() instead.");
    }
    const track = result as Track;
    const filePath = await downloadTrack(track, {
      clientId,
      oauthToken: opts?.oauthToken ?? oauthToken,
      ...opts,
    });
    return { filePath, track };
  }

  async function downloadPlaylist(url: string, opts?: Omit<DownloadPlaylistOptions, "clientId">): Promise<PlaylistDownloadResult> {
    const result = await resolve(url);
    if (!("tracks" in result)) {
      throw new Error("URL resolved to a track, not a playlist. Use client.download() instead.");
    }
    const playlist = result as PlaylistData;
    const { title, user, permalink, tracks } = playlist;

    const results: DownloadResult[] = [];
    const errors: { track: Track; error: unknown }[] = [];

    if (!tracks || tracks.length === 0) {
      return { results, errors };
    }

    const outDir = opts?.outDir || `${user.permalink}_${permalink}`;
    await mkdir(outDir, { recursive: true });

    console.log(`playlist: ${title} — ${tracks.length} tracks\n`);

    const archiveFile = opts?.archiveFile || opts?.syncFile;
    const archive = archiveFile ? new ArchiveHelper(archiveFile) : undefined;
    if (archive) await archive.init();

    for (const track of tracks) {
      if (!track.user || !track.media?.transcodings?.length) {
        if (track.id) {
          const full = await fetchFullTrack(track.id, clientId);
          if (full) Object.assign(track, full);
        }
      }
      if (!track.user || !track.media?.transcodings?.length) {
        console.error(`skipped: ${track.title || track.id || "unknown"} (no data)`);
        continue;
      }

      if (archive?.isArchived(track.id)) {
        if (opts?.syncFile) {
          archive.markProcessed(track.id, archive.getPath(track.id)!);
        }
        console.log(`${track.title} is already in archive, skipping`);
        continue;
      }

      try {
        const filePath = await downloadTrack(track, {
          clientId,
          outDir,
          format: opts?.format,
          debug: opts?.debug,
          oauthToken: opts?.oauthToken ?? oauthToken,
          album: title,
        });
        results.push({ filePath, track });
        if (archive && filePath) {
          if (opts?.archiveFile) {
            await archive.append(track.id, filePath);
          } else if (opts?.syncFile) {
            archive.markProcessed(track.id, filePath);
          }
        }
        console.log();
      } catch (e) {
        errors.push({ track, error: e });
        console.error(`failed: ${track.title}: ${e}`);
      }
    }

    if (opts?.syncFile && archive) {
      await archive.finalize();
    }

    return { results, errors };
  }

  async function fetchAllTracks(userId: number, opts?: { oauthToken?: string }): Promise<Track[]> {
    const tracks: Track[] = [];
    let url = `https://api-v2.soundcloud.com/users/${userId}/tracks?client_id=${clientId}&limit=50`;

    while (url) {
      const res = await fetch(url, {
        headers: { "User-Agent": userAgent, Authorization: opts?.oauthToken != null ? `OAuth ${opts.oauthToken}` : "" },
      });
      if (!res.ok) break;
      const data = await res.json() as { collection: Track[]; next_href: string | null };
      tracks.push(...data.collection);
      url = data.next_href || "";
      if (!data.collection.length) break;
    }

    return tracks;
  }

  async function downloadArtist(url: string, opts?: Omit<DownloadArtistOptions, "clientId">): Promise<PlaylistDownloadResult> {
    const result = await resolve(url);
    if ("tracks" in result || "media" in result) {
      throw new Error("URL resolved to a track or playlist. Use client.download() or client.downloadPlaylist() instead.");
    }
    const artist = result as ArtistData;
    const { username, permalink } = artist.user;

    const tracks = await fetchAllTracks(artist.user.id, { oauthToken: opts?.oauthToken ?? oauthToken });

    const results: DownloadResult[] = [];
    const errors: { track: Track; error: unknown }[] = [];

    if (tracks.length === 0) {
      console.log(`${username} has no tracks`);
      return { results, errors };
    }

    const outDir = opts?.outDir || permalink;
    await mkdir(outDir, { recursive: true });

    console.log(`artist: ${username} — ${tracks.length} tracks\n`);

    const archiveFile = opts?.archiveFile || opts?.syncFile;
    const archive = archiveFile ? new ArchiveHelper(archiveFile) : undefined;
    if (archive) await archive.init();

    for (const track of tracks) {
      if (!track.user || !track.media?.transcodings?.length) {
        if (track.id) {
          const full = await fetchFullTrack(track.id, clientId);
          if (full) Object.assign(track, full);
        }
      }
      if (!track.user || !track.media?.transcodings?.length) {
        console.error(`skipped: ${track.title || track.id || "unknown"} (no data)`);
        continue;
      }

      if (archive?.isArchived(track.id)) {
        if (opts?.syncFile) {
          archive.markProcessed(track.id, archive.getPath(track.id)!);
        }
        console.log(`${track.title} is already in archive, skipping`);
        continue;
      }

      try {
        const filePath = await downloadTrack(track, {
          clientId,
          outDir,
          format: opts?.format,
          debug: opts?.debug,
          oauthToken: opts?.oauthToken ?? oauthToken,
        });
        results.push({ filePath, track });
        if (archive && filePath) {
          if (opts?.archiveFile) {
            await archive.append(track.id, filePath);
          } else if (opts?.syncFile) {
            archive.markProcessed(track.id, filePath);
          }
        }
        console.log();
      } catch (e) {
        errors.push({ track, error: e });
        console.error(`failed: ${track.title}: ${e}`);
      }
    }

    if (opts?.syncFile && archive) {
      await archive.finalize();
    }

    return { results, errors };
  }

  return { clientId, oauthToken, resolve, download, downloadPlaylist, downloadArtist };
}
