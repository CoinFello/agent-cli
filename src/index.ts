import { Command } from 'commander'
import { createSmartAccount, createSmartAccountWithSecureEnclave } from './account.js'
import { loadConfig, saveConfig, CONFIG_PATH } from './config.js'
import { sendConversation, BASE_URL_V1, BASE_URL } from './api.js'
import { loadSessionToken } from './cookies.js'
import { signInWithAgent } from './siwe.js'
import { generatePrivateKey } from 'viem/accounts'
import type { Delegation } from '@metamask/smart-accounts-kit'
import {
  isSecureEnclaveAvailable,
  startDaemon,
  stopDaemon,
  isDaemonRunning,
} from './secure-enclave/index.js'
import {
  loadPendingDelegation,
  clearPendingDelegation,
  formatDelegationRequestForDisplay,
  signAndSubmitDelegation,
  handleConversationResponse,
} from './delegation.js'
import packageJson from '../package.json'

const program = new Command()

program
  .name('coinfello')
  .description('CoinFello CLI - Smart Account interactions')
  .version(packageJson.version)

// ── create_account ──────────────────────────────────────────────
program
  .command('create_account')
  .description('Create a smart account and save its address to local config')
  .option(
    '--use-unsafe-private-key',
    'Use a raw private key instead of hardware-backed key (Secure Enclave / TPM 2.0)'
  )
  .option('--delete-existing-private-key', 'Delete the existing account and create a new one')
  .action(async (opts: { useUnsafePrivateKey?: boolean; deleteExistingPrivateKey?: boolean }) => {
    try {
      const config = await loadConfig()
      if (config.smart_account_address) {
        if (!opts.deleteExistingPrivateKey) {
          console.error(
            `Error: An account already exists (${config.smart_account_address}). ` +
              'Use --delete-existing-private-key to overwrite it.'
          )
          process.exit(1)
        }
        console.warn('Deleting existing account and creating a new one...')
      }

      const useHardwareKey = !opts.useUnsafePrivateKey && isSecureEnclaveAvailable()

      if (useHardwareKey) {
        console.log(`Creating Secure Enclave-backed smart account`)
        const { address, keyTag, publicKeyX, publicKeyY, keyId } =
          await createSmartAccountWithSecureEnclave()

        config.signer_type = 'secureEnclave'
        config.smart_account_address = address
        config.secure_enclave = {
          key_tag: keyTag,
          public_key_x: publicKeyX,
          public_key_y: publicKeyY,
          key_id: keyId,
        }
        delete config.private_key
        await saveConfig(config)

        console.log('Secure Enclave smart account created successfully.')
        console.log(`Address: ${address}`)
        console.log(`Key tag: ${keyTag}`)
        console.log(`Config saved to: ${CONFIG_PATH}`)
      } else {
        if (!opts.useUnsafePrivateKey) {
          console.warn(
            'Warning: No hardware key support detected. Falling back to raw private key.'
          )
        }
        console.log(`Creating smart account...`)
        const privateKey = generatePrivateKey()
        const { address } = await createSmartAccount(privateKey, 1)

        config.private_key = privateKey
        config.signer_type = 'privateKey'
        config.smart_account_address = address
        await saveConfig(config)

        console.log('Smart account created successfully.')
        console.log(`Address: ${address}`)
        console.log(`Config saved to: ${CONFIG_PATH}`)
      }
    } catch (err) {
      console.error(`Failed to create account: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// ── get_account ─────────────────────────────────────────────────
program
  .command('get_account')
  .description('Display the current smart account address from local config')
  .action(async () => {
    try {
      const config = await loadConfig()
      if (!config.smart_account_address) {
        console.error("Error: No smart account found. Run 'create_account' first.")
        process.exit(1)
      }

      console.log(config.smart_account_address)
    } catch (err) {
      console.error(`Failed to get account: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// ── sign_in ─────────────────────────────────────────────────────
program
  .command('sign_in')
  .description('Sign in to a server using SIWE with your smart account')
  .option(
    '--base-url <baseUrl>',
    'The server base URL override (e.g. https://api.example.com)',
    `${BASE_URL}api/auth`
  )
  .action(async (opts: { baseUrl: string }) => {
    try {
      console.log('Signing in with smart account...')
      const config = await loadConfig()
      const result = await signInWithAgent(opts.baseUrl, config)
      console.log('Sign-in successful.')
      console.log(`User ID: ${result.user.id}`)
      console.log(`Session token saved to config.`)
    } catch (err) {
      console.error(`Failed to sign in: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// ── set_delegation ──────────────────────────────────────────────
program
  .command('set_delegation')
  .description('Store a signed delegation (JSON) in local config')
  .argument('<delegation>', 'The signed delegation as a JSON string')
  .action(async (delegationJson: string) => {
    try {
      const delegation = JSON.parse(delegationJson) as Delegation

      const config = await loadConfig()
      config.delegation = delegation
      await saveConfig(config)

      console.log('Delegation saved successfully.')
      console.log(`Config saved to: ${CONFIG_PATH}`)
    } catch (err) {
      console.error(`Failed to set delegation: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// ── new_chat ────────────────────────────────────────────────────
program
  .command('new_chat')
  .description('Clear the saved chat ID from local config and start a fresh conversation')
  .action(async () => {
    try {
      const config = await loadConfig()
      delete config.chat_id
      await saveConfig(config)
      await clearPendingDelegation()

      console.log('Saved chat ID cleared successfully.')
      console.log(`Config saved to: ${CONFIG_PATH}`)
    } catch (err) {
      console.error(`Failed to clear chat ID: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// ── send_prompt ─────────────────────────────────────────────────
program
  .command('send_prompt')
  .description('Send a prompt to CoinFello. If a delegation is requested, saves it for review.')
  .argument('<prompt>', 'The prompt to send')
  .action(async (prompt: string) => {
    try {
      const config = await loadConfig()
      if (!config.smart_account_address) {
        console.error("Error: No smart account found. Run 'create_account' first.")
        process.exit(1)
      }
      if (config.signer_type !== 'secureEnclave' && !config.private_key) {
        console.error("Error: No private key found in config. Run 'create_account' first.")
        process.exit(1)
      }

      if (config.session_token) {
        await loadSessionToken(config.session_token, BASE_URL_V1)
      }

      console.log('Sending prompt...')
      const response = await sendConversation({
        prompt,
        chatId: config.chat_id,
      })

      await handleConversationResponse(response, config, prompt)
    } catch (err) {
      console.error(`Failed to send prompt: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// ── approve_delegation_request ─────────────────────────────────
program
  .command('approve_delegation_request')
  .description('Approve and sign a pending delegation request, then submit it to CoinFello')
  .action(async () => {
    try {
      const config = await loadConfig()
      if (!config.smart_account_address) {
        console.error("Error: No smart account found. Run 'create_account' first.")
        process.exit(1)
      }
      if (config.signer_type !== 'secureEnclave' && !config.private_key) {
        console.error("Error: No private key found in config. Run 'create_account' first.")
        process.exit(1)
      }

      const pending = await loadPendingDelegation()

      console.log('Approving delegation request...')
      console.log(formatDelegationRequestForDisplay(pending))

      if (config.session_token) {
        await loadSessionToken(config.session_token, BASE_URL_V1)
      }

      const finalResponse = await signAndSubmitDelegation(config, pending)

      await clearPendingDelegation()

      await handleConversationResponse(finalResponse, config, pending.originalPrompt)
    } catch (err) {
      console.error(`Failed to approve delegation: ${(err as Error).message}`)
      process.exit(1)
    }
  })

// ── signer-daemon ─────────────────────────────────────────────
const signerDaemon = program
  .command('signer-daemon')
  .description('Manage the Secure Enclave signing daemon')

signerDaemon
  .command('start')
  .description('Start the signing daemon (authenticates via Touch ID / password once)')
  .action(async () => {
    try {
      const running = await isDaemonRunning()
      if (running) {
        console.log('Signing daemon is already running.')
        return
      }
      console.log('Starting signing daemon (authenticate when prompted)...')
      const { pid, socket } = await startDaemon()
      console.log(`Signing daemon started.`)
      console.log(`PID: ${pid}`)
      console.log(`Socket: ${socket}`)
    } catch (err) {
      console.error(`Failed to start daemon: ${(err as Error).message}`)
      process.exit(1)
    }
  })

signerDaemon
  .command('stop')
  .description('Stop the signing daemon')
  .action(async () => {
    try {
      const running = await isDaemonRunning()
      if (!running) {
        console.log('Signing daemon is not running.')
        return
      }
      await stopDaemon()
      console.log('Signing daemon stopped.')
    } catch (err) {
      console.error(`Failed to stop daemon: ${(err as Error).message}`)
      process.exit(1)
    }
  })

signerDaemon
  .command('status')
  .description('Check if the signing daemon is running')
  .action(async () => {
    const running = await isDaemonRunning()
    if (running) {
      console.log('Signing daemon is running.')
    } else {
      console.log('Signing daemon is not running.')
    }
  })

program.parse()
