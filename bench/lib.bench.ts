import { bench, describe } from "vitest";
import {
  extractAssetUrls,
  findClientIdInChunk,
  compressWaveform,
  normalizeWaveform,
  renderAsciiWaveform,
  originalArtworkUrl,
  formatTime,
} from "../lib";

// --- Synthetic but representative inputs -------------------------------------

// A SoundCloud homepage references a handful of bundled JS assets among a large
// amount of surrounding markup. Build a realistically sized HTML document.
const homepageHtml = (() => {
  const filler = "<div class=\"l-container\">lorem ipsum dolor sit amet</div>".repeat(2000);
  const assets = Array.from(
    { length: 12 },
    (_, i) =>
      `<script crossorigin src="https://a-v2.sndcdn.com/assets/${i}-deadbeef${i}cafe.js"></script>`,
  ).join("\n");
  return `<!doctype html><html><head>${filler}</head><body>${assets}${filler}</body></html>`;
})();

// The asset chunk that actually contains the client_id is a large minified
// bundle; the token sits well into the file.
const assetChunkWithClientId = (() => {
  const head = "n.exports=function(e){return e};".repeat(8000);
  return `${head}var o={client_id:"a1B2c3D4e5F6g7H8i9J0kLmNoPqR",app_version:"172"};${head}`;
})();

// SoundCloud waveform payloads are arrays of amplitude samples. Real waveforms
// contain ~1800 samples; generate a deterministic, varied profile.
const waveformSamples = Array.from({ length: 1800 }, (_, i) =>
  Math.round((Math.sin(i / 17) * 0.5 + 0.5) * 100 + (i % 7) * 3),
);

const largeWaveformSamples = Array.from({ length: 20000 }, (_, i) =>
  Math.round((Math.sin(i / 23) * 0.5 + 0.5) * 100 + (i % 11) * 2),
);

const artworkUrl =
  "https://i1.sndcdn.com/artworks-000123456789-abcdef-large.jpg";

// --- Benchmarks --------------------------------------------------------------

describe("client_id discovery", () => {
  bench("extractAssetUrls (homepage HTML)", () => {
    extractAssetUrls(homepageHtml);
  });

  bench("findClientIdInChunk (minified asset bundle)", () => {
    findClientIdInChunk(assetChunkWithClientId);
  });
});

describe("waveform processing", () => {
  bench("compressWaveform (1800 samples)", () => {
    compressWaveform(waveformSamples, 75);
  });

  bench("normalizeWaveform (1800 samples)", () => {
    normalizeWaveform(waveformSamples, 75);
  });

  bench("renderAsciiWaveform (1800 samples)", () => {
    renderAsciiWaveform(waveformSamples, 75);
  });

  bench("renderAsciiWaveform (20000 samples)", () => {
    renderAsciiWaveform(largeWaveformSamples, 75);
  });
});

describe("metadata helpers", () => {
  bench("originalArtworkUrl", () => {
    originalArtworkUrl(artworkUrl);
  });

  bench("formatTime", () => {
    formatTime(213_456);
  });
});
