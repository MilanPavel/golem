// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "GolemKit",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "GolemKit", targets: ["GolemKit"]),
    ],
    targets: [
        .target(name: "GolemKit"),
        .testTarget(name: "GolemKitTests", dependencies: ["GolemKit"]),
    ]
)
