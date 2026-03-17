import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Delegation } from '@metamask/smart-accounts-kit'

export interface Config {
  private_key?: string
  smart_account_address?: string
  chat_id?: string
  delegation?: Delegation
  session_token?: string
  signer_type?: 'privateKey' | 'secureEnclave'
  secure_enclave?: {
    key_tag: string
    public_key_x: string // hex
    public_key_y: string // hex
    key_id: string // hex, on-chain P256 key identifier
  }
}

export const CONFIG_DIR = join(homedir(), '.clawdbot', 'skills', 'coinfello')
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json')

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await readFile(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw) as Config
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {}
    }
    throw err
  }
}

export async function saveConfig(config: Config): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf-8')
}
