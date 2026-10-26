# Technical architecture

Updated: 26 October 2026.

> **Status:** Proposed architecture. Model identifiers, endpoints, capabilities and reference-product details are reproduced from the brief, not verified API contracts. Types and tool names are illustrative, not implementation.

[Documentation index](README.md) · [Original brief](sources/original-project-brief.md) · [Open questions](open-questions.md)

## Implementation update — 26 October 2026

The [Calendar MVP backend](../backend/README.md) now implements Fastify/TypeScript, encrypted SQLite persistence, one-user bearer authentication, Meta file transcription/planning, Google OAuth and confirmed event creation. SQLite replaces the proposed Supabase dependency for local development. Provider contracts have mocked-HTTP tests; live credentials and Watch integration remain untested. The broader architecture below remains a proposal, including additional bots and Supabase migration.

## Reference validation update — 26 October 2026

Moment's published privacy policy names the providers listed below, supporting that part of the original brief. It does not establish its watch transport, native frameworks or delegation implementation. Product and privacy descriptions also differ on microphone recording. See [Moment research](research/moment.md). Our choices remain an independent proposed architecture, not a verified reproduction.

Target device: the user's Apple Watch SE 2; installed watchOS and development compatibility still need testing.


## Moment as Our Architectural Reference

Moment is a useful reference because it demonstrates that Apple Watch can provide a lightweight interface to cloud-powered AI agents.

We should adopt its broad architectural principles while independently implementing our own product.

### What Moment publicly describes

Based on Moment's previously reviewed privacy documentation, its service providers include:

- AssemblyAI for speech transcription.
- OpenRouter and xAI models for AI processing.
- Supabase for authentication and storage.
- Railway for backend hosting.

The exact implementation details of its native watch application, internal service boundaries and Grok Bot delegation protocol have not been independently verified.

We should therefore treat the architecture as a reference pattern, not a complete blueprint of Moment's source code.

### What we will reuse conceptually

- Lightweight Apple Watch interface.
- Short voice interactions.
- Cloud-based transcription.
- Cloud AI reasoning.
- Specialised task agents.
- Cloud-hosted backend services.
- Persistent user and session information.
- Clear user feedback after task execution.

### What we will replace

| Layer | Moment reference | Muse for Watch |
|---|---|---|
| Wearable interface | Apple Watch app | Native SwiftUI watchOS app |
| Recording | Watch microphone | AVFoundation |
| Transcription | AssemblyAI | Muse Voice Transcribe 1.0 |
| AI reasoning | xAI via OpenRouter | Muse Spark 1.3 directly |
| Agent platform | Grok Bots | Custom specialised agents |
| Backend hosting | Railway | Railway |
| Database | Supabase | Supabase |
| Authentication | Supabase | Supabase Auth |
| Task integrations | Connected bots | Our own service adapters |
| Audio responses | Exact approach unverified | Apple speech synthesis |

This provides a proven general architectural direction without requiring us to recreate Moment's proprietary internals.

## Complete Technical Architecture

### Overview

The application consists of four main layers.

**Layer 1: Apple Watch client**

Handles user-facing functionality.

**Layer 2: Backend API**

Receives audio, authenticates requests, manages sessions and coordinates processing.

**Layer 3: Meta AI services**

Transcribes audio and performs reasoning and tool selection.

**Layer 4: External integrations and storage**

Connects to real applications and stores authorised user information.

### Request lifecycle

The expected flow is:

1. The user selects Pip on Apple Watch.
2. The user taps the microphone.
3. The watch records a short audio clip.
4. Recording ends.
5. The watch sends the file to our backend over HTTPS.
6. The backend validates the authenticated request.
7. The backend sends the audio to Muse Voice Transcribe.
8. Muse Voice Transcribe returns text.
9. The backend loads Pip's configuration and conversation context.
10. The backend sends the user's request to Muse Spark.
11. Muse Spark either responds directly or requests one or more tools.
12. The backend validates and executes allowed tools.
13. Tool results are returned to Muse Spark if further reasoning is necessary.
14. The backend produces a structured response.
15. The watch displays the relevant information.
16. Apple speech synthesis reads the response aloud.
17. If a consequential action is proposed, the watch asks for confirmation.
18. The backend executes the approved action and verifies the result.
19. The conversation and permitted task information are stored.

Not every request requires external tool execution.

A simple informational request may return directly from Muse Spark.

A complex request may require several tool interactions.

### Apple Watch application

**Language:** Swift  
**UI:** SwiftUI  
**Minimum platform:** To be decided based on installed Xcode SDK and target-device compatibility.

Primary Apple frameworks:

**SwiftUI**

Used to build the native interface, screens, navigation and animated character presentation.

**AVFoundation**

Used to capture audio and play generated or synthesised speech.

**URLSession**

Used for secure backend requests and audio uploads.

**WatchKit / watchOS APIs**

Used where necessary for watch-specific lifecycle, haptics and interface behaviour.

**App Intents / shortcuts**

Optional enhancement for launching frequent actions more conveniently.

#### Recording strategy

Our initial implementation should use push-to-talk audio recording.

This avoids the complexity of continuous real-time streaming and is more compatible with the intended short interactions.

The application will:

- Request microphone permission.
- Record a short audio file.
- Stop recording when the user finishes.
- Upload the file.
- Display processing progress.
- Present the returned result.

The actual audio encoding and sample rate must be tested against Muse Voice Transcribe's supported formats.

### Backend

**Runtime:** Node.js  
**Language:** TypeScript  
**Hosting:** Railway  
**HTTP framework:** Fastify or Express  
**Validation:** Schema validation using a library such as Zod

The backend is responsible for:

- Receiving audio uploads.
- Validating authenticated requests.
- Enforcing request and file-size limits.
- Managing sessions and users.
- Calling Meta APIs.
- Orchestrating agent workflows.
- Executing approved tools.
- Managing external account credentials.
- Storing conversation context.
- Producing structured responses.
- Handling errors, retries and timeouts.
- Maintaining basic usage logs.

We should keep all Meta API keys and external service credentials on the server.

Secrets must never be embedded directly in the distributed watch application.

### Meta Voice Transcription

**Model:** `muse-voice-transcribe-1.0`

**File transcription endpoint:** `POST /v1/asr/transcribe`

Meta also provides a real-time WebSocket endpoint:

`wss://api.meta.ai/v1/asr/realtime`

The model supports speech-to-text transcription, turn detection, speaker attribution and multilingual recognition.

For our first implementation, we will use file-based transcription.

#### Why file-based transcription?

It is simpler to implement and debug.

We can record complete audio clips before sending them.

We avoid the additional engineering involved in maintaining live audio streams, handling connection interruptions, synchronising partial results and implementing streaming turn detection.

If the MVP works reliably, we can later explore real-time transcription to improve responsiveness.

#### Important limitation

Muse Voice Transcribe is a transcription model, not a text-to-speech system.

We will use Apple's speech synthesis for the spoken responses.

### Meta AI Reasoning

**Primary model:** `muse-spark-1.3`

**API base URL:** `https://api.meta.ai/v1`

Meta's Model API provides OpenAI-compatible and Anthropic-compatible interfaces.

Muse Spark supports tool calling, structured outputs and long-context reasoning.

For our application, the most important capability is **agentic tool use**.

The model should interpret user instructions and decide which authorised tools are required.

For example, a request to answer an Instagram comment might produce the following logical plan:

1. Retrieve recent comments.
2. Identify the relevant comment.
3. Generate a suitable response.
4. Request user approval.
5. Call the comment-reply API.
6. Verify publication.
7. Report completion.

The backend remains responsible for actually executing tools.

Muse Spark does not automatically gain access to Instagram, Gmail, Google Calendar or other applications simply because it can request tool calls.

Each integration must be implemented and authorised independently.

### Agent configuration

Every bot should use the same underlying processing infrastructure.

Each agent is defined by configuration rather than a separate backend service.

A representative agent configuration could contain:

- Agent ID.
- Display name.
- Character identity.
- Personality instructions.
- Tool permissions.
- Response style.
- Memory-access policy.
- Safety and approval requirements.
- Character animation metadata.

Example:

```typescript
type AgentConfig = {
  id: string;
  name: string;
  systemPrompt: string;
  allowedTools: string[];
  memoryScope: string;
  requiresApproval: string[];
};
```

Pip would have access to approved social media tools.

Milo would have access to calendar tools.

Nori would have access to research and note-storage tools.

This architecture avoids duplicating model integration logic for every agent.

### Tool execution

Tools are TypeScript functions with clearly defined inputs and outputs.

For example:

```typescript
type ToolResult<T> = {
  success: boolean;
  data?: T;
  error?: string;
};
```

Potential tools include:

```text
instagram.getRecentComments
instagram.replyToComment

facebook.getPagePosts
facebook.publishPagePost

calendar.listEvents
calendar.findAvailability
calendar.createEvent

memory.saveFact
memory.searchFacts
```

Tools should use strict validation, authenticated external requests and predictable response formats.

The model proposes a tool call.

The backend validates whether the chosen agent and user are allowed to invoke it.

The backend must never accept arbitrary executable instructions from the model.

#### Action approval

Read-only actions can generally execute without explicit per-action approval after the user has granted account access.

Publishing, sending, deleting or modifying external data should require explicit user confirmation.

The confirmation interface must show what the agent intends to do.

For the MVP, one approval should authorise one clearly specified action or bounded group of actions.

### Database and authentication

**Platform:** Supabase

We plan to use:

- Supabase Postgres for persistent data.
- Supabase Auth for user authentication.
- Supabase Storage only if persistent audio or generated assets are necessary.

Suggested tables:

**users**

Stores user identity and account metadata.

**agents**

Stores available agent definitions and configurations.

**conversations**

Stores conversations and their ownership.

**messages**

Stores the individual user and assistant turns.

**memories**

Stores permitted long-term facts and contextual information.

**integrations**

Stores information about connected services and their authorisation status.

**tasks**

Stores tool execution state and history.

**approvals**

Records pending and completed approvals.

#### Authentication strategy

For the earliest single-user prototype, local development credentials and a tightly controlled test account are sufficient.

Before making the app publicly accessible, we should implement proper authentication and per-user access controls.

A browser or iPhone companion experience is the easiest place to complete complex OAuth flows.

For the hackathon, we can develop against pre-authorised accounts if permissions allow.

We should not spend most of the event building a complex account-registration interface.

### Memory architecture

Persistent memory is part of the longer-term product vision.

It should be separated into three categories.

**Conversation context**

Recent exchanges used to maintain continuity within a conversation.

**Agent-specific memory**

Facts relevant to an agent's specialisation.

For example, Pip may remember preferred caption tone and frequently managed social accounts.

**Shared user memory**

Information that multiple agents may use when authorised.

For example, Nori saves information about an upcoming event, and Milo later uses that information to help schedule preparation time.

#### Memory implementation

The initial memory layer can use a relational database.

For a small hackathon project, storing structured facts and retrieving them using direct queries or full-text search may be sufficient.

Vector embeddings and complex retrieval infrastructure are optional.

We should avoid building a generic RAG system simply to add technical complexity, particularly because the official hackathon guide identifies basic RAG applications as an overused project category.

User data should have clear deletion and correction mechanisms.

Shared memory must be bounded by user consent and appropriate permissions.
