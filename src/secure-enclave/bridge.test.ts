import { describe, it, expect, beforeAll } from 'vitest'
import { p256 } from '@noble/curves/nist.js'
import {
  isSecureEnclaveBinaryAvailable,
  generateKey,
  signPayload,
  type SecureEnclaveKeyPair,
} from './bridge.js'

// Skip entire suite on non-macOS (Secure Enclave is macOS-only)
describe.skipIf(process.platform !== 'darwin')(
  'Secure Enclave Bridge Integration',
  () => {
    beforeAll(async () => {
      const binaryAvailable = await isSecureEnclaveBinaryAvailable()
      if (!binaryAvailable) {
        throw new Error(
          'Secure Enclave binary not found. Run `npm run build:swift` first.'
        )
      }
    })

    it('signs 0xdeadbeef and verifies signature against public key', async (ctx) => {
      // Persistent SE keys require a Developer ID-signed binary (Team ID entitlement).
      // Skip gracefully in dev environments without proper code signing.
      let keyPair: SecureEnclaveKeyPair
      try {
        keyPair = await generateKey()
      } catch {
        ctx.skip()
        return
      }

      const { derSignature } = await signPayload(keyPair.tag, '0xdeadbeef' as `0x${string}`)
      expect(derSignature).toMatch(/^0x[0-9a-f]+$/i)

      // p256.verify applies SHA-256 internally (matching Swift's ecdsaSignatureMessageX962SHA256),
      // so pass the raw payload bytes — not a pre-computed hash.
      const rawPayloadBytes = Uint8Array.from(Buffer.from('deadbeef', 'hex'))
      const sigBytes = Uint8Array.from(Buffer.from(derSignature.slice(2), 'hex'))

      // Build uncompressed public key bytes: 04 || x (32 bytes) || y (32 bytes)
      const xHex = keyPair.x.toString(16).padStart(64, '0')
      const yHex = keyPair.y.toString(16).padStart(64, '0')
      const pubKeyBytes = Uint8Array.from(Buffer.from('04' + xHex + yHex, 'hex'))

      // Verify (Swift produces DER-encoded signatures)
      const isValid = p256.verify(sigBytes, rawPayloadBytes, pubKeyBytes, { format: 'der' })
      expect(isValid).toBe(true)
    })
  }
)
