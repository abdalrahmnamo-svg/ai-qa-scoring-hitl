/**
 * Scorers: turn a conversation + scorecard into a *draft* score.
 *
 *  - mock   (default): deterministic keyword/timing heuristic. No network, no API key. Same input and
 *                      seed always yield the same draft. This is what the tests and the golden eval use.
 *  - claude          : calls the Anthropic API with the QA role prompt. Needs ANTHROPIC_API_KEY.
 *
 * Both return { draftScores: {id: {points, evidence}}, reasoning, confidence, model }.
 * Neither can create an official score; output goes through the guard like any other draft.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildCriterionList } from './scorecardShape.js'
import { computeDeterministicCriteria } from './deterministicCriteria.js'
import { hashString } from './dailyScoringBatch.js'

const here = path.dirname(fileURLToPath(import.meta.url))

const agentText = (messages) => messages.filter((m) => m.sender === 'agent' && !m.isBot).map((m) => String(m.text || ''))

/** The sentence of `text` that matches `re` (trimmed), or null. */
function snippet(text, re) {
  const sentence = text.split(/(?<=[.!?])\s+/).find((part) => re.test(part))
  return sentence ? sentence.trim().slice(0, 140) : null
}

/** First agent message matching `re` -> quoted evidence, else null. */
function findEvidence(msgs, re) {
  for (const t of msgs) {
    const s = snippet(t, re)
    if (s) return `Agent wrote: "${s}"`
  }
  return null
}

const levelPoints = (max, level) => (level <= 0 ? 0 : level === 1 ? Math.ceil(max / 2) : max)

/** Largest gap (sec) between a customer message and the next agent reply, excluding the first reply (that is g2). */
function maxReplyGapSec(messages) {
  let max = 0
  let firstReplySeen = false
  let lastCustomerTs = null
  for (const m of messages) {
    const t = Date.parse(m.ts)
    if (m.sender === 'customer') {
      lastCustomerTs = t
    } else if (!m.isBot && lastCustomerTs != null) {
      if (firstReplySeen) max = Math.max(max, (t - lastCustomerTs) / 1000)
      firstReplySeen = true
      lastCustomerTs = null
    }
  }
  return max
}

/**
 * Pure heuristic. Returns detected "levels" per criterion with evidence.
 * @returns {Record<string, { level: number, evidence: string }>}
 */
export function detectLevels(conversation) {
  const messages = conversation.messages || conversation.messagesRaw || []
  const msgs = agentText(messages)
  const all = msgs.join('\n')
  const contact = conversation.contact || ''
  const out = {}
  const none = (what) => `No ${what} found in the agent messages.`

  // g1: introduction + addressing the customer
  const intro = /(this is|my name is) Agent \w+/i.test(all)
  const named = contact && all.includes(contact)
  out.g1 = {
    level: intro && named ? 2 : intro || named ? 1 : 0,
    evidence: findEvidence(msgs, /(this is|my name is) Agent \w+|Customer \d{4}/i) || none('introduction or customer name'),
  }

  // g3: gap handling
  const gap = maxReplyGapSec(messages)
  out.g3 = {
    level: gap <= 180 ? 2 : gap <= 420 ? 1 : 0,
    evidence: `Longest wait between a customer message and the agent reply (after the first) was ${Math.round(gap)}s.`,
  }

  // u1: clarifying questions in the middle of the chat (not greeting/closing checks)
  const middle = msgs.slice(1, -1).filter((t) => !/fully resolve|anything else/i.test(t))
  const qs = middle.filter((t) => t.includes('?'))
  out.u1 = {
    level: Math.min(2, qs.length),
    evidence: qs.length ? `Agent asked: "${snippet(qs[0], /\?/) || qs[0].slice(0, 140)}"` : none('clarifying question'),
  }

  // u2: validating information
  const ver = findEvidence(msgs, /verified (the|your)/i)
  const weak = findEvidence(msgs, /I have your details/i)
  out.u2 = { level: ver ? 2 : weak ? 1 : 0, evidence: ver || weak || none('validation of customer details') }

  // u3: empathy (distinct messages)
  const emp = msgs.filter((t) => /(sorry|apolog|understand how|frustrat)/i.test(t))
  out.u3 = {
    level: Math.min(2, emp.length),
    evidence: emp.length ? `Agent wrote: "${snippet(emp[0], /(sorry|apolog|understand how|frustrat)/i) || emp[0].slice(0, 140)}"` : none('empathy statement'),
  }

  // u4: account history
  const hist = findEvidence(msgs, /(reviewed|checked) your (account|previous|history)/i)
  const histWeak = findEvidence(msgs, /let me check your/i)
  out.u4 = { level: hist ? 2 : histWeak ? 1 : 0, evidence: hist || histWeak || none('history review') }

  // r1/r2: action and solution
  const done = findEvidence(msgs, /I('ve| have) (processed|rebooked|sent|reset|issued|updated|opened)/i)
  const promised = findEvidence(msgs, /I (will|'ll) (arrange|process|look into)/i)
  out.r1 = { level: done ? 2 : promised ? 1 : 0, evidence: done || promised || none('system action') }
  const fix = findEvidence(msgs, /per our guidelines|the correct fix/i)
  const tryIt = findEvidence(msgs, /you could try|please try/i)
  out.r2 = { level: fix ? 2 : tryIt ? 1 : 0, evidence: fix || tryIt || none('guideline-based solution') }

  // r3: spelling
  const typoRe = /\b(recieve|teh|pleese|thier|definately|seperate|occured|wich)\b/gi
  const typos = (all.match(typoRe) || []).length
  out.r3 = {
    level: typos === 0 ? 2 : typos === 1 ? 1 : 0,
    evidence: typos ? `Found ${typos} misspelling(s), e.g. "${(all.match(typoRe) || [])[0]}".` : 'No misspellings found in the agent messages.',
  }

  // c1 follow-up, c2 needs met, c3 clarity
  const fu = findEvidence(msgs, /check back|follow up with you/i)
  const fuWeak = findEvidence(msgs, /let me know if/i)
  out.c1 = { level: fu ? 2 : fuWeak ? 1 : 0, evidence: fu || fuWeak || none('follow-up') }
  const met = findEvidence(msgs, /fully resolve|answered everything/i)
  const metWeak = findEvidence(msgs, /hope that helps/i)
  out.c2 = { level: met ? 2 : metWeak ? 1 : 0, evidence: met || metWeak || none('needs-met check') }
  const short = msgs.filter((t) => t.trim().length <= 5).length
  const long = msgs.filter((t) => t.trim().length > 380).length
  out.c3 = {
    level: short + long === 0 ? 2 : short + long === 1 ? 1 : 0,
    evidence: `${short} very short reply(ies) and ${long} very long reply(ies) among ${msgs.length} agent messages.`,
  }

  // courtesy
  const anything = findEvidence(msgs, /anything else I can help/i)
  const anythingWeak = findEvidence(msgs, /anything else/i)
  out.t1 = { level: anything ? 2 : anythingWeak ? 1 : 0, evidence: anything || anythingWeak || none('closing check') }
  const thanks = findEvidence(msgs, /thank you for|appreciate/i)
  const thanksWeak = findEvidence(msgs, /\bthanks\b/i)
  out.t2 = { level: thanks ? 2 : thanksWeak ? 1 : 0, evidence: thanks || thanksWeak || none('appreciation') }
  const court = findEvidence(msgs, /have a (great|nice|good) day/i)
  const courtWeak = findEvidence(msgs, /take care/i)
  out.t3 = { level: court ? 2 : courtWeak ? 1 : 0, evidence: court || courtWeak || none('closing phrase') }

  // process
  const exp = findEvidence(msgs, /within \d+/i)
  const expWeak = findEvidence(msgs, /\b(soon|shortly)\b/i)
  out.p1 = { level: exp ? 2 : expWeak ? 1 : 0, evidence: exp || expWeak || none('expectation setting') }
  const doc = findEvidence(msgs, /added a note/i)
  const docWeak = findEvidence(msgs, /noted this/i)
  out.p2 = { level: doc ? 2 : docWeak ? 1 : 0, evidence: doc || docWeak || none('documentation note') }

  return out
}

/**
 * Apply reviewer calibration (mean human-minus-AI delta per criterion) from learning signals.
 * Only criteria with enough samples and a clear bias move; deterministic criteria are never adjusted.
 */
export function applyCalibration(points, criterion, signals) {
  const row = (signals?.calibration?.perCriterion || []).find((c) => c.criterionId === criterion.id)
  if (!row || row.samples < 2 || Math.abs(row.meanDelta) < 0.5) return { points, note: '' }
  const adjusted = Math.max(0, Math.min(criterion.maxPoints, points + Math.round(row.meanDelta)))
  if (adjusted === points) return { points, note: '' }
  return { points: adjusted, note: ` Calibrated ${adjusted > points ? '+' : ''}${adjusted - points} from reviewer corrections (n=${row.samples}).` }
}

export function mockScoreConversation({ conversation, scorecard, signals = null, seed = 'qa-demo' }) {
  const criteria = buildCriterionList(scorecard.scorecardStructure)
  const levels = detectLevels(conversation)
  const { overrides } = computeDeterministicCriteria({ conversation, scorecard })

  const draftScores = {}
  let partial = 0
  for (const c of criteria) {
    if (overrides[c.id]) {
      draftScores[c.id] = { points: overrides[c.id].points, evidence: overrides[c.id].evidence }
      continue
    }
    const det = levels[c.id] || { level: 0, evidence: 'No detector for this criterion.' }
    if (det.level === 1) partial++
    let points = levelPoints(c.maxPoints, det.level)
    const cal = applyCalibration(points, c, signals)
    points = cal.points
    draftScores[c.id] = { points, evidence: det.evidence + cal.note }
  }

  const total = Object.values(draftScores).reduce((a, v) => a + v.points, 0)
  const jitter = ((hashString(`${seed}:${conversation.conversationId}`) % 7) - 3) / 100
  const confidence = Math.max(0.3, Math.min(0.99, Number((0.92 - 0.04 * partial + jitter).toFixed(2))))
  const weakest = criteria
    .map((c) => ({ id: c.id, gap: c.maxPoints - draftScores[c.id].points }))
    .sort((a, b) => b.gap - a.gap || a.id.localeCompare(b.id))
    .filter((c) => c.gap > 0)
    .slice(0, 3)
    .map((c) => c.id)
  const reasoning =
    `Heuristic mock scorer: total ${total}/100. ` +
    (weakest.length ? `Largest point losses: ${weakest.join(', ')}. ` : 'No point losses detected. ') +
    `${partial} criteria received partial credit. g2 is computed from response time, not judged.`
  return { draftScores, reasoning, confidence, model: 'mock-scorer-v1' }
}

function extractJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end === -1) throw new Error('Model response contained no JSON object')
  return JSON.parse(text.slice(start, end + 1))
}

async function claudeScoreConversation({ conversation, scorecard, signals, examples = [] }, { apiKey, model }) {
  if (!apiKey) throw new Error('SCORER=claude requires ANTHROPIC_API_KEY')
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })
  const role = fs.readFileSync(path.join(here, '..', 'qa-mcp', 'AGENT_ROLE.md'), 'utf8')
  const criteria = buildCriterionList(scorecard.scorecardStructure)
  const user = [
    'Score this conversation. Respond with ONLY a JSON object:',
    '{"draftScores": {"<criterionId>": {"points": <integer>, "evidence": "<quote or cite the transcript>"}}, "reasoning": "<string>", "confidence": <0..1>}',
    'Score every criterion. Do not include g2 reasoning beyond a best guess; it is overridden server-side.',
    `Criteria: ${JSON.stringify(criteria)}`,
    `Reviewer feedback to learn from: ${JSON.stringify({ biasHints: signals?.biasHints ?? [], rejections: (signals?.rejections ?? []).slice(0, 10) })}`,
    `Human-scored examples: ${JSON.stringify(examples.slice(0, 3))}`,
    `Conversation: ${JSON.stringify(conversation)}`,
  ].join('\n\n')
  const res = await client.messages.create({
    model,
    max_tokens: 2000,
    system: role,
    messages: [{ role: 'user', content: user }],
  })
  const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')
  const parsed = extractJson(text)
  return {
    draftScores: parsed.draftScores,
    reasoning: parsed.reasoning,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
    model,
  }
}

/** @param {{ mode?: string, seed?: string, apiKey?: string, model?: string }} opts */
export function createScorer({ mode, seed, apiKey, model } = {}) {
  const m = (mode || process.env.SCORER || 'mock').toLowerCase()
  const theSeed = seed || process.env.SCORER_SEED || 'qa-demo'
  if (m === 'mock') {
    return { mode: 'mock', model: 'mock-scorer-v1', score: async (input) => mockScoreConversation({ ...input, seed: theSeed }) }
  }
  if (m === 'claude') {
    const cfg = { apiKey: apiKey || process.env.ANTHROPIC_API_KEY, model: model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-5-5' }
    return { mode: 'claude', model: cfg.model, score: (input) => claudeScoreConversation(input, cfg) }
  }
  throw new Error(`Unknown SCORER "${m}" (expected "mock" or "claude")`)
}
