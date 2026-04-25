import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const currentFilePath = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(currentFilePath), '..')
const scriptDirectory = path.dirname(currentFilePath)
const viteArguments = process.argv.slice(2)

const childProcess = shouldUseWindowsUncBridge(projectRoot)
  ? spawnViaWindowsUncBridge(projectRoot, viteArguments)
  : spawn(process.execPath, [resolveViteBin(projectRoot), ...viteArguments], {
      cwd: projectRoot,
      stdio: 'inherit',
    })

forwardTerminationSignals(childProcess)

childProcess.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }

  process.exit(code ?? 1)
})

childProcess.on('error', (error) => {
  console.error(error)
  process.exit(1)
})

function shouldUseWindowsUncBridge(value) {
  return process.platform === 'win32' && normalizeWindowsPath(value).startsWith('\\\\')
}

function normalizeWindowsPath(value) {
  if (!value.startsWith('\\\\?\\')) {
    return value
  }

  if (value.startsWith('\\\\?\\UNC\\')) {
    return `\\\\${value.slice('\\\\?\\UNC\\'.length)}`
  }

  return value.slice('\\\\?\\'.length)
}

function resolveViteBin(rootPath) {
  return path.join(rootPath, 'node_modules', 'vite', 'bin', 'vite.js')
}

function spawnViaWindowsUncBridge(rootPath, args) {
  return spawn(resolvePowerShellExecutable(), [
    '-NoLogo',
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    path.join(scriptDirectory, 'run-vite-unc.ps1'),
    '-ProjectRoot',
    normalizeWindowsPath(rootPath),
    '-NodeExecutable',
    normalizeWindowsPath(process.execPath),
    '-ViteArgsBase64',
    encodeArguments(args),
  ], {
    cwd: process.env.SystemRoot || 'C:\\Windows',
    stdio: 'inherit',
    windowsHide: false,
  })
}

function resolvePowerShellExecutable() {
  const windowsPowerShellPath = path.join(
    process.env.SystemRoot || 'C:\\Windows',
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  )

  if (fs.existsSync(windowsPowerShellPath)) {
    return windowsPowerShellPath
  }

  return 'powershell.exe'
}

function encodeArguments(args) {
  return Buffer.from(JSON.stringify(args), 'utf8').toString('base64')
}

function forwardTerminationSignals(child) {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal)
      }
    })
  }
}
