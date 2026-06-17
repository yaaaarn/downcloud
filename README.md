# downcloud


a simple (and fast) soundcloud downloader.

## install

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
  url                       track url
  outfile                   path to save output file

options:
  -t, --token <string>      use a temporary soundcloud oauth token
  -o, --output <directory>  output directory
  --debug                   print ffmpeg execution logs (default: false)
  -h, --help                display help for command
```

### playlist

```
usage: downcloud playlist [options] <url>

download all tracks from a playlist

arguments:
  url                       playlist url

options:
  -t, --token <string>      use a temporary soundcloud oauth token
  -o, --output <directory>  output directory (default: playlist name)
  --debug                   print ffmpeg execution logs (default: false)
  -h, --help                display help for command
```

### set-token

```
usage: downcloud set-token [options] <token>

save a soundcloud oauth token into your keyring

arguments:
  token       soundcloud oauth token

options:
  -h, --help  display help for command
```

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
