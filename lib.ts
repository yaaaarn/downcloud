// Pure, side-effect-free helpers extracted from the downcloud CLI.
// Kept in a dedicated module so they can be unit-tested and benchmarked
// without importing the Bun-specific CLI entrypoint in `index.ts`.

/**
 * Extract SoundCloud asset (`*.js`) URLs from the homepage HTML.
 * These assets are scanned to discover the public `client_id`.
 */
export function extractAssetUrls(html: string): string[] {
  const assetRegex = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
  return Array.from(html.matchAll(assetRegex), m => m[1]).filter(
    (x): x is string => x != null,
  );
}

/**
 * Find a `client_id` value embedded in an asset chunk, if present.
 */
export function findClientIdInChunk(chunk: string): string | null {
  const match = chunk.match(/client_id:"([a-zA-Z0-9]+)"/);
  return match ? match[1]! : null;
}

/**
 * Downsample a waveform `samples` array to `targetWidth` buckets by averaging.
 */
export function compressWaveform(samples: number[], targetWidth: number): number[] {
  const compressed: number[] = [];
  const chunkSize = Math.ceil(samples.length / targetWidth);
  for (let i = 0; i < samples.length; i += chunkSize) {
    const chunk = samples.slice(i, i + chunkSize);
    const avg = chunk.reduce((sum, v) => sum + v, 0) / chunk.length;
    compressed.push(avg);
  }
  return compressed;
}

/**
 * Downsample and normalize a waveform to values in the [0, 1] range.
 */
export function normalizeWaveform(samples: number[], targetWidth: number): number[] {
  const compressed = compressWaveform(samples, targetWidth);
  const maxVal = Math.max(...compressed) || 1;
  return compressed.map(v => v / maxVal);
}

/**
 * Render a two-row ASCII representation of a waveform.
 */
export function renderAsciiWaveform(
  samples: number[],
  targetWidth = 75,
): { top: string; bottom: string } {
  const maxVal = Math.max(...samples) || 1;
  const compressed = compressWaveform(samples, targetWidth);

  const topSet = [" ", "▖", "▌"];
  const botSet = [" ", "▘", "▌"];

  const top = compressed
    .map(v => {
      const norm = v / maxVal;
      const index = Math.min(Math.floor(norm * topSet.length), topSet.length - 1);
      return topSet[index];
    })
    .join("");

  const bottom = compressed
    .map(v => {
      const norm = v / maxVal;
      const index = Math.min(Math.floor(norm * botSet.length), botSet.length - 1);
      return botSet[index];
    })
    .join("");

  return { top, bottom };
}

/**
 * Rewrite an artwork URL to point at the original (largest) resolution.
 */
export function originalArtworkUrl(url: string): string {
  return url.replace(/-(large|t\d+x\d+)(?=\.\w+)/, "-original");
}

/**
 * Format a millisecond duration as `mm:ss`.
 */
export function formatTime(ms: number): string {
  const sec = Math.floor(ms / 1000);
  return `${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
