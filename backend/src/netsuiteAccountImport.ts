import { loadOrSyncNetSuiteAccountCatalog, syncNetSuiteAccountCatalog } from './netsuiteAccountStore.js'
import { NetSuiteClient } from './netsuiteClient.js'
import type {
  NetSuiteAccountCatalogItem,
  NetSuiteAccountImportExecutionItem,
  NetSuiteAccountImportExecutionResponse,
  NetSuiteAccountImportExistingMatch,
  NetSuiteAccountImportPreviewResponse,
  NetSuiteAccountImportResolvedReference,
  NetSuiteAccountImportRowResult,
  NetSuiteAccountTypeOption,
} from './types.js'

type ParsedImportRow = {
  rowNumber: number
  acctNumber: string | null
  acctName: string | null
  acctTypeInput: string | null
  parentReference: string | null
  description: string | null
  externalId: string | null
  isInactive: boolean
  isSummary: boolean
}

type ParsedImportInput = {
  totalLines: number
  delimiter: NetSuiteAccountImportPreviewResponse['detectedDelimiter']
  detectedHeader: boolean
  acceptedColumns: string[]
  rows: ParsedImportRow[]
}

type ExistingAccountIndexes = {
  byCode: Map<string, NetSuiteAccountCatalogItem[]>
  byDisplayName: Map<string, NetSuiteAccountCatalogItem[]>
  byLeafName: Map<string, NetSuiteAccountCatalogItem[]>
  byDisplaySegment: Map<string, NetSuiteAccountCatalogItem[]>
}

type BatchRowCandidate = {
  rowNumber: number
  acctNumber: string | null
  acctName: string | null
  selfDisplaySegment: string | null
  expectedDisplayName: string | null
}

type BatchRowIndexes = {
  byCode: Map<string, BatchRowCandidate[]>
  byDisplaySegment: Map<string, BatchRowCandidate[]>
  byLeafName: Map<string, BatchRowCandidate[]>
  byExpectedDisplayName: Map<string, BatchRowCandidate[]>
}

type WorkingPreviewRow = NetSuiteAccountImportRowResult & {
  dependencyRowNumber: number | null
  expectedDisplayName: string | null
}

type InternalPreview = {
  parsedInput: ParsedImportInput
  rows: WorkingPreviewRow[]
}

type DelimiterCharacter = '\t' | ',' | ';' | '|'

type CanonicalImportColumn =
  | 'acctNumber'
  | 'acctName'
  | 'acctType'
  | 'parent'
  | 'description'
  | 'externalId'
  | 'isInactive'
  | 'isSummary'

const CANONICAL_IMPORT_COLUMNS: CanonicalImportColumn[] = [
  'acctNumber',
  'acctName',
  'acctType',
  'parent',
  'description',
  'externalId',
  'isInactive',
  'isSummary',
]

const IMPORT_HEADER_ALIASES: Record<CanonicalImportColumn, string[]> = {
  acctNumber: [
    'acctnumber',
    'accountnumber',
    'numero',
    'numero cuenta',
    'numero de cuenta',
    'codigo',
    'codigo cuenta',
    'codigo de cuenta',
    'cuenta',
  ],
  acctName: [
    'acctname',
    'accountname',
    'nombre',
    'nombre cuenta',
    'nombre de cuenta',
    'descripcion cuenta',
  ],
  acctType: [
    'accttype',
    'accounttype',
    'tipo',
    'tipo cuenta',
    'tipo de cuenta',
    'tipo contable',
  ],
  parent: [
    'parent',
    'parentaccount',
    'parentacctnumber',
    'parentaccountnumber',
    'parentdisplayname',
    'parentname',
    'cuenta padre',
    'numero padre',
    'codigo padre',
    'padre',
  ],
  description: ['description', 'descripcion', 'detalle', 'nota', 'memo'],
  externalId: ['externalid', 'external id', 'id externo', 'identificador externo'],
  isInactive: ['isinactive', 'inactive', 'inactiva', 'desactivada'],
  isSummary: ['issummary', 'summary', 'resumen', 'agrupadora', 'cuenta resumen'],
}

const NETSUITE_ACCOUNT_TYPE_OPTIONS: NetSuiteAccountTypeOption[] = [
  { id: 'NonPosting', label: 'No contable', aliases: ['non posting', 'estadistica', 'estadístico', 'no posting'] },
  { id: 'Bank', label: 'Bancos', aliases: ['banco', 'bank'] },
  { id: 'LongTermLiab', label: 'Pasivo a largo plazo', aliases: ['long term liability', 'pasivo largo plazo'] },
  { id: 'DeferExpense', label: 'Gasto diferido', aliases: ['deferred expense', 'gasto diferido'] },
  { id: 'OthExpense', label: 'Otro gasto', aliases: ['other expense', 'otros gastos'] },
  { id: 'COGS', label: 'Costo de ventas', aliases: ['cost of goods sold', 'cogs', 'costo ventas'] },
  { id: 'Income', label: 'Ingreso', aliases: ['revenue', 'income', 'ingresos'] },
  { id: 'UnbilledRec', label: 'Ingreso no facturado', aliases: ['unbilled receivable', 'no facturado'] },
  { id: 'Equity', label: 'Capital', aliases: ['equity', 'capital contable'] },
  { id: 'FixedAsset', label: 'Activo fijo', aliases: ['fixed asset', 'activo fijo'] },
  { id: 'OthCurrAsset', label: 'Otro activo circulante', aliases: ['other current asset', 'activo circulante'] },
  { id: 'AcctRec', label: 'Cuentas por cobrar', aliases: ['accounts receivable', 'cuentas cobrar', 'clientes'] },
  { id: 'DeferRevenue', label: 'Ingreso diferido', aliases: ['deferred revenue', 'ingreso diferido'] },
  { id: 'CredCard', label: 'Tarjeta de credito', aliases: ['credit card', 'tarjeta de crédito'] },
  { id: 'OthCurrLiab', label: 'Otro pasivo circulante', aliases: ['other current liability', 'pasivo circulante'] },
  { id: 'OthIncome', label: 'Otro ingreso', aliases: ['other income', 'otros ingresos'] },
  { id: 'Expense', label: 'Gasto', aliases: ['expense', 'gastos'] },
  { id: 'AcctPay', label: 'Cuentas por pagar', aliases: ['accounts payable', 'cuentas pagar', 'proveedores'] },
  { id: 'OthAsset', label: 'Otro activo', aliases: ['other asset', 'otros activos'] },
]

const DEFAULT_IMPORT_COLUMN_ORDER: CanonicalImportColumn[] = [
  'acctNumber',
  'acctName',
  'acctType',
  'parent',
  'description',
  'externalId',
  'isInactive',
  'isSummary',
]

const HEADER_ALIAS_TO_CANONICAL = new Map<string, CanonicalImportColumn>(
  Object.entries(IMPORT_HEADER_ALIASES).flatMap(([canonicalKey, aliases]) =>
    aliases.map((alias) => [normalizeComparisonKey(alias), canonicalKey as CanonicalImportColumn]),
  ),
)

export class NetSuiteAccountImportError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'NetSuiteAccountImportError'
    this.status = status
  }
}

export function getNetSuiteAccountTypeOptions() {
  return NETSUITE_ACCOUNT_TYPE_OPTIONS.map((item) => ({
    id: item.id,
    label: item.label,
    aliases: [...item.aliases],
  }))
}

export async function previewNetSuiteAccountImport(rawText: string | null | undefined) {
  return buildPublicPreviewResponse(await buildInternalPreview(rawText))
}

export async function createNetSuiteAccountsFromImport(
  rawText: string | null | undefined,
): Promise<NetSuiteAccountImportExecutionResponse> {
  const preview = await buildInternalPreview(rawText)
  const executionResults = new Map<number, NetSuiteAccountImportExecutionItem>()
  const createdRows = new Map<number, { internalId: string; displayName: string | null }>()
  const failedRows = new Set<number>()
  let client: NetSuiteClient | null = null

  preview.rows.forEach((row) => {
    if (row.previewStatus === 'existing') {
      executionResults.set(row.rowNumber, {
        ...toPublicPreviewRow(row),
        executionStatus: 'skipped_existing',
        createdAccountInternalId: null,
        message: 'La cuenta ya existe en NetSuite y fue omitida.',
      })
      return
    }

    if (row.previewStatus === 'blocked') {
      executionResults.set(row.rowNumber, {
        ...toPublicPreviewRow(row),
        executionStatus: 'blocked',
        createdAccountInternalId: null,
        message: row.issues[0] ?? 'La fila no está lista para crear.',
      })
    }
  })

  const pendingRows = preview.rows
    .filter((row) => row.previewStatus === 'ready')
    .map((row) => ({ ...row }))

  while (pendingRows.length > 0) {
    let progress = false

    for (let index = 0; index < pendingRows.length; index += 1) {
      const row = pendingRows[index]
      if (executionResults.has(row.rowNumber)) {
        pendingRows.splice(index, 1)
        index -= 1
        progress = true
        continue
      }

      if (row.dependencyRowNumber !== null && !createdRows.has(row.dependencyRowNumber)) {
        if (failedRows.has(row.dependencyRowNumber)) {
          executionResults.set(row.rowNumber, {
            ...toPublicPreviewRow(row),
            executionStatus: 'blocked',
            createdAccountInternalId: null,
            message: `La cuenta padre de la fila ${row.dependencyRowNumber} no pudo crearse.`,
          })
          pendingRows.splice(index, 1)
          index -= 1
          progress = true
        }
        continue
      }

      const payload = buildExecutionPayload(row, createdRows)
      try {
        client ??= NetSuiteClient.fromEnv()
        const response = await client.createRecord('account', payload)
        const createdAccountInternalId = resolveCreatedRecordId(response.location, response.json)
        if (!createdAccountInternalId) {
          throw new NetSuiteAccountImportError(
            `NetSuite aceptó la fila ${row.rowNumber}, pero no devolvió un internalId utilizable.`,
            502,
          )
        }

        const createdDisplayName = computeExecutionDisplayName(row, createdRows)
        createdRows.set(row.rowNumber, {
          internalId: createdAccountInternalId,
          displayName: createdDisplayName,
        })

        executionResults.set(row.rowNumber, {
          ...toPublicPreviewRow(row),
          executionStatus: 'created',
          createdAccountInternalId,
          message: `Cuenta creada en NetSuite con internalId ${createdAccountInternalId}.`,
        })
      } catch (error) {
        failedRows.add(row.rowNumber)
        executionResults.set(row.rowNumber, {
          ...toPublicPreviewRow(row),
          executionStatus: 'failed',
          createdAccountInternalId: null,
          message: error instanceof Error ? error.message : 'NetSuite devolvió un error al crear la cuenta.',
        })
      }

      pendingRows.splice(index, 1)
      index -= 1
      progress = true
    }

    if (!progress) {
      pendingRows.forEach((row) => {
        executionResults.set(row.rowNumber, {
          ...toPublicPreviewRow(row),
          executionStatus: 'blocked',
          createdAccountInternalId: null,
          message:
            row.dependencyRowNumber !== null
              ? `La cuenta depende de la fila ${row.dependencyRowNumber} y no pudo resolverse.`
              : 'La fila no pudo procesarse por una dependencia no resuelta.',
        })
      })
      break
    }
  }

  const orderedItems = preview.rows
    .map((row) => executionResults.get(row.rowNumber))
    .filter((item): item is NetSuiteAccountImportExecutionItem => Boolean(item))

  const createdCount = orderedItems.filter((item) => item.executionStatus === 'created').length
  const skippedExistingCount = orderedItems.filter((item) => item.executionStatus === 'skipped_existing').length
  const blockedCount = orderedItems.filter((item) => item.executionStatus === 'blocked').length
  const failedCount = orderedItems.filter((item) => item.executionStatus === 'failed').length

  return {
    executedAtUtc: new Date().toISOString(),
    detectedDelimiter: preview.parsedInput.delimiter,
    detectedHeader: preview.parsedInput.detectedHeader,
    acceptedColumns: [...preview.parsedInput.acceptedColumns],
    accountTypeOptions: getNetSuiteAccountTypeOptions(),
    summary: {
      totalLines: preview.parsedInput.totalLines,
      parsedRows: preview.parsedInput.rows.length,
      createdRows: createdCount,
      skippedExistingRows: skippedExistingCount,
      blockedRows: blockedCount,
      failedRows: failedCount,
    },
    items: orderedItems,
    syncedCatalog: createdCount > 0 ? await syncNetSuiteAccountCatalog() : null,
  }
}

async function buildInternalPreview(rawText: string | null | undefined): Promise<InternalPreview> {
  const parsedInput = parseImportText(rawText)
  const catalog = await loadOrSyncNetSuiteAccountCatalog()
  const existingAccountIndexes = buildExistingAccountIndexes(catalog)
  const workingRows = parsedInput.rows.map((row) => createWorkingPreviewRow(row))
  const workingRowMap = new Map(workingRows.map((row) => [row.rowNumber, row]))
  const batchIndexes = buildBatchRowIndexes(workingRows)

  workingRows.forEach((row) => {
    const parentResolution = resolveParentReference(row.parentReference, row.rowNumber, existingAccountIndexes, batchIndexes)
    row.resolvedParent = parentResolution.reference
    row.dependencyRowNumber = parentResolution.reference?.source === 'batch' ? parentResolution.reference.rowNumber : null
    row.issues.push(...parentResolution.issues)
  })

  const expectedDisplayNameCache = new Map<number, string | null>()
  workingRows.forEach((row) => {
    row.expectedDisplayName = computeExpectedDisplayName(row.rowNumber, workingRowMap, expectedDisplayNameCache, new Set())
  })

  workingRows.forEach((row) => {
    const existingMatch = resolveExistingAccountMatch(row, catalog)
    row.existingAccount = existingMatch

    if (existingMatch) {
      row.previewStatus = 'existing'
      row.payload = null
      row.issues.length = 0
      return
    }

    if (row.dependencyRowNumber !== null) {
      const dependencyRow = workingRowMap.get(row.dependencyRowNumber)
      if (!dependencyRow) {
        pushUniqueIssue(row.issues, `No pude cargar la cuenta padre de la fila ${row.dependencyRowNumber}.`)
      } else if (dependencyRow.issues.length > 0) {
        pushUniqueIssue(
          row.issues,
          `La cuenta padre indicada en la fila ${row.dependencyRowNumber} también tiene errores.`,
        )
      }
    }

    row.previewStatus = row.issues.length > 0 ? 'blocked' : 'ready'

    row.payload = row.previewStatus === 'ready' ? buildPreviewPayload(row) : null
  })

  return {
    parsedInput,
    rows: workingRows,
  }
}

function buildPublicPreviewResponse(preview: InternalPreview): NetSuiteAccountImportPreviewResponse {
  const readyRows = preview.rows.filter((row) => row.previewStatus === 'ready').length
  const existingRows = preview.rows.filter((row) => row.previewStatus === 'existing').length
  const blockedRows = preview.rows.filter((row) => row.previewStatus === 'blocked').length
  const batchDependentRows = preview.rows.filter((row) => row.dependencyRowNumber !== null).length

  return {
    generatedAtUtc: new Date().toISOString(),
    detectedDelimiter: preview.parsedInput.delimiter,
    detectedHeader: preview.parsedInput.detectedHeader,
    acceptedColumns: [...preview.parsedInput.acceptedColumns],
    accountTypeOptions: getNetSuiteAccountTypeOptions(),
    summary: {
      totalLines: preview.parsedInput.totalLines,
      parsedRows: preview.parsedInput.rows.length,
      readyRows,
      existingRows,
      blockedRows,
      batchDependentRows,
    },
    items: preview.rows.map((row) => toPublicPreviewRow(row)),
  }
}

function toPublicPreviewRow(row: WorkingPreviewRow): NetSuiteAccountImportRowResult {
  return {
    rowNumber: row.rowNumber,
    acctNumber: row.acctNumber,
    acctName: row.acctName,
    acctTypeInput: row.acctTypeInput,
    acctTypeId: row.acctTypeId,
    acctTypeLabel: row.acctTypeLabel,
    parentReference: row.parentReference,
    description: row.description,
    externalId: row.externalId,
    isInactive: row.isInactive,
    isSummary: row.isSummary,
    previewStatus: row.previewStatus,
    existingAccount: row.existingAccount ? { ...row.existingAccount } : null,
    resolvedParent: row.resolvedParent ? { ...row.resolvedParent } : null,
    payload: row.payload ? JSON.parse(JSON.stringify(row.payload)) : null,
    issues: [...row.issues],
  }
}

function createWorkingPreviewRow(row: ParsedImportRow): WorkingPreviewRow {
  const acctType = resolveAccountType(row.acctTypeInput)
  const issues: string[] = []

  if (!row.acctName) {
    issues.push('La columna acctName es obligatoria.')
  } else if (row.acctName.length > 31) {
    issues.push(`El nombre ${row.acctName} rebasa el máximo de 31 caracteres que expone NetSuite.`)
  }

  if (!acctType) {
    issues.push(`No pude reconocer el tipo contable ${row.acctTypeInput ?? '(vacío)'}.`)
  }

  if (row.acctNumber && row.acctNumber.length > 60) {
    issues.push(`El número ${row.acctNumber} rebasa el máximo de 60 caracteres admitido por NetSuite.`)
  }

  return {
    rowNumber: row.rowNumber,
    acctNumber: row.acctNumber,
    acctName: row.acctName,
    acctTypeInput: row.acctTypeInput,
    acctTypeId: acctType?.id ?? null,
    acctTypeLabel: acctType?.label ?? null,
    parentReference: row.parentReference,
    description: row.description,
    externalId: row.externalId,
    isInactive: row.isInactive,
    isSummary: row.isSummary,
    previewStatus: issues.length > 0 ? 'blocked' : 'ready',
    existingAccount: null,
    resolvedParent: null,
    dependencyRowNumber: null,
    expectedDisplayName: null,
    payload: null,
    issues,
  }
}

function parseImportText(rawText: string | null | undefined): ParsedImportInput {
  const normalizedText = String(rawText ?? '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
  if (!normalizedText) {
    throw new NetSuiteAccountImportError('Pega primero un bloque TSV/CSV con las cuentas a crear.')
  }

  const allLines = normalizedText.split('\n').map((line) => line.trim()).filter(Boolean)
  if (allLines.length === 0) {
    throw new NetSuiteAccountImportError('No detecté filas útiles en el bloque de importación.')
  }

  const delimiter = detectDelimiter(allLines[0])
  const delimiterCharacter = getDelimiterCharacter(delimiter)
  const firstLineCells = splitDelimitedLine(allLines[0], delimiterCharacter)
  const headerMapping = resolveHeaderMapping(firstLineCells)
  const dataLines = headerMapping.detectedHeader ? allLines.slice(1) : allLines

  const rows = dataLines.map((line, index) => {
    const cells = splitDelimitedLine(line, delimiterCharacter)
    const getValue = (column: CanonicalImportColumn) => {
      if (headerMapping.detectedHeader) {
        const headerIndex = headerMapping.columnIndexes[column]
        return headerIndex === undefined ? null : cleanText(cells[headerIndex])
      }

      const defaultIndex = DEFAULT_IMPORT_COLUMN_ORDER.indexOf(column)
      return defaultIndex < 0 ? null : cleanText(cells[defaultIndex])
    }

    return {
      rowNumber: index + 1,
      acctNumber: getNullableString(getValue('acctNumber')),
      acctName: getNullableString(getValue('acctName')),
      acctTypeInput: getNullableString(getValue('acctType')),
      parentReference: getNullableString(getValue('parent')),
      description: getNullableString(getValue('description')),
      externalId: getNullableString(getValue('externalId')),
      isInactive: parseBooleanLike(getValue('isInactive')),
      isSummary: parseBooleanLike(getValue('isSummary')),
    } satisfies ParsedImportRow
  })

  return {
    totalLines: allLines.length,
    delimiter,
    detectedHeader: headerMapping.detectedHeader,
    acceptedColumns: headerMapping.acceptedColumns,
    rows,
  }
}

function resolveHeaderMapping(cells: string[]) {
  const columnIndexes: Partial<Record<CanonicalImportColumn, number>> = {}
  const acceptedColumns: string[] = []

  cells.forEach((cell, index) => {
    const canonicalKey = HEADER_ALIAS_TO_CANONICAL.get(normalizeComparisonKey(cell))
    if (!canonicalKey || columnIndexes[canonicalKey] !== undefined) {
      return
    }

    columnIndexes[canonicalKey] = index
    acceptedColumns.push(canonicalKey)
  })

  const detectedHeader = acceptedColumns.length >= 2 && Boolean(columnIndexes.acctName || columnIndexes.acctType)
  return {
    detectedHeader,
    acceptedColumns: detectedHeader ? acceptedColumns : [...DEFAULT_IMPORT_COLUMN_ORDER],
    columnIndexes,
  }
}

function buildExistingAccountIndexes(accounts: NetSuiteAccountCatalogItem[]): ExistingAccountIndexes {
  const byCode = new Map<string, NetSuiteAccountCatalogItem[]>()
  const byDisplayName = new Map<string, NetSuiteAccountCatalogItem[]>()
  const byLeafName = new Map<string, NetSuiteAccountCatalogItem[]>()
  const byDisplaySegment = new Map<string, NetSuiteAccountCatalogItem[]>()

  accounts.forEach((item) => {
    const code = normalizeCode(extractAccountCode(item.displayName))
    if (code) {
      pushMapItem(byCode, code, item)
    }

    const normalizedDisplayName = normalizeComparisonKey(item.displayName)
    if (normalizedDisplayName) {
      pushMapItem(byDisplayName, normalizedDisplayName, item)
    }

    const leafName = normalizeComparisonKey(extractLeafAccountName(item.displayName))
    if (leafName) {
      pushMapItem(byLeafName, leafName, item)
    }

    const displaySegment = normalizeComparisonKey(extractAccountDisplaySegment(item.displayName))
    if (displaySegment) {
      pushMapItem(byDisplaySegment, displaySegment, item)
    }
  })

  return {
    byCode,
    byDisplayName,
    byLeafName,
    byDisplaySegment,
  }
}

function buildBatchRowIndexes(rows: WorkingPreviewRow[]): BatchRowIndexes {
  const candidates = rows.map((row) => ({
    rowNumber: row.rowNumber,
    acctNumber: row.acctNumber,
    acctName: row.acctName,
    selfDisplaySegment: buildSelfDisplaySegment(row.acctNumber, row.acctName),
    expectedDisplayName: row.expectedDisplayName,
  }))

  const byCode = new Map<string, BatchRowCandidate[]>()
  const byDisplaySegment = new Map<string, BatchRowCandidate[]>()
  const byLeafName = new Map<string, BatchRowCandidate[]>()
  const byExpectedDisplayName = new Map<string, BatchRowCandidate[]>()

  candidates.forEach((candidate) => {
    const code = normalizeCode(candidate.acctNumber)
    if (code) {
      pushMapItem(byCode, code, candidate)
    }

    const displaySegment = normalizeComparisonKey(candidate.selfDisplaySegment)
    if (displaySegment) {
      pushMapItem(byDisplaySegment, displaySegment, candidate)
    }

    const leafName = normalizeComparisonKey(candidate.acctName)
    if (leafName) {
      pushMapItem(byLeafName, leafName, candidate)
    }

    const expectedDisplayName = normalizeComparisonKey(candidate.expectedDisplayName)
    if (expectedDisplayName) {
      pushMapItem(byExpectedDisplayName, expectedDisplayName, candidate)
    }
  })

  return {
    byCode,
    byDisplaySegment,
    byLeafName,
    byExpectedDisplayName,
  }
}

function resolveParentReference(
  parentReference: string | null,
  currentRowNumber: number,
  existingAccountIndexes: ExistingAccountIndexes,
  batchIndexes: BatchRowIndexes,
): {
  reference: NetSuiteAccountImportResolvedReference | null
  issues: string[]
} {
  if (!parentReference) {
    return {
      reference: null,
      issues: [],
    }
  }

  const issues: string[] = []
  const normalizedReference = normalizeComparisonKey(parentReference)
  const normalizedCode = normalizeCode(parentReference)

  const existingCandidates = uniqueExistingCandidates([
    ...(normalizedCode ? existingAccountIndexes.byCode.get(normalizedCode) ?? [] : []),
    ...(normalizedReference ? existingAccountIndexes.byDisplayName.get(normalizedReference) ?? [] : []),
    ...(normalizedReference ? existingAccountIndexes.byDisplaySegment.get(normalizedReference) ?? [] : []),
    ...(normalizedReference ? existingAccountIndexes.byLeafName.get(normalizedReference) ?? [] : []),
  ])

  if (existingCandidates.length === 1) {
    return {
      reference: {
        source: 'existing',
        internalId: existingCandidates[0].internalId,
        displayName: existingCandidates[0].displayName,
        rowNumber: null,
      },
      issues,
    }
  }

  if (existingCandidates.length > 1) {
    issues.push(`La cuenta padre ${parentReference} es ambigua dentro del catálogo actual de NetSuite.`)
    return {
      reference: null,
      issues,
    }
  }

  const batchCandidates = uniqueBatchCandidates([
    ...(normalizedCode ? batchIndexes.byCode.get(normalizedCode) ?? [] : []),
    ...(normalizedReference ? batchIndexes.byExpectedDisplayName.get(normalizedReference) ?? [] : []),
    ...(normalizedReference ? batchIndexes.byDisplaySegment.get(normalizedReference) ?? [] : []),
    ...(normalizedReference ? batchIndexes.byLeafName.get(normalizedReference) ?? [] : []),
  ]).filter((candidate) => candidate.rowNumber !== currentRowNumber)

  if (batchCandidates.length === 1) {
    return {
      reference: {
        source: 'batch',
        internalId: null,
        displayName: batchCandidates[0].expectedDisplayName ?? batchCandidates[0].selfDisplaySegment,
        rowNumber: batchCandidates[0].rowNumber,
      },
      issues,
    }
  }

  if (batchCandidates.length > 1) {
    issues.push(`La cuenta padre ${parentReference} coincide con varias filas del lote.`)
    return {
      reference: null,
      issues,
    }
  }

  issues.push(`No pude resolver la cuenta padre ${parentReference} ni en NetSuite ni dentro del lote.`)
  return {
    reference: null,
    issues,
  }
}

function computeExpectedDisplayName(
  rowNumber: number,
  rowMap: Map<number, WorkingPreviewRow>,
  cache: Map<number, string | null>,
  visiting: Set<number>,
): string | null {
  const cachedValue = cache.get(rowNumber)
  if (cache.has(rowNumber)) {
    return cachedValue ?? null
  }

  const row = rowMap.get(rowNumber)
  if (!row) {
    cache.set(rowNumber, null)
    return null
  }

  const selfDisplaySegment = buildSelfDisplaySegment(row.acctNumber, row.acctName)
  if (!selfDisplaySegment) {
    cache.set(rowNumber, null)
    return null
  }

  if (!row.resolvedParent) {
    cache.set(rowNumber, selfDisplaySegment)
    return selfDisplaySegment
  }

  if (visiting.has(rowNumber)) {
    pushUniqueIssue(row.issues, 'Existe una dependencia circular en la jerarquía de cuentas del lote.')
    cache.set(rowNumber, null)
    return null
  }

  visiting.add(rowNumber)

  let parentDisplayName: string | null = null
  if (row.resolvedParent.source === 'existing') {
    parentDisplayName = row.resolvedParent.displayName
  } else if (row.resolvedParent.rowNumber !== null) {
    parentDisplayName = computeExpectedDisplayName(row.resolvedParent.rowNumber, rowMap, cache, visiting)
  }

  visiting.delete(rowNumber)

  const expectedDisplayName = parentDisplayName ? `${parentDisplayName} : ${selfDisplaySegment}` : null
  cache.set(rowNumber, expectedDisplayName)
  return expectedDisplayName
}

function resolveExistingAccountMatch(
  row: WorkingPreviewRow,
  accounts: NetSuiteAccountCatalogItem[],
): NetSuiteAccountImportExistingMatch | null {
  const normalizedCode = normalizeCode(row.acctNumber)
  if (normalizedCode) {
    const codeMatches = uniqueExistingCandidates(
      accounts.filter((item) => normalizeCode(extractAccountCode(item.displayName)) === normalizedCode),
    )
    if (codeMatches.length === 1) {
      return {
        internalId: codeMatches[0].internalId,
        displayName: codeMatches[0].displayName,
        matchBy: 'acctNumber',
      }
    }
    if (codeMatches.length > 1) {
      pushUniqueIssue(row.issues, `El número ${row.acctNumber} coincide con más de una cuenta existente.`)
      return null
    }
  }

  const normalizedExpectedDisplayName = normalizeComparisonKey(row.expectedDisplayName)
  if (!normalizedExpectedDisplayName) {
    return null
  }

  const displayMatches = uniqueExistingCandidates(
    accounts.filter((item) => normalizeComparisonKey(item.displayName) === normalizedExpectedDisplayName),
  )
  if (displayMatches.length === 1) {
    return {
      internalId: displayMatches[0].internalId,
      displayName: displayMatches[0].displayName,
      matchBy: 'displayName',
    }
  }

  if (displayMatches.length > 1) {
    pushUniqueIssue(
      row.issues,
      `La jerarquía ${row.expectedDisplayName} coincide con más de una cuenta existente en NetSuite.`,
    )
  }

  return null
}

function buildPreviewPayload(row: WorkingPreviewRow) {
  const payload: Record<string, unknown> = {
    acctName: row.acctName,
    acctType: {
      id: row.acctTypeId,
    },
    isInactive: row.isInactive,
    isSummary: row.isSummary,
  }

  if (row.acctNumber) {
    payload.acctNumber = row.acctNumber
  }

  if (row.description) {
    payload.description = row.description
  }

  if (row.externalId) {
    payload.externalId = row.externalId
  }

  if (row.resolvedParent?.source === 'existing' && row.resolvedParent.internalId) {
    payload.parent = {
      id: row.resolvedParent.internalId,
      refName: row.resolvedParent.displayName ?? undefined,
    }
  } else if (row.resolvedParent?.source === 'batch' && row.resolvedParent.rowNumber !== null) {
    payload.parent = {
      source: 'batch',
      rowNumber: row.resolvedParent.rowNumber,
      refName: row.resolvedParent.displayName ?? undefined,
    }
  }

  return payload
}

function buildExecutionPayload(
  row: WorkingPreviewRow,
  createdRows: Map<number, { internalId: string; displayName: string | null }>,
) {
  const payload = buildPreviewPayload(row)

  if (row.dependencyRowNumber !== null) {
    const createdParent = createdRows.get(row.dependencyRowNumber)
    if (!createdParent?.internalId) {
      throw new NetSuiteAccountImportError(
        `La cuenta padre de la fila ${row.dependencyRowNumber} todavía no existe en NetSuite.`,
        409,
      )
    }

    payload.parent = {
      id: createdParent.internalId,
      refName: createdParent.displayName ?? undefined,
    }
  }

  return payload
}

function computeExecutionDisplayName(
  row: WorkingPreviewRow,
  createdRows: Map<number, { internalId: string; displayName: string | null }>,
) {
  const selfDisplaySegment = buildSelfDisplaySegment(row.acctNumber, row.acctName)
  if (!selfDisplaySegment) {
    return null
  }

  if (row.dependencyRowNumber !== null) {
    const createdParent = createdRows.get(row.dependencyRowNumber)
    return createdParent?.displayName ? `${createdParent.displayName} : ${selfDisplaySegment}` : selfDisplaySegment
  }

  if (row.resolvedParent?.source === 'existing' && row.resolvedParent.displayName) {
    return `${row.resolvedParent.displayName} : ${selfDisplaySegment}`
  }

  return selfDisplaySegment
}

function resolveCreatedRecordId(location: string | null, json: unknown) {
  const record = getNullableRecord(json)
  const fromBody = getNullableString(record?.id)
  if (fromBody) {
    return fromBody
  }

  if (!location) {
    return null
  }

  const match = location.match(/\/([^/]+)$/)
  return match?.[1] ?? null
}

function resolveAccountType(value: string | null) {
  const normalizedValue = normalizeComparisonKey(value)
  if (!normalizedValue) {
    return null
  }

  return (
    NETSUITE_ACCOUNT_TYPE_OPTIONS.find((option) => normalizeComparisonKey(option.id) === normalizedValue) ??
    NETSUITE_ACCOUNT_TYPE_OPTIONS.find((option) => normalizeComparisonKey(option.label) === normalizedValue) ??
    NETSUITE_ACCOUNT_TYPE_OPTIONS.find((option) =>
      option.aliases.some((alias) => normalizeComparisonKey(alias) === normalizedValue),
    ) ??
    null
  )
}

function splitDelimitedLine(line: string, delimiter: DelimiterCharacter | null) {
  if (!delimiter) {
    return [line]
  }

  const items: string[] = []
  let currentValue = ''
  let insideQuotes = false

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const nextCharacter = line[index + 1]

    if (character === '"') {
      if (insideQuotes && nextCharacter === '"') {
        currentValue += '"'
        index += 1
      } else {
        insideQuotes = !insideQuotes
      }
      continue
    }

    if (character === delimiter && !insideQuotes) {
      items.push(currentValue)
      currentValue = ''
      continue
    }

    currentValue += character
  }

  items.push(currentValue)
  return items.map((item) => cleanText(item))
}

function detectDelimiter(line: string): NetSuiteAccountImportPreviewResponse['detectedDelimiter'] {
  const counters = {
    tab: (line.match(/\t/g) ?? []).length,
    comma: (line.match(/,/g) ?? []).length,
    semicolon: (line.match(/;/g) ?? []).length,
    pipe: (line.match(/\|/g) ?? []).length,
  }

  const winner = Object.entries(counters).sort((left, right) => right[1] - left[1])[0]
  if (!winner || winner[1] === 0) {
    return 'unknown'
  }

  return winner[0] as NetSuiteAccountImportPreviewResponse['detectedDelimiter']
}

function getDelimiterCharacter(
  delimiter: NetSuiteAccountImportPreviewResponse['detectedDelimiter'],
): DelimiterCharacter | null {
  switch (delimiter) {
    case 'tab':
      return '\t'
    case 'comma':
      return ','
    case 'semicolon':
      return ';'
    case 'pipe':
      return '|'
    default:
      return '\t'
  }
}

function buildSelfDisplaySegment(acctNumber: string | null, acctName: string | null) {
  const left = cleanText(acctNumber)
  const right = cleanText(acctName)

  if (!left && !right) {
    return null
  }

  return `${left}${left && right ? ' ' : ''}${right}`.trim()
}

function extractAccountCode(displayName: string) {
  const match = displayName.trim().match(/^([A-Z0-9-]+)/i)
  return match?.[1] ?? null
}

function extractLeafAccountName(displayName: string) {
  const leafSegment = extractAccountDisplaySegment(displayName)
  return leafSegment.replace(/^[A-Z0-9-]+\s+/i, '').trim() || leafSegment.trim()
}

function extractAccountDisplaySegment(displayName: string) {
  const segments = displayName.split(':')
  return segments[segments.length - 1]?.trim() ?? displayName.trim()
}

function parseBooleanLike(value: string | null) {
  const normalizedValue = normalizeComparisonKey(value)
  return (
    normalizedValue === 'TRUE' ||
    normalizedValue === '1' ||
    normalizedValue === 'SI' ||
    normalizedValue === 'YES' ||
    normalizedValue === 'Y' ||
    normalizedValue === 'INACTIVA' ||
    normalizedValue === 'RESUMEN' ||
    normalizedValue === 'AGRUPADORA'
  )
}

function pushMapItem<T>(map: Map<string, T[]>, key: string, value: T) {
  const existing = map.get(key)
  if (existing) {
    existing.push(value)
    return
  }

  map.set(key, [value])
}

function uniqueExistingCandidates(items: NetSuiteAccountCatalogItem[]) {
  const seen = new Set<string>()
  return items.filter((item) => {
    if (seen.has(item.internalId)) {
      return false
    }

    seen.add(item.internalId)
    return true
  })
}

function uniqueBatchCandidates(items: BatchRowCandidate[]) {
  const seen = new Set<number>()
  return items.filter((item) => {
    if (seen.has(item.rowNumber)) {
      return false
    }

    seen.add(item.rowNumber)
    return true
  })
}

function pushUniqueIssue(issues: string[], value: string) {
  if (!issues.includes(value)) {
    issues.push(value)
  }
}

function normalizeComparisonKey(value: unknown) {
  return cleanText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase()
}

function normalizeCode(value: unknown) {
  const normalizedValue = cleanText(value).replace(/\s+/g, '').trim().toUpperCase()
  return normalizedValue || null
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function getNullableString(value: unknown) {
  const normalizedValue = cleanText(value)
  return normalizedValue ? normalizedValue : null
}

function getNullableRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}
