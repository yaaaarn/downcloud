// Pure, side-effect-free helpers extracted from the downcloud CLI.
// Kept in a dedicated module so they can be unit-tested and benchmarked
// without importing the Bun-specific CLI entrypoint in `index.ts`.

/**
 * Extract SoundCloud asset (`*.js`) URLs from the homepage HTML.
 * These assets are scanned to discover the public `client_id`.
 */
export function extractAssetUrls(html: string): string[] {
  const urls: string[] = [];
  const re = /src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    urls.push(m[1]);
  }
  return urls;
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
  const n = samples.length;
  const chunkSize = Math.ceil(n / targetWidth);
  const compressed: number[] = [];
  for (let i = 0; i < n; i += chunkSize) {
    let sum = 0;
    const end = Math.min(i + chunkSize, n);
    for (let j = i; j < end; j++) {
      sum += samples[j];
    }
    compressed.push(sum / (end - i));
  }
  return compressed;
}

/**
 * Downsample and normalize a waveform to values in the [0, 1] range.
 */
export function normalizeWaveform(samples: number[], targetWidth: number): number[] {
  const compressed = compressWaveform(samples, targetWidth);
  let maxVal = 0;
  for (let i = 0; i < compressed.length; i++) {
    if (compressed[i] > maxVal) maxVal = compressed[i];
  }
  maxVal = maxVal || 1;
  for (let i = 0; i < compressed.length; i++) {
    compressed[i] /= maxVal;
  }
  return compressed;
}

/**
 * Render a two-row ASCII representation of a waveform.
 */
export function renderAsciiWaveform(
  samples: number[],
  targetWidth = 75,
): { top: string; bottom: string } {
  let maxVal = 0;
  for (let i = 0; i < samples.length; i++) {
    if (samples[i] > maxVal) maxVal = samples[i];
  }
  maxVal = maxVal || 1;

  const compressed = compressWaveform(samples, targetWidth);
  const topSet = [" ", "▖", "▌"];
  const botSet = [" ", "▘", "▌"];
  const setLen = topSet.length;

  let top = "";
  let bottom = "";
  for (let i = 0; i < compressed.length; i++) {
    const norm = compressed[i] / maxVal;
    const index = Math.min((norm * setLen) | 0, setLen - 1);
    top += topSet[index];
    bottom += botSet[index];
  }

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
