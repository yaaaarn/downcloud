export interface Transcoding {
  url: string;
  format: { protocol: string; mime_type: string };
}

export interface Track {
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

export interface AudioMetadata {
  title: string;
  artist: string;
  album: string;
  description?: string;
  url?: string;
  artworkUrl?: string;
}

export interface SaveAudioOptions {
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
  oauthToken?: string
}

export interface User {
  id: number;
  username: string;
  permalink: string;
}

export interface ArtistData {
  user: User;
  tracks: Track[];
}

export interface PlaylistData {
  title: string;
  user: { username: string; permalink: string };
  permalink: string;
  tracks: Track[];
}

export type ResolveResult = Track | PlaylistData | ArtistData;

export interface DownloadOptions {
  clientId: string;
  oauthToken?: string;
  outDir?: string;
  debug?: boolean;
  format?: string;
  album?: string;
  customOutFile?: string;
}

export interface DownloadPlaylistOptions {
  clientId: string;
  oauthToken?: string;
  outDir?: string;
  debug?: boolean;
  format?: string;
  archiveFile?: string;
  syncFile?: string;
}

export interface DownloadArtistOptions {
  clientId: string;
  oauthToken?: string;
  outDir?: string;
  debug?: boolean;
  format?: string;
  archiveFile?: string;
  syncFile?: string;
}

export interface DownloadResult {
  filePath: string | undefined;
  track: Track;
}

export interface PlaylistDownloadResult {
  results: DownloadResult[];
  errors: { track: Track; error: unknown }[];
}

export interface SoundCloudClient {
  clientId: string;
  oauthToken: string | undefined;
  resolve: (url: string) => Promise<ResolveResult>;
  download: (url: string, opts?: Omit<DownloadOptions, "clientId">) => Promise<DownloadResult>;
  downloadPlaylist: (url: string, opts?: Omit<DownloadPlaylistOptions, "clientId">) => Promise<PlaylistDownloadResult>;
  downloadArtist: (url: string, opts?: Omit<DownloadArtistOptions, "clientId">) => Promise<PlaylistDownloadResult>;
}
