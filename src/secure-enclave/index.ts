export {
  isSecureEnclaveAvailable,
  generateKey,
  getPublicKey,
  startDaemon,
  stopDaemon,
  isDaemonRunning,
} from './bridge.js'
export { createSecureEnclaveGetFn } from './getFn.js'
