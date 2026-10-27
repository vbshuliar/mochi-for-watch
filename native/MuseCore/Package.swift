// swift-tools-version: 6.0
import PackageDescription

let package = Package(
  name: "MuseCore", platforms: [.iOS(.v17), .watchOS(.v10), .macOS(.v14)],
  products: [.library(name: "MuseCore", targets: ["MuseCore"])],
  targets: [
    .target(name: "MuseCore"), .testTarget(name: "MuseCoreTests", dependencies: ["MuseCore"]),
  ])
