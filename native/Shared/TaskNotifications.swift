import Foundation
import MochiCore
import Observation
import UserNotifications
#if os(iOS)
import UIKit
#elseif os(watchOS)
import WatchKit
#endif

/// Push is opt-in and requires a provisioned build and a configured APNs provider.
@MainActor @Observable final class TaskNotifications: NSObject, UNUserNotificationCenterDelegate {
  static let shared = TaskNotifications()
  private(set) var status = "Notifications are off"
  private(set) var enabled = false
  private(set) var busy = false
  var openedTaskID: String?
  var openedReminderID: String?
  private var connection: Connection?
  private var deviceToken: String?
  private var registrationConnection: Connection?
  private var generation = UUID()
  private let registrationQueue = SerialRegistrationQueue()
  private var pendingRemovals: [Connection] = []
  private let defaults = UserDefaults.standard
  private var deviceID: String {
    if let id = defaults.string(forKey: "muse.push.deviceID") { return id }
    let id = UUID().uuidString
    defaults.set(id, forKey: "muse.push.deviceID")
    return id
  }
  private(set) var optedIn: Bool {
    get { defaults.bool(forKey: "muse.push.optedIn") }
    set { defaults.set(newValue, forKey: "muse.push.optedIn") }
  }
  private var environment: String? {
    switch Bundle.main.object(forInfoDictionaryKey: "MochiPushEnvironment") as? String {
    case "development": return "sandbox"
    case "production": return "production"
    default: return nil
    }
  }
  override private init() {
    super.init()
    UNUserNotificationCenter.current().delegate = self
  }
  func configure(_ next: Connection?) {
    guard connection != next else { return }
    let old = registrationConnection ?? connection
    connection = next
    generation = UUID()
    enabled = false
    registrationConnection = nil
    if let old {
      removeRegistration(old)
    }
    Task { await refresh() }
  }
  func refresh() async {
    guard let connection else { status = "Connect to Mochi to enable notifications"; return }
    let ticket = generation
    for pending in pendingRemovals { removeRegistration(pending) }
    do {
      struct Status: Decodable, Sendable { let configured: Bool }
      let provider = try await APIClient(connection: connection).get("v1/notifications/status", as: Status.self)
      guard ticket == generation else { return }
      guard provider.configured else { enabled = false; status = "Server push setup is required. Results remain available in Tasks."; return }
      guard environment != nil else { enabled = false; status = "This build needs push notification provisioning. Results remain available in Tasks."; return }
      let settings = await UNUserNotificationCenter.current().notificationSettings()
      guard ticket == generation else { return }
      if settings.authorizationStatus == .denied {
        generation = UUID()
        removeRegistration(registrationConnection ?? connection)
        enabled = false
        status = "Notifications are disabled in system Settings"
        return
      }
      if optedIn, [.authorized, .provisional].contains(settings.authorizationStatus) {
        status = "Connecting notifications…"
        registerWithApple()
        if deviceToken != nil { await registerToken() }
      } else { enabled = false; status = "Notifications are off" }
    } catch {
      guard ticket == generation else { return }
      enabled = false
      status = "Couldn’t check notification setup. Try again."
    }
  }
  func enable() async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    guard environment != nil, connection != nil else { await refresh(); return }
    do {
      let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
      guard granted else { status = "Allow notifications in system Settings"; return }
      optedIn = true
      await refresh()
    } catch { status = "Couldn’t request notification permission" }
  }
  func disable() async {
    guard !busy else { return }
    busy = true
    defer { busy = false }
    optedIn = false
    enabled = false
    generation = UUID()
    #if os(iOS)
    UIApplication.shared.unregisterForRemoteNotifications()
    #elseif os(watchOS)
    WKApplication.shared().unregisterForRemoteNotifications()
    #endif
    guard let connection = registrationConnection ?? connection else { status = "Notifications are off"; return }
    await removeRegistration(connection).value
    if !pendingRemovals.contains(connection) { status = "Notifications are off" }
  }
  @discardableResult private func removeRegistration(_ connection: Connection) -> Task<Void, Never> {
    registrationQueue.enqueue { [self] in
      do {
        _ = try await APIClient(connection: connection).data("v1/notifications/devices/\(deviceID)", method: "DELETE")
        pendingRemovals.removeAll { $0 == connection }
        if registrationConnection == connection { registrationConnection = nil }
      } catch {
        if !pendingRemovals.contains(connection) { pendingRemovals.append(connection) }
        status = "Couldn’t remove an old notification registration. Refresh to retry."
      }
    }
  }
  private func registerWithApple() {
    #if os(iOS)
    UIApplication.shared.registerForRemoteNotifications()
    #elseif os(watchOS)
    WKApplication.shared().registerForRemoteNotifications()
    #endif
  }
  func receivedToken(_ data: Data) {
    deviceToken = data.map { String(format: "%02x", $0) }.joined()
    Task { await registerToken() }
  }
  func registrationFailed() { enabled = false; status = "Apple push registration failed. Check provisioning and retry." }
  private func registerToken() async {
    guard optedIn, let token = deviceToken, let environment, let connection else { return }
    let ticket = generation
    #if os(iOS)
    let platform = "ios"
    #else
    let platform = "watchos"
    #endif
    await registrationQueue.enqueue { [self] in
      guard ticket == generation, optedIn, self.connection == connection else { return }
      do {
        struct Registration: Decodable { let id: String; let configured: Bool }
        let data = try await APIClient(connection: connection).json("v1/notifications/devices", values: [
          "id": deviceID, "token": token, "environment": environment, "platform": platform,
        ])
        // Connection changes enqueue removal after this request and before any new registration.
        guard ticket == generation else { return }
        let result = try JSONDecoder().decode(Registration.self, from: data)
        registrationConnection = connection
        enabled = result.configured
        status = result.configured ? "Task updates are enabled" : "Server push setup is required"
      } catch {
        guard ticket == generation else { return }
        enabled = false
        status = "Couldn’t register task notifications. Try again."
      }
    }.value
  }
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    let id = response.notification.request.content.userInfo["taskId"] as? String
    let reminderID = response.notification.request.content.userInfo["reminderId"] as? String
    Task { @MainActor in
      // A push only opens a task. It never authorizes a call or Calendar write.
      if let reminderID, UUID(uuidString: reminderID) != nil { self.openedReminderID = reminderID }
      else if let id, UUID(uuidString: id) != nil { self.openedTaskID = id }
      completionHandler()
    }
  }
  nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
    completionHandler([.list]) // Do not speak or play a sound over a conversation.
  }
}

#if os(iOS)
final class PhoneNotificationDelegate: NSObject, UIApplicationDelegate {
  func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool { _ = TaskNotifications.shared; return true }
  func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) { TaskNotifications.shared.receivedToken(deviceToken) }
  func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) { TaskNotifications.shared.registrationFailed() }
}
#elseif os(watchOS)
final class WatchNotificationDelegate: NSObject, WKApplicationDelegate {
  func applicationDidFinishLaunching() { _ = TaskNotifications.shared }
  func didRegisterForRemoteNotifications(withDeviceToken deviceToken: Data) { TaskNotifications.shared.receivedToken(deviceToken) }
  func didFailToRegisterForRemoteNotificationsWithError(_ error: Error) { TaskNotifications.shared.registrationFailed() }
}
#endif
