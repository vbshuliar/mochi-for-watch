# Personal memory

Implemented 27 October 2026 for the existing private, single-user deployment.

## Use it

- “Remember that I live in London.”
- In a new conversation: “Where do I live?” or “What's the weather like today?”
- “Remember that I now live in Bristol.”
- “Forget where I live.”

Mochi uses Meta to interpret explicit save/update/forget requests. Ordinary conversation does not automatically populate a profile. The planner is instructed not to store secrets or third-party personal details; this is model guidance, not a deterministic secret detector. Do not store credentials in memories.

On iPhone, open **Memory** from the home screen. Tap an entry to edit or delete it, use **Add** for a new fact, or **Forget everything** with confirmation. The list refreshes on opening, pull-to-refresh and returning to the app. Native UI changes require an updated app installation; the existing Watch app can use the deployed backend's memory actions without a new Watch build.

## Storage and conversation behaviour

Memories live in the existing encrypted SQLite Store on the Fly persistent volume. They are shared across this private owner's phone and Watch sessions and survive server restarts. No separate provider, key or database is required. There are at most 50 entries, with an 80-character title and 500-character fact each.

The current memory list is sent as labelled data to the Meta planner with each turn. Memory content is not instruction authority. Search queries should include only relevant context, such as a city; the whole profile is not sent as a search query.

Saving, editing or deleting a memory resets server conversation context across sessions and cancels other in-flight turns. This prevents an old conversational snapshot from restoring a corrected/deleted fact. A memory-changing voice turn does not re-add the command to the new context. Existing client activity rows, server timeline records, cached replies and storage backups are not erased by deleting a saved memory. This is memory management, not deletion of all conversation records.

Creating an entry with an existing case-insensitive title updates that entry. Renaming another entry to a conflicting title is rejected. Invalid/stale IDs do not silently create replacements. Mutations are synchronous database transactions and require the same authenticated app token as other private API routes.

## API

| Method | Path | Body / response |
|---|---|---|
| GET | `/v1/memories` | `{memories: [{id,title,text,updatedAt}]}` |
| POST | `/v1/memories` | `{title,text}` → saved entry, HTTP 201 |
| PATCH | `/v1/memories/:id` | `{title,text}` → saved entry |
| DELETE | `/v1/memories/:id` | HTTP 204 |
| DELETE | `/v1/memories` | Forget all saved entries, HTTP 204 |

`updatedAt` is Unix milliseconds. This is a single-user API: do not share its app token with unrelated users. Public distribution requires authenticated user ownership throughout the store and API.

## Verification

Backend tests cover cross-session recall, edits, deletion, context reset, authentication, malformed input, duplicate titles, missing IDs, forget-all, persistence after reopening the database and cancellation of stale in-flight replies. Native checks compile the Memory screen and its networking model for iPhone and the existing Watch app. Live Meta tests exercise remember, recall and forget routing; provider behaviour remains probabilistic.

## Next workflows

Memory is the context layer for the next integration, not a workflow executor. Candidate workflows:

1. **Plan my free time:** preferences + Calendar availability + current web options → a proposal → Calendar creation after approval.
2. **Research this idea:** web search + preferred style → a sourced Notion page after approval.
3. **Catch me up:** Gmail read access + priorities → a summary and proposed follow-ups; sending still requires approval.

Calendar OAuth and real-account validation remain pending. Notion and Gmail require their own authorization and adapters; Meta model access alone does not grant access to those accounts. Gmail and Notion have since been implemented with account setup pending; see [the workflow guide](gmail-notion.md).

Deployment verification: the Fly deployment completed and authenticated `GET /v1/memories` returned HTTP 200 with a valid empty list. Live Meta end-to-end checks ran against an isolated in-memory database: save Science Museum preference, recall from a different session, edit to British Museum, and delete followed by an unknown-preference clarification. The user's production memory was not populated by these tests. All 54 backend tests and native SDK builds passed; a signed iPhone build is prepared in ignored `native/DerivedDataSigned`. Physical installation remains pending because the iPhone is unavailable to Xcode.
