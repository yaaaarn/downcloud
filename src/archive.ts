import { appendFile } from "node:fs/promises";

export class ArchiveHelper {
  entries: Map<string, string>;
  processed: Set<string>;
  archive?: Bun.BunFile;
  enabled: boolean;

  constructor(public archiveFile?: string) {
    this.enabled = !!archiveFile;
    this.entries = new Map();
    this.processed = new Set();
    if (this.enabled) this.archive = Bun.file(archiveFile!);
  }

  async init() {
    if (!this.archive) return;
    try {
      if (!(await this.archive.exists())) return;
      const data = await this.archive.text();
      for (const line of data.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const firstSpace = trimmed.indexOf(" ");
        if (firstSpace === -1) continue;
        const secondSpace = trimmed.indexOf(" ", firstSpace + 1);
        if (secondSpace === -1) continue;
        this.entries.set(trimmed.slice(0, secondSpace), trimmed.slice(secondSpace + 1));
      }
    } catch { }
  }

  isArchived(trackId: number): boolean {
    return this.entries.has(`soundcloud ${trackId}`);
  }

  async append(trackId: number, filePath: string) {
    const key = `soundcloud ${trackId}`;
    if (!this.entries.has(key)) {
      await appendFile(this.archiveFile!, `${key} ${filePath}\n`);
      this.entries.set(key, filePath);
    }
  }

  getPath(trackId: number): string | undefined {
    return this.entries.get(`soundcloud ${trackId}`);
  }

  markProcessed(trackId: number, filePath: string) {
    const key = `soundcloud ${trackId}`;
    this.processed.add(key);
    this.entries.set(key, filePath);
  }

  async finalize() {
    if (!this.archive) return;

    await Promise.all(
      [...this.entries].map(async ([key, filePath]) => {
        if (!this.processed.has(key)) {
          try { await Bun.file(filePath).delete(); } catch { }
        }
      })
    );

    const lines = [...this.processed].map(k => `${k} ${this.entries.get(k)}`);
    await Bun.write(this.archive!, lines.length ? lines.join("\n") + "\n" : "");
  }
}
