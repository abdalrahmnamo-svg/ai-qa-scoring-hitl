import { orderedScorecardSections } from '../src/utils/defaultScorecardConfig.js'

/** Flat list of criteria { id, label, maxPoints, section } in canonical order. */
export function buildCriterionList(scorecardStructure) {
  const out = []
  for (const [key, section] of orderedScorecardSections(scorecardStructure)) {
    for (const c of section?.criteria || []) {
      if (!c?.id) continue
      out.push({ id: c.id, label: c.label || c.id, maxPoints: Number(c.maxPoints) || 0, section: key })
    }
  }
  return out
}

/** Map criterionId -> section key (used as the "topic" of a learning signal). */
export function topicMap(scorecardStructure) {
  const m = {}
  for (const c of buildCriterionList(scorecardStructure)) m[c.id] = c.section
  return m
}
