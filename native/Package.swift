// swift-tools-version: 6.0
// Host-side verification compiles the exact production conversation sources.
// The Xcode apps use the MuseCore subpackage and their platform audio implementations.
import PackageDescription

let package = Package(
  name: "MuseNativeVerification",
  platforms: [.macOS(.v14)],
  targets: [
    .executableTarget(name: "MuseSmoke", dependencies: ["MuseCore"], path: "Smoke"),
    .target(name: "MuseCore", path: "MuseCore/Sources/MuseCore"),
    .target(
      name: "MuseConversation", dependencies: ["MuseCore"], path: "Shared",
      exclude: [
        "ActionReview.swift", "AudioController.swift", "JollyView.swift", "PhoneWatchBridge.swift",
        "RealtimeTranscriber.swift", "PlatformBootstrap.swift", "TaskNotifications.swift",
      ],
      sources: ["ConnectionStore.swift", "ConversationModel.swift", "VoiceInterfaces.swift", "SerialRegistrationQueue.swift"]),
    .testTarget(
      name: "MuseCoreTests", dependencies: ["MuseCore"], path: "MuseCore/Tests/MuseCoreTests"),
    .testTarget(
      name: "MuseNativeTests", dependencies: ["MuseCore", "MuseConversation"], path: "Tests"),
  ]
)
