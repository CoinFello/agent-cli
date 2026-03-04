import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform } from 'node:os'
import { access, constants } from 'node:fs/promises'
import type { Hex } from 'viem'

const execFileAsync = promisify(execFile)

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

export interface SecureEnclaveKeyPair {
  tag: string
  x: bigint
  y: bigint
}

export interface SecureEnclaveSignature {
  derSignature: Hex
}

function getBinaryPath(): string {
  // The binary lives inside a .app bundle so macOS AMFI can find the
  // embedded provisioning profile for keychain-access-groups entitlements.
  // When running from dist/index.js, __dirname is the dist/ directory.
  return join(__dirname, 'secure-enclave-signer.app', 'Contents', 'MacOS', 'secure-enclave-signer')
}

export function isSecureEnclaveAvailable(): boolean {
  return platform() === 'darwin'
}

export async function isSecureEnclaveBinaryAvailable(): Promise<boolean> {
  if (!isSecureEnclaveAvailable()) return false
  try {
    await access(getBinaryPath(), constants.X_OK)
    return true
  } catch {
    return false
  }
}

async function runCommand(args: string[]): Promise<Record<string, string>> {
  const binaryPath = getBinaryPath()

  try {
    const { stdout } = await execFileAsync(binaryPath, args, {
      timeout: 30_000,
    })
    return JSON.parse(stdout.trim()) as Record<string, string>
  } catch (err: unknown) {
    const error = err as { stderr?: string; message?: string }
    if (error.stderr) {
      try {
        const parsed = JSON.parse(error.stderr.trim()) as { error: string; message: string }
        throw new Error(`SecureEnclave [${parsed.error}]: ${parsed.message}`)
      } catch (parseErr) {
        if (parseErr instanceof SyntaxError) {
          throw new Error(`SecureEnclave error: ${error.stderr}`)
        }
        throw parseErr
      }
    }
    throw new Error(`SecureEnclave command failed: ${error.message ?? 'Unknown error'}`)
  }
}

export async function generateKey(): Promise<SecureEnclaveKeyPair> {
  const result = await runCommand(['generate'])
  return {
    tag: result.tag,
    x: BigInt(`0x${result.x}`),
    y: BigInt(`0x${result.y}`),
  }
}

export async function signPayload(tag: string, payload: Hex): Promise<SecureEnclaveSignature> {
  const hex = payload.startsWith('0x') ? payload.slice(2) : payload
  const result = await runCommand(['sign', '--tag', tag, '--payload', hex])
  return {
    derSignature: `0x${result.signature}` as Hex,
  }
}

export async function getPublicKey(tag: string): Promise<{ x: bigint; y: bigint }> {
  const result = await runCommand(['get-public-key', '--tag', tag])
  return {
    x: BigInt(`0x${result.x}`),
    y: BigInt(`0x${result.y}`),
  }
}
