{
  description = "downcloud - a simple (and fast) soundcloud downloader";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    flake-utils.url = "github:numtide/flake-utils";
    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
      bun2nix,
    }@inputs:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};
        bun2nix' = bun2nix.packages.${system}.default;
      in
      {
        packages.default = pkgs.callPackage ./default.nix { bun2nix = bun2nix'; };
        devShells.default = pkgs.mkShell {
          nativeBuildInputs = with pkgs; [ pkg-config ];
          buildInputs = with pkgs; [ libsecret ];

          packages = with pkgs; [
            bun
            bun2nix'
          ];

          shellHook = ''
            export LD_LIBRARY_PATH="${
              pkgs.lib.makeLibraryPath [
                pkgs.libsecret
                pkgs.glib
              ]
            }:$LD_LIBRARY_PATH"
          '';
        };
      }
    );
}
