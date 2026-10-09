/**
 * Default scorecard: six sections, 100 points.
 * Used as the seed value for the `scorecard_config` table and as a UI fallback.
 */

/** Passing score threshold (out of 100). A conversation passes when totalScore >= PASS_THRESHOLD. */
export const PASS_THRESHOLD = 90

/**
 * Canonical section order. The UI must not rely on key order coming back from JSON storage.
 */
export const SCORECARD_SECTION_ORDER = Object.freeze([
  'greeting',
  'understanding',
  'resolution',
  'confirmation',
  'courtesy',
  'process',
])

/**
 * @param {object|null|undefined} scorecardStructure
 * @returns {[string, object][]} [sectionKey, section] pairs in canonical order; unknown keys last.
 */
export function orderedScorecardSections(scorecardStructure) {
  if (!scorecardStructure || typeof scorecardStructure !== 'object') return []
  const seen = new Set()
  const pairs = []
  for (const key of SCORECARD_SECTION_ORDER) {
    const section = scorecardStructure[key]
    if (section && typeof section === 'object') {
      pairs.push([key, section])
      seen.add(key)
    }
  }
  for (const [key, section] of Object.entries(scorecardStructure)) {
    if (!seen.has(key) && section && typeof section === 'object') {
      pairs.push([key, section])
    }
  }
  return pairs
}

export const DEFAULT_MASTER_GUIDELINES = [
  { id: 1, title: 'Reply within the target time', description: 'Send the first meaningful reply inside the response-time target.' },
  { id: 2, title: 'Ask if anything else is needed', description: 'Before closing, check the customer has no further requests.' },
  { id: 3, title: 'Be empathetic', description: "Acknowledge the customer's situation before solving." },
  { id: 4, title: 'Set expectations clearly', description: 'Say what happens next, and when (processing times, limits, follow-ups).' },
  { id: 5, title: 'Review messages before sending', description: 'Check grammar, spelling and clarity.' },
  { id: 6, title: 'Use a friendly, professional tone', description: 'Avoid blunt or robotic phrasing.' },
  { id: 7, title: 'Avoid one-word answers', description: 'Give complete, informative replies.' },
  { id: 8, title: 'Document actions', description: 'Record what was done, especially exceptions.' },
  { id: 9, title: 'Resolve fully', description: 'Make sure the issue is resolved before ending the chat.' },
  { id: 10, title: 'Keep answers simple', description: 'Plain language, one step at a time.' },
]

export const DEFAULT_OPERATING_HOURS = { targetFrtMinutes: 5 }

export const DEFAULT_SCORECARD_STRUCTURE = {
  greeting: {
    title: 'GREETING (20 points)',
    criteria: [
      { id: 'g1', label: 'Introduces self and addresses the customer', maxPoints: 5, notes: "Agent gives their name and uses the customer's name or reference when greeting." },
      { id: 'g2', label: 'First reply within target time', maxPoints: 10, notes: 'Computed from response time, not judged. Target is in the operating hours config.' },
      { id: 'g3', label: 'No long gaps between messages', maxPoints: 5, notes: 'Keep the conversation moving; tell the customer if a check will take a while.' },
    ],
  },
  understanding: {
    title: 'UNDERSTANDING (20 points)',
    criteria: [
      { id: 'u1', label: 'Asks the right questions', maxPoints: 5, notes: 'Relevant clarifying questions that move the case forward.' },
      { id: 'u2', label: 'Validates customer information', maxPoints: 5, notes: 'Confirms identifiers and details before acting on them.' },
      { id: 'u3', label: 'Shows empathy', maxPoints: 5, notes: "Acknowledges the customer's concern and situation." },
      { id: 'u4', label: 'Reviews account history', maxPoints: 5, notes: 'Checks prior notes or earlier contacts before answering.' },
    ],
  },
  resolution: {
    title: 'RESOLUTION (21 points)',
    criteria: [
      { id: 'r1', label: 'Takes the right system action', maxPoints: 6, notes: 'Performs the correct update (refund, rebooking, reset, ticket).' },
      { id: 'r2', label: 'Proposes a correct solution', maxPoints: 10, notes: 'A practical solution that follows the written support guidelines.' },
      { id: 'r3', label: 'Clear, error-free writing', maxPoints: 5, notes: 'Spelling, grammar and punctuation.' },
    ],
  },
  confirmation: {
    title: 'CONFIRMATION (15 points)',
    criteria: [
      { id: 'c1', label: 'Follows up', maxPoints: 5, notes: 'Checks the solution worked, or commits to a follow-up.' },
      { id: 'c2', label: 'Confirms all needs are met', maxPoints: 5, notes: 'Every question answered before closing.' },
      { id: 'c3', label: 'Clear, simple answers', maxPoints: 5, notes: 'Plain language; no one-word or overloaded replies.' },
    ],
  },
  courtesy: {
    title: 'COURTESY (9 points)',
    criteria: [
      { id: 't1', label: 'Ends the chat on a high note', maxPoints: 5, notes: 'Asks whether there is anything else before closing.' },
      { id: 't2', label: 'Shows appreciation', maxPoints: 2, notes: 'Thanks the customer sincerely.' },
      { id: 't3', label: 'Closing courtesy phrase', maxPoints: 2, notes: 'For example "have a great day".' },
    ],
  },
  process: {
    title: 'PROCESS (15 points)',
    criteria: [
      { id: 'p1', label: 'Sets expectations', maxPoints: 8, notes: 'States next steps and timelines clearly.' },
      { id: 'p2', label: 'Documents actions and exceptions', maxPoints: 7, notes: 'Mentions the account note or flags any exception made.' },
    ],
  },
}
