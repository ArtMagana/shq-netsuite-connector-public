import { NetSuiteClient } from './netsuiteClient.js'

type InventoryAdjustmentLocationOption = {
  internalId: string
  name: string
  subsidiaryId: string | null
  subsidiaryName: string | null
}

type InventoryAdjustmentPostingPeriod = {
  internalId: string
  name: string
  startDate: string | null
  endDate: string | null
}

type InventoryAdjustmentItemSearchResult = {
  internalId: string
  itemId: string
  displayName: string | null
  itemType: string
  costingMethod: string | null
  isLotTracked: boolean
  isSerialTracked: boolean
  usesBins: boolean
  stockUnitId: string | null
  stockUnitName: string | null
}

type InventoryAdjustmentAccountSearchResult = {
  internalId: string
  displayName: string
  accountType: string | null
}

type InventoryAdjustmentLocationBalance = {
  locationId: string
  locationName: string | null
  quantityOnHand: number
  quantityAvailable: number
  subsidiaryId: string | null
  subsidiaryName: string | null
}

type InventoryAdjustmentLotBalance = {
  inventoryNumberId: string
  inventoryNumber: string | null
  expirationDate: string | null
  locationId: string
  locationName: string | null
  quantityOnHand: number
  quantityAvailable: number
}

type InventoryAdjustmentItemSnapshotResponse = {
  generatedAtUtc: string
  item: InventoryAdjustmentItemSearchResult
  requestedLocation: InventoryAdjustmentLocationOption | null
  totals: {
    quantityOnHand: number
    quantityAvailable: number
    locationCount: number
    lotCount: number
  }
  locations: InventoryAdjustmentLocationBalance[]
  lots: InventoryAdjustmentLotBalance[]
  requirements: {
    needsInventoryDetail: boolean
    requiresInventoryNumberSelection: boolean
    requiresReceiptInventoryNumber: boolean
    usesBins: boolean
  }
}

type InventoryAdjustmentAssignmentDraft = {
  quantity: number
  issueInventoryNumberId: string | null
  receiptInventoryNumber: string | null
  expirationDate: string | null
}

type InventoryAdjustmentDraft = {
  transactionDate: string
  postingPeriodId: string | null
  accountId: string
  locationId: string
  itemId: string
  memo: string | null
  lineMemo: string | null
  adjustmentMode: 'delta' | 'set'
  quantity: number
  unitCost: number | null
  assignments: InventoryAdjustmentAssignmentDraft[]
}

type InventoryAdjustmentAssignmentPreview = {
  quantity: number
  direction: 'issue' | 'receipt'
  issueInventoryNumberId: string | null
  issueInventoryNumber: string | null
  receiptInventoryNumber: string | null
}

type InventoryAdjustmentPreviewResponse = {
  generatedAtUtc: string
  transactionDate: string
  account: InventoryAdjustmentAccountSearchResult
  location: InventoryAdjustmentLocationOption
  postingPeriod: InventoryAdjustmentPostingPeriod | null
  item: InventoryAdjustmentItemSearchResult
  memo: string | null
  lineMemo: string | null
  currentStock: InventoryAdjustmentItemSnapshotResponse['totals'] & {
    selectedLocationQuantityOnHand: number
    selectedLocationQuantityAvailable: number
  }
  computed: {
    adjustmentMode: InventoryAdjustmentDraft['adjustmentMode']
    requestedQuantity: number
    adjustQtyBy: number
    newQuantity: number
    direction: 'increase' | 'decrease'
  }
  validation: {
    isValid: boolean
    issues: string[]
    warnings: string[]
    requiresInventoryDetail: boolean
  }
  assignments: InventoryAdjustmentAssignmentPreview[]
  payloadPreview: Record<string, unknown> | null
}

type InventoryAdjustmentExecuteResponse = {
  executedAtUtc: string
  record: {
    internalId: string
    tranId: string | null
  }
  item: InventoryAdjustmentItemSearchResult
  location: InventoryAdjustmentLocationOption
  account: InventoryAdjustmentAccountSearchResult
  summary: InventoryAdjustmentPreviewResponse['computed'] & {
    previousQuantityOnHand: number
  }
  message: string
}

type InventoryAdjustmentBootstrapResponse = {
  generatedAtUtc: string
  todayDate: string
  locations: InventoryAdjustmentLocationOption[]
  postingPeriods: InventoryAdjustmentPostingPeriod[]
}

type InventoryAdjustmentSearchItemsResponse = {
  generatedAtUtc: string
  query: string
  count: number
  items: InventoryAdjustmentItemSearchResult[]
}

type InventoryAdjustmentSearchAccountsResponse = {
  generatedAtUtc: string
  query: string
  count: number
  items: InventoryAdjustmentAccountSearchResult[]
}

type PreviewComputation = {
  draft: InventoryAdjustmentDraft
  item: InventoryAdjustmentItemSearchResult
  account: InventoryAdjustmentAccountSearchResult
  location: InventoryAdjustmentLocationOption
  postingPeriod: InventoryAdjustmentPostingPeriod | null
  snapshot: InventoryAdjustmentItemSnapshotResponse
  selectedLocationBalance: InventoryAdjustmentLocationBalance
  issues: string[]
  warnings: string[]
  adjustQtyBy: number
  newQuantity: number
  assignments: InventoryAdjustmentAssignmentPreview[]
  payloadPreview: Record<string, unknown> | null
}

const SEARCH_LIMIT_DEFAULT = 12
const SEARCH_LIMIT_MAX = 20
const LOOKUP_CACHE_TTL_MS = 5 * 60 * 1000
const NUMERIC_TOLERANCE = 0.0001
const SUPPORTED_ITEM_TYPES = new Set(['InvtPart', 'Assembly'])

let locationCache:
  | {
      storedAtMs: number
      items: InventoryAdjustmentLocationOption[]
    }
  | null = null

let postingPeriodCache:
  | {
      storedAtMs: number
      items: InventoryAdjustmentPostingPeriod[]
    }
  | null = null

export class InventoryAdjustmentError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'InventoryAdjustmentError'
    this.status = status
  }
}

export async function fetchInventoryAdjustmentBootstrap(
  client: NetSuiteClient,
): Promise<InventoryAdjustmentBootstrapResponse> {
  return {
    generatedAtUtc: new Date().toISOString(),
    todayDate: formatDateOnly(new Date()),
    locations: await fetchLocations(client),
    postingPeriods: await fetchPostingPeriods(client),
  }
}

export async function searchInventoryAdjustmentItems(
  client: NetSuiteClient,
  rawQuery: unknown,
  rawLimit: unknown,
): Promise<InventoryAdjustmentSearchItemsResponse> {
  const query = normalizeSearchQuery(rawQuery)
  const limit = normalizeSearchLimit(rawLimit)
  const likeLiteral = query ? formatSuiteQlLiteral(`%${escapeSuiteQlLikeValue(query.toUpperCase())}%`) : null
  const exactLiteral = query ? formatSuiteQlLiteral(query.toUpperCase()) : null
  const prefixLiteral = query ? formatSuiteQlLiteral(`${escapeSuiteQlLikeValue(query.toUpperCase())}%`) : null

  const searchQuery = `
SELECT
  item.id AS internalId,
  item.itemid AS itemId,
  item.displayname AS displayName,
  item.itemtype AS itemType,
  item.costingmethod AS costingMethod,
  item.islotitem AS isLotTracked,
  item.isserialitem AS isSerialTracked,
  item.usebins AS usesBins,
  item.stockunit AS stockUnitId,
  BUILTIN.DF(item.stockunit) AS stockUnitName
FROM item
WHERE item.isinactive = 'F'
  AND item.itemtype IN (${joinSuiteQlLiterals([...SUPPORTED_ITEM_TYPES])})
  ${
    likeLiteral
      ? `AND (
    UPPER(item.itemid) LIKE ${likeLiteral}
    OR UPPER(item.displayname) LIKE ${likeLiteral}
  )`
      : ''
  }
ORDER BY
  ${
    query
      ? `CASE
    WHEN UPPER(item.itemid) = ${exactLiteral} THEN 0
    WHEN UPPER(item.itemid) LIKE ${prefixLiteral} THEN 1
    WHEN UPPER(item.displayname) = ${exactLiteral} THEN 2
    ELSE 3
  END,`
      : ''
  }
  item.itemid ASC
  `.trim()

  const response = await client.suiteql(searchQuery, limit, 0)
  const rows = Array.isArray(response.json.items)
    ? (response.json.items as Record<string, unknown>[])
    : []
  const items = rows
    .map((row) => normalizeInventoryAdjustmentItem(row))
    .filter((item): item is InventoryAdjustmentItemSearchResult => item !== null)

  return {
    generatedAtUtc: new Date().toISOString(),
    query,
    count: items.length,
    items,
  }
}

export async function searchInventoryAdjustmentAccounts(
  client: NetSuiteClient,
  rawQuery: unknown,
  rawLimit: unknown,
): Promise<InventoryAdjustmentSearchAccountsResponse> {
  const query = normalizeSearchQuery(rawQuery)
  const limit = normalizeSearchLimit(rawLimit)
  const likeLiteral = query ? formatSuiteQlLiteral(`%${escapeSuiteQlLikeValue(query.toUpperCase())}%`) : null
  const exactLiteral = query ? formatSuiteQlLiteral(query.toUpperCase()) : null
  const prefixLiteral = query ? formatSuiteQlLiteral(`${escapeSuiteQlLikeValue(query.toUpperCase())}%`) : null

  const searchQuery = `
SELECT
  account.id AS internalId,
  account.displaynamewithhierarchy AS displayName,
  account.accttype AS accountType
FROM account
WHERE account.isinactive = 'F'
  ${
    likeLiteral
      ? `AND UPPER(account.displaynamewithhierarchy) LIKE ${likeLiteral}`
      : ''
  }
ORDER BY
  ${
    query
      ? `CASE
    WHEN UPPER(account.displaynamewithhierarchy) = ${exactLiteral} THEN 0
    WHEN UPPER(account.displaynamewithhierarchy) LIKE ${prefixLiteral} THEN 1
    ELSE 2
  END,`
      : ''
  }
  account.displaynamewithhierarchy ASC
  `.trim()

  const response = await client.suiteql(searchQuery, limit, 0)
  const rows = Array.isArray(response.json.items)
    ? (response.json.items as Record<string, unknown>[])
    : []
  const items = rows
    .map((row) => normalizeInventoryAdjustmentAccount(row))
    .filter((item): item is InventoryAdjustmentAccountSearchResult => item !== null)

  return {
    generatedAtUtc: new Date().toISOString(),
    query,
    count: items.length,
    items,
  }
}

export async function fetchInventoryAdjustmentItemSnapshot(
  client: NetSuiteClient,
  rawItemId: unknown,
  rawLocationId?: unknown,
): Promise<InventoryAdjustmentItemSnapshotResponse> {
  const itemId = normalizeRequiredString(rawItemId, 'Selecciona un item para consultar su inventario actual.')
  const item = await fetchInventoryItemById(client, itemId)
  const requestedLocation = await resolveLocationOption(client, rawLocationId)
  const locations = await fetchInventoryLocationBalances(client, itemId, requestedLocation?.internalId ?? null)
  const lots = await fetchInventoryLotBalances(client, itemId, requestedLocation?.internalId ?? null)
  const totals = summarizeItemSnapshot(locations, lots)

  return {
    generatedAtUtc: new Date().toISOString(),
    item,
    requestedLocation,
    totals,
    locations,
    lots,
    requirements: {
      needsInventoryDetail: item.isLotTracked || item.isSerialTracked || item.usesBins,
      requiresInventoryNumberSelection: item.isLotTracked || item.isSerialTracked,
      requiresReceiptInventoryNumber: item.isLotTracked || item.isSerialTracked,
      usesBins: item.usesBins,
    },
  }
}

export async function previewInventoryAdjustment(
  client: NetSuiteClient,
  rawDraft: unknown,
): Promise<InventoryAdjustmentPreviewResponse> {
  const computation = await buildPreviewComputation(client, rawDraft)

  return {
    generatedAtUtc: new Date().toISOString(),
    transactionDate: computation.draft.transactionDate,
    account: computation.account,
    location: computation.location,
    postingPeriod: computation.postingPeriod,
    item: computation.item,
    memo: computation.draft.memo,
    lineMemo: computation.draft.lineMemo,
    currentStock: {
      ...computation.snapshot.totals,
      selectedLocationQuantityOnHand: computation.selectedLocationBalance.quantityOnHand,
      selectedLocationQuantityAvailable: computation.selectedLocationBalance.quantityAvailable,
    },
    computed: {
      adjustmentMode: computation.draft.adjustmentMode,
      requestedQuantity: computation.draft.quantity,
      adjustQtyBy: computation.adjustQtyBy,
      newQuantity: computation.newQuantity,
      direction: computation.adjustQtyBy >= 0 ? 'increase' : 'decrease',
    },
    validation: {
      isValid: computation.issues.length === 0,
      issues: computation.issues,
      warnings: computation.warnings,
      requiresInventoryDetail:
        computation.item.isLotTracked || computation.item.isSerialTracked || computation.item.usesBins,
    },
    assignments: computation.assignments,
    payloadPreview: computation.payloadPreview,
  }
}

export async function executeInventoryAdjustment(
  client: NetSuiteClient,
  rawDraft: unknown,
): Promise<InventoryAdjustmentExecuteResponse> {
  const computation = await buildPreviewComputation(client, rawDraft)
  if (computation.issues.length > 0 || !computation.payloadPreview) {
    throw new InventoryAdjustmentError(
      `No puedo publicar el ajuste porque siguen abiertas estas validaciones: ${computation.issues.join(' | ')}`,
      400,
    )
  }

  const createResponse = await client.createRecord('inventoryAdjustment', computation.payloadPreview)
  const createdRecord = getNullableRecord(createResponse.json)
  const internalId = normalizeCreatedRecordId(
    getNullableString(createdRecord?.id) ?? parseRecordIdFromLocation(createResponse.location),
  )

  if (!internalId) {
    throw new InventoryAdjustmentError(
      'NetSuite acepto la solicitud del ajuste, pero no devolvio un internalId utilizable.',
      502,
    )
  }

  let tranId: string | null = getNullableString(createdRecord?.tranId)
  if (!tranId) {
    try {
      const freshRecord = await client.getRecord('inventoryAdjustment', internalId)
      tranId = getNullableString(getNullableRecord(freshRecord.json)?.tranId)
    } catch {
      tranId = null
    }
  }

  return {
    executedAtUtc: new Date().toISOString(),
    record: {
      internalId,
      tranId,
    },
    item: computation.item,
    location: computation.location,
    account: computation.account,
    summary: {
      adjustmentMode: computation.draft.adjustmentMode,
      requestedQuantity: computation.draft.quantity,
      adjustQtyBy: computation.adjustQtyBy,
      newQuantity: computation.newQuantity,
      direction: computation.adjustQtyBy >= 0 ? 'increase' : 'decrease',
      previousQuantityOnHand: computation.selectedLocationBalance.quantityOnHand,
    },
    message:
      computation.adjustQtyBy >= 0
        ? 'Ajuste de entrada publicado en NetSuite.'
        : 'Ajuste de salida publicado en NetSuite.',
  }
}

async function buildPreviewComputation(
  client: NetSuiteClient,
  rawDraft: unknown,
): Promise<PreviewComputation> {
  const draft = normalizeDraft(rawDraft)
  const [item, account, locations, postingPeriods] = await Promise.all([
    fetchInventoryItemById(client, draft.itemId),
    fetchAccountById(client, draft.accountId),
    fetchLocations(client),
    fetchPostingPeriods(client),
  ])

  const location = resolveLocationFromList(locations, draft.locationId)
  const postingPeriod =
    draft.postingPeriodId !== null
      ? postingPeriods.find((period) => period.internalId === draft.postingPeriodId) ?? null
      : null

  if (draft.postingPeriodId && !postingPeriod) {
    throw new InventoryAdjustmentError(
      `El periodo contable ${draft.postingPeriodId} no existe en el catalogo disponible para ajustes.`,
      404,
    )
  }

  const snapshot = await fetchInventoryAdjustmentItemSnapshot(client, draft.itemId, draft.locationId)
  const selectedLocationBalance =
    snapshot.locations.find((balance) => balance.locationId === location.internalId) ?? {
      locationId: location.internalId,
      locationName: location.name,
      quantityOnHand: 0,
      quantityAvailable: 0,
      subsidiaryId: location.subsidiaryId,
      subsidiaryName: location.subsidiaryName,
    }

  const issues: string[] = []
  const warnings: string[] = []
  const currentQuantityOnHand = selectedLocationBalance.quantityOnHand
  const currentQuantityAvailable = selectedLocationBalance.quantityAvailable

  if (draft.adjustmentMode === 'set' && draft.quantity < 0) {
    issues.push('La cantidad objetivo no puede quedar por debajo de cero.')
  }

  const adjustQtyBy =
    draft.adjustmentMode === 'delta'
      ? roundQuantity(draft.quantity)
      : roundQuantity(draft.quantity - currentQuantityOnHand)

  const newQuantity = roundQuantity(currentQuantityOnHand + adjustQtyBy)

  if (Math.abs(adjustQtyBy) <= NUMERIC_TOLERANCE) {
    issues.push('La cantidad calculada para el ajuste es cero. No hay nada que publicar.')
  }

  if (adjustQtyBy < 0 && Math.abs(adjustQtyBy) - currentQuantityOnHand > NUMERIC_TOLERANCE) {
    issues.push(
      `No puedes retirar ${formatQuantity(Math.abs(adjustQtyBy))} porque solo hay ${formatQuantity(currentQuantityOnHand)} en existencia.`,
    )
  }

  if (adjustQtyBy < 0 && draft.unitCost !== null) {
    issues.push('NetSuite no permite capturar costo unitario en ajustes negativos.')
  }

  if (adjustQtyBy > 0 && draft.unitCost === null) {
    warnings.push('No definiste costo unitario. NetSuite aplicara su logica de costeo vigente.')
  }

  if (item.usesBins) {
    issues.push(
      'Esta primera version no soporta bin management. El item seleccionado usa bins y requiere una capa adicional.',
    )
  }

  const assignmentContext = buildAssignmentPreview({
    item,
    location,
    lots: snapshot.lots,
    adjustQtyBy,
    assignments: draft.assignments,
    issues,
  })

  const payloadPreview =
    issues.length === 0
      ? buildInventoryAdjustmentPayload({
          draft,
          item,
          location,
          postingPeriod,
          adjustQtyBy,
          assignments: assignmentContext.assignments,
        })
      : null

  return {
    draft,
    item,
    account,
    location,
    postingPeriod,
    snapshot,
    selectedLocationBalance,
    issues,
    warnings,
    adjustQtyBy,
    newQuantity,
    assignments: assignmentContext.assignments,
    payloadPreview,
  }
}

function buildAssignmentPreview(params: {
  item: InventoryAdjustmentItemSearchResult
  location: InventoryAdjustmentLocationOption
  lots: InventoryAdjustmentLotBalance[]
  adjustQtyBy: number
  assignments: InventoryAdjustmentAssignmentDraft[]
  issues: string[]
}) {
  const needsInventoryNumbers = params.item.isLotTracked || params.item.isSerialTracked
  if (!needsInventoryNumbers) {
    return {
      assignments: [] as InventoryAdjustmentAssignmentPreview[],
    }
  }

  const normalizedAssignments = params.assignments
    .map((assignment) => ({
      quantity: roundQuantity(assignment.quantity),
      issueInventoryNumberId: assignment.issueInventoryNumberId,
      receiptInventoryNumber: assignment.receiptInventoryNumber,
      expirationDate: assignment.expirationDate,
    }))
    .filter((assignment) => assignment.quantity > NUMERIC_TOLERANCE)

  if (normalizedAssignments.length === 0) {
    params.issues.push(
      params.adjustQtyBy >= 0
        ? 'El item requiere detalle de inventario. Agrega al menos un lote o serie de entrada.'
        : 'El item requiere detalle de inventario. Selecciona el lote o serie que vas a retirar.',
    )

    return {
      assignments: [] as InventoryAdjustmentAssignmentPreview[],
    }
  }

  const expectedQuantity = Math.abs(params.adjustQtyBy)
  const totalAssigned = roundQuantity(
    normalizedAssignments.reduce((total, assignment) => total + assignment.quantity, 0),
  )

  if (Math.abs(totalAssigned - expectedQuantity) > NUMERIC_TOLERANCE) {
    params.issues.push(
      `La suma del detalle (${formatQuantity(totalAssigned)}) debe coincidir con el ajuste (${formatQuantity(expectedQuantity)}).`,
    )
  }

  const availableLotsById = new Map(
    params.lots
      .filter((lot) => lot.locationId === params.location.internalId)
      .map((lot) => [lot.inventoryNumberId, lot] as const),
  )
  const requestedIssueQuantityByLot = new Map<string, number>()

  if (params.adjustQtyBy < 0) {
    for (const assignment of normalizedAssignments) {
      if (!assignment.issueInventoryNumberId) {
        continue
      }

      requestedIssueQuantityByLot.set(
        assignment.issueInventoryNumberId,
        roundQuantity(
          (requestedIssueQuantityByLot.get(assignment.issueInventoryNumberId) ?? 0) + assignment.quantity,
        ),
      )
    }
  }

  const assignments: InventoryAdjustmentAssignmentPreview[] = normalizedAssignments.map((assignment) => {
    if (params.adjustQtyBy < 0) {
      const lot = assignment.issueInventoryNumberId
        ? availableLotsById.get(assignment.issueInventoryNumberId)
        : null

      if (!assignment.issueInventoryNumberId) {
        params.issues.push('Cada salida debe identificar el lote o serie existente que se va a retirar.')
      } else if (!lot) {
        params.issues.push(
          `El lote o serie ${assignment.issueInventoryNumberId} no existe en la ubicacion seleccionada.`,
        )
      } else if (
        (requestedIssueQuantityByLot.get(assignment.issueInventoryNumberId) ?? assignment.quantity) -
          lot.quantityOnHand >
        NUMERIC_TOLERANCE
      ) {
        params.issues.push(
          `El lote ${lot.inventoryNumber ?? lot.inventoryNumberId} no tiene suficiente existencia para retirar ${formatQuantity(requestedIssueQuantityByLot.get(assignment.issueInventoryNumberId) ?? assignment.quantity)}.`,
        )
      }

      if (params.item.isSerialTracked && Math.abs(assignment.quantity - 1) > NUMERIC_TOLERANCE) {
        params.issues.push('Cada serie debe salir con cantidad 1.')
      }

      return {
        quantity: assignment.quantity,
        direction: 'issue',
        issueInventoryNumberId: assignment.issueInventoryNumberId,
        issueInventoryNumber: lot?.inventoryNumber ?? null,
        receiptInventoryNumber: null,
      }
    }

    const receiptInventoryNumber = cleanText(assignment.receiptInventoryNumber)
    if (!receiptInventoryNumber) {
      params.issues.push('Cada entrada debe capturar el lote o serie que NetSuite va a recibir.')
    }

    if (params.item.isSerialTracked && Math.abs(assignment.quantity - 1) > NUMERIC_TOLERANCE) {
      params.issues.push('Cada serie nueva debe entrar con cantidad 1.')
    }

    return {
      quantity: assignment.quantity,
      direction: 'receipt',
      issueInventoryNumberId: null,
      issueInventoryNumber: null,
      receiptInventoryNumber: receiptInventoryNumber || null,
    }
  })

  return { assignments }
}

function buildInventoryAdjustmentPayload(params: {
  draft: InventoryAdjustmentDraft
  item: InventoryAdjustmentItemSearchResult
  location: InventoryAdjustmentLocationOption
  postingPeriod: InventoryAdjustmentPostingPeriod | null
  adjustQtyBy: number
  assignments: InventoryAdjustmentAssignmentPreview[]
}) {
  const actualAdjustQtyBy = roundQuantity(params.adjustQtyBy)
  const inventoryLine: Record<string, unknown> = {
    line: 1,
    item: {
      id: params.item.internalId,
    },
    location: {
      id: params.location.internalId,
    },
    adjustQtyBy: actualAdjustQtyBy,
  }

  const lineMemo = cleanText(params.draft.lineMemo) || cleanText(params.draft.memo)
  if (lineMemo) {
    inventoryLine.memo = lineMemo
  }

  if (params.draft.unitCost !== null && actualAdjustQtyBy > 0) {
    inventoryLine.unitCost = params.draft.unitCost
  }

  if (params.assignments.length > 0) {
    inventoryLine.inventoryDetail = {
      inventoryAssignment: {
        items: params.assignments.map((assignment) => {
          const payload: Record<string, unknown> = {
            quantity: assignment.quantity,
          }

          if (assignment.direction === 'issue' && assignment.issueInventoryNumberId) {
            payload.issueInventoryNumber = {
              id: assignment.issueInventoryNumberId,
            }
          }

          if (assignment.direction === 'receipt' && assignment.receiptInventoryNumber) {
            payload.receiptInventoryNumber = assignment.receiptInventoryNumber
          }

          return payload
        }),
      },
    }
  }

  const payload: Record<string, unknown> = {
    externalId: buildInventoryAdjustmentExternalId(params),
    tranDate: params.draft.transactionDate,
    account: {
      id: params.draft.accountId,
    },
    adjLocation: {
      id: params.location.internalId,
    },
    inventory: {
      items: [inventoryLine],
    },
  }

  const memo = cleanText(params.draft.memo)
  if (memo) {
    payload.memo = memo
  }

  if (params.postingPeriod) {
    payload.postingPeriod = {
      id: params.postingPeriod.internalId,
    }
  }

  if (params.location.subsidiaryId) {
    payload.subsidiary = {
      id: params.location.subsidiaryId,
    }
  }

  return payload
}

function buildInventoryAdjustmentExternalId(params: {
  draft: InventoryAdjustmentDraft
  item: InventoryAdjustmentItemSearchResult
  location: InventoryAdjustmentLocationOption
}) {
  const timestamp = Date.now()
  return `AHORA-INVADJ-${params.item.internalId}-${params.location.internalId}-${timestamp}`
}

async function fetchInventoryItemById(
  client: NetSuiteClient,
  itemId: string,
): Promise<InventoryAdjustmentItemSearchResult> {
  const response = await client.suiteql(
    `
SELECT
  item.id AS internalId,
  item.itemid AS itemId,
  item.displayname AS displayName,
  item.itemtype AS itemType,
  item.costingmethod AS costingMethod,
  item.islotitem AS isLotTracked,
  item.isserialitem AS isSerialTracked,
  item.usebins AS usesBins,
  item.stockunit AS stockUnitId,
  BUILTIN.DF(item.stockunit) AS stockUnitName
FROM item
WHERE item.id = ${formatSuiteQlLiteral(itemId)}
    `.trim(),
    1,
    0,
  )

  const item = normalizeInventoryAdjustmentItem((response.json.items ?? [])[0] ?? null)
  if (!item) {
    throw new InventoryAdjustmentError(`No encontre el item ${itemId} en NetSuite.`, 404)
  }

  if (!SUPPORTED_ITEM_TYPES.has(item.itemType)) {
    throw new InventoryAdjustmentError(
      `El item ${item.itemId} no es ajustable desde este flujo. Tipo detectado: ${item.itemType}.`,
      400,
    )
  }

  return item
}

async function fetchAccountById(
  client: NetSuiteClient,
  accountId: string,
): Promise<InventoryAdjustmentAccountSearchResult> {
  const response = await client.suiteql(
    `
SELECT
  account.id AS internalId,
  account.displaynamewithhierarchy AS displayName,
  account.accttype AS accountType
FROM account
WHERE account.id = ${formatSuiteQlLiteral(accountId)}
  AND account.isinactive = 'F'
    `.trim(),
    1,
    0,
  )

  const account = normalizeInventoryAdjustmentAccount((response.json.items ?? [])[0] ?? null)
  if (!account) {
    throw new InventoryAdjustmentError(`La cuenta ${accountId} no existe o esta inactiva en NetSuite.`, 404)
  }

  return account
}

async function fetchLocations(
  client: NetSuiteClient,
): Promise<InventoryAdjustmentLocationOption[]> {
  const cache = locationCache
  if (cache && Date.now() - cache.storedAtMs < LOOKUP_CACHE_TTL_MS) {
    return cache.items
  }

  const response = await client.suiteql(
    `
SELECT
  location.id AS internalId,
  location.name AS name,
  location.subsidiary AS subsidiaryId,
  BUILTIN.DF(location.subsidiary) AS subsidiaryName
FROM location
WHERE location.isinactive = 'F'
ORDER BY location.name ASC
    `.trim(),
    500,
    0,
  )

  const rows = Array.isArray(response.json.items)
    ? (response.json.items as Record<string, unknown>[])
    : []
  const items = rows
    .map((row) => normalizeInventoryAdjustmentLocation(row))
    .filter((location): location is InventoryAdjustmentLocationOption => location !== null)

  locationCache = {
    storedAtMs: Date.now(),
    items,
  }

  return items
}

async function fetchPostingPeriods(
  client: NetSuiteClient,
): Promise<InventoryAdjustmentPostingPeriod[]> {
  const cache = postingPeriodCache
  if (cache && Date.now() - cache.storedAtMs < LOOKUP_CACHE_TTL_MS) {
    return cache.items
  }

  const response = await client.suiteql(
    `
SELECT
  transaction.postingperiod AS internalId,
  BUILTIN.DF(transaction.postingperiod) AS name,
  MIN(transaction.trandate) AS startDate,
  MAX(transaction.trandate) AS endDate
FROM transaction
WHERE transaction.type IN ('CustInvc', 'VendBill', 'InvAdjst')
  AND transaction.postingperiod IS NOT NULL
GROUP BY
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod)
    `.trim(),
    300,
    0,
  )

  const rows = Array.isArray(response.json.items)
    ? (response.json.items as Record<string, unknown>[])
    : []
  const items = rows
    .map((row) => normalizeInventoryAdjustmentPostingPeriod(row))
    .filter((period): period is InventoryAdjustmentPostingPeriod => period !== null)
    .sort(comparePostingPeriodsDesc)

  postingPeriodCache = {
    storedAtMs: Date.now(),
    items,
  }

  return items
}

async function resolveLocationOption(client: NetSuiteClient, rawLocationId?: unknown) {
  const locationId = getNullableString(rawLocationId)
  if (!locationId) {
    return null
  }

  const locations = await fetchLocations(client)
  return resolveLocationFromList(locations, locationId)
}

function resolveLocationFromList(
  locations: InventoryAdjustmentLocationOption[],
  locationId: string,
) {
  const location = locations.find((item) => item.internalId === locationId)
  if (!location) {
    throw new InventoryAdjustmentError(
      `La ubicacion ${locationId} no existe o no esta activa para este ajuste.`,
      404,
    )
  }

  return location
}

async function fetchInventoryLocationBalances(
  client: NetSuiteClient,
  itemId: string,
  locationId: string | null,
): Promise<InventoryAdjustmentLocationBalance[]> {
  const response = await client.suiteql(
    `
SELECT
  ib.location AS locationId,
  BUILTIN.DF(ib.location) AS locationName,
  SUM(ib.quantityonhand) AS quantityOnHand,
  SUM(ib.quantityavailable) AS quantityAvailable
FROM InventoryBalance ib
WHERE ib.item = ${formatSuiteQlLiteral(itemId)}
  ${locationId ? `AND ib.location = ${formatSuiteQlLiteral(locationId)}` : ''}
GROUP BY
  ib.location,
  BUILTIN.DF(ib.location)
ORDER BY locationName ASC
    `.trim(),
    200,
    0,
  )

  const activeLocations = await fetchLocations(client)
  const locationById = new Map<string, InventoryAdjustmentLocationOption>(
    activeLocations.map((location) => [location.internalId, location] as const),
  )
  const rows = Array.isArray(response.json.items)
    ? (response.json.items as Record<string, unknown>[])
    : []

  return rows
    .map((row) => normalizeInventoryAdjustmentLocationBalance(row, locationById))
    .filter((item): item is InventoryAdjustmentLocationBalance => item !== null)
}

async function fetchInventoryLotBalances(
  client: NetSuiteClient,
  itemId: string,
  locationId: string | null,
): Promise<InventoryAdjustmentLotBalance[]> {
  const response = await client.suiteql(
    `
SELECT
  ib.inventorynumber AS inventoryNumberId,
  BUILTIN.DF(ib.inventorynumber) AS inventoryNumber,
  inum.expirationdate AS expirationDate,
  ib.location AS locationId,
  BUILTIN.DF(ib.location) AS locationName,
  SUM(ib.quantityonhand) AS quantityOnHand,
  SUM(ib.quantityavailable) AS quantityAvailable
FROM InventoryBalance ib
JOIN InventoryNumber inum
  ON inum.id = ib.inventorynumber
WHERE ib.item = ${formatSuiteQlLiteral(itemId)}
  AND ib.inventorynumber IS NOT NULL
  ${locationId ? `AND ib.location = ${formatSuiteQlLiteral(locationId)}` : ''}
GROUP BY
  ib.inventorynumber,
  BUILTIN.DF(ib.inventorynumber),
  inum.expirationdate,
  ib.location,
  BUILTIN.DF(ib.location)
ORDER BY inventoryNumber ASC, locationName ASC
    `.trim(),
    500,
    0,
  )

  const rows = Array.isArray(response.json.items)
    ? (response.json.items as Record<string, unknown>[])
    : []

  return rows
    .map((row) => normalizeInventoryAdjustmentLotBalance(row))
    .filter((item): item is InventoryAdjustmentLotBalance => item !== null)
}

function summarizeItemSnapshot(
  locations: InventoryAdjustmentLocationBalance[],
  lots: InventoryAdjustmentLotBalance[],
) {
  return {
    quantityOnHand: roundQuantity(locations.reduce((total, row) => total + row.quantityOnHand, 0)),
    quantityAvailable: roundQuantity(locations.reduce((total, row) => total + row.quantityAvailable, 0)),
    locationCount: locations.length,
    lotCount: lots.length,
  }
}

function normalizeDraft(rawDraft: unknown): InventoryAdjustmentDraft {
  const draft = getNullableRecord(rawDraft)
  const adjustmentMode = getNullableString(draft?.adjustmentMode)
  if (adjustmentMode !== 'delta' && adjustmentMode !== 'set') {
    throw new InventoryAdjustmentError('El ajuste debe usar modo delta o set.', 400)
  }

  const transactionDate = normalizeRequiredString(
    draft?.transactionDate,
    'La fecha del ajuste es obligatoria.',
  )
  if (!/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) {
    throw new InventoryAdjustmentError('La fecha del ajuste debe venir en formato YYYY-MM-DD.', 400)
  }

  const quantity = parseNumber(draft?.quantity)
  if (quantity === null) {
    throw new InventoryAdjustmentError('Captura una cantidad valida para el ajuste.', 400)
  }

  const unitCost = parseNumber(draft?.unitCost)
  if (unitCost !== null && unitCost < 0) {
    throw new InventoryAdjustmentError('El costo unitario no puede ser negativo.', 400)
  }

  const assignments = Array.isArray(draft?.assignments)
    ? draft.assignments.map((assignment) => normalizeAssignmentDraft(assignment))
    : []

  return {
    transactionDate,
    postingPeriodId: getNullableString(draft?.postingPeriodId),
    accountId: normalizeRequiredString(
      draft?.accountId,
      'Selecciona la cuenta de ajuste que se va a usar en NetSuite.',
    ),
    locationId: normalizeRequiredString(
      draft?.locationId,
      'Selecciona la ubicacion donde vas a ejecutar el ajuste.',
    ),
    itemId: normalizeRequiredString(draft?.itemId, 'Selecciona el item que vas a ajustar.'),
    memo: getNullableString(draft?.memo),
    lineMemo: getNullableString(draft?.lineMemo),
    adjustmentMode,
    quantity: roundQuantity(quantity),
    unitCost: unitCost !== null ? roundQuantity(unitCost) : null,
    assignments,
  }
}

function normalizeAssignmentDraft(rawAssignment: unknown): InventoryAdjustmentAssignmentDraft {
  const assignment = getNullableRecord(rawAssignment)
  const quantity = parseNumber(assignment?.quantity)

  return {
    quantity: quantity !== null ? roundQuantity(quantity) : 0,
    issueInventoryNumberId: getNullableString(assignment?.issueInventoryNumberId),
    receiptInventoryNumber: getNullableString(assignment?.receiptInventoryNumber),
    expirationDate: getNullableString(assignment?.expirationDate),
  }
}

function normalizeInventoryAdjustmentItem(value: unknown) {
  const row = normalizeSuiteQlRow(value)
  const internalId = getNullableString(row.internalid)
  const itemId = getNullableString(row.itemid)
  const itemType = getNullableString(row.itemtype)

  if (!internalId || !itemId || !itemType) {
    return null
  }

  return {
    internalId,
    itemId,
    displayName: getNullableString(row.displayname),
    itemType,
    costingMethod: getNullableString(row.costingmethod),
    isLotTracked: normalizeNetSuiteBoolean(row.islottracked),
    isSerialTracked: normalizeNetSuiteBoolean(row.isserialtracked),
    usesBins: normalizeNetSuiteBoolean(row.usesbins),
    stockUnitId: getNullableString(row.stockunitid),
    stockUnitName: getNullableString(row.stockunitname),
  } satisfies InventoryAdjustmentItemSearchResult
}

function normalizeInventoryAdjustmentAccount(value: unknown) {
  const row = normalizeSuiteQlRow(value)
  const internalId = getNullableString(row.internalid)
  const displayName = getNullableString(row.displayname)
  if (!internalId || !displayName) {
    return null
  }

  return {
    internalId,
    displayName,
    accountType: getNullableString(row.accounttype),
  } satisfies InventoryAdjustmentAccountSearchResult
}

function normalizeInventoryAdjustmentLocation(value: unknown) {
  const row = normalizeSuiteQlRow(value)
  const internalId = getNullableString(row.internalid)
  const name = getNullableString(row.name)
  if (!internalId || !name) {
    return null
  }

  return {
    internalId,
    name,
    subsidiaryId: getNullableString(row.subsidiaryid),
    subsidiaryName: getNullableString(row.subsidiaryname),
  } satisfies InventoryAdjustmentLocationOption
}

function normalizeInventoryAdjustmentPostingPeriod(value: unknown) {
  const row = normalizeSuiteQlRow(value)
  const internalId = getNullableString(row.internalid)
  const name = getNullableString(row.name)
  if (!internalId || !name) {
    return null
  }

  return {
    internalId,
    name,
    startDate: getNullableString(row.startdate),
    endDate: getNullableString(row.enddate),
  } satisfies InventoryAdjustmentPostingPeriod
}

function normalizeInventoryAdjustmentLocationBalance(
  value: unknown,
  locationById: Map<string, InventoryAdjustmentLocationOption>,
) {
  const row = normalizeSuiteQlRow(value)
  const locationId = getNullableString(row.locationid)
  if (!locationId) {
    return null
  }

  const metadata = locationById.get(locationId) ?? null

  return {
    locationId,
    locationName: getNullableString(row.locationname),
    quantityOnHand: roundQuantity(parseNumber(row.quantityonhand) ?? 0),
    quantityAvailable: roundQuantity(parseNumber(row.quantityavailable) ?? 0),
    subsidiaryId: metadata?.subsidiaryId ?? null,
    subsidiaryName: metadata?.subsidiaryName ?? null,
  } satisfies InventoryAdjustmentLocationBalance
}

function normalizeInventoryAdjustmentLotBalance(value: unknown) {
  const row = normalizeSuiteQlRow(value)
  const inventoryNumberId = getNullableString(row.inventorynumberid)
  const locationId = getNullableString(row.locationid)
  if (!inventoryNumberId || !locationId) {
    return null
  }

  return {
    inventoryNumberId,
    inventoryNumber: getNullableString(row.inventorynumber),
    expirationDate: normalizeInventoryDate(getNullableString(row.expirationdate)),
    locationId,
    locationName: getNullableString(row.locationname),
    quantityOnHand: roundQuantity(parseNumber(row.quantityonhand) ?? 0),
    quantityAvailable: roundQuantity(parseNumber(row.quantityavailable) ?? 0),
  } satisfies InventoryAdjustmentLotBalance
}

function normalizeSearchQuery(value: unknown) {
  return cleanText(value)
}

function normalizeSearchLimit(value: unknown) {
  const parsed = parseNumber(value)
  if (parsed === null) {
    return SEARCH_LIMIT_DEFAULT
  }

  return Math.max(1, Math.min(SEARCH_LIMIT_MAX, Math.trunc(parsed)))
}

function normalizeNetSuiteBoolean(value: unknown) {
  return String(value ?? '')
    .trim()
    .toUpperCase() === 'T'
}

function normalizeSuiteQlRow(value: unknown) {
  const record = getNullableRecord(value)
  if (!record) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, rowValue]) => [key.toLowerCase(), rowValue]),
  ) as Record<string, unknown>
}

function normalizeRequiredString(value: unknown, message: string) {
  const normalized = getNullableString(value)
  if (!normalized) {
    throw new InventoryAdjustmentError(message, 400)
  }

  return normalized
}

function comparePostingPeriodsDesc(
  left: InventoryAdjustmentPostingPeriod,
  right: InventoryAdjustmentPostingPeriod,
) {
  return parseDateValue(right.startDate) - parseDateValue(left.startDate)
}

function parseDateValue(value: string | null) {
  if (!value) {
    return 0
  }

  const dotDateMatch = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/)
  if (dotDateMatch) {
    const [, day, month, year] = dotDateMatch
    return Date.UTC(Number(year), Number(month) - 1, Number(day))
  }

  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime()
}

function parseNumber(value: unknown) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }

  if (typeof value === 'string' && value.trim()) {
    const normalized = Number(value)
    return Number.isFinite(normalized) ? normalized : null
  }

  return null
}

function normalizeInventoryDate(value: string | null) {
  if (!value) {
    return null
  }

  const parts = value.split(/[./-]/).map((segment) => segment.trim())
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

  const candidate = new Date(Date.UTC(year, month - 1, day))
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return null
  }

  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`
}

function getNullableRecord(value: unknown) {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }

  return null
}

function getNullableString(value: unknown) {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : null
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value)
  }

  return null
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function escapeSuiteQlLikeValue(value: string) {
  return value.replace(/'/g, "''")
}

function joinSuiteQlLiterals(values: string[]) {
  return values.map((value) => formatSuiteQlLiteral(value)).join(', ')
}

function formatSuiteQlLiteral(value: string) {
  if (/^-?\d+(?:\.\d+)?$/.test(value)) {
    return value
  }

  return `'${value.replace(/'/g, "''")}'`
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('es-MX', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(roundQuantity(value))
}

function formatDateOnly(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-')
}

function normalizeCreatedRecordId(value: string | null) {
  if (!value || value === '0') {
    return null
  }

  return value
}

function parseRecordIdFromLocation(location: string | null) {
  if (!location) {
    return null
  }

  try {
    const url = new URL(location)
    const parts = url.pathname.split('/').filter(Boolean)
    return parts[parts.length - 1] || null
  } catch {
    const match = location.match(/\/([^/?#]+)\/?$/)
    return match?.[1] ?? null
  }
}
