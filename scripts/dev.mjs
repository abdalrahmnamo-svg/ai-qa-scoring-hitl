#!/usr/bin/env node
// `npm run dev`: start the API (port 3001) and the Vite UI (port 5173) together.
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)
const viteBin = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js')

const apiArgs = ['--disable-warning=ExperimentalWarning']
apiArgs.push('server/index.js')

const children = [
  spawn(process.execPath, apiArgs, { stdio: 'inherit' }),
  spawn(process.execPath, [viteBin], { stdio: 'inherit' }),
]

const stop = () => children.forEach((c) => !c.killed && c.kill())
process.on('SIGINT', () => { stop(); process.exit(0) })
process.on('SIGTERM', () => { stop(); process.exit(0) })
for (const c of children) c.on('exit', (code) => { stop(); process.exit(code ?? 0) })
