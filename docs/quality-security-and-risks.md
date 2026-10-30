# Testing, security and technical risks

Updated: 26 October 2026.

> **Status:** Planned checks and risks, not completed test results. API access, watch audio/networking and integration permissions are early validation priorities.


## Testing and Quality Assurance

### Functional tests

Verify that:

- Recording starts and stops correctly.
- Audio uploads successfully.
- Transcription produces the expected output.
- Muse Spark returns a usable structured result.
- The correct bot receives the request.
- The correct tool is selected.
- Invalid tool arguments are rejected.
- Approval is required where intended.
- The action is executed only once.
- The correct external result is returned.

### Error handling

Test:

- No network connection.
- Lost connectivity during upload.
- Empty audio.
- Unsupported audio format.
- Failed transcription.
- Meta API timeout.
- Invalid API key.
- Expired social service token.
- Missing tool permission.
- External API rate limits.
- Duplicate user confirmation.
- Failed external action.

The watch should never display false success messages.

### Agent reliability

Agents must operate within their assigned tool permissions.

Mochi must have explicit Calendar permissions before modifying events. A Calendar connection does not authorise social publishing, and research tools must not send messages. Enforce service-specific permissions even though all capabilities share one companion.

The model's instructions should not substitute for backend permission enforcement.

### Tool verification

Every external action should return a machine-readable result.

For example, after creating a calendar event, the backend should receive the event identifier or appropriate confirmation from Google Calendar.

The interface should distinguish between:

- Proposed.
- Awaiting approval.
- Executing.
- Completed.
- Failed.

This could be an important technical differentiator under the hackathon's agentic judging criteria.

### Performance

We should measure the complete interaction:

- Recording duration.
- Audio upload duration.
- Transcription latency.
- Muse Spark response latency.
- External tool latency.
- Speech playback start time.

A fast response is important because watch interactions are naturally brief.

However, we should avoid promising specific latency figures before testing the real implementation.

We can improve the experience through concise prompts, minimal context loading, small tool outputs and clear processing feedback.

### Security

Security requirements include:

- HTTPS communication.
- Backend-only model API keys.
- Encrypted credential storage where applicable.
- Strict access control.
- Input validation.
- Authentication and authorisation.
- Limited token permissions.
- No secrets in public GitHub.
- Restricted agent tool access.
- Safe logging.
- Data deletion support.
- Explicit approval before consequential actions.

Voice recordings should not be retained unnecessarily.

Where feasible, process them transiently and store only the minimum information required.

## Important Technical Risks

### Meta API access

**Severity: High until verified**

The fact that a model is documented does not guarantee that a particular developer account can call it.

We must verify authentication, billing, model access and endpoint availability.

**Mitigation:** Test Muse Spark and Voice Transcribe before developing advanced interface features.

### watchOS development

**Severity: Medium**

Native Apple Watch development has platform-specific restrictions involving recording, networking and app lifecycle.

We must test the audio and backend communication pipeline on actual supported watchOS environments.

**Mitigation:** Use short push-to-talk recordings and standard HTTPS requests.

### Instagram API permissions

**Severity: High**

Instagram account types, permissions and app configuration can delay development.

**Mitigation:** Validate a developer-controlled professional account early and maintain a simpler integration as a fallback.


### Background activity

**Severity: Medium**

watchOS restricts background execution.

Continuous microphone access and arbitrary background processing are not viable assumptions for a normal watch application.

**Mitigation:** Keep model inference and longer tasks on the backend. Use approved notification mechanisms to communicate results where supported.

### Overengineering

**Severity: High**

Building numerous agents, complex memory, multiple API integrations and elaborate animations simultaneously risks producing an unreliable prototype.

**Mitigation:** Prioritise one complete agentic workflow before adding breadth.

### Demo reliability

**Severity: High**

A failed voice upload or expired social token could damage an otherwise impressive demonstration.

**Mitigation:** Build controlled test scenarios, verify credentials, and prepare a truthful recorded demonstration of actual successful executions.
