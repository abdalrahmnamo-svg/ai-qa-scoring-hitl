// Load ../.env into process.env when it exists (no dependency, silent when absent).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.env')
if (fs.existsSync(file)) process.loadEnvFile(file)
