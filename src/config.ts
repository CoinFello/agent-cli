import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Delegation } from "@metamask/smart-accounts-kit";

export interface Config {
  smart_account_address?: string;
  chain?: string;
  delegation?: Delegation;
}

const CONFIG_DIR = join(homedir(), ".clawdbot", "skills", "coinfello");
export const CONFIG_PATH = join(CONFIG_DIR, "config.json");

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as Config;
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return {};
    }
    throw err;
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}
