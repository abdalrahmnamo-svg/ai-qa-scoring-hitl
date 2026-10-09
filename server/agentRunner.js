/**
 * The "agent loop": what an MCP-connected LLM does in a session, driven through the same tool
 * handlers it would use over stdio. `npm run batch` runs it in-process; point an MCP client at
 * qa-mcp/server.js to let a real model do the same thing.
 *
 * Nothing here can create an official score: the only write is `submit_draft_score`.
 */

/** Adapter so tool handlers can call a Hono app directly (no network, no port). */
export function inProcessFetch(app) {
  return (url, init) => app.request(url, init)
}

export async function runBatch({ handlers, scorer, date, perAgent = 2, log = () => {} }) {
  await handlers.get_qa_agent_role()
  const scorecard = await handlers.fetch_scorecard_config()
  const signals = await handlers.fetch_learning_signals({})
  const examples = scorer.mode === 'claude' ? await handlers.fetch_scored_examples({ limit: 3 }) : []
  const batch = await handlers.fetch_daily_scoring_batch({ date, perAgent })

  log(
    `batch ${batch.date}: ${batch.totalConversations} conversation(s) across ${batch.agentCount} agent(s); ` +
      `${signals.rejections.length} rejection(s), ${signals.corrections.length} correction(s), ${signals.biasHints.length} bias hint(s) from reviewers`,
  )

  const result = { date: batch.date, submitted: [], guardRejected: [], blocked: [] }
  for (const block of batch.agents) {
    for (const conversation of block.conversations) {
      const draft = await scorer.score({ conversation, scorecard, signals, examples })
      try {
        const res = await handlers.submit_draft_score({
          conversationId: conversation.conversationId,
          draftScores: draft.draftScores,
          reasoning: draft.reasoning,
          confidence: draft.confidence,
          model: draft.model,
        })
        result.submitted.push({ conversationId: conversation.conversationId, ...res })
        log(`  ${conversation.conversationId} (${conversation.agent}) -> draft #${res.draftId} total ${res.totalScore}`)
      } catch (err) {
        if (err.status === 422) {
          result.guardRejected.push({ conversationId: conversation.conversationId, error: err.message })
          log(`  ${conversation.conversationId} rejected by guard: ${err.message}`)
        } else if (err.status === 409) {
          result.blocked.push({ conversationId: conversation.conversationId, error: err.message })
          log(`  ${conversation.conversationId} blocked: ${err.message}`)
        } else {
          throw err
        }
      }
    }
  }
  return result
}
