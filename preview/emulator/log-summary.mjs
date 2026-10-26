const short = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
export function summarizeLog(kind, path, data) {
 if (typeof data === 'string') return short(data);
 const body = data?.body;
 if (body?.error) return short(body.error.message || 'request failed');
 if (data?.message) return short(data.message);
 if (kind === 'request') {
  if (path.endsWith('/turns')) return `asking Muse: ${short(data?.text)}`;
  if (path.endsWith('/audio')) return `sending voice recording for transcription · ${Math.round((data?.bytes || 0) / 1024)} KB`;
  if (path.endsWith('/decision')) return data?.decision === 'confirm' ? 'confirming the proposed Calendar event' : 'cancelling the proposed Calendar event';
  if (path.endsWith('/status')) return 'checking backend and Calendar connection';
  if (path.endsWith('/events')) return 'checking conversation progress';
  if (path.endsWith('/connect')) return 'requesting Google Calendar connection';
  if (path.startsWith('DELETE ')) return 'clearing this conversation';
  if (path === 'POST /v1/sessions') return `starting conversation · ${short(data?.timeZone)}`;
  if (path.includes('/actions/')) return 'checking the proposed event and save status';
 }
 if (kind === 'response') {
  if (body?.speechText) return short(body.speechText);
  if (body?.action) return `${short(body.action.event?.title || 'event')} · ${short(body.action.status)}`;
  if (body?.mode) return `${short(body.mode)} backend · Calendar ${short(body.calendar)}`;
  if (Array.isArray(body?.events)) return body.events.length ? `latest: ${short(body.events.at(-1).statusText)}` : 'conversation ready · no activity yet';
  if (body?.url) return 'Google consent link ready';
  if (body?.id && path.endsWith('/sessions')) return 'conversation started';
  if (data?.status === 204) return 'conversation cleared';
  return `request completed · HTTP ${data?.status ?? 'unknown'}`;
 }
 return short(path || kind);
}
