{
  bun2nix,
  libsecret,
  glib,
  pkg-config,
  makeBinaryWrapper,
  ffmpeg,
  lib,
  stdenv,
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
          lib.makeLibraryPath (
            lib.optionals (!stdenv.isDarwin) [ libsecret ] ++ [ glib ]
          )
        }" \
        --prefix PATH : "${lib.makeLibraryPath [ ffmpeg ]}"
    '';
  })
