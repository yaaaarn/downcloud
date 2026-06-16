{
  bun2nix,
  libsecret,
  glib,
  pkg-config,
  makeBinaryWrapper,
  ffmpeg,
  lib,
  ...
}:
let
  bunDeps = bun2nix.fetchBunDeps {
    bunNix = ./bun.nix;
  };
in
(bun2nix.mkDerivation {
  packageJson = ./package.json;
  src = ./.;
  inherit bunDeps;

  removeBunBuildFlags = [ "--bytecode" ];

  nativeBuildInputs = [
    pkg-config
    makeBinaryWrapper
  ];
}).overrideAttrs
  (oldAttrs: {
    postInstall = (oldAttrs.postInstall or "") + ''
      wrapProgram $out/bin/downcloud \
        --prefix LD_LIBRARY_PATH : "${
          lib.makeLibraryPath [
            libsecret
            glib
          ]
        }" \
        --prefix PATH : "${lib.makeLibraryPath [ ffmpeg ]}"
    '';
  })
