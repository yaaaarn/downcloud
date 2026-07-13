{
  description = "downcloud";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    bun2nix.url = "github:nix-community/bun2nix";
    bun2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs =
    {
      self,
      nixpkgs,
      bun2nix,
    }:
    let
      supportedSystems = [
        "x86_64-linux"
        "aarch64-linux"
        "x86_64-darwin"
        "aarch64-darwin"
      ];
 
      forAllSystems = f: nixpkgs.lib.genAttrs supportedSystems (system: f system);
    in
    {
      packages = forAllSystems (system: {
        default = nixpkgs.legacyPackages.${system}.callPackage ./default.nix {
          bun2nix = bun2nix.packages.${system}.default;
        };
      });

      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          bun2nix' = bun2nix.packages.${system}.default;
        in
        {
          default = pkgs.mkShell {
            nativeBuildInputs = with pkgs; [ pkg-config ];
            buildInputs = with pkgs; lib.optionals (!stdenv.isDarwin) [ libsecret ];

            packages = with pkgs; [
              bun
              bun2nix'
            ];

            shellHook = ''
              export LD_LIBRARY_PATH="${
                pkgs.lib.makeLibraryPath (
                  (pkgs.lib.optionals (!pkgs.stdenv.isDarwin) [ pkgs.libsecret ]) ++ [ pkgs.glib ]
                )
              }:$LD_LIBRARY_PATH"
            '';
          };
        }
      );
    };
}
