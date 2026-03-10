import Foundation
import Security
import LocalAuthentication

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


func loadPrivateKey(tag: String, authContext: LAContext? = nil) -> SecKey {
    let tagData = tag.data(using: .utf8)!

    var query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: tagData,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecReturnRef as String: true,
    ]
    if let ctx = authContext {
        query[kSecUseAuthenticationContext as String] = ctx
    }

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    guard status == errSecSuccess, let key = item else {
        exitWithError("key_not_found", "No Secure Enclave key found with tag: \(tag) (status: \(status))")
    }

    return key as! SecKey
}

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

func signPayload(tag: String, payloadHex: String, authContext: LAContext? = nil) {
    guard let payload = dataFromHex(payloadHex) else {
        exitWithError("invalid_payload", "Invalid hex payload")
    }

    let privateKey = loadPrivateKey(tag: tag, authContext: authContext)

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

func getPublicKey(tag: String, authContext: LAContext? = nil) {
    let privateKey = loadPrivateKey(tag: tag, authContext: authContext)

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

// MARK: - Daemon Mode

enum DaemonError: Error {
    case operationFailed(code: String, message: String)
}

/// Non-fatal versions of core operations for daemon use (return Result instead of exiting)

/// Cache loaded SecKey references to avoid re-querying the keychain (which re-checks LAContext validity)
var keyCache: [String: SecKey] = [:]

func daemonLoadPrivateKey(tag: String) throws -> SecKey {
    // Return cached key if available
    if let cached = keyCache[tag] {
        return cached
    }

    let tagData = tag.data(using: .utf8)!

    // Don't pass LAContext — the key's access control only has .privateKeyUsage (no .userPresence),
    // so it doesn't require per-use biometric auth. Passing an expired LAContext is what causes -25308.
    let query: [String: Any] = [
        kSecClass as String: kSecClassKey,
        kSecAttrApplicationTag as String: tagData,
        kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        kSecReturnRef as String: true,
    ]

    var item: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &item)

    guard status == errSecSuccess, let key = item else {
        throw DaemonError.operationFailed(code: "key_not_found", message: "No Secure Enclave key found with tag: \(tag) (status: \(status))")
    }

    let secKey = key as! SecKey
    keyCache[tag] = secKey
    return secKey
}

func daemonGenerateKey() throws -> [String: Any] {
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
        throw DaemonError.operationFailed(code: "access_control_failed", message: "Failed to create access control")
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
        throw DaemonError.operationFailed(code: "key_generation_failed", message: "Failed to generate key: \(msg)")
    }

    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        throw DaemonError.operationFailed(code: "public_key_extraction_failed", message: "Failed to extract public key")
    }

    var exportError: Unmanaged<CFError>?
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data? else {
        let msg = exportError?.takeRetainedValue().localizedDescription ?? "Unknown error"
        throw DaemonError.operationFailed(code: "public_key_export_failed", message: "Failed to export public key: \(msg)")
    }

    guard publicKeyData.count == 65, publicKeyData[0] == 0x04 else {
        throw DaemonError.operationFailed(code: "invalid_public_key", message: "Unexpected public key format (expected 65-byte uncompressed point)")
    }

    let x = publicKeyData[1...32]
    let y = publicKeyData[33...64]

    return [
        "tag": tag,
        "x": hexString(from: Data(x)),
        "y": hexString(from: Data(y)),
    ]
}

func daemonSignPayload(tag: String, payloadHex: String) throws -> [String: Any] {
    guard let payload = dataFromHex(payloadHex) else {
        throw DaemonError.operationFailed(code: "invalid_payload", message: "Invalid hex payload")
    }

    let privateKey = try daemonLoadPrivateKey(tag: tag)
    let algorithm = SecKeyAlgorithm.ecdsaSignatureMessageX962SHA256

    guard SecKeyIsAlgorithmSupported(privateKey, .sign, algorithm) else {
        throw DaemonError.operationFailed(code: "algorithm_unsupported", message: "ECDSA P256 SHA256 signing not supported on this device")
    }

    var error: Unmanaged<CFError>?
    guard let signature = SecKeyCreateSignature(
        privateKey,
        algorithm,
        payload as CFData,
        &error
    ) as Data? else {
        let msg = error?.takeRetainedValue().localizedDescription ?? "Unknown error"
        throw DaemonError.operationFailed(code: "signing_failed", message: "Failed to sign: \(msg)")
    }

    return ["signature": hexString(from: signature)]
}

func daemonGetPublicKey(tag: String) throws -> [String: Any] {
    let privateKey = try daemonLoadPrivateKey(tag: tag)

    guard let publicKey = SecKeyCopyPublicKey(privateKey) else {
        throw DaemonError.operationFailed(code: "public_key_extraction_failed", message: "Failed to extract public key")
    }

    var exportError: Unmanaged<CFError>?
    guard let publicKeyData = SecKeyCopyExternalRepresentation(publicKey, &exportError) as Data? else {
        let msg = exportError?.takeRetainedValue().localizedDescription ?? "Unknown error"
        throw DaemonError.operationFailed(code: "public_key_export_failed", message: "Failed to export public key: \(msg)")
    }

    guard publicKeyData.count == 65, publicKeyData[0] == 0x04 else {
        throw DaemonError.operationFailed(code: "invalid_public_key", message: "Unexpected public key format")
    }

    let x = publicKeyData[1...32]
    let y = publicKeyData[33...64]

    return [
        "x": hexString(from: Data(x)),
        "y": hexString(from: Data(y)),
    ]
}

func handleDaemonRequest(_ json: [String: Any]) -> Data {
    let command = json["command"] as? String ?? ""

    do {
        var result: [String: Any]
        switch command {
        case "ping":
            result = ["status": "ok"]
        case "generate":
            result = try daemonGenerateKey()
        case "sign":
            guard let tag = json["tag"] as? String, let payload = json["payload"] as? String else {
                return makeErrorResponse(code: "invalid_request", message: "Missing 'tag' or 'payload'")
            }
            result = try daemonSignPayload(tag: tag, payloadHex: payload)
        case "get-public-key":
            guard let tag = json["tag"] as? String else {
                return makeErrorResponse(code: "invalid_request", message: "Missing 'tag'")
            }
            result = try daemonGetPublicKey(tag: tag)
        default:
            return makeErrorResponse(code: "unknown_command", message: "Unknown command: \(command)")
        }
        return makeSuccessResponse(result: result)
    } catch let DaemonError.operationFailed(code, message) {
        // If we got an auth error, invalidate the key cache and suggest restart
        if message.contains("-25308") {
            keyCache.removeAll()
        }
        return makeErrorResponse(code: code, message: message)
    } catch {
        return makeErrorResponse(code: "internal_error", message: error.localizedDescription)
    }
}

func makeSuccessResponse(result: [String: Any]) -> Data {
    let response: [String: Any] = ["success": true, "result": result]
    return (try? JSONSerialization.data(withJSONObject: response)) ?? Data()
}

func makeErrorResponse(code: String, message: String) -> Data {
    let response: [String: Any] = ["success": false, "error": code, "message": message]
    return (try? JSONSerialization.data(withJSONObject: response)) ?? Data()
}

func getSocketPath() -> String {
    let username = NSUserName()
    return "/tmp/coinfello-se-signer-\(username).sock"
}

func getPidPath() -> String {
    let username = NSUserName()
    return "/tmp/coinfello-se-signer-\(username).pid"
}

func runDaemon() {
    let socketPath = getSocketPath()
    let pidPath = getPidPath()

    // 1. Authenticate with LAContext (triggers Touch ID / password)
    let context = LAContext()
    var authError: NSError?
    guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &authError) else {
        exitWithError("la_unavailable", "LocalAuthentication not available: \(authError?.localizedDescription ?? "unknown")")
    }

    let semaphore = DispatchSemaphore(value: 0)
    var authSuccess = false
    var authFailMessage = ""

    context.evaluatePolicy(
        .deviceOwnerAuthentication,
        localizedReason: "Authenticate for CoinFello Secure Enclave signing daemon"
    ) { success, error in
        authSuccess = success
        if !success {
            authFailMessage = error?.localizedDescription ?? "Authentication failed"
        }
        semaphore.signal()
    }
    semaphore.wait()

    guard authSuccess else {
        exitWithError("auth_failed", authFailMessage)
    }

    // 2. Remove stale socket
    unlink(socketPath)

    // 3. Create Unix domain socket
    let serverFd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard serverFd >= 0 else {
        exitWithError("socket_failed", "Cannot create socket: \(String(cString: strerror(errno)))")
    }

    var addr = sockaddr_un()
    addr.sun_family = sa_family_t(AF_UNIX)
    socketPath.withCString { ptr in
        withUnsafeMutablePointer(to: &addr.sun_path) { sunPath in
            let dest = UnsafeMutableRawPointer(sunPath).assumingMemoryBound(to: CChar.self)
            strcpy(dest, ptr)
        }
    }

    let bindResult = withUnsafePointer(to: &addr) { ptr in
        ptr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sockaddrPtr in
            bind(serverFd, sockaddrPtr, socklen_t(MemoryLayout<sockaddr_un>.size))
        }
    }
    guard bindResult == 0 else {
        exitWithError("bind_failed", "Cannot bind to \(socketPath): \(String(cString: strerror(errno)))")
    }

    // Set socket permissions to owner-only
    chmod(socketPath, 0o600)

    guard Darwin.listen(serverFd, 5) == 0 else {
        exitWithError("listen_failed", "Cannot listen on socket: \(String(cString: strerror(errno)))")
    }

    // 4. Write PID file
    let pid = ProcessInfo.processInfo.processIdentifier
    try? "\(pid)".write(toFile: pidPath, atomically: true, encoding: .utf8)

    // 5. Signal handlers for cleanup
    let cleanup: @convention(c) (Int32) -> Void = { _ in
        unlink(getSocketPath())
        unlink(getPidPath())
        exit(0)
    }
    signal(SIGTERM, cleanup)
    signal(SIGINT, cleanup)

    // 6. Print ready indicator to stdout
    outputJSON([
        "status": "ready",
        "socket": socketPath,
        "pid": pid,
    ])
    fflush(stdout)

    // 7. Accept loop (one request per connection)
    while true {
        let clientFd = accept(serverFd, nil, nil)
        guard clientFd >= 0 else { continue }

        // Read all data from client (they close write-half when done)
        var requestData = Data()
        var buf = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = read(clientFd, &buf, buf.count)
            if n <= 0 { break }
            requestData.append(contentsOf: buf[0..<n])
        }

        // Parse and handle
        var responseData: Data
        if let json = try? JSONSerialization.jsonObject(with: requestData) as? [String: Any] {
            responseData = handleDaemonRequest(json)
        } else {
            responseData = makeErrorResponse(code: "invalid_request", message: "Invalid JSON")
        }

        // Write response and close
        responseData.append("\n".data(using: .utf8)!)
        responseData.withUnsafeBytes { ptr in
            _ = write(clientFd, ptr.baseAddress!, responseData.count)
        }
        close(clientFd)
    }
}

// MARK: - CLI Entry Point

let args = CommandLine.arguments

guard args.count >= 2 else {
    exitWithError("usage", "Usage: SecureEnclaveSigner <generate|sign|get-public-key|daemon> [options]")
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

case "daemon":
    runDaemon()

default:
    exitWithError("usage", "Unknown command: \(command). Use generate, sign, get-public-key, or daemon.")
}
