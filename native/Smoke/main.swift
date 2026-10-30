import Foundation
import MochiCore

@main struct SmokeCheck {
  static func main() async throws {
    guard let origin = ProcessInfo.processInfo.environment["MOCHI_SMOKE_ORIGIN"],
      let token = ProcessInfo.processInfo.environment["MOCHI_SMOKE_TOKEN"],
      let url = URL(string: origin)
    else {
      throw MochiError.message("Run native/scripts/smoke.mjs to start an isolated fixture backend.")
    }
    let api = APIClient(connection: try Connection(baseURL: url, token: token))
    let status = try await api.get("v1/status", as: ServerStatus.self)
    guard status.mode == "mock" else {
      throw MochiError.message("Smoke tests only run against a mock backend.")
    }
    let session = try await api.createSession()
    do {
      let reply = try await api.stream(
        sessionID: session, requestID: UUID().uuidString, text: "hello"
      ) { _ in }
      guard reply.state == "speak", reply.simulated else {
        throw MochiError.message("Unexpected greeting contract.")
      }
      let proposal = try await api.stream(
        sessionID: session, requestID: UUID().uuidString, text: "schedule demo lunch"
      ) { _ in }
      guard let action = proposal.action, action.status == "pending" else {
        throw MochiError.message("Expected an unexecuted Calendar proposal.")
      }
      let bytes = try await api.json(
        "v1/sessions/\(session)/actions/\(action.id)/decision", values: ["decision": "cancel"])
      let cancelled = try JSONDecoder().decode(TurnResult.self, from: bytes)
      guard cancelled.simulated else {
        throw MochiError.message("The fixture unexpectedly left mock mode.")
      }
      let turn = UUID().uuidString
      try await api.cancel(sessionID: session, requestID: turn)
      do {
        _ = try await api.stream(sessionID: session, requestID: turn, text: "hello") { _ in }
        throw MochiError.message("A cancelled request executed.")
      } catch MochiError.message(let message) where message == "A cancelled request executed." {
        throw MochiError.message(message)
      } catch { /* Cancel-before-dispatch must reject the later turn. */  }
      _ = try await api.data("v1/sessions/\(session)", method: "DELETE")
      print(
        "PASS: native URLSession → backend status, session, streamed reply, Calendar proposal/cancel, request cancellation and cleanup."
      )
    } catch {
      _ = try? await api.data("v1/sessions/\(session)", method: "DELETE")
      throw error
    }
  }
}
