# Instagram and Facebook Pages

The implementation uses Facebook Login to select a managed Facebook Page or its linked Instagram professional account. It reads posts/comments and lets Meta summarize or draft suggested replies. It never publishes them.

## Operator setup

1. Create/configure a Meta developer app with the appropriate Facebook Login use case and permissions. Add your test user/account roles while the app is in development. Broader distribution can require Meta review and business verification; eligibility is controlled by Meta.
2. Register these exact OAuth redirect URIs for the deployed backend:
   - `https://<your-backend>/oauth/instagram/callback`
   - `https://<your-backend>/oauth/facebook/callback`
3. Set server-only environment values (use the secret manager, never a public page or client bundle):
   - `META_SOCIAL_APP_ID`
   - `META_SOCIAL_APP_SECRET`
   - `META_SOCIAL_REDIRECT_BASE=https://<your-backend>`
   - `GRAPH_API_VERSION=v24.0` (the implementation pin; verify app support before changing)
4. For localhost development the default redirect base is `http://127.0.0.1:8787`. Register localhost callbacks separately if permitted by your app configuration.
5. Sign in from Mochi, grant the required access, return to Mochi, refresh accounts and select the desired Page/Instagram account. A grant alone does not mark the connector connected.

Instagram requests `pages_show_list`, `pages_read_engagement`, `instagram_basic`, `instagram_manage_comments`. Facebook requests `pages_show_list`, `pages_read_engagement`, `pages_read_user_content`. The Instagram comment scope is required for reading comments on this path; this implementation provides no write endpoint even if the provider scope includes moderation rights.

Use a professional Instagram account linked to a Page you manage. The user confirmed this account arrangement on 28 October 2026. Credentials and live permissions still need configuration/verification.

## API

All `/v1` endpoints require the existing private app bearer token.

- `POST /v1/integrations/{instagram|facebook}/connect` → `{url}`
- `GET /v1/integrations/{instagram|facebook}/accounts` → `{accounts:[{id,name}]}`
- `PUT /v1/integrations/{instagram|facebook}/account` with `{id}` → updated status
- `DELETE /v1/integrations/{instagram|facebook}` → local disconnect
- `GET /oauth/{instagram|facebook}/callback` → one-use OAuth state validation

`GET /v1/status` includes `instagram`, `facebook` and `socialAccounts`. Only valid grants with a selected account are connected. Selection is checked against a fresh provider-owned account list, not trusted from a client ID.

The `social_task` planner result fetches bounded recent activity and gives that evidence to Meta. The model returns a summary and optional suggested reply; it cannot issue tool calls from social content. Switching or disconnecting an account invalidates in-flight results before they reach the user.

## Limits

- Up to 100 accounts in discovery, ten posts and ten comments per post. Provider paging links are not followed.
- Tokens expire and require reconnect. This version does not silently exchange grants for long-lived tokens.
- Existing grants are removed when reconnect starts; denied consent leaves the service disconnected.
- Revoked permissions are detected when the provider rejects a request, then local access is cleared.
- No DMs, publishing, scheduling posts, analytics or personal profile support.

## Primary references

- [Meta Instagram API with Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/)
- [Meta Pages API](https://developers.facebook.com/docs/pages-api/)
- [Meta Facebook Login manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/)
- [Meta-owned Instagram Postman collection](https://www.postman.com/meta/instagram/documentation/6yqw8pt/instagram-api)

Direct Meta documentation returned HTTP 429 during this work. Meta-owned Postman documentation supplied supporting flow information; permission eligibility and the pinned Graph version still need verification in the actual developer app. Mocked tests are not evidence of completed provider review or live account access.
