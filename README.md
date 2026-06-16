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

## usage

```
usage: downcloud [options] [command]

a simple (and fast) soundcloud downloader

options:
  -V, --version                    output the version number
  -h, --help                       display help for command

commands:
  set-token <token>                save a soundcloud oauth token into your keyring
  track [options] <url> [outfile]  download a track
  help [command]                   display help for command
```

### track

```
usage: downcloud track [options] <url> [outfile]

download a track

arguments:
  url                   track url
  outfile               path to save output file

options:
  -t, --token <string>  use a temporary soundcloud oauth token
  --debug               print ffmpeg execution logs (default: false)
  -h, --help            display help for command
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

gpl3.0 or later
