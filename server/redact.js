/** Minimal PII redaction for transcripts sent to the scoring agent. */

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const PHONE_RE = /\+?\d[\d\-\s().]{7,}\d/g

export function redactText(text) {
  return String(text ?? '').replace(EMAIL_RE, '[email]').replace(PHONE_RE, '[phone]')
}

export function redactTranscript(messages) {
  return (Array.isArray(messages) ? messages : []).map((m) => ({ ...m, text: redactText(m.text) }))
}
