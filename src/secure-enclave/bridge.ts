import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { platform, userInfo } from 'node:os'
import { access, constants, readFile, unlink } from 'node:fs/promises'
import { createConnection } from 'node:net'
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

const SOCKET_PATH = `/tmp/coinfello-se-signer-${userInfo().username}.sock`
const PID_PATH = `/tmp/coinfello-se-signer-${userInfo().username}.pid`

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

// MARK: - Daemon Socket Client

async function sendDaemonRequest(request: Record<string, string>): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    const client = createConnection({ path: SOCKET_PATH }, () => {
      const data = JSON.stringify(request)
      client.end(data)
    })

    let response = ''
    client.on('data', (chunk) => {
      response += chunk.toString()
    })
    client.on('end', () => {
      try {
        const parsed = JSON.parse(response.trim())
        if (parsed.success) {
          resolve(parsed.result as Record<string, string>)
        } else {
          reject(new Error(`SecureEnclave [${parsed.error}]: ${parsed.message}`))
        }
      } catch {
        reject(new Error(`Invalid daemon response: ${response}`))
      }
    })
    client.on('error', (err) => {
      reject(err)
    })

    client.setTimeout(30_000, () => {
      client.destroy()
      reject(new Error('Daemon request timed out'))
    })
  })
}

export async function isDaemonRunning(): Promise<boolean> {
  try {
    await sendDaemonRequest({ command: 'ping' })
    return true
  } catch {
    return false
  }
}

export async function startDaemon(): Promise<{ pid: number; socket: string }> {
  const binaryPath = getBinaryPath()

  const child = spawn(binaryPath, ['daemon'], {
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.unref()

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''

    child.stdout!.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
      try {
        const ready = JSON.parse(stdout.trim())
        if (ready.status === 'ready') {
          child.stdout!.removeAllListeners()
          child.stderr!.removeAllListeners()
          resolve({ pid: ready.pid, socket: ready.socket })
        }
      } catch {
        // JSON not complete yet
      }
    })

    child.stderr!.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (err) => {
      reject(new Error(`Failed to start daemon: ${err.message}`))
    })

    child.on('exit', (code) => {
      if (code !== 0) {
        // Try to parse the stderr JSON error
        try {
          const parsed = JSON.parse(stderr.trim())
          reject(new Error(`Daemon exited: [${parsed.error}] ${parsed.message}`))
        } catch {
          reject(new Error(`Daemon exited with code ${code}: ${stderr}`))
        }
      }
    })

    setTimeout(() => reject(new Error('Daemon startup timed out')), 15_000)
  })
}

export async function stopDaemon(): Promise<void> {
  try {
    const pidStr = await readFile(PID_PATH, 'utf-8')
    const pid = parseInt(pidStr.trim(), 10)
    process.kill(pid, 'SIGTERM')
  } catch {
    // Try socket cleanup if PID file is stale
    try {
      await unlink(SOCKET_PATH)
    } catch {
      // ignore
    }
    try {
      await unlink(PID_PATH)
    } catch {
      // ignore
    }
  }
}

// MARK: - Command Execution (daemon-first with direct fallback)

async function runCommandDirect(args: string[]): Promise<Record<string, string>> {
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

async function runCommand(args: string[]): Promise<Record<string, string>> {
  // Try daemon first
  try {
    const command = args[0]
    const request: Record<string, string> = { command }

    if (command === 'sign') {
      const tagIdx = args.indexOf('--tag')
      const payloadIdx = args.indexOf('--payload')
      if (tagIdx >= 0 && tagIdx + 1 < args.length) request.tag = args[tagIdx + 1]
      if (payloadIdx >= 0 && payloadIdx + 1 < args.length) request.payload = args[payloadIdx + 1]
    } else if (command === 'get-public-key') {
      const tagIdx = args.indexOf('--tag')
      if (tagIdx >= 0 && tagIdx + 1 < args.length) request.tag = args[tagIdx + 1]
    }

    return await sendDaemonRequest(request)
  } catch {
    // Daemon not running or request failed; fall back to direct exec
    return await runCommandDirect(args)
  }
}

// MARK: - Public API

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
