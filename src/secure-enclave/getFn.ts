import { createHash } from 'node:crypto'
import { signPayload } from './bridge.js'
import type { Hex } from 'viem'

const RPID = 'localhost'
const ORIGIN = 'https://localhost'

function sha256(data: Buffer): Buffer {
  return createHash('sha256').update(data).digest()
}

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64url')
}

/**
 * Creates a custom `getFn` for `toWebAuthnAccount` that signs using the macOS
 * Secure Enclave instead of browser WebAuthn APIs.
 *
 * The flow:
 * 1. ox's `WebAuthnP256.sign` calls this `getFn` with credential request options
 * 2. We construct authenticatorData and clientDataJSON manually
 * 3. We pass `authenticatorData || sha256(clientDataJSON)` to the Secure Enclave
 *    which applies SHA-256 internally (ecdsaSignatureMessageX962SHA256)
 * 4. We return a synthetic PublicKeyCredential that ox can parse
 */
export function createSecureEnclaveGetFn(keyTag: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async function getFn(options?: any): Promise<any> {
    // 1. Extract challenge from credential request options
    const challengeBuffer = options?.publicKey?.challenge
    if (!challengeBuffer) {
      throw new Error('No challenge in credential request options')
    }
    const challenge = Buffer.from(challengeBuffer)
    const challengeBase64Url = toBase64Url(challenge)

    // 2. Construct authenticatorData
    //    Format: rpIdHash (32 bytes) || flags (1 byte) || signCount (4 bytes)
    //    flags: 0x05 = UP (bit 0) + UV (bit 2)
    const rpIdHash = sha256(Buffer.from(RPID, 'utf-8'))
    const flags = Buffer.from([0x05])
    const signCount = Buffer.alloc(4) // 0x00000000
    const authenticatorData = Buffer.concat([rpIdHash, flags, signCount])

    // 3. Construct clientDataJSON
    const clientDataObj = {
      type: 'webauthn.get',
      challenge: challengeBase64Url,
      origin: ORIGIN,
      crossOrigin: false,
    }
    const clientDataJSON = JSON.stringify(clientDataObj)
    const clientDataBuffer = Buffer.from(clientDataJSON, 'utf-8')

    // 4. Build signing payload: authenticatorData || sha256(clientDataJSON)
    //    The Secure Enclave uses ecdsaSignatureMessageX962SHA256 which will
    //    SHA-256 this payload internally, producing:
    //    sha256(authenticatorData || sha256(clientDataJSON))
    //    This matches what the on-chain P256 verifier expects.
    const clientDataHash = sha256(clientDataBuffer)
    const payload = Buffer.concat([authenticatorData, clientDataHash])
    const payloadHex = `0x${payload.toString('hex')}` as Hex

    // 5. Sign with Secure Enclave
    const { derSignature } = await signPayload(keyTag, payloadHex)

    // 6. Convert DER signature to raw bytes
    const sigHex = derSignature.startsWith('0x') ? derSignature.slice(2) : derSignature
    const signatureBuffer = Buffer.from(sigHex, 'hex')

    // 7. Return synthetic PublicKeyCredential
    //    ox's WebAuthnP256.sign accesses:
    //    - credential.response.authenticatorData (ArrayBuffer)
    //    - credential.response.clientDataJSON (ArrayBuffer)
    //    - credential.response.signature (ArrayBuffer, DER/ASN.1 encoded)
    const credentialId = Buffer.from(keyTag, 'utf-8').toString('base64url')

    return {
      id: credentialId,
      type: 'public-key',
      rawId: toArrayBuffer(Buffer.from(keyTag, 'utf-8')),
      authenticatorAttachment: 'platform',
      response: {
        authenticatorData: toArrayBuffer(authenticatorData),
        clientDataJSON: toArrayBuffer(clientDataBuffer),
        signature: toArrayBuffer(signatureBuffer),
      },
      getClientExtensionResults: () => ({}),
    }
  }
}

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  const ab = new ArrayBuffer(buf.byteLength)
  const view = new Uint8Array(ab)
  view.set(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength))
  return ab
}
