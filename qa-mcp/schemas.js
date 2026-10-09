// qa-mcp/schemas.js: MCP tool definitions.
// The MCP server may read freely and write DRAFTS only; it can never write an official score.
// Session workflow: get_qa_agent_role first, then fetch_scorecard_config + fetch_learning_signals,
// then score the daily batch. See qa-mcp/AGENT_ROLE.md.

export const TOOL_SCHEMAS = [
  {
    name: 'get_qa_agent_role',
    description:
      'REQUIRED FIRST STEP every session. Returns the QA agent role, scorecard reference, learning loop and session workflow.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'fetch_scorecard_config',
    description: 'Load the live scorecard rubric (criterion ids, labels, max points, notes), guidelines and operating hours.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'fetch_learning_signals',
    description:
      'Recent human rejections (with reasons), edit-corrections on your drafts, and per-criterion calibration bias hints. Call before scoring.',
    inputSchema: {
      type: 'object',
      properties: {
        sinceDays: { type: 'integer', minimum: 1, maximum: 365, default: 30 },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fetch_scored_examples',
    description: 'Human-scored conversations with transcripts: calibration examples showing how reviewers score and comment.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 },
        agent: { type: 'string', description: 'Optional exact support-agent name filter' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fetch_daily_scoring_batch',
    description:
      'PRIMARY work queue: up to perAgent (default 2) random unscored conversations per support agent for a date (default: latest day in the data).',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', format: 'date', description: 'YYYY-MM-DD' },
        perAgent: { type: 'integer', minimum: 1, maximum: 10, default: 2 },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'fetch_unscored_conversations',
    description: 'Ad-hoc backlog: unscored conversations, newest first. For daily runs prefer fetch_daily_scoring_batch.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 10 },
        agent: { type: 'string' },
        from: { type: 'string', format: 'date' },
        to: { type: 'string', format: 'date' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'submit_draft_score',
    description:
      'Submit a DRAFT score for one conversation. It always lands as pending_human_review and never counts until a human approves it in the Review Queue. The server rejects malformed, out-of-range or evidence-free drafts.',
    inputSchema: {
      type: 'object',
      required: ['conversationId', 'draftScores', 'reasoning'],
      properties: {
        conversationId: { type: 'string', description: 'conversationId from the fetched conversation, e.g. CONV-0007' },
        draftScores: {
          type: 'object',
          description: 'Map of EVERY scorecard criterion id -> { points, evidence }. Evidence must cite the transcript.',
          additionalProperties: {
            type: 'object',
            required: ['points', 'evidence'],
            properties: {
              points: { type: 'integer', minimum: 0 },
              evidence: { type: 'string', minLength: 12 },
            },
            additionalProperties: false,
          },
        },
        reasoning: { type: 'string', minLength: 1, description: 'Why these points; cite transcript moments' },
        confidence: { type: 'number', minimum: 0, maximum: 1, description: 'Self-reported confidence; drives review triage' },
        model: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
]
