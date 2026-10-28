const short = value => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 150);
export function summarizeLog(kind, path, data) {
 if (typeof data === 'string') return short(data);
 const body = data?.body;
 const service = path.includes('/notion') ? 'Notion' : path.includes('/gmail') ? 'Gmail' : 'Google Calendar';
 const proposal = path.includes('/calls/') ? 'phone call' : path.includes('/documents/') ? 'Notion page' : 'Calendar event';
 if (body?.error) return short(body.error.message || 'request failed');
 if (data?.message) return short(data.message);
 if (kind === 'request') {
  if (path.includes('/calls/') && path.endsWith('/stop')) return 'stopping the phone call';
  if (path.includes('/calls/') && path.endsWith('/calendar')) return 'preparing the booked appointment for Calendar review';
  if (path.includes('/calls/') && !path.endsWith('/decision')) return 'checking the phone call progress';
  if (path.endsWith('/speech')) return `giving Jolly a voice: ${short(data?.text)}`;
  if (path.endsWith('/turns')) return `asking Muse: ${short(data?.text)}`;
  if (path.endsWith('/audio')) return `sending voice recording for transcription · ${Math.round((data?.bytes || 0) / 1024)} KB`;
  if (path.endsWith('/decision')) return `${data?.decision === 'confirm' ? 'confirming' : 'cancelling'} the proposed ${proposal}`;
  if (path.endsWith('/status')) return 'checking backend and Calendar connection';
  if (path.endsWith('/events')) return 'checking conversation progress';
  if (path.endsWith('/connect')) return `requesting ${service} connection`;
  if (path.startsWith('DELETE /v1/integrations/')) return `disconnecting ${service}`;
  if(path.includes('/notion/pages')) return 'finding shared Notion pages';
  if(path.includes('/notion/destination')) return 'selecting the Notion destination';
  if(path.includes('/documents/')) return 'checking the Notion draft and save status';
  if (path.startsWith('DELETE ')) return 'clearing this conversation';
  if (path === 'POST /v1/sessions') return `starting conversation · ${short(data?.timeZone)}`;
  if (path.includes('/actions/')) return 'checking the proposed event and save status';
 }
 if (kind === 'response') {
  if (body?.speechText) return short(body.speechText);
  if (body?.callAction) return `call to ${short(body.callAction.booking?.destinationName)} · ${short(body.callAction.summary || body.callAction.status).replaceAll('_', ' ')}`;
  if (body?.action) return `${short(body.action.title || body.action.event?.title || 'proposal')} · ${short(body.action.status)}`;
  if (body?.mode) return `${short(body.mode)} backend · Calendar ${short(body.calendar)}`;
  if (Array.isArray(body?.events)) return body.events.length ? `latest: ${short(body.events.at(-1).statusText)}` : 'conversation ready · no activity yet';
  if (body?.disconnected) return `${service} disconnected`;
  if (body?.url) return `${service} connection link ready`;
  if (body?.id && path.endsWith('/sessions')) return 'conversation started';
  if (data?.status === 204) return 'conversation cleared';
  return `request completed · HTTP ${data?.status ?? 'unknown'}`;
 }
 return short(path || kind);
}
