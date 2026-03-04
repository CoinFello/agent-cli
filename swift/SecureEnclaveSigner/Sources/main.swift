import Foundation
import Security

// MARK: - Helpers

func hexString(from data: Data) -> String {
    data.map { String(format: "%02x", $0) }.joined()
}

func dataFromHex(_ hex: String) -> Data? {
    var hex = hex.hasPrefix("0x") ? String(hex.dropFirst(2)) : hex
    guard hex.count % 2 == 0 else { return nil }
    var data = Data()
    while !hex.isEmpty {
        let byte = hex.prefix(2)
        hex = String(hex.dropFirst(2))
        guard let b = UInt8(byte, radix: 16) else { return nil }
        data.append(b)
    }
    return data
}

func outputJSON(_ dict: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: dict),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    }
}

func exitWithError(_ code: String, _ message: String) -> Never {
    let err = ["error": code, "message": message]
    if let data = try? JSONSerialization.data(withJSONObject: err),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(str.data(using: .utf8)!)
        FileHandle.standardError.write("\n".data(using: .utf8)!)
    }
    exit(1)
}

// MARK: - Secure Enclave Operations

func generateKey() {
    let uuid = UUID().uuidString.lowercased()
    let tag = "com.coinfello.agent-cli.\(uuid)"
    let tagData = tag.data(using: .utf8)!

    let access = SecAccessControlCreateWithFlags(
        kCFAllocatorDefault,
        kSecAttrAccessibleWhenUnlockedThisDeviceOnly,
        .privateKeyUsage,
        nil
    )

    guard let access = access else {
        exitWithError("access_control_failed", "Failed to create access control")
    }

    let attributes: [String: Any] = [
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecAttrKeySizeInBits as String: 256,
        kSecAttrTokenID as String: kSecAttrTokenIDSecureEnclave,
        kSecPrivateKeyAttrs as String: [
            kSecAttrIsPermanent as String: true,
            kSecAttrApplicationTag as String: tagData,
            kSecAttrAccessControl as String: access,
        ] as [String: Any],
    ]

    var error: Unmanaged<CFError>?
    guard let privateKey = SecKeyCreateRandomKey(attributes as CFDictionary, &error) else {
        let msg = error?.takeRetainedValue().localizedDescription ?? "Unknown error"
        exitWithError("key_generation_failed", "Failed to generate key: \(msg)")
    }

    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        exitWithError("public_key_extraction_failed", "Failed to extract public key")
    }

    var exportError: Unmanaged<CFError>?
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data? else {
        let msg = exportError?.takeRetainedValue().localizedDescription ?? "Unknown error"
        exitWithError("public_key_export_failed", "Failed to export public key: \(msg)")
    }

    // SEC1 uncompressed point: 0x04 || x (32 bytes) || y (32 bytes)
    guard publicKeyData.count == 65, publicKeyData[0] == 0x04 else {
        exitWithError("invalid_public_key", "Unexpected public key format (expected 65-byte uncompressed point)")
    }

    let x = publicKeyData[1...32]
    let y = publicKeyData[33...64]

    outputJSON([
        "tag": tag,
        "x": hexString(from: Data(x)),
        "y": hexString(from: Data(y)),
    ])
}

func loadPrivateKey(tag: String) -> SecKey {
    let tagData = tag.data(using: .utf8)!

    let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: tagData,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecReturnRef as String: true,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    guard status == errSecSuccess, let key = item else {
        exitWithError("key_not_found", "No Secure Enclave key found with tag: \(tag) (status: \(status))")
    }

    return key as! SecKey
}

func signPayload(tag: String, payloadHex: String) {
    guard let payload = dataFromHex(payloadHex) else {
        exitWithError("invalid_payload", "Invalid hex payload")
    }

    let privateKey = loadPrivateKey(tag: tag)

    // Try ecdsaSignatureMessageX962SHA256 first (SE hashes the payload internally)
    // This is the standard algorithm supported by all Secure Enclaves
    let algorithm = SecKeyAlgorithm.ecdsaSignatureMessageX962SHA256

    guard SecKeyIsAlgorithmSupported(privateKey, .sign, algorithm) else {
        exitWithError("algorithm_unsupported", "ECDSA P256 SHA256 signing not supported on this device")
    }

    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
        privateKey,
        algorithm,
        payload as CFData,
        &error
    ) as Data? else {
        let msg = error?.takeRetainedValue().localizedDescription ?? "Unknown error"
        exitWithError("signing_failed", "Failed to sign: \(msg)")
    }

    outputJSON([
        "signature": hexString(from: signature),
    ])
}

func getPublicKey(tag: String) {
    let privateKey = loadPrivateKey(tag: tag)

    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        exitWithError("public_key_extraction_failed", "Failed to extract public key")
    }

    var exportError: Unmanaged<CFError>?
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data? else {
        let msg = exportError?.takeRetainedValue().localizedDescription ?? "Unknown error"
        exitWithError("public_key_export_failed", "Failed to export public key: \(msg)")
    }

    guard publicKeyData.count == 65, publicKeyData[0] == 0x04 else {
        exitWithError("invalid_public_key", "Unexpected public key format")
    }

    let x = publicKeyData[1...32]
    let y = publicKeyData[33...64]

    outputJSON([
        "x": hexString(from: Data(x)),
        "y": hexString(from: Data(y)),
    ])
}

// MARK: - CLI Entry Point

let args = CommandLine.arguments

guard args.count >= 2 else {
    exitWithError("usage", "Usage: SecureEnclaveSigner <generate|sign|get-public-key> [options]")
}

let command = args[1]

switch command {
case "generate":
    generateKey()

case "sign":
    var tag: String?
    var payload: String?
    var i = 2
    while i < args.count {
        switch args[i] {
        case "--tag":
            i += 1
            guard i < args.count else { exitWithError("usage", "Missing value for --tag") }
            tag = args[i]
        case "--payload":
            i += 1
            guard i < args.count else { exitWithError("usage", "Missing value for --payload") }
            payload = args[i]
        default:
            exitWithError("usage", "Unknown option: \(args[i])")
        }
        i += 1
    }
    guard let tag = tag, let payload = payload else {
        exitWithError("usage", "Usage: SecureEnclaveSigner sign --tag <tag> --payload <hex>")
    }
    signPayload(tag: tag, payloadHex: payload)

case "get-public-key":
    var tag: String?
    var i = 2
    while i < args.count {
        switch args[i] {
        case "--tag":
            i += 1
            guard i < args.count else { exitWithError("usage", "Missing value for --tag") }
            tag = args[i]
        default:
            exitWithError("usage", "Unknown option: \(args[i])")
        }
        i += 1
    }
    guard let tag = tag else {
        exitWithError("usage", "Usage: SecureEnclaveSigner get-public-key --tag <tag>")
    }
    getPublicKey(tag: tag)

default:
    exitWithError("usage", "Unknown command: \(command). Use generate, sign, or get-public-key.")
}
