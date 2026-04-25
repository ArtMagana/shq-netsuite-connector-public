import { promises as fs } from 'node:fs'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PDFParse } from 'pdf-parse'

import { loadLocalEnv } from './loadLocalEnv.js'

loadLocalEnv()

type InventoryCertificateLookupRequest = {
  fileName?: unknown
  lot?: unknown
  productQuery?: unknown
  includeText?: unknown
}

export type InventoryCertificateDetectedDate = {
  label: string
  raw: string
  normalized: string | null
  line: string | null
}

export type InventoryCertificateAnalysis = {
  textExtractionStatus: 'parsed' | 'failed'
  warnings: string[]
  lotMatches: string[]
  relevantLines: string[]
  dates: {
    production: InventoryCertificateDetectedDate | null
    expiration: InventoryCertificateDetectedDate | null
  }
  parsedText: string | null
}

type InventoryCertificateLookupResponse = {
  inspectedAtUtc: string
  query: {
    fileName: string | null
    lot: string | null
    productQuery: string | null
  }
  searchedDirectories: string[]
  scannedFiles: number
  match: {
    fileName: string
    filePath: string
    matchedBy: string[]
    fileSizeBytes: number
    modifiedAtUtc: string | null
  }
  analysis: InventoryCertificateAnalysis
}

type InventoryCertificateCandidate = {
  fileName: string
  filePath: string
  score: number
  matchedBy: string[]
  parsedText: string | null
  parseError: string | null
}

const CERTIFICATE_INDEX_TTL_MS = 2 * 60 * 1000
const DEFAULT_TEXT_SCAN_LIMIT = 140
const moduleDir = dirname(fileURLToPath(import.meta.url))
const backendRootDir = resolve(moduleDir, '..')
const persistentInventoryCertificateStorageDir = resolve(
  backendRootDir,
  '..',
  'data',
  'inventory-certificates',
)
const inventoryCertificateStorageDir = resolve(backendRootDir, 'storage', 'inventory-certificates')
const fallbackSearchDirectories = [
  persistentInventoryCertificateStorageDir,
  inventoryCertificateStorageDir,
  resolve(
    backendRootDir,
    '..',
    '..',
    'webAPP Imports',
    'docker',
    'supplai',
    'uploads',
    'technical-datasheets',
    'coa',
  ),
  resolve(backendRootDir, '..', '..', 'webAPP Imports', 'docker', 'supplai', 'uploads', 'pdfs'),
]

let certificateIndexCache:
  | {
      storedAtMs: number
      directoriesKey: string
      files: string[]
    }
  | null = null

export class InventoryCertificateError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'InventoryCertificateError'
    this.status = status
  }
}

export async function lookupInventoryCertificate(
  request: InventoryCertificateLookupRequest,
): Promise<InventoryCertificateLookupResponse> {
  const fileName = normalizeOptionalString(request.fileName)
  const lot = normalizeOptionalString(request.lot)
  const productQuery = normalizeOptionalString(request.productQuery)
  const includeText = request.includeText === true

  if (!fileName && !lot && !productQuery) {
    throw new InventoryCertificateError('Provide at least fileName, lot, or productQuery.', 400)
  }

  const searchDirectories = await resolveSearchDirectories()
  if (!searchDirectories.length) {
    throw new InventoryCertificateError(
      'No searchable certificate directories are available for inventory certificates.',
      404,
    )
  }

  const pdfFiles = await listSearchablePdfFiles(searchDirectories)
  if (!pdfFiles.length) {
    throw new InventoryCertificateError(
      'No PDF certificates are available yet in the configured inventory certificate folders.',
      404,
    )
  }

  const requestedFileName = fileName ? normalizeFileName(fileName) : null
  const normalizedLot = lot ? normalizeForMatch(lot) : null
  const productTokens = productQuery ? tokenizeForMatch(productQuery) : []
  const minimumProductMatches = productTokens.length > 1 ? 2 : 1

  const candidates: InventoryCertificateCandidate[] = []
  for (const filePath of pdfFiles) {
    const resolvedFileName = filePath.split(/[\\/]/).pop() ?? filePath
    const matchedBy: string[] = []
    let score = 0

    if (requestedFileName) {
      const normalizedResolvedFileName = normalizeFileName(resolvedFileName)
      if (normalizedResolvedFileName === requestedFileName) {
        score += 1200
        matchedBy.push('fileName')
      } else if (
        stripPdfExtension(normalizedResolvedFileName) === stripPdfExtension(requestedFileName)
      ) {
        score += 1000
        matchedBy.push('fileName')
      } else if (normalizedResolvedFileName.includes(stripPdfExtension(requestedFileName))) {
        score += 700
        matchedBy.push('fileName')
      }
    }

    if (normalizedLot && normalizeForMatch(resolvedFileName).includes(normalizedLot)) {
      score += 800
      matchedBy.push('lot')
    }

    if (productTokens.length > 0) {
      const fileNameMatchCount = productTokens.filter((token) =>
        normalizeForMatch(resolvedFileName).includes(token),
      ).length

      if (fileNameMatchCount >= minimumProductMatches) {
        score += fileNameMatchCount * 120
        matchedBy.push('productQuery')
        if (fileNameMatchCount === productTokens.length) {
          score += 200
        }
      }
    }

    if (score <= 0) {
      continue
    }

    candidates.push({
      fileName: resolvedFileName,
      filePath,
      score,
      matchedBy: Array.from(new Set(matchedBy)),
      parsedText: null,
      parseError: null,
    })
  }

  if (candidates.length === 0 && (normalizedLot || productTokens.length > 0)) {
    const textScannedCandidates = await scanCandidatesByText(
      pdfFiles,
      normalizedLot,
      productTokens,
      minimumProductMatches,
      DEFAULT_TEXT_SCAN_LIMIT,
    )
    candidates.push(...textScannedCandidates)
  }

  if (candidates.length === 0) {
    const attemptedMatcher = fileName ? `file "${fileName}"` : lot ? `lot "${lot}"` : `"${productQuery}"`
    throw new InventoryCertificateError(
      `I could not find a PDF certificate that matches ${attemptedMatcher}.`,
      404,
    )
  }

  candidates.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score
    }

    return left.fileName.localeCompare(right.fileName)
  })

  const winner = candidates[0]
  const analysis = await inspectCertificateCandidate(winner, {
    lot,
    includeText,
  })
  const stats = await fs.stat(winner.filePath)

  return {
    inspectedAtUtc: new Date().toISOString(),
    query: {
      fileName,
      lot,
      productQuery,
    },
    searchedDirectories: searchDirectories,
    scannedFiles: pdfFiles.length,
    match: {
      fileName: winner.fileName,
      filePath: winner.filePath,
      matchedBy: winner.matchedBy,
      fileSizeBytes: stats.size,
      modifiedAtUtc: Number.isFinite(stats.mtimeMs) ? stats.mtime.toISOString() : null,
    },
    analysis,
  }
}

export async function cacheInventoryCertificateFile(fileName: string, fileBuffer: Buffer) {
  const resolvedFileName =
    sanitizePdfFileName(fileName) ?? `inventory-certificate-${Date.now().toString(36)}.pdf`
  const targetDirectories = dedupeDirectories([
    persistentInventoryCertificateStorageDir,
    inventoryCertificateStorageDir,
  ])

  let storedPath: string | null = null
  let lastError: unknown = null

  for (const directoryPath of targetDirectories) {
    try {
      await fs.mkdir(directoryPath, { recursive: true })
      const targetPath = join(directoryPath, resolvedFileName)
      await fs.writeFile(targetPath, fileBuffer)
      storedPath = targetPath
    } catch (error) {
      lastError = error
    }
  }

  certificateIndexCache = null

  if (storedPath) {
    return storedPath
  }

  throw new InventoryCertificateError(
    lastError instanceof Error
      ? lastError.message
      : 'No pude guardar la copia local del certificado.',
    500,
  )
}

export function invalidateInventoryCertificateIndexCache() {
  certificateIndexCache = null
}

export async function removeCachedInventoryCertificatesByLot(lot: string) {
  const normalizedLot = normalizeForMatch(lot)
  if (!normalizedLot) {
    return []
  }

  const removedPaths: string[] = []
  const targetDirectories = dedupeDirectories([
    persistentInventoryCertificateStorageDir,
    inventoryCertificateStorageDir,
  ])

  for (const directoryPath of targetDirectories) {
    const pdfFiles: string[] = []
    await collectPdfFiles(directoryPath, pdfFiles)

    for (const filePath of pdfFiles) {
      const fileName = filePath.split(/[\\/]/).pop() ?? ''
      if (!normalizeForMatch(fileName).includes(normalizedLot)) {
        continue
      }

      try {
        await fs.unlink(filePath)
        removedPaths.push(filePath)
      } catch {
        continue
      }
    }
  }

  certificateIndexCache = null
  return removedPaths
}

async function inspectCertificateCandidate(
  candidate: InventoryCertificateCandidate,
  options: {
    lot: string | null
    includeText: boolean
  },
) {
  let parsedText = candidate.parsedText
  let parseError = candidate.parseError

  if (parsedText === null && parseError === null) {
    try {
      parsedText = await extractPdfText(await fs.readFile(candidate.filePath))
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'Unknown PDF parse error.'
    }
  }

  return analyzeInventoryCertificateText(parsedText, {
    lot: options.lot,
    includeText: options.includeText,
    parseError,
  })
}

export function analyzeInventoryCertificateText(
  parsedText: string | null,
  options: {
    lot: string | null
    includeText: boolean
    parseError?: string | null
  },
): InventoryCertificateAnalysis {
  if (!parsedText) {
    return {
      textExtractionStatus: 'failed',
      warnings: [
        options.parseError ?? 'The PDF exists, but I could not extract readable text from it.',
      ],
      lotMatches: [],
      relevantLines: [],
      dates: {
        production: null,
        expiration: null,
      },
      parsedText: options.includeText ? parsedText : null,
    }
  }

  const lines = normalizeTextLines(parsedText)
  const production = findDateSignal(lines, [
    'fecha de produccion',
    'produccion',
    'fecha de manufactura',
    'manufactura',
    'manufacture date',
    'fecha de fabricacion',
    'fabricacion',
    'production date',
    'manufacturing date',
    'mfg date',
  ])
  const expiration = findDateSignal(lines, [
    'fecha de caducidad',
    'caducidad',
    'fecha de vencimiento',
    'vencimiento',
    'fecha de expiracion',
    'expiracion',
    'expiry date',
    'expiration date',
    'best before',
    'use before',
  ])
  const lotMatches = collectLotMatches(lines, options.lot)
  const relevantLines = collectRelevantLines(
    lines,
    [production?.line ?? null, expiration?.line ?? null],
    options.lot,
  )
  const warnings: string[] = []

  if (!production) {
    warnings.push('I did not detect a production or manufacturing date in the PDF text.')
  }

  if (!expiration) {
    warnings.push('I did not detect an expiration date in the PDF text.')
  }

  return {
    textExtractionStatus: 'parsed',
    warnings,
    lotMatches,
    relevantLines,
    dates: {
      production,
      expiration,
    },
    parsedText: options.includeText ? parsedText : null,
  }
}

async function resolveSearchDirectories() {
  await fs.mkdir(persistentInventoryCertificateStorageDir, { recursive: true })
  await fs.mkdir(inventoryCertificateStorageDir, { recursive: true })

  const configuredValue = process.env.INVENTORY_CERTIFICATE_SEARCH_DIRS?.trim() ?? ''
  const configuredDirectories = configuredValue
    .split(/[;\n]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => resolve(backendRootDir, entry))

  const primaryDirectories = await filterExistingDirectories([
    persistentInventoryCertificateStorageDir,
    inventoryCertificateStorageDir,
  ])
  const availableConfiguredDirectories = await filterExistingDirectories(configuredDirectories)
  const availableFallbackDirectories = await filterExistingDirectories(fallbackSearchDirectories)

  return dedupeDirectories([
    ...primaryDirectories,
    ...availableConfiguredDirectories,
    ...availableFallbackDirectories,
  ])
}

async function listSearchablePdfFiles(searchDirectories: string[]) {
  const directoriesKey = searchDirectories.join('|')
  const now = Date.now()

  if (
    certificateIndexCache &&
    certificateIndexCache.directoriesKey === directoriesKey &&
    now - certificateIndexCache.storedAtMs < CERTIFICATE_INDEX_TTL_MS
  ) {
    return certificateIndexCache.files
  }

  const files: string[] = []
  for (const directoryPath of searchDirectories) {
    await collectPdfFiles(directoryPath, files)
  }

  files.sort((left, right) => left.localeCompare(right))
  certificateIndexCache = {
    storedAtMs: now,
    directoriesKey,
    files,
  }

  return files
}

async function collectPdfFiles(directoryPath: string, files: string[]) {
  let entries: Array<{
    name: string
    isDirectory: () => boolean
    isFile: () => boolean
  }>

  try {
    entries = (await fs.readdir(directoryPath, {
      encoding: 'utf8',
      withFileTypes: true,
    })) as Array<{
      name: string
      isDirectory: () => boolean
      isFile: () => boolean
    }>
  } catch {
    return
  }

  for (const entry of entries) {
    const fullPath = join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      await collectPdfFiles(fullPath, files)
      continue
    }

    if (entry.isFile() && extname(entry.name).toLowerCase() === '.pdf') {
      files.push(fullPath)
    }
  }
}

async function scanCandidatesByText(
  pdfFiles: string[],
  normalizedLot: string | null,
  productTokens: string[],
  minimumProductMatches: number,
  limit: number,
) {
  const results: InventoryCertificateCandidate[] = []
  const slice = pdfFiles.slice(0, limit)

  for (const filePath of slice) {
    let parsedText: string | null = null
    let parseError: string | null = null

    try {
      parsedText = await extractPdfText(await fs.readFile(filePath))
    } catch (error) {
      parseError = error instanceof Error ? error.message : 'Unknown PDF parse error.'
    }

    if (!parsedText) {
      continue
    }

    const normalizedText = normalizeForMatch(parsedText)
    const matchedBy: string[] = []
    let score = 0

    if (normalizedLot && normalizedText.includes(normalizedLot)) {
      score += 700
      matchedBy.push('lot_text')
    }

    if (productTokens.length > 0) {
      const productMatchCount = productTokens.filter((token) => normalizedText.includes(token)).length
      if (productMatchCount >= minimumProductMatches) {
        score += productMatchCount * 80
        matchedBy.push('productQuery_text')
        if (productMatchCount === productTokens.length) {
          score += 180
        }
      }
    }

    if (score <= 0) {
      continue
    }

    results.push({
      fileName: filePath.split(/[\\/]/).pop() ?? filePath,
      filePath,
      score,
      matchedBy,
      parsedText,
      parseError,
    })
  }

  return results
}

async function isDirectory(directoryPath: string) {
  try {
    const stats = await fs.stat(directoryPath)
    return stats.isDirectory()
  } catch {
    return false
  }
}

async function filterExistingDirectories(directoryPaths: string[]) {
  const availableDirectories: string[] = []
  for (const directoryPath of directoryPaths) {
    if (await isDirectory(directoryPath)) {
      availableDirectories.push(directoryPath)
    }
  }

  return availableDirectories
}

async function extractPdfText(fileBuffer: Buffer) {
  const parser = new PDFParse({ data: fileBuffer })

  try {
    const result = await parser.getText()
    return result.text?.trim() || null
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

function dedupeDirectories(directoryPaths: string[]) {
  return Array.from(new Set(directoryPaths.map((directoryPath) => resolve(directoryPath))))
}

function sanitizePdfFileName(fileName: string) {
  const baseName = fileName.split(/[\\/]/).pop()?.trim() ?? ''
  if (!baseName) {
    return null
  }

  const sanitized = baseName
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!sanitized) {
    return null
  }

  return /\.pdf$/i.test(sanitized) ? sanitized : `${sanitized}.pdf`
}

function findDateSignal(lines: string[], labels: string[]) {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const normalizedLine = normalizeForMatch(line)
    const matchedLabel = labels.find((label) => normalizedLine.includes(normalizeForMatch(label)))
    if (!matchedLabel) {
      continue
    }

    const sameLineDate = extractDateCandidateAfterLabel(line, matchedLabel)
    if (sameLineDate) {
      return createDetectedDate(matchedLabel, sameLineDate, line)
    }

    const leadingDate = extractDateCandidateBeforeLabel(line, matchedLabel)
    if (leadingDate) {
      return createDetectedDate(matchedLabel, leadingDate, line)
    }

    const nearbyLines = [lines[index - 1], lines[index + 1], lines[index + 2]].filter(
      (value): value is string => typeof value === 'string',
    )

    for (const nearbyLine of nearbyLines) {
      const nearbyDate = extractDateCandidate(nearbyLine)
      if (nearbyDate) {
        return createDetectedDate(matchedLabel, nearbyDate, nearbyLine)
      }
    }
  }

  return null
}

function collectLotMatches(lines: string[], lot: string | null) {
  if (!lot) {
    return []
  }

  const normalizedLot = normalizeForMatch(lot)
  return lines.filter((line) => normalizeForMatch(line).includes(normalizedLot)).slice(0, 6)
}

function collectRelevantLines(lines: string[], dateLines: Array<string | null>, lot: string | null) {
  const candidates = new Set<string>()

  for (const line of dateLines) {
    if (typeof line === 'string' && line.trim()) {
      candidates.add(line.trim())
    }
  }

  for (const line of collectLotMatches(lines, lot)) {
    candidates.add(line)
  }

  return Array.from(candidates).slice(0, 8)
}

function createDetectedDate(label: string, rawDate: string, line: string): InventoryCertificateDetectedDate {
  return {
    label,
    raw: rawDate,
    normalized: normalizeDateCandidate(rawDate),
    line,
  }
}

function extractDateCandidateAfterLabel(value: string, label: string) {
  const normalizedValue = normalizeForMatch(value)
  const normalizedLabel = normalizeForMatch(label)
  const labelIndex = normalizedValue.indexOf(normalizedLabel)
  if (labelIndex < 0) {
    return null
  }

  return extractDateCandidate(normalizedValue.slice(labelIndex + normalizedLabel.length))
}

function extractDateCandidateBeforeLabel(value: string, label: string) {
  const normalizedValue = normalizeForMatch(value)
  const normalizedLabel = normalizeForMatch(label)
  const labelIndex = normalizedValue.indexOf(normalizedLabel)
  if (labelIndex <= 0) {
    return null
  }

  return extractDateCandidate(normalizedValue.slice(0, labelIndex))
}

function extractDateCandidate(value: string) {
  const numericDateMatch =
    value.match(/(?<!\d)(\d{1,2}[./-]\d{1,2}[./-]\d{2,4})(?!\d)/) ??
    value.match(/(?<!\d)(\d{4}[./-]\d{1,2}[./-]\d{1,2})(?!\d)/)

  return numericDateMatch?.[1] ?? null
}

function normalizeDateCandidate(rawDate: string) {
  const parts = rawDate.split(/[./-]/).map((segment) => segment.trim())
  if (parts.length !== 3) {
    return null
  }

  let year = 0
  let month = 0
  let day = 0

  if (parts[0].length === 4) {
    year = Number.parseInt(parts[0], 10)
    month = Number.parseInt(parts[1], 10)
    day = Number.parseInt(parts[2], 10)
  } else {
    day = Number.parseInt(parts[0], 10)
    month = Number.parseInt(parts[1], 10)
    year = Number.parseInt(parts[2], 10)
    if (parts[2].length === 2) {
      year += year >= 70 ? 1900 : 2000
    }
  }

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return null
  }

  const candidateDate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidateDate.getUTCFullYear() !== year ||
    candidateDate.getUTCMonth() !== month - 1 ||
    candidateDate.getUTCDate() !== day
  ) {
    return null
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function normalizeTextLines(text: string) {
  return text
    .replace(/\r/g, '\n')
    .split(/\n+/)
    .map((line) => line.replace(/\t/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
}

function normalizeOptionalString(value: unknown) {
  if (typeof value !== 'string') {
    return null
  }

  const normalizedValue = value.trim()
  return normalizedValue ? normalizedValue : null
}

function normalizeForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function tokenizeForMatch(value: string) {
  return Array.from(
    new Set(
      normalizeForMatch(value)
        .split(/[^a-z0-9]+/)
        .map((token) => token.trim())
        .filter((token) => token.length >= 3),
    ),
  )
}

function normalizeFileName(value: string) {
  return normalizeForMatch(value).replace(/\s+/g, ' ').trim()
}

function stripPdfExtension(value: string) {
  return value.endsWith('.pdf') ? value.slice(0, -4) : value
}
