#!/usr/bin/env node
// Seed the local SQLite database with synthetic conversations, human scores and a golden set.
// Usage: npm run seed [-- --seed 42]
import '../server/loadEnv.js'
import { openDb, resolveDbPath } from '../server/db.js'
import { seedDatabase } from '../server/seedData.js'

const i = process.argv.indexOf('--seed')
const seed = i !== -1 ? Number(process.argv[i + 1]) || 42 : Number(process.env.SEED) || 42

const db = openDb()
const summary = seedDatabase(db, { seed })
console.log(`Seeded ${resolveDbPath()} (seed ${seed})`)
console.log(JSON.stringify(summary))
