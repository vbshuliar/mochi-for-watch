import Foundation
import XCTest
@testable import MochiCore

final class IntegrationTests: XCTestCase {
  func testLegacyStatusRemainsDecodable() throws {
    let json = #"{"mode":"live","calendar":"disconnected","calendarEnabled":false,"calendarConfigured":true,"speechOutput":"voice"}"#
    let status = try JSONDecoder().decode(ServerStatus.self, from: Data(json.utf8))
    XCTAssertNil(status.instagram)
    XCTAssertNil(status.facebook)
    XCTAssertNil(status.socialAccounts)
  }
  func testSelectedAndUnselectedSocialAccountsDecode() throws {
    let json = #"{"mode":"live","calendar":"disconnected","calendarEnabled":false,"calendarConfigured":true,"speechOutput":"voice","instagram":"connected","facebook":"disconnected","socialAccounts":{"instagram":{"id":"ig1","name":"Our studio"}}}"#
    let status = try JSONDecoder().decode(ServerStatus.self, from: Data(json.utf8))
    XCTAssertEqual(status.socialAccounts?.instagram?.name, "Our studio")
    XCTAssertNil(status.socialAccounts?.facebook)
    let available = try JSONDecoder().decode(AvailableSocialAccounts.self, from: Data(#"{"accounts":[{"id":"page1","name":"Our Page"}]}"#.utf8))
    XCTAssertEqual(available.accounts.first?.id, "page1")
  }
  func testOAuthLinksRequireExactHTTPSProviderHost() throws {
    for provider in ["instagram", "facebook"] {
      XCTAssertTrue(IntegrationSignIn.isAllowed(URL(string: "https://www.facebook.com/v22/dialog/oauth?state=abc")!, provider: provider))
      for link in ["http://www.facebook.com/auth", "https://www.facebook.com.evil.test/auth", "https://facebook.com/auth", "https://evil.test/?www.facebook.com", "https://user:pass@www.facebook.com/auth", "https://www.facebook.com:8443/auth"] {
        XCTAssertFalse(IntegrationSignIn.isAllowed(URL(string: link)!, provider: provider), link)
      }
    }
    XCTAssertTrue(IntegrationSignIn.isAllowed(URL(string: "https://accounts.google.com/oauth")!, provider: "gmail"))
    XCTAssertTrue(IntegrationSignIn.isAllowed(URL(string: "https://api.notion.com/v1/oauth/authorize")!, provider: "notion"))
    XCTAssertFalse(IntegrationSignIn.isAllowed(URL(string: "https://www.facebook.com/auth")!, provider: "unknown"))
  }
}
