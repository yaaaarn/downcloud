# ️️🌧️ downcloud

[![npm](https://img.shields.io/npm/v/@yaaaarn/downcloud)](https://www.npmjs.com/package/@yaaaarn/downcloud)

a simple (and fast) soundcloud downloader.

## table of contents

- [benchmarks](#benchmarks)
- [prerequisites](#prerequisites)
- [install](#install)
  - [run directly (no install)](#run-directly-no-install)
  - [nix flake](#nix-flake)
- [authentication](#authentication)
- [usage](#usage)
  - [track](#track)
  - [playlist](#playlist)
- [library api](#library-api)
  - [track](#track-1)
  - [playlist](#playlist-1)
  - [exports](#exports)
- [dev](#dev)
- [license](#license)

## benchmarks

```
downcloud (1.0.0)      1.403s  ███████
yt-dlp (2026.03.17)    2.175s  ███████████
music-dl (0.2.1)       6.241s  ███████████████████████████████
soundcloud-dl (1.0.0)  6.434s  ████████████████████████████████
scdl (3.0.5)           7.353s  █████████████████████████████████████
```

> tested on apple m2 mac mini with 1gbps ethernet speed

<details>
<summary>more data</summary>
  
| program | command | `time` |
|---|---|---|
| scdl (3.0.5) | `scdl -l https://soundcloud.com/hologura/yoho4` | `0.84s user 0.33s system 15% cpu 7.353 total` |
| downcloud (1.0.0) | `downcloud track https://soundcloud.com/hologura/yoho4` | `0.19s user 0.21s system 28% cpu 1.403 total` |
| yt-dlp (2026.03.17) | `yt-dlp https://soundcloud.com/hologura/yoho4` | `0.73s user 0.21s system 43% cpu 2.175 total` |
| soundcloud-dl (1.0.0) | `go run github.com/AYehia0/soundcloud-dl@latest https://soundcloud.com/hologura/yoho4 -b` | `0.28s user 0.45s system 11% cpu 6.434 total` |
| music-dl (0.2.1) | `music-dl --url https://soundcloud.com/hologura/yoho4` | `3.47s user 0.56s system 64% cpu 6.241 total` |

</details>

## prerequisites

- `ffmpeg`

## install

### npm

```bash
bunx @yaaaarn/downcloud track <url>
```

or install globally:

```bash
bun install -g @yaaaarn/downcloud
downcloud track <url>
```

### run directly (no install)

```bash
bun run start
```

### nix flake

add to your `flake.nix` inputs:

```nix
downcloud = {
  url = "github:yaaaarn/downcloud";
  inputs.nixpkgs.follows = "nixpkgs";
};
```

then add `downcloud.packages.${system}.default` to your `environment.systemPackages` or home-manager packages.

## authentication

higher-quality downloads of some tracks are only available for download with a soundcloud oauth token. to get yours:

1. open soundcloud and log in
2. open devtools and go to **application** > **storage** > **cookies** > `soundcloud.com`
3. find the `oauth_token` cookie and copy its value
4. save it:

```bash
downcloud set-token <your-token>
```

you can also provide it on a per-command basis with `-t <token>` instead of saving it.

> on darwin systems you may get an error if running via ssh, where the keychain cannot be unlocked.
> running the command below will unlock the keychain:
> 
> ```security unlock-keychain ~/Library/Keychains/login.keychain-db```

## usage

```
usage: downcloud [options] [command]

a simple (and fast) soundcloud downloader

options:
  -V, --version             output the version number
  -h, --help                display help for command

commands:
  set-token <token>         save a soundcloud oauth token into your keyring
  track [options] <url>     download a track
  playlist [options] <url>  download all tracks from a playlist
  help [command]            display help for command
```

### track

```
usage: downcloud track [options] <url>

download a track

arguments:
  url                        track url
  outfile                    path to save output file

options:
  -t, --token <string>       use a temporary soundcloud oauth token
  -o, --output <directory>   output directory
  -f, --format <format>      output format (mp3, m4a, flac)
  --download-archive <file>  download archive file (skip already archived tracks)
  --sync <file>              sync archive file (download new, remove deleted, rewrite archive)
  --debug                    print ffmpeg execution logs (default: false)
  -h, --help                 display help for command
```

### playlist

```
usage: downcloud playlist [options] <url>

download all tracks from a playlist

arguments:
  url                        playlist url

options:
  -t, --token <string>       use a temporary soundcloud oauth token
  -o, --output <directory>   output directory (default: playlist name)
  -f, --format <format>      output format (mp3, m4a, flac)
  --download-archive <file>  download archive file (skip already archived tracks)
  --sync <file>              sync archive file (download new, remove deleted, rewrite archive)
  --debug                    print ffmpeg execution logs (default: false)
  -h, --help                 display help for command
```

## library api

downcloud can also be used programmatically:

### track

```ts
import { resolveClientId, resolveUrl, downloadTrack, type Track } from "@yaaaarn/downcloud";

const clientId = await resolveClientId();
const data = await resolveUrl("https://soundcloud.com/hologura/yoho4", clientId) as Track;
const filePath = await downloadTrack(data, clientId);

console.log(`saved to ${filePath}`);
```

### playlist

```ts
import { resolveClientId, resolveUrl, downloadTrack, type PlaylistData } from "@yaaaarn/downcloud";

const clientId = await resolveClientId();
const data = await resolveUrl("https://soundcloud.com/user/sets/playlist", clientId) as PlaylistData;

for (const track of data.tracks) {
  if (!track.media?.transcodings?.length) continue;
  const filePath = await downloadTrack(track, clientId, undefined, data.title);
  console.log(filePath);
}
```

### exports

| export | description |
|---|---|
| `resolveClientId()` | resolve a soundcloud client id from their js assets |
| `resolveOauthToken(token?)` | get oauth token from arg, env, or system keychain |
| `resolveUrl(url, clientId)` | resolve a soundcloud url to track/playlist data |
| `downloadTrack(track, clientId, oauthToken?, outDir?, debug?, albumName?, customOutFile?, outFormat?)` | download a track to a file |
| `printAsciiWaveform(waveformUrl)` | print an ascii waveform to the console |
| `ArchiveHelper` | class for download-archive / sync functionality |
| `Track`, `Transcoding`, `AudioMetadata`, `SaveAudioOptions`, `PlaylistData` | type definitions |

## dev

```bash
# enter the dev shell (if using nix)
nix develop

# install dependencies
bun install

# build the binary
bun run build  # produces ./downcloud
```

## license

gpl-3.0 or later
