// swift-tools-version: 6.0
// Host-side verification compiles the exact production conversation sources.
// The Xcode apps use the MochiCore subpackage and their platform audio implementations.
import Foundation
import PackageDescription

let package = Package(
  name: "MochiNativeVerification",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "MochiSmoke", dependencies: ["MochiCore"], path: "Smoke"),
    .target(name: "MochiCore", path: "MochiCore/Sources/MochiCore"),
    .target(
      name: "MochiConversation", dependencies: ["MochiCore"], path: ".",
      exclude: [
        "MochiCore", "Smoke", "Tests", "Watch", "Resources", "Verification", "scripts",
        "MochiForWatch.xcodeproj", "project.yml", "README.md", "Generated",
        "iPhone/MemoryView.swift", "iPhone/TasksView.swift", "iPhone/DemoSetup.swift", "iPhone/MochiPhoneApp.swift",
        "Shared/DailySupportView.swift", "Shared/ActionReview.swift", "Shared/AudioController.swift",
        "Shared/MochiView.swift", "Shared/PhoneWatchBridge.swift", "Shared/RealtimeTranscriber.swift",
        "Shared/PlatformBootstrap.swift", "Shared/TaskNotifications.swift",
      ] + ["Local", "DerivedData", "DerivedDataSigned"].filter {
        FileManager.default.fileExists(atPath: URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent($0).path)
      },
      sources: ["Shared/DailySupportModel.swift", "Shared/ConnectionStore.swift", "Shared/ConversationModel.swift", "Shared/VoiceInterfaces.swift", "Shared/SerialRegistrationQueue.swift", "iPhone/PhoneModel.swift"]),
    .testTarget(
      name: "MochiCoreTests", dependencies: ["MochiCore"], path: "MochiCore/Tests/MochiCoreTests"),
    .testTarget(
      name: "MochiNativeTests", dependencies: ["MochiCore", "MochiConversation"], path: "Tests"),
  ]
)
