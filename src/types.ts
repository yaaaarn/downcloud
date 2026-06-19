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
}

export interface PlaylistData {
  title: string;
  user: { username: string; permalink: string };
  permalink: string;
  tracks: Track[];
}
