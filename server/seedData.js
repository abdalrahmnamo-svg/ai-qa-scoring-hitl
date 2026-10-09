/**
 * Synthetic data generator. Everything here is invented: agents "Agent Alpha..Foxtrot", customers
 * "Customer 0042", emails @example.com, phones +1-555-01xx. A seeded PRNG makes the output identical
 * for a given seed.
 *
 * Each conversation is generated from per-criterion quality "levels" (0 = missing, 1 = weak,
 * 2 = good). The dialogue realises those levels as text. The human ("golden") score is the realised
 * level plus reviewer noise, with a systematic strictness on empathy (u3) and documentation (p2), so
 * the mock scorer and the human truth agree often but not always.
 */

import { mulberry32 } from './dailyScoringBatch.js'
import { transaction, loadScorecard } from './db.js'
import { buildCriterionList } from './scorecardShape.js'
import { computeDeterministicCriteria } from './deterministicCriteria.js'
import { PASS_THRESHOLD } from '../src/utils/defaultScorecardConfig.js'

export const AGENTS = [
  { name: 'Agent Alpha', skill: 0.95 },
  { name: 'Agent Bravo', skill: 0.88 },
  { name: 'Agent Charlie', skill: 0.8 },
  { name: 'Agent Delta', skill: 0.92 },
  { name: 'Agent Echo', skill: 0.7 },
  { name: 'Agent Foxtrot', skill: 0.84 },
]

export const DATES = ['2025-03-03', '2025-03-04', '2025-03-05', '2025-03-06', '2025-03-07']

const TOTAL_CONVERSATIONS = 80
const UNASSIGNED_INDEXES = new Set([7, 33, 52, 71])
const GOLDEN_COUNT = 20
const HUMAN_COUNT = 8

const FILLER =
  ' To explain how this works in more detail, our process involves several internal checks across different teams, and each of those checks happens in sequence, which is why the exact order matters when we handle requests of this type, and why I want to describe each part carefully so that nothing is unclear to you at any point.'

const SCENARIOS = {
  billing: {
    open: 'Hi, I was charged twice for my subscription this month.',
    details: 'It is the monthly plan, charged on the 3rd. There are two charges of $19.99.',
    q1: 'Could you tell me which card the two charges appeared on?',
    a1: 'The Visa ending 4821.',
    q2: 'And when did you first notice the second charge?',
    a2: 'Yesterday when I checked my statement.',
    empathy1: "I'm sorry about the trouble with the double charge.",
    empathy2: 'I understand how frustrating this must be.',
    history2: "I've reviewed your account history and previous contacts, and this is the first time this has happened.",
    verify2: "I've verified the account details and the two charges on the 3rd match.",
    fix: 'Per our guidelines, the correct fix here is to refund the duplicate charge.',
    tryIt: 'You could try contacting your bank about the second charge.',
    refuse: "I'm afraid that is not something we can change on our side.",
    done: "I've processed the refund for the duplicate $19.99 charge.",
    promise: 'I will arrange the refund for you.',
    expect2: "The refund will arrive within 3-5 business days, and you'll receive a confirmation email.",
    doc2: "I've added a note to your account with the details of this refund, and flagged it as a one-time exception.",
    follow2: "I'll check back with you in two days to make sure the refund has arrived.",
  },
  booking: {
    open: 'I need to move my booking from Friday to next Tuesday.',
    details: 'The booking reference is BK-7305 and it is for two people.',
    q1: 'Is the new date flexible by a day either way?',
    a1: 'Tuesday or Wednesday would work.',
    q2: 'Do both people still need to attend?',
    a2: 'Yes, both of us.',
    empathy1: "I'm sorry for the inconvenience of the schedule change.",
    empathy2: 'I understand how important it is to get the date right.',
    history2: "I've checked your account and previous bookings, and there are no earlier changes on this one.",
    verify2: "I've verified the booking reference and the party size on the booking.",
    fix: 'Per our guidelines, the correct fix here is to rebook you for Tuesday with no change fee, since this is your first change.',
    tryIt: 'You could try booking a new slot on the website and cancelling the old one.',
    refuse: 'Unfortunately bookings cannot be moved once they are made.',
    done: "I've rebooked you for Tuesday and sent the updated confirmation.",
    promise: 'I will arrange the new date for you.',
    expect2: "You'll receive the updated confirmation within 10 minutes, and the old slot is released automatically.",
    doc2: "I've added a note to your booking recording the change, and flagged the waived fee as a one-time exception.",
    follow2: "I'll check back with you on Monday to make sure everything is in place.",
  },
  login: {
    open: "I can't log in to the app since the latest update.",
    details: 'It says my password is incorrect, but I have not changed it.',
    q1: 'What error message do you see exactly?',
    a1: 'It just says incorrect credentials.',
    q2: 'Which device are you using?',
    a2: 'A phone, with the latest version of the app.',
    empathy1: "I'm sorry you are locked out right now.",
    empathy2: 'I understand how frustrating this must be.',
    history2: "I've reviewed your account history and previous contacts, and there were no earlier sign-in problems.",
    verify2: "I've verified your account email and that the account is active.",
    fix: 'Per our guidelines, the correct fix here is a password reset followed by a fresh sign-in on the updated app.',
    tryIt: 'You could try reinstalling the app and signing in again.',
    refuse: 'That is a known limitation and there is nothing I can do about it.',
    done: "I've sent a reset link to the email on your account.",
    promise: 'I will arrange a reset for you.',
    expect2: 'The link will arrive within 5 minutes and stays valid for 24 hours.',
    doc2: "I've added a note to your account recording the reset, and flagged the affected app version for our team.",
    follow2: "I'll check back with you tomorrow to confirm you can sign in.",
  },
}
const SCENARIO_KEYS = Object.keys(SCENARIOS)

const HUMAN_COMMENTS = {
  pass: ['- Good job! Keep it up!', '- Well done, great handling of this inquiry.'],
  fail: [
    '- Make sure to be more empathetic and set clear expectations.',
    '- Review messages before sending and confirm the need is fully met.',
  ],
}

const levelPoints = (max, level) => (level <= 0 ? 0 : level === 1 ? Math.ceil(max / 2) : max)

function drawLevel(rng, q) {
  const r = rng()
  if (r < q) return 2
  return r < q + (1 - q) * 0.6 ? 1 : 0
}

/** Choose a level for every criterion. */
function drawLevels(rng, q, criteria) {
  const levels = {}
  for (const c of criteria) levels[c.id] = drawLevel(rng, q)
  return levels
}

function buildDialogue(rng, scen, { agent, contact, email, phone, levels, rawSec, withContactInfo, startMs }) {
  const turns = [] // { sender, text, gap, isBot }
  const pick = (arr) => arr[Math.floor(rng() * arr.length)]
  const cust = (text) => turns.push({ sender: 'customer', text, gap: 15 + Math.floor(rng() * 45) })
  const norm = () => 20 + Math.floor(rng() * 90)
  let nextGap = null
  const agentSay = (text) => {
    turns.push({ sender: 'agent', text, gap: nextGap ?? norm() })
    nextGap = null
  }

  turns.push({
    sender: 'customer',
    text: withContactInfo ? `${scen.open} My email is ${email} and my phone is ${phone}.` : scen.open,
    gap: 0,
  })

  // g1 greeting (first reply; gap = raw response time)
  nextGap = rawSec
  const g1 = levels.g1
  if (g1 === 2) {
    agentSay(pick([`Hello ${contact}, this is ${agent}. Good to hear from you, how can I help?`, `Hi ${contact}, my name is ${agent}. How can I help today?`]))
  } else if (g1 === 1) {
    agentSay(pick([`Hello, this is ${agent}. How can I help?`, `Hi ${contact}. How can I help?`]))
  } else {
    agentSay(pick(['Hi. What is the problem?', 'Hello. What do you need?']))
  }
  cust(scen.details)

  if (levels.c3 === 0) agentSay('Ok.')

  const mid = []
  if (levels.u3 >= 1) mid.push(scen.empathy1)
  if (levels.u4 === 2) mid.push(scen.history2)
  else if (levels.u4 === 1) mid.push('Let me check your account.')
  if (mid.length) agentSay(mid.join(' '))

  if (levels.u1 >= 1) {
    agentSay(scen.q1)
    cust(scen.a1)
  }
  if (levels.u1 === 2) {
    agentSay(scen.q2)
    cust(scen.a2)
  }
  if (levels.u3 === 2) agentSay(scen.empathy2)

  if (levels.c3 === 0) agentSay('Sure.')

  // g3: the next agent reply after the customer's last message carries the gap
  const gapSec = levels.g3 === 2 ? 30 + Math.floor(rng() * 70) : levels.g3 === 1 ? 250 + Math.floor(rng() * 150) : 500 + Math.floor(rng() * 400)
  if (turns[turns.length - 1].sender !== 'customer') cust('Okay, please go ahead.')
  nextGap = gapSec
  if (levels.u2 === 2) {
    agentSay(scen.verify2)
  } else if (levels.u2 === 1) {
    agentSay('I have your details here.')
  }

  const solution = levels.r2 === 2 ? scen.fix : levels.r2 === 1 ? scen.tryIt : scen.refuse
  agentSay(levels.c3 === 1 ? solution + FILLER : solution)
  cust('Okay, that makes sense.')
  if (levels.r1 === 2) agentSay(scen.done)
  else if (levels.r1 === 1) agentSay(scen.promise)

  if (levels.p1 === 2) agentSay(scen.expect2)
  else if (levels.p1 === 1) agentSay('It should be sorted soon.')
  if (levels.p2 === 2) agentSay(scen.doc2)
  else if (levels.p2 === 1) agentSay("I've noted this.")
  if (levels.c1 === 2) agentSay(scen.follow2)
  else if (levels.c1 === 1) agentSay("Let me know if it doesn't work.")
  cust('Thank you, will do.')

  if (levels.c2 === 2) {
    agentSay('Does that fully resolve everything for you?')
    cust("Yes, that's everything, thank you.")
  } else if (levels.c2 === 1) {
    agentSay('I hope that helps.')
  }

  const closing = []
  if (levels.t1 === 2) closing.push('Is there anything else I can help you with today?')
  else if (levels.t1 === 1) closing.push('Anything else?')
  if (levels.t2 === 2) closing.push('Thank you for your patience and for contacting us.')
  else if (levels.t2 === 1) closing.push('Thanks.')
  if (levels.t3 === 2) closing.push('Have a great day!')
  else if (levels.t3 === 1) closing.push('Take care.')
  agentSay(closing.length ? closing.join(' ') : 'Goodbye for now.')

  // r3: realise spelling mistakes by corrupting " the " in some agent messages
  const wanted = levels.r3 === 2 ? 0 : levels.r3 === 1 ? 1 : 3
  let applied = 0
  const candidates = turns.map((t, i) => i).filter((i) => turns[i].sender === 'agent' && turns[i].text.includes(' the '))
  for (const i of candidates) {
    if (applied >= wanted) break
    turns[i].text = turns[i].text.replace(' the ', ' teh ')
    applied++
  }
  levels.r3 = applied === 0 ? 2 : applied === 1 ? 1 : 0

  // timestamps
  let t = startMs
  return turns.map((turn) => {
    t += turn.gap * 1000
    return { sender: turn.sender, isBot: false, text: turn.text, ts: new Date(t).toISOString() }
  })
}

function applyReviewerNoise(rng, levels, criteria) {
  const out = {}
  for (const c of criteria) {
    if (c.id === 'g2') continue
    const strict = c.id === 'u3' || c.id === 'p2'
    const down = strict ? 0.3 : 0.06
    const up = 0.04
    const u = rng()
    let lv = levels[c.id]
    if (u < down) lv = Math.max(0, lv - 1)
    else if (u < down + up) lv = Math.min(2, lv + 1)
    out[c.id] = lv
  }
  return out
}

/**
 * Seed (and reset) the database.
 * @returns {{ conversations: number, golden: number, humanScored: number, unassigned: number }}
 */
export function seedDatabase(db, { seed = 42 } = {}) {
  const rng = mulberry32(seed)
  const scorecard = loadScorecard(db)
  const criteria = buildCriterionList(scorecard.scorecardStructure)

  const rows = []
  for (let i = 0; i < TOTAL_CONVERSATIONS; i++) {
    const dateIdx = i % DATES.length
    const date = DATES[dateIdx]
    const conversationId = `CONV-${String(i + 1).padStart(4, '0')}`
    const contactNo = String((i * 37 + 42) % 10000).padStart(4, '0')
    const contact = `Customer ${contactNo}`
    const email = `customer${contactNo}@example.com`
    const phone = `+1-555-01${String(i % 100).padStart(2, '0')}`
    const slot = Math.floor(i / DATES.length)
    const startMs = Date.parse(`${date}T09:00:00Z`) + slot * 20 * 60 * 1000

    if (UNASSIGNED_INDEXES.has(i)) {
      const mk = (sender, isBot, text, s) => ({ sender, isBot, text, ts: new Date(startMs + s * 1000).toISOString() })
      rows.push({
        conv: { conversationId, agent: 'Unassigned', contact, date, topic: 'menu', raw: null, adj: null },
        messages: [
          mk('customer', false, 'Menu', 0),
          mk('agent', true, 'Welcome! Reply 1 for billing, 2 for bookings, 3 for app help.', 2),
          mk('customer', false, '3', 20),
          mk('agent', true, 'Start Conversation', 22),
          mk('agent', true, 'Thank you for chatting with us. Please type the word "Rate" to rate this conversation.', 25),
        ],
        levels: null,
        dateIdx,
      })
      continue
    }

    const agent = AGENTS[Math.floor(i / DATES.length) % AGENTS.length]
    const q = Math.max(0.35, Math.min(0.98, agent.skill + (rng() - 0.5) * 0.2))
    const levels = drawLevels(rng, q, criteria)

    // g2 / response time
    const fast = rng() < Math.min(0.97, q + 0.07)
    const rawSec = fast ? 40 + Math.floor(rng() * 240) : 330 + Math.floor(rng() * 570)
    const adjusted = !fast && rng() < 0.18 ? 60 + Math.floor(rng() * 220) : null

    const scenKey = SCENARIO_KEYS[i % SCENARIO_KEYS.length]
    const messages = buildDialogue(rng, SCENARIOS[scenKey], {
      agent: agent.name,
      contact,
      email,
      phone,
      levels,
      rawSec,
      withContactInfo: rng() < 0.25,
      startMs,
    })
    rows.push({
      conv: { conversationId, agent: agent.name, contact, date, topic: scenKey, raw: rawSec, adj: adjusted },
      messages,
      levels,
      dateIdx,
    })
  }

  // Which gradable conversations get human scores (never from the final day, so a fresh batch exists).
  const eligible = rows.filter((r) => r.levels && r.dateIdx < DATES.length - 1)
  const order = eligible.map((r, i) => ({ r, k: rng(), i })).sort((a, b) => a.k - b.k || a.i - b.i).map((x) => x.r)
  const golden = new Set(order.slice(0, GOLDEN_COUNT).map((r) => r.conv.conversationId))
  const human = new Set(order.slice(GOLDEN_COUNT, GOLDEN_COUNT + HUMAN_COUNT).map((r) => r.conv.conversationId))

  transaction(db, () => {
    for (const t of ['scores', 'draft_scores', 'messages', 'conversations']) db.exec(`DELETE FROM ${t}`)
    db.exec("DELETE FROM sqlite_sequence WHERE name IN ('draft_scores','messages')")

    const insConv = db.prepare(
      'INSERT INTO conversations (conversation_id, agent, contact, date, topic, raw_response_sec, adjusted_response_sec) VALUES (?,?,?,?,?,?,?)',
    )
    const insMsg = db.prepare('INSERT INTO messages (conversation_id, seq, sender, is_bot, text, ts) VALUES (?,?,?,?,?,?)')
    const insScore = db.prepare(
      `INSERT INTO scores (conversation_id, scores, total_score, passed, score_origin, comments, scored_by, scored_date)
       VALUES (?,?,?,?,?,?,?,?)`,
    )

    for (const r of rows) {
      const c = r.conv
      insConv.run(c.conversationId, c.agent, c.contact, c.date, c.topic, c.raw, c.adj)
      r.messages.forEach((m, seq) => insMsg.run(c.conversationId, seq, m.sender, m.isBot ? 1 : 0, m.text, m.ts))

      if (!golden.has(c.conversationId) && !human.has(c.conversationId)) continue
      const truthLevels = applyReviewerNoise(rng, r.levels, criteria)
      const { overrides } = computeDeterministicCriteria({
        conversation: { rawResponseSec: c.raw, adjustedResponseSec: c.adj },
        scorecard,
      })
      const truth = {}
      for (const crit of criteria) {
        truth[crit.id] = crit.id === 'g2' ? overrides.g2.points : levelPoints(crit.maxPoints, truthLevels[crit.id])
      }
      const total = Object.values(truth).reduce((a, b) => a + b, 0)
      const passed = total >= PASS_THRESHOLD
      const comment = HUMAN_COMMENTS[passed ? 'pass' : 'fail'][Math.floor(rng() * 2)]
      insScore.run(
        c.conversationId,
        JSON.stringify(truth),
        total,
        passed ? 1 : 0,
        golden.has(c.conversationId) ? 'golden' : 'human',
        comment,
        'Reviewer 01',
        c.date,
      )
    }
  })

  return {
    conversations: rows.length,
    golden: golden.size,
    humanScored: human.size,
    unassigned: rows.filter((r) => !r.levels).length,
  }
}
