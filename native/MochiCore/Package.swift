// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "MochiCore", platforms: [.iOS(.v17), .watchOS(.v10), .macOS(.v14)],
  products: [.library(name: "MochiCore", targets: ["MochiCore"])],
  targets: [
    .target(name: "MochiCore"), .testTarget(name: "MochiCoreTests", dependencies: ["MochiCore"]),
  ])
