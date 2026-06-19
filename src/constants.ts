import { join } from "path";
import chalk from "chalk";

export const userAgent = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/149.0.7827.114 Safari/537.36";
export const CACHE_FILE = join(process.env.HOME || ".", ".downcloud_client_id");
export const WAVE_WIDTH = 75;

export const bright = chalk.hex("#E64D16");
export const pastel = chalk.hex("#FF9E6A");
export const dim = chalk.hex("#555555");
export const dimmer = chalk.hex("#666666");
