import { WAVE_WIDTH, dim } from "./constants";

export function compressWaveform(samples: number[], targetWidth: number): number[] {
  const n = samples.length;
  const chunkSize = Math.ceil(n / targetWidth);
  const compressed: number[] = [];
  for (let i = 0; i < n; i += chunkSize) {
    let sum = 0;
    const end = Math.min(i + chunkSize, n);
    for (let j = i; j < end; j++) {
      sum += samples[j]!;
    }
    compressed.push(sum / (end - i));
  }
  return compressed;
}

export function clampIndex(value: number, max: number): number {
  return Math.min(Math.floor(value), max);
}

async function fetchWaveformRows(url: string, width: number): Promise<{ top: string; bottom: string } | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const { samples } = await res.json() as { samples: number[] };
    if (!samples?.length) return null;

    const compressed = compressWaveform(samples, width);
    let maxVal = 0;
    for (let i = 0; i < compressed.length; i++) {
      if (compressed[i]! > maxVal) maxVal = compressed[i]!;
    }
    maxVal = maxVal || 1;

    const topSet = [" ", "▖", "▌"];
    const botSet = [" ", "▘", "▌"];

    const topChars = new Array<string>(compressed.length);
    const botChars = new Array<string>(compressed.length);
    for (let i = 0; i < compressed.length; i++) {
      const n = compressed[i]! / maxVal;
      topChars[i] = topSet[clampIndex(n * topSet.length, topSet.length - 1)]!;
      botChars[i] = botSet[clampIndex(n * botSet.length, botSet.length - 1)]!;
    }
    const top = topChars.join("");
    const bottom = botChars.join("");

    return { top, bottom };
  } catch {
    return null;
  }
}

export async function printAsciiWaveform(waveformUrl: string) {
  const rows = await fetchWaveformRows(waveformUrl, WAVE_WIDTH);
  if (!rows) return;
  console.log();
  console.log(rows.top);
  console.log(`${dim(rows.bottom)}\n`);
}

export { fetchWaveformRows };
