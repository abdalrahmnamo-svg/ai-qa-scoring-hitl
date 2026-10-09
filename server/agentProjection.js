import { redactTranscript } from './redact.js'

/** Token-efficient, PII-redacted conversation payload for the scoring agent. */
export function projectAgentConversation(conv) {
  return {
    conversationId: conv.conversationId,
    agent: conv.agent,
    contact: conv.contact,
    date: conv.date,
    topic: conv.topic ?? null,
    rawResponseSec: conv.rawResponseSec ?? null,
    adjustedResponseSec: conv.adjustedResponseSec ?? null,
    messages: redactTranscript(conv.messagesRaw ?? conv.messages).map((m) => ({
      sender: m.sender,
      isBot: Boolean(m.isBot),
      text: m.text,
      ts: m.ts,
    })),
  }
}
