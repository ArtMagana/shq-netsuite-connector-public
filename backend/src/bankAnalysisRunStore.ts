import fs from 'node:fs'
import path from 'node:path'

import type {
  BankImportAnalysisMode,
  BankImportAnalysisRunResponse,
  BankImportAnalysisStatus,
  BankImportAnalyzeResponse,
  BankImportBankId,
} from './types.js'

type StoredBankAnalysisRun = {
  analysisId: string
  requestHash: string
  bankId: BankImportBankId
  sourceFileName: string
  accountingPeriod: string
  cutoffDate: string
  mode: BankImportAnalysisMode
  status: BankImportAnalysisStatus
  startedAtUtc: string
  finishedAtUtc: string | null
  error: string | null
  result: BankImportAnalyzeResponse | null
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredBankAnalysisRunFile = {
  version: 1
  items: StoredBankAnalysisRun[]
}

const BANK_ANALYSIS_RUN_STORE_PATH =
  process.env.BANKS_ANALYSIS_RUN_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'bank-analysis-runs.json')

export function getBankAnalysisRun(analysisId: string) {
  return loadBankAnalysisRuns().find((item) => item.analysisId === cleanText(analysisId)) ?? null
}

export function findRunningBankAnalysisRunByHash(input: {
  requestHash: string
  bankId: BankImportBankId
  mode: BankImportAnalysisMode
}) {
  return loadBankAnalysisRuns()
    .filter(
      (item) =>
        item.status === 'running' &&
        item.requestHash === cleanText(input.requestHash) &&
        item.bankId === input.bankId &&
        item.mode === input.mode,
    )
    .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))[0] ?? null
}

export function findLatestBankAnalysisRunByHash(input: {
  requestHash: string
  bankId: BankImportBankId
  mode: BankImportAnalysisMode
}) {
  return loadBankAnalysisRuns()
    .filter(
      (item) =>
        item.requestHash === cleanText(input.requestHash) && item.bankId === input.bankId && item.mode === input.mode,
    )
    .sort((left, right) => right.updatedAtUtc.localeCompare(left.updatedAtUtc))[0] ?? null
}

export function createBankAnalysisRun(input: {
  analysisId: string
  requestHash: string
  bankId: BankImportBankId
  sourceFileName: string
  accountingPeriod: string
  cutoffDate: string
  mode: BankImportAnalysisMode
}) {
  const currentItems = loadBankAnalysisRuns()
  const now = new Date().toISOString()
  const nextItem: StoredBankAnalysisRun = {
    analysisId: cleanText(input.analysisId),
    requestHash: cleanText(input.requestHash),
    bankId: input.bankId,
    sourceFileName: cleanText(input.sourceFileName),
    accountingPeriod: cleanText(input.accountingPeriod),
    cutoffDate: cleanText(input.cutoffDate),
    mode: input.mode,
    status: 'running',
    startedAtUtc: now,
    finishedAtUtc: null,
    error: null,
    result: null,
    createdAtUtc: now,
    updatedAtUtc: now,
  }

  persistBankAnalysisRuns([...currentItems, nextItem])
  return nextItem
}

export function completeBankAnalysisRun(
  analysisId: string,
  status: Extract<BankImportAnalysisStatus, 'completed' | 'failed'>,
  input: {
    error?: string | null
    result?: BankImportAnalyzeResponse | null
  },
) {
  const now = new Date().toISOString()
  const currentItems = loadBankAnalysisRuns()
  const nextItems = currentItems.map((item) => {
    if (item.analysisId !== cleanText(analysisId)) {
      return item
    }

    return {
      ...item,
      status,
      finishedAtUtc: now,
      error: cleanText(input.error) || null,
      result: input.result ?? null,
      updatedAtUtc: now,
    }
  })

  persistBankAnalysisRuns(nextItems)
  return nextItems.find((item) => item.analysisId === cleanText(analysisId)) ?? null
}

export function toBankAnalysisRunResponse(run: StoredBankAnalysisRun): BankImportAnalysisRunResponse {
  return {
    analysisId: run.analysisId,
    bankId: run.bankId,
    sourceFileName: run.sourceFileName,
    accountingPeriod: run.accountingPeriod,
    cutoffDate: run.cutoffDate,
    mode: run.mode,
    status: run.status,
    startedAtUtc: run.startedAtUtc,
    finishedAtUtc: run.finishedAtUtc,
    error: run.error,
    result: normalizeAnalyzeResponse(run.result),
  }
}

function loadBankAnalysisRuns() {
  if (!fs.existsSync(BANK_ANALYSIS_RUN_STORE_PATH)) {
    return [] as StoredBankAnalysisRun[]
  }

  try {
    const raw = fs.readFileSync(BANK_ANALYSIS_RUN_STORE_PATH, 'utf8')
    const parsed = JSON.parse(raw) as Partial<StoredBankAnalysisRunFile>
    if (!Array.isArray(parsed.items)) {
      return []
    }

    return parsed.items
      .map(normalizeStoredBankAnalysisRun)
      .filter((item): item is StoredBankAnalysisRun => item !== null)
  } catch {
    return []
  }
}

function persistBankAnalysisRuns(items: StoredBankAnalysisRun[]) {
  const directoryPath = path.dirname(BANK_ANALYSIS_RUN_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })

  const payload: StoredBankAnalysisRunFile = {
    version: 1,
    items,
  }

  fs.writeFileSync(BANK_ANALYSIS_RUN_STORE_PATH, JSON.stringify(payload, null, 2), 'utf8')
}

function normalizeStoredBankAnalysisRun(value: unknown): StoredBankAnalysisRun | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const item = value as Record<string, unknown>
  const bankId = typeof item.bankId === 'string' ? (item.bankId as BankImportBankId) : null
  const mode =
    item.mode === 'standard' || item.mode === 'banxico' || item.mode === 'cot_ov'
      ? (item.mode as BankImportAnalysisMode)
      : 'standard'
  const status =
    item.status === 'running' || item.status === 'completed' || item.status === 'failed'
      ? (item.status as BankImportAnalysisStatus)
      : null
  if (!bankId || !status) {
    return null
  }

  return {
    analysisId: cleanText(item.analysisId),
    requestHash: cleanText(item.requestHash),
    bankId,
    sourceFileName: cleanText(item.sourceFileName),
    accountingPeriod: cleanText(item.accountingPeriod) || cleanText(item.cutoffDate).slice(0, 7),
    cutoffDate: cleanText(item.cutoffDate),
    mode,
    status,
    startedAtUtc: cleanText(item.startedAtUtc),
    finishedAtUtc: cleanText(item.finishedAtUtc) || null,
    error: cleanText(item.error) || null,
    result: normalizeAnalyzeResponse(isAnalyzeResponse(item.result) ? (item.result as BankImportAnalyzeResponse) : null),
    createdAtUtc: cleanText(item.createdAtUtc),
    updatedAtUtc: cleanText(item.updatedAtUtc),
  }
}

function normalizeAnalyzeResponse(result: BankImportAnalyzeResponse | null) {
  if (!result) {
    return null
  }

  return {
    ...result,
    excludedTypeMovements: Array.isArray(result.excludedTypeMovements) ? result.excludedTypeMovements : [],
  }
}

function isAnalyzeResponse(value: unknown): value is BankImportAnalyzeResponse {
  if (!value || typeof value !== 'object') {
    return false
  }

  const item = value as Record<string, unknown>
  return typeof item.generatedAtUtc === 'string' && typeof item.sourceFileName === 'string'
}

function cleanText(value: unknown) {
  return String(value ?? '').trim()
}
