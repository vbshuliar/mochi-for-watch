// swift-tools-version: 6.0
// Host-side verification compiles the exact production conversation sources.
// The Xcode apps use the MuseCore subpackage and their platform audio implementations.
import Foundation
import PackageDescription

let package = Package(
  name: "MuseNativeVerification",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "MuseSmoke", dependencies: ["MuseCore"], path: "Smoke"),
    .target(name: "MuseCore", path: "MuseCore/Sources/MuseCore"),
    .target(
      name: "MuseConversation", dependencies: ["MuseCore"], path: ".",
      exclude: [
        "MuseCore", "Smoke", "Tests", "Watch", "Resources", "Verification", "scripts",
        "MuseForWatch.xcodeproj", "project.yml", "README.md", "Generated",
        "iPhone/MemoryView.swift", "iPhone/TasksView.swift", "iPhone/DemoSetup.swift", "iPhone/MusePhoneApp.swift",
        "Shared/DailySupportView.swift", "Shared/ActionReview.swift", "Shared/AudioController.swift",
        "Shared/JollyView.swift", "Shared/PhoneWatchBridge.swift", "Shared/RealtimeTranscriber.swift",
        "Shared/PlatformBootstrap.swift", "Shared/TaskNotifications.swift",
      ] + ["Local", "DerivedData", "DerivedDataSigned"].filter {
        FileManager.default.fileExists(atPath: URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent($0).path)
      },
      sources: ["Shared/DailySupportModel.swift", "Shared/ConnectionStore.swift", "Shared/ConversationModel.swift", "Shared/VoiceInterfaces.swift", "Shared/SerialRegistrationQueue.swift", "iPhone/PhoneModel.swift"]),
    .testTarget(
      name: "MuseCoreTests", dependencies: ["MuseCore"], path: "MuseCore/Tests/MuseCoreTests"),
    .testTarget(
      name: "MuseNativeTests", dependencies: ["MuseCore", "MuseConversation"], path: "Tests"),
  ]
)
