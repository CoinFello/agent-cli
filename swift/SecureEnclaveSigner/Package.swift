// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "SecureEnclaveSigner",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(name: "SecureEnclaveSigner", path: "Sources")
    ]
)
