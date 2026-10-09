import { describe, it, expect, beforeAll } from 'vitest'
import { hasHumanAgentTurn, isGradableConversation, buildDailyScoringBatch } from '../server/dailyScoringBatch.js'
import { openDb } from '../server/db.js'
import { seedDatabase } from '../server/seedData.js'

describe('dailyScoringBatch gradability', () => {
  it('rejects Unassigned agent', () => {
    expect(
      isGradableConversation({ agent: 'Unassigned', messagesRaw: [{ sender: 'customer', isBot: false, text: 'Hi' }] }),
    ).toBe(false)
  })

  it('rejects bot-only transcript', () => {
    expect(
      isGradableConversation({ agent: 'Agent Alpha', messagesRaw: [{ sender: 'agent', isBot: true, text: 'Hello menu 1-10' }] }),
    ).toBe(false)
  })

  it('rejects Start/End Conversation only', () => {
    const messagesRaw = [
      { sender: 'agent', isBot: false, text: 'Start Conversation (Agent Bravo)' },
      { sender: 'agent', isBot: false, text: 'End Conversation (Agent Bravo)' },
    ]
    expect(hasHumanAgentTurn(messagesRaw)).toBe(false)
    expect(isGradableConversation({ agent: 'Agent Bravo', messagesRaw })).toBe(false)
  })

  it('accepts real human agent reply', () => {
    const messagesRaw = [
      { sender: 'agent', isBot: false, text: 'Start Conversation (Agent Alpha)' },
      { sender: 'agent', isBot: false, text: 'Hello Customer 0042, this is Agent Alpha. How can I assist you?' },
    ]
    expect(hasHumanAgentTurn(messagesRaw)).toBe(true)
    expect(isGradableConversation({ agent: 'Agent Alpha', messagesRaw })).toBe(true)
  })

  it('ignores rating boilerplate as agent performance', () => {
    const messagesRaw = [{ sender: 'agent', isBot: false, text: 'Thank you for chatting with us!' }]
    expect(hasHumanAgentTurn(messagesRaw)).toBe(false)
  })
})

describe('buildDailyScoringBatch', () => {
  let db
  beforeAll(() => {
    db = openDb(':memory:')
    seedDatabase(db, { seed: 42 })
  })

  const ids = (b) => b.agents.flatMap((a) => a.conversations.map((c) => c.conversationId))

  it('is reproducible for the same seed and date', () => {
    const a = buildDailyScoringBatch(db, { dateStr: '2025-03-07', perAgent: 2, seed: 's' })
    const b = buildDailyScoringBatch(db, { dateStr: '2025-03-07', perAgent: 2, seed: 's' })
    expect(ids(a)).toEqual(ids(b))
    expect(ids(a).length).toBeGreaterThan(0)
  })

  it('caps per agent, skips scored conversations and the Unassigned bucket', () => {
    const batch = buildDailyScoringBatch(db, { dateStr: '2025-03-03', perAgent: 1 })
    expect(batch.agents.every((a) => a.conversations.length <= 1)).toBe(true)
    expect(batch.agents.some((a) => a.agent === 'Unassigned')).toBe(false)
    const scored = new Set(db.prepare('SELECT conversation_id FROM scores').all().map((r) => r.conversation_id))
    for (const id of ids(batch)) expect(scored.has(id)).toBe(false)
  })

  it('redacts emails and phone numbers in the agent payload', () => {
    const batch = buildDailyScoringBatch(db, { dateStr: '2025-03-07', perAgent: 10 })
    const text = JSON.stringify(batch)
    expect(text).not.toMatch(/@example\.com/)
    expect(text).not.toMatch(/\+1-555-01\d\d/)
  })
})
