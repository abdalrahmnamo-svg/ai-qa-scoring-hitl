#!/usr/bin/env node
/**
 * Golden-set evaluation: prints how closely AI drafts match the held-out human ("golden") scores.
 * See server/goldenEval.js for the metric definitions.
 *
 * Usage: npm run golden:eval [-- --tolerance 5]
 */
import '../server/loadEnv.js'
import { openDb } from '../server/db.js'
import { createScorer } from '../server/scorer.js'
import { runGoldenEval } from '../server/goldenEval.js'

const tolArg = process.argv.indexOf('--tolerance')
const tolerance = tolArg !== -1 ? Number(process.argv[tolArg + 1]) || 5 : 5

try {
  const report = await runGoldenEval(openDb(), { scorer: createScorer(), tolerance })
  console.log(JSON.stringify(report, null, 2))
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
