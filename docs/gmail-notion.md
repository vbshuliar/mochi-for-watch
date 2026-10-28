# Gmail and Notion workflows

Implemented 27 October 2026. Provider OAuth credentials and real-account acceptance testing remain required; implementing the adapters does not mean either account is connected.

**Scope update:** account setup paused on 27 October 2026 in favour of the [Calendar + booking-call demo](booking-calls.md). The implementation is retained.

## End-user experience

1. Open **Connections → Gmail → Connect with Google** and grant read-only access.
2. Open **Connections → Notion → Connect with Notion**, share the pages Muse may access, then choose a destination under **Save pages under**. Page search is by title, with up to 50 results; narrow the query if more are available.
3. Ask Jolly:
   - “Summarize my unread emails from this week.”
   - “Find my trip bookings and create a travel brief in Notion.”
   - “Create a Notion page with three weekend photography project ideas.”
4. For a document, review the full text and destination, then select **Save to Notion** or **Cancel**. No external page is created before confirmation.

Native iPhone/Watch and browser emulator support document review. Existing installed native builds need updating before they can review these new proposals. Device installation is deferred at the owner's request.

## Developer setup: Google

Use the existing Google OAuth web application, enable Gmail API, and add the Gmail read-only scope to the consent configuration. Keep Calendar scopes and redirect registration intact. Register:

- Local: `http://127.0.0.1:8787/oauth/gmail/callback`
- Current hosted app: `https://muse-for-watch-vlad.fly.dev/oauth/gmail/callback`

Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and `GMAIL_REDIRECT_URI` on the backend. Gmail has its own OAuth state and encrypted token record, separate from Calendar. Connect requests use PKCE, offline access and consent; completion requires the granted read-only scope and a refresh token.

For a private development app, configure test users in Google's consent setup. Gmail read-only is a restricted scope; public distribution has additional verification requirements. Check Google's current requirements before making the app public. Never put client secrets in the iPhone bundle, browser JavaScript or repository.

## Developer setup: Notion

Create a public OAuth connection in Notion's developer portal. Configure read-content and insert-content capabilities for destination discovery and page creation; this implementation does not update existing pages. Register:

- Local: `http://127.0.0.1:8787/oauth/notion/callback`
- Current hosted app: `https://muse-for-watch-vlad.fly.dev/oauth/notion/callback`

Set `NOTION_CLIENT_ID`, `NOTION_CLIENT_SECRET`, and `NOTION_REDIRECT_URI` on the backend. The callback exchanges the code using HTTP Basic authentication. Tokens are encrypted in the existing SQLite Store, refresh tokens rotate when returned, and 401 responses trigger one refresh attempt. Notion API requests pin `Notion-Version: 2025-09-03`.

The end user shares allowed pages in Notion's OAuth picker, then selects one destination in Muse. A destination change or account reconnection invalidates an old pending proposal's save authorization. Keep source email content out of shared destinations unless that is intended: access follows Notion's page permissions.

Fly configuration already contains the two hosted redirect URLs. Install the four OAuth credentials using the existing secure Fly-secret workflow; do not paste them into chat. OAuth app registration and live consent are still needed. Ordinary users only see connection buttons, not developer setup fields.

## Behaviour and boundaries

- Gmail is read-only: no sending, drafts, mark-read, moving or deletion operations.
- Each request reads at most ten matching messages. Plain-text MIME bodies are preferred; HTML-only mail falls back to its Gmail snippet. Attachments are ignored. This is a bounded summary, not a complete inbox export or attachment parser.
- Matching messages are sent to Meta for summarization/document generation. Email contents are untrusted evidence and cannot select tools, permissions or the Notion destination. This generation call has no tools and returns validated text only.
- Email contents do not become personal memories. The saved draft, conversation context and receipts can contain private content in the encrypted backend store and local activity views.
- Notion documents are plain-text paragraphs with deterministic source-email links appended when email was used. Existing-page edits and rich formatting are outside this version.
- Proposals expire after ten minutes, belong to one conversation, and bind to the selected destination and connection generation. New successful turns supersede old pending proposals.
- Confirming a completed action returns the existing receipt. A crash or ambiguous write error is marked uncertain; it does not retry the POST. Check Notion manually before requesting a new page. Unresolved receipts are retained if session deletion is attempted.
- Disconnect removes local credentials and pending OAuth state. Revoke the provider grant in Google/Notion settings if desired. A request already accepted by a provider may still finish after disconnect.
- This remains the existing single-user private service. Multi-user authentication/ownership is not implemented.

## API

- `POST /v1/integrations/{gmail|notion}/connect` → browser authorization URL
- `DELETE /v1/integrations/{gmail|notion}` → disconnect local grant
- `GET /oauth/{gmail|notion}/callback` → public callback, protected by expiring single-use state
- `POST /v1/integrations/notion/pages/search` with `{query}` → shared page titles
- `PUT /v1/integrations/notion/destination` with `{id}` → validate and select parent page
- `/v1/status` adds `gmail`, `notion`, `notionParent`
- Turn results can include `documentAction`; `GET /v1/sessions/:id/documents/:actionId` refreshes its state
- `POST /v1/sessions/:id/documents/:actionId/decision` with `{decision: "confirm" | "cancel"}`

## Verification

Automated coverage includes separate grants, OAuth replay and disconnect races, MIME attachment filtering, draft-before-write, cross-session denial, confirmation idempotency, cancel/expiry/destination changes, uncertain-write retries and superseding stale drafts. Native compile checks and existing browser tests also run. Live Meta routing and synthetic document generation can be checked without granting Gmail/Notion access or creating external pages. Real OAuth, mailbox reading and Notion writes remain pending until app credentials and user consent are configured.

Primary references: [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes), [Gmail message retrieval](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get), [Notion authorization](https://developers.notion.com/guides/get-started/authorization), [Notion page creation](https://developers.notion.com/reference/post-page), [Notion title search](https://developers.notion.com/reference/post-search).
