#!/usr/bin/env node
// Smoke test for the MCP server: launch it exactly as mcp.example.json describes, list its tools,
// call get_qa_agent_role, and (if the API is up and the token matches) fetch the scorecard.
// Usage: npm run mcp:smoke   (set QA_MCP_TOKEN to override the placeholder token in the config)
import fs from 'node:fs'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

const config = JSON.parse(fs.readFileSync(new URL('../mcp.example.json', import.meta.url), 'utf8'))
const spec = config.mcpServers['qa-mcp']
const env = { ...process.env, ...spec.env }
if (process.env.QA_MCP_TOKEN) env.QA_MCP_TOKEN = process.env.QA_MCP_TOKEN

const transport = new StdioClientTransport({ command: spec.command, args: spec.args, env, cwd: process.cwd(), stderr: 'ignore' })
const client = new Client({ name: 'smoke', version: '1.0.0' })
await client.connect(transport)

const { tools } = await client.listTools()
console.log(`tools (${tools.length}): ${tools.map((t) => t.name).join(', ')}`)

const role = await client.callTool({ name: 'get_qa_agent_role', arguments: {} })
console.log(`get_qa_agent_role -> ${role.isError ? 'ERROR' : 'ok'} (${role.content[0].text.length} chars)`)

const cfg = await client.callTool({ name: 'fetch_scorecard_config', arguments: {} })
console.log(`fetch_scorecard_config -> ${cfg.isError ? `ERROR: ${cfg.content[0].text.slice(0, 120)}` : 'ok'}`)

await client.close()
