import { NetSuiteClient } from './netsuiteClient.js'
import { loadOrSyncNetSuiteAccountCatalog } from './netsuiteAccountStore.js'
import { loadOrSyncNetSuiteEntityCatalog, syncNetSuiteEntityCatalog } from './netsuiteEntityStore.js'
import {
  loadSatAnalysisWindows,
  markSatAnalysisWindowInvoiceAlreadyInNetSuite,
  markSatAnalysisWindowInvoiceUploaded,
  type SatAnalysisNetSuiteMatch,
} from './satAnalysisWindows.js'
import { upsertSatManualProviderHomologation } from './satManualHomologationStore.js'
import { previewSatPackageForNetsuite } from './satNetsuitePreview.js'
import { SatServiceError } from './sat.js'
import {
  buildSatUberVendorDraft,
  buildSatNuevoProveedorCandidate,
  classifySatUberProviderCandidate,
} from './satUberVendors.js'

type ReferencePayload = {
  id: string
  refName?: string
}

type VendorDefaults = {
  subsidiary: ReferencePayload | null
  currency: ReferencePayload | null
  terms: ReferencePayload | null
  approvalStatus: ReferencePayload | null
  department: ReferencePayload | null
  location: ReferencePayload | null
  classRef: ReferencePayload | null
}

type AutoResolvedVendor = {
  vendor: ReferencePayload
  createdVendor?: {
    internalId: string
    displayName: string
    scenario: 'individual' | 'company'
    created: boolean
  }
}

type PreviewInvoice = Awaited<ReturnType<typeof previewSatPackageForNetsuite>>['invoices'][number]
type PreviewRow = Awaited<ReturnType<typeof previewSatPackageForNetsuite>>['rows'][number]

type RelatedVendorBillMatch = {
  internalId: string
  transactionNumber: string | null
  tranId: string | null
  transactionDate: string | null
  total: number | null
  entityId: string | null
  vendorName: string | null
  currencyId: string | null
  currencyName: string | null
}

const REQUIRED_SAT_VENDOR_BILL_DEPARTMENT_NAME = 'Administracion'
const REQUIRED_SAT_VENDOR_BILL_LOCATION_NAME = 'SHQ - Oficinas Administrativas'
const UNSUPPORTED_VENDOR_BILL_TYPE_ISSUE =
  'TipoDeComprobante E no se importa como factura proveedor; requiere flujo especifico.'
const SAT_UBER_TEMPLATE_VENDOR_ID =
  process.env.NETSUITE_SAT_UBER_TEMPLATE_VENDOR_ID?.trim() || '6463'
const SAT_UBER_VENDOR_CATEGORY_NAME = 'Nacional'
const SAT_UBER_VENDOR_PROCEDENCIA_NAME = 'Nacional'
const PREVIEW_TAX_CODE_TO_NETSUITE_ITEM_ID: Record<string, string> = {
  'VAT_MX:IVA:IVA Compras 16%': 'IVA Compras 16%',
  'VAT_MX:IVA:IVA 0%': 'IVA 0%',
}

const accountReferenceCache = new Map<string, ReferencePayload>()
const taxCodeReferenceCache = new Map<string, ReferencePayload>()
const vendorReferenceCache = new Map<string, ReferencePayload>()
const vendorCurrencyReferenceCache = new Map<string, ReferencePayload[]>()
const namedReferenceCache = new Map<string, ReferencePayload>()
let satUberTemplateVendorCache: Record<string, unknown> | null = null

export async function uploadSatAnalysisInvoiceToNetSuite(params: {
  windowId: string
  uuid: string
  dryRun?: boolean
}) {
  const window = loadSatAnalysisWindows().find((item) => item.id === params.windowId)
  if (!window) {
    throw new SatServiceError(`No existe la ventana SAT ${params.windowId}.`, 404)
  }

  const normalizedUuid = normalizeUuid(params.uuid)
  if (!normalizedUuid) {
    throw new SatServiceError('El UUID indicado no es valido para la carga a NetSuite.', 400)
  }

  const sourceItem = window.analysisItems.find((item) => normalizeUuid(item.uuid) === normalizedUuid)
  if (!sourceItem) {
    const processed = window.processedItems.find((item) => normalizeUuid(item.uuid) === normalizedUuid)
    if (processed) {
      throw new SatServiceError(
        `La factura ${params.uuid} ya esta en historico procesado dentro de la ventana ${params.windowId}.`,
        409,
      )
    }

    throw new SatServiceError(
      `La factura ${params.uuid} no esta pendiente de carga en la ventana ${params.windowId}.`,
      404,
    )
  }

  const preview = await previewSatPackageForNetsuite(sourceItem.packageId)
  const invoice = preview.invoices.find((item) => normalizeUuid(item.uuid) === normalizedUuid)
  const rows = preview.rows.filter((item) => normalizeUuid(item.uuid) === normalizedUuid)

  if (!invoice || rows.length === 0) {
    throw new SatServiceError(
      `No pude preparar el preview de la factura ${params.uuid} dentro del paquete ${sourceItem.packageId}.`,
      404,
    )
  }

  const client = NetSuiteClient.fromEnv()
  const exactDuplicates = await queryExistingVendorBillsByUuid(client, normalizedUuid)
  if (exactDuplicates.length > 0) {
    assertExactDuplicatesMatchInvoiceTotal({
      uuid: normalizedUuid,
      invoice,
      duplicates: exactDuplicates,
    })

    const executedAtUtc = new Date().toISOString()
    const updatedWindow = params.dryRun
      ? null
      : markSatAnalysisWindowInvoiceAlreadyInNetSuite({
          windowId: params.windowId,
          uuid: normalizedUuid,
          netsuiteMatches: exactDuplicates,
          processedAtUtc: executedAtUtc,
        })

    return {
      success: true as const,
      dryRun: Boolean(params.dryRun),
      created: false,
      skippedReason: 'duplicate' as const,
      executedAtUtc,
      windowId: params.windowId,
      packageId: sourceItem.packageId,
      uuid: sourceItem.uuid,
      invoice,
      duplicateMatches: exactDuplicates,
      analysisWindow: updatedWindow
        ? {
            id: updatedWindow.id,
            analysisItems: updatedWindow.analysisItems.length,
            processedItems: updatedWindow.processedItems.length,
          }
        : undefined,
      message: params.dryRun
        ? 'La factura ya existe en NetSuite; la carga fue omitida.'
        : 'La factura ya existia en NetSuite y fue movida al historico procesado.',
    }
  }

  if (invoice.tipoComprobante === 'E') {
    return uploadSatAnalysisVendorCreditToNetSuite({
      windowId: params.windowId,
      sourceItem,
      normalizedUuid,
      invoice,
      rows,
      client,
      dryRun: Boolean(params.dryRun),
    })
  }

  if (!invoice.readyToImport) {
    throw new SatServiceError(
      `La factura ${params.uuid} no esta lista para importar: ${invoice.issues.join(' ')}`,
      409,
    )
  }

  if (invoice.duplicateStatus !== 'clear') {
    throw new SatServiceError(
      `La factura ${params.uuid} ya tiene indicios de existir en NetSuite y no se puede subir automaticamente.`,
      409,
    )
  }

  const autoResolvedVendor = await ensureAutoResolvedVendorForInvoice({
    client,
    invoice,
    rows,
    dryRun: Boolean(params.dryRun),
  })
  const effectiveDefaults = await resolveVendorBillDefaults(
    client,
    invoice,
    autoResolvedVendor?.vendor ?? null,
  )
  const payload = await buildVendorBillPayload({
    client,
    invoice,
    sourceItem,
    rows,
    defaults: effectiveDefaults,
  })
  validateVendorBillPayload({
    invoice,
    uuid: normalizedUuid,
    payload,
  })

  if (params.dryRun) {
    return {
      success: true as const,
      dryRun: true,
      created: false,
      skippedReason: null,
      executedAtUtc: new Date().toISOString(),
      windowId: params.windowId,
      packageId: sourceItem.packageId,
      uuid: sourceItem.uuid,
      invoice,
      duplicateMatches: [],
      payload,
      providerAutoResolution: autoResolvedVendor?.createdVendor,
      message: 'Payload SAT listo para alta en NetSuite.',
    }
  }

  const createResponse = await client.createRecord('vendorBill', payload)
  const createdRecordId = normalizeCreatedRecordId(
    asOptionalString((createResponse.json as Record<string, unknown>)?.id) ??
      parseRecordIdFromLocation(createResponse.location),
  )

  if (!createdRecordId) {
    throw new SatServiceError(
      `NetSuite acepto la solicitud de alta para ${params.uuid}, pero no devolvio un internalId utilizable.`,
      502,
    )
  }

  const freshRecord = (await client.getRecord('vendorBill', createdRecordId)).json as Record<string, unknown>
  validateCreatedVendorBill({
    recordId: createdRecordId,
    expectedUuid: normalizedUuid,
    invoice,
    freshRecord,
  })
  const processedAtUtc = new Date().toISOString()
  const netsuiteMatch: SatAnalysisNetSuiteMatch = {
    internalId: createdRecordId,
    transactionNumber: asOptionalString(freshRecord.transactionNumber),
    tranId: asOptionalString(freshRecord.tranId),
    vendorName: getReferenceRefName(freshRecord.entity),
    transactionDate: asOptionalString(freshRecord.tranDate),
    total: parseNumber(freshRecord.total),
    currencyName: getReferenceRefName(freshRecord.currency),
    matchType: 'uuid-field',
  }

  const updatedWindow = markSatAnalysisWindowInvoiceUploaded({
    windowId: params.windowId,
    uuid: normalizedUuid,
    netsuiteMatch,
    processedAtUtc,
  })

  return {
    success: true as const,
    dryRun: false,
    created: true,
    skippedReason: null,
    executedAtUtc: processedAtUtc,
    windowId: params.windowId,
    packageId: sourceItem.packageId,
    uuid: sourceItem.uuid,
    invoice,
    duplicateMatches: [],
    payload,
    providerAutoResolution: autoResolvedVendor?.createdVendor,
    createdRecord: {
      internalId: createdRecordId,
      tranId: asOptionalString(freshRecord.tranId),
      transactionNumber: asOptionalString(freshRecord.transactionNumber),
      total: parseNumber(freshRecord.total),
      currencyName: getReferenceRefName(freshRecord.currency),
      vendorName: getReferenceRefName(freshRecord.entity),
      tranDate: asOptionalString(freshRecord.tranDate),
    },
    analysisWindow: {
      id: updatedWindow.id,
      analysisItems: updatedWindow.analysisItems.length,
      processedItems: updatedWindow.processedItems.length,
    },
    message: 'Factura SAT creada en NetSuite y movida al historico procesado.',
  }
}

export async function repairSatVendorBillFromAnalysisWindow(params: {
  windowId: string
  uuid: string
  recordId: string
}) {
  const normalizedUuid = normalizeUuid(params.uuid)
  if (!normalizedUuid) {
    throw new SatServiceError('El UUID indicado no es valido para reparar el vendor bill.', 400)
  }

  const sourceItem = loadSatSourceItemForWindow(params.windowId, normalizedUuid, true)
  if (!sourceItem) {
    throw new SatServiceError(
      `La factura ${params.uuid} no existe en la ventana SAT ${params.windowId}.`,
      404,
    )
  }

  const preview = await previewSatPackageForNetsuite(sourceItem.packageId)
  const invoice = preview.invoices.find((item) => normalizeUuid(item.uuid) === normalizedUuid)
  const rows = preview.rows.filter((item) => normalizeUuid(item.uuid) === normalizedUuid)
  if (!invoice || rows.length === 0) {
    throw new SatServiceError(
      `No pude reconstruir el modelo SAT para la factura ${params.uuid}.`,
      404,
    )
  }

  const client = NetSuiteClient.fromEnv()
  const currentRecord = (await client.getRecord('vendorBill', params.recordId, { expandSubResources: true }))
    .json as Record<string, unknown>

  const currentTranId = normalizeUuid(asOptionalString(currentRecord.tranId))
  const currentInboundUuid = normalizeUuid(asOptionalString(currentRecord.custbody_mx_inbound_bill_uuid))
  const currentCfdiUuid = normalizeUuid(asOptionalString(currentRecord.custbody_mx_cfdi_uuid))
  const matchesCurrentRecord =
    currentTranId === normalizedUuid ||
    currentInboundUuid === normalizedUuid ||
    currentCfdiUuid === normalizedUuid

  if (!matchesCurrentRecord) {
    throw new SatServiceError(
      `El vendor bill ${params.recordId} no coincide con el UUID ${params.uuid}; se cancela la reparacion para evitar tocar otra factura.`,
      409,
    )
  }

  const defaults = await resolveVendorBillDefaults(client, invoice)
  const expenseItems = await buildVendorBillExpenseItems({
    client,
    invoice,
    sourceItem,
    rows,
    defaults,
  })

  await client.patchRecord(
    'vendorBill',
    params.recordId,
    {
      expense: {
        items: expenseItems,
      },
    },
    {
      replace: 'expense',
    },
  )

  const refreshedRecord = (await client.getRecord('vendorBill', params.recordId, { expandSubResources: true }))
    .json as Record<string, unknown>

  return {
    success: true as const,
    repairedAtUtc: new Date().toISOString(),
    windowId: params.windowId,
    uuid: params.uuid,
    recordId: params.recordId,
    transactionNumber: asOptionalString(refreshedRecord.transactionNumber),
    tranId: asOptionalString(refreshedRecord.tranId),
    total: parseNumber(refreshedRecord.total),
    expenseLines: getSublistItems(refreshedRecord.expense).map((item) => {
      const expenseLine = getNullableRecord(item)
      return {
        line: parseNumber(expenseLine?.line),
        accountId: getReferenceId(expenseLine?.account),
        accountName: getReferenceRefName(expenseLine?.account),
        amount: parseNumber(expenseLine?.amount),
        memo: asOptionalString(expenseLine?.memo),
        taxCodeId: getReferenceId(expenseLine?.taxCode),
        taxCodeName: getReferenceRefName(expenseLine?.taxCode),
      }
    }),
  }
}

async function uploadSatAnalysisVendorCreditToNetSuite(params: {
  windowId: string
  sourceItem: { packageId: string; fecha: string | null; uuid: string | null }
  normalizedUuid: string
  invoice: PreviewInvoice
  rows: PreviewRow[]
  client: NetSuiteClient
  dryRun: boolean
}) {
  validateVendorCreditPreview({
    invoice: params.invoice,
    rows: params.rows,
    uuid: params.normalizedUuid,
  })

  const autoResolvedVendor = await ensureAutoResolvedVendorForInvoice({
    client: params.client,
    invoice: params.invoice,
    rows: params.rows,
    dryRun: params.dryRun,
  })
  const effectiveDefaults = await resolveVendorBillDefaults(
    params.client,
    params.invoice,
    autoResolvedVendor?.vendor ?? null,
  )
  const relatedBill = await resolveRelatedVendorBillForCredit({
    client: params.client,
    invoice: params.invoice,
    defaults: effectiveDefaults,
  })
  const payload = await buildVendorCreditPayload({
    client: params.client,
    invoice: params.invoice,
    sourceItem: params.sourceItem,
    rows: params.rows,
    defaults: effectiveDefaults,
  })
  validateVendorBillPayload({
    invoice: params.invoice,
    uuid: params.normalizedUuid,
    payload,
  })

  if (params.dryRun) {
    return {
      success: true as const,
      dryRun: true,
      created: false,
      skippedReason: null,
      executedAtUtc: new Date().toISOString(),
      windowId: params.windowId,
      packageId: params.sourceItem.packageId,
      uuid: params.sourceItem.uuid,
      invoice: params.invoice,
      duplicateMatches: [],
      payload,
      relatedVendorBill: relatedBill,
      providerAutoResolution: autoResolvedVendor?.createdVendor,
      message: 'Payload SAT listo para alta de credito de proveedor en NetSuite.',
    }
  }

  const createResponse = await params.client.createRecord('vendorCredit', payload)
  const createdRecordId = normalizeCreatedRecordId(
    asOptionalString((createResponse.json as Record<string, unknown>)?.id) ??
      parseRecordIdFromLocation(createResponse.location),
  )

  if (!createdRecordId) {
    throw new SatServiceError(
      `NetSuite acepto el alta del credito de proveedor ${params.normalizedUuid}, pero no devolvio un internalId utilizable.`,
      502,
    )
  }

  const freshRecord = (await params.client.getRecord('vendorCredit', createdRecordId, { expandSubResources: true }))
    .json as Record<string, unknown>
  validateCreatedVendorCredit({
    recordId: createdRecordId,
    expectedUuid: params.normalizedUuid,
    invoice: params.invoice,
    freshRecord,
  })

  const application = buildVendorCreditNoApplicationResult({
    relatedBill,
    freshRecord,
  })
  const finalRecord = application.freshRecord
  const processedAtUtc = new Date().toISOString()
  const netsuiteMatch: SatAnalysisNetSuiteMatch = {
    internalId: createdRecordId,
    transactionNumber: asOptionalString(finalRecord.transactionNumber),
    tranId: asOptionalString(finalRecord.tranId),
    vendorName: getReferenceRefName(finalRecord.entity),
    transactionDate: asOptionalString(finalRecord.tranDate),
    total: parseNumber(finalRecord.total),
    currencyName: getReferenceRefName(finalRecord.currency),
    matchType: 'uuid-field',
  }

  const updatedWindow = markSatAnalysisWindowInvoiceUploaded({
    windowId: params.windowId,
    uuid: params.normalizedUuid,
    netsuiteMatch,
    processedAtUtc,
  })

  return {
    success: true as const,
    dryRun: false,
    created: true,
    skippedReason: null,
    executedAtUtc: processedAtUtc,
    windowId: params.windowId,
    packageId: params.sourceItem.packageId,
    uuid: params.sourceItem.uuid,
    invoice: params.invoice,
    duplicateMatches: [],
    payload,
    providerAutoResolution: autoResolvedVendor?.createdVendor,
    relatedVendorBill: relatedBill,
    vendorCreditApplication: {
      applied: application.applied,
      amount: application.amount,
      reason: application.reason,
      message: application.message,
    },
    createdRecord: {
      internalId: createdRecordId,
      tranId: asOptionalString(finalRecord.tranId),
      transactionNumber: asOptionalString(finalRecord.transactionNumber),
      total: parseNumber(finalRecord.total),
      unapplied: parseNumber(finalRecord.unapplied),
      applied: parseNumber(finalRecord.applied),
      currencyName: getReferenceRefName(finalRecord.currency),
      vendorName: getReferenceRefName(finalRecord.entity),
      tranDate: asOptionalString(finalRecord.tranDate),
    },
    analysisWindow: {
      id: updatedWindow.id,
      analysisItems: updatedWindow.analysisItems.length,
      processedItems: updatedWindow.processedItems.length,
    },
    message: 'Credito de proveedor SAT creado en NetSuite y movido al historico procesado; quedo sin aplicar por regla.',
  }
}

function validateVendorCreditPreview(params: {
  invoice: PreviewInvoice
  rows: PreviewRow[]
  uuid: string
}) {
  if (params.invoice.tipoComprobante !== 'E') {
    throw new SatServiceError(
      `El CFDI ${params.uuid} no es TipoDeComprobante E y no se puede cargar como credito de proveedor.`,
      400,
    )
  }

  if (params.invoice.duplicateStatus !== 'clear') {
    throw new SatServiceError(
      `El credito ${params.uuid} ya tiene indicios de existir en NetSuite y no se puede subir automaticamente.`,
      409,
    )
  }

  const blockingInvoiceIssues = params.invoice.issues.filter(
    (issue) => issue !== UNSUPPORTED_VENDOR_BILL_TYPE_ISSUE,
  )
  if (blockingInvoiceIssues.length > 0) {
    throw new SatServiceError(
      `El credito ${params.uuid} no esta listo para importar: ${blockingInvoiceIssues.join(' ')}`,
      409,
    )
  }

  const rowIssues = params.rows.flatMap((row) => row.issues)
  if (rowIssues.length > 0) {
    throw new SatServiceError(
      `El credito ${params.uuid} tiene lineas con issues pendientes: ${rowIssues.join(' ')}`,
      409,
    )
  }
}

async function buildVendorCreditPayload(params: {
  client: NetSuiteClient
  invoice: PreviewInvoice
  sourceItem: { fecha: string | null; uuid: string | null }
  rows: PreviewRow[]
  defaults: VendorDefaults & {
    vendor: ReferencePayload
    headerAccount: ReferencePayload
  }
}) {
  const payload = await buildVendorBillPayload(params)
  delete payload.terms
  delete payload.approvalStatus
  payload.autoApply = false
  return payload
}

async function resolveRelatedVendorBillForCredit(params: {
  client: NetSuiteClient
  invoice: PreviewInvoice
  defaults: VendorDefaults & {
    vendor: ReferencePayload
    headerAccount: ReferencePayload
  }
}) {
  const relatedUuids = uniqueStrings(
    params.invoice.cfdiRelations
      .filter((relation) => asOptionalString(relation.tipoRelacion) === '01')
      .map((relation) => normalizeUuid(relation.uuid))
      .filter((uuid): uuid is string => Boolean(uuid)),
  )

  if (relatedUuids.length === 0) {
    return null
  }

  const matches = await queryVendorBillsByUuid(params.client, relatedUuids)
  if (matches.length === 0) {
    throw new SatServiceError(
      `El credito ${params.invoice.uuid ?? 'sin UUID'} relaciona ${relatedUuids.join(', ')}, pero no encontre esas facturas en NetSuite.`,
      404,
    )
  }

  const vendorMatches = matches.filter((match) => match.entityId === params.defaults.vendor.id)
  if (vendorMatches.length !== 1) {
    throw new SatServiceError(
      `El credito ${params.invoice.uuid ?? 'sin UUID'} encontro ${matches.length} factura(s) relacionada(s), pero ninguna coincide de forma unica con el proveedor ${params.defaults.vendor.refName ?? params.defaults.vendor.id}.`,
      409,
    )
  }

  const relatedBill = vendorMatches[0]
  const invoiceCurrency = normalizeCurrencyCode(params.invoice.moneda)
  const relatedCurrency = normalizeCurrencyCode(relatedBill.currencyName)
  if (invoiceCurrency && relatedCurrency && invoiceCurrency !== relatedCurrency) {
    throw new SatServiceError(
      `El credito ${params.invoice.uuid ?? 'sin UUID'} esta en ${invoiceCurrency}, pero la factura relacionada ${relatedBill.transactionNumber ?? relatedBill.internalId} esta en ${relatedCurrency}.`,
      409,
    )
  }

  return relatedBill
}

async function queryVendorBillsByUuid(client: NetSuiteClient, normalizedUuids: string[]) {
  const matches: RelatedVendorBillMatch[] = []
  for (const chunk of chunkArray(normalizedUuids, 20)) {
    const inClause = chunk.map(toSuiteQlString).join(', ')
    const response = await client.suiteql(
      `
SELECT
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.foreigntotal,
  transaction.entity,
  BUILTIN.DF(transaction.entity) AS vendorName,
  transaction.currency,
  BUILTIN.DF(transaction.currency) AS currencyName
FROM transaction
WHERE transaction.type = 'VendBill'
  AND (
    UPPER(NVL(transaction.custbody_mx_cfdi_uuid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.custbody_mx_inbound_bill_uuid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.tranid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.externalid, '')) IN (${inClause})
  )
      `.trim(),
      100,
      0,
    )

    matches.push(
      ...readSuiteQlItems(response.json).map((item) => ({
        internalId: asOptionalString(item.id) ?? '',
        transactionNumber: asOptionalString(item.transactionnumber),
        tranId: asOptionalString(item.tranid),
        transactionDate: asOptionalString(item.trandate),
        total: parseNumber(item.foreigntotal),
        entityId: asOptionalString(item.entity),
        vendorName: asOptionalString(item.vendorname),
        currencyId: asOptionalString(item.currency),
        currencyName: asOptionalString(item.currencyname),
      })),
    )
  }

  return matches.filter((match) => match.internalId)
}

function buildVendorCreditNoApplicationResult(params: {
  relatedBill: RelatedVendorBillMatch | null
  freshRecord: Record<string, unknown>
}) {
  if (!params.relatedBill) {
    return {
      applied: false,
      amount: 0,
      reason: 'missing_related_cfdi' as const,
      message: 'El XML no trae CfdiRelacionado tipo 01; por regla se deja el credito sin aplicar.',
      freshRecord: params.freshRecord,
    }
  }

  return {
    applied: false,
    amount: 0,
    reason: 'application_disabled' as const,
    message: `El XML relaciona la factura ${
      params.relatedBill.transactionNumber ?? params.relatedBill.tranId ?? params.relatedBill.internalId
    }, pero por regla SAT el credito se deja sin aplicar.`,
    freshRecord: params.freshRecord,
  }
}

async function buildVendorBillPayload(params: {
  client: NetSuiteClient
  invoice: PreviewInvoice
  sourceItem: { fecha: string | null; uuid: string | null }
  rows: PreviewRow[]
  defaults: VendorDefaults & {
    vendor: ReferencePayload
    headerAccount: ReferencePayload
  }
}) {
  const uuid = params.sourceItem.uuid ?? params.invoice.uuid
  if (!uuid) {
    throw new SatServiceError('La factura SAT no tiene UUID y no se puede cargar a NetSuite.', 400)
  }

  const tranDate = toNetSuiteDateString(params.sourceItem.fecha)
  if (!tranDate) {
    throw new SatServiceError(`La factura ${uuid} no tiene una fecha valida para NetSuite.`, 400)
  }

  const expenseItems = await buildVendorBillExpenseItems(params)

  const payload: Record<string, unknown> = {
    entity: params.defaults.vendor,
    account: params.defaults.headerAccount,
    tranDate,
    tranId: uuid,
    externalId: uuid,
    memo: params.invoice.serieFolio ?? uuid,
    exchangeRate: params.invoice.tipoCambio,
    custbody_mx_cfdi_uuid: uuid,
    custbody_mx_inbound_bill_uuid: uuid,
    expense: {
      items: expenseItems,
    },
  }

  if (params.defaults.subsidiary) {
    payload.subsidiary = params.defaults.subsidiary
  }

  if (params.defaults.currency) {
    payload.currency = params.defaults.currency
  }

  if (params.defaults.terms) {
    payload.terms = params.defaults.terms
  }

  if (params.defaults.approvalStatus) {
    payload.approvalStatus = params.defaults.approvalStatus
  }

  return payload
}

async function buildVendorBillExpenseItems(params: {
  client: NetSuiteClient
  invoice: PreviewInvoice
  sourceItem: { fecha: string | null; uuid: string | null }
  rows: PreviewRow[]
  defaults: VendorDefaults & {
    vendor: ReferencePayload
    headerAccount: ReferencePayload
  }
}) {
  const uuid = params.sourceItem.uuid ?? params.invoice.uuid
  if (!uuid) {
    throw new SatServiceError('La factura SAT no tiene UUID y no se puede cargar a NetSuite.', 400)
  }

  const expenseItems = []
  for (const row of params.rows) {
    if (!row.cuentaGastos) {
      throw new SatServiceError(
        `La factura ${uuid} contiene una linea sin cuenta contable homologada.`,
        400,
      )
    }

    const account = await resolveAccountReference(params.client, row.cuentaGastos)
    const taxCode = await resolveTaxCodeReference(params.client, row.ivaTipo)

    const expenseLine: Record<string, unknown> = {
      account,
      amount: roundToTwoDecimals(row.importe),
      grossAmt: roundToTwoDecimals(row.monto),
      tax1Amt: roundToTwoDecimals(row.importeTraslado),
      memo: row.descripcion ?? params.invoice.serieFolio ?? uuid,
      taxCode,
      isBillable: false,
    }

    if (params.defaults.department) {
      expenseLine.department = params.defaults.department
    }

    if (params.defaults.location) {
      expenseLine.location = params.defaults.location
    }

    if (params.defaults.classRef) {
      expenseLine.class = params.defaults.classRef
    }

    expenseItems.push(expenseLine)
  }

  return expenseItems
}

async function ensureAutoResolvedVendorForInvoice(params: {
  client: NetSuiteClient
  invoice: PreviewInvoice
  rows: PreviewRow[]
  dryRun: boolean
}): Promise<AutoResolvedVendor | null> {
  if (params.invoice.proveedorNetsuite) {
    return null
  }

  const uberCandidate = classifySatUberProviderCandidate({
    nombreEmisor: params.invoice.nombreEmisor,
    rfcEmisor: params.invoice.rfcEmisor,
    concepts: params.rows
      .filter((row) => row.lineType === 'normal')
      .map((row) => ({ claveProdServ: row.claveProdServ })),
  }) ?? buildGenericNuevoProveedorCandidate({
    invoice: params.invoice,
    rows: params.rows,
  })
  if (!uberCandidate) {
    return null
  }

  const existingVendor = await findVendorCatalogItem({
    providerName: null,
    providerRfc: uberCandidate.rfcEmisor,
  })
  if (existingVendor?.internalId) {
    if (!params.dryRun) {
      await upsertSatManualProviderHomologation({
        nombreEmisor: params.invoice.nombreEmisor,
        emisorRfc: params.invoice.rfcEmisor,
        supplierInternalId: existingVendor.internalId,
        ccDisplayName: uberCandidate.defaultPayablesAccount,
        saveByName: true,
        saveByRfc: true,
      })

      vendorReferenceCache.clear()
    }
    return {
      vendor: {
        id: existingVendor.internalId,
        refName: existingVendor.displayName || existingVendor.entityId || existingVendor.companyName,
      },
      createdVendor: {
        internalId: existingVendor.internalId,
        displayName:
          existingVendor.displayName || existingVendor.entityId || existingVendor.companyName || 'Uber',
        scenario: uberCandidate.scenario,
        created: false,
      },
    }
  }

  if (params.dryRun) {
    throw new SatServiceError(
      `La factura ${params.invoice.uuid ?? params.invoice.rfcEmisor ?? 'sin UUID'} requiere crear primero un proveedor SAT automatico en NetSuite; el dry run no crea proveedores nuevos.`,
      409,
    )
  }

  const createdVendor = await createSatUberVendor({
    client: params.client,
    invoice: params.invoice,
    candidate: uberCandidate,
  })

  return {
    vendor: createdVendor.vendor,
    createdVendor: createdVendor.summary,
  }
}

function buildGenericNuevoProveedorCandidate(params: {
  invoice: PreviewInvoice
  rows: PreviewRow[]
}) {
  const normalRows = params.rows.filter((row) => row.lineType === 'normal')
  if (normalRows.length === 0 || normalRows.some((row) => !row.cuentaGastos)) {
    return null
  }

  return buildSatNuevoProveedorCandidate({
    nombreEmisor: params.invoice.nombreEmisor,
    rfcEmisor: params.invoice.rfcEmisor,
    defaultExpenseAccount: normalRows[0].cuentaGastos,
  })
}

async function resolveVendorBillDefaults(
  client: NetSuiteClient,
  invoice: PreviewInvoice,
  forcedVendor: ReferencePayload | null = null,
) {
  const vendor =
    forcedVendor ??
    (await resolveVendorReference(client, {
      providerName: invoice.proveedorNetsuite,
      providerRfc: invoice.rfcEmisor,
    }))
  const headerAccount = await resolveAccountReference(
    client,
    invoice.cc ?? '201-02-00 Proveedores : Proveedores nacionales',
  )
  const vendorRecord = (await client.getRecord('vendor', vendor.id)).json as Record<string, unknown>
  const latestVendorBillDefaults = await loadLatestVendorBillDefaults(client, vendor.id)
  const vendorCurrencies = await loadVendorCurrencyReferences(client, vendor.id)
  const fallbackClassId = asOptionalString(process.env.NETSUITE_SAT_VENDOR_BILL_CLASS_ID)
  const department = await resolveNamedReference(client, {
    recordType: 'department',
    fieldName: 'name',
    expectedValue: REQUIRED_SAT_VENDOR_BILL_DEPARTMENT_NAME,
    label: 'departamento',
  })
  const location = await resolveNamedReference(client, {
    recordType: 'location',
    fieldName: 'name',
    expectedValue: REQUIRED_SAT_VENDOR_BILL_LOCATION_NAME,
    label: 'ubicacion',
  })

  const currency = resolveCurrencyReference({
    invoiceCurrency: invoice.moneda,
    vendorCurrencies,
    vendorCurrency: toReferencePayload(vendorRecord.currency),
    latestVendorBillCurrency: latestVendorBillDefaults.currency,
  })

  return {
    vendor,
    headerAccount,
    subsidiary:
      latestVendorBillDefaults.subsidiary ??
      toReferencePayload(vendorRecord.subsidiary) ??
      toReferencePayloadWithId('1'),
    currency,
    terms: latestVendorBillDefaults.terms ?? toReferencePayload(vendorRecord.terms),
    approvalStatus: latestVendorBillDefaults.approvalStatus,
    department,
    location,
    classRef: latestVendorBillDefaults.classRef ?? toReferencePayloadWithId(fallbackClassId),
  }
}

function resolveCurrencyReference(params: {
  invoiceCurrency: string
  vendorCurrencies: ReferencePayload[]
  vendorCurrency: ReferencePayload | null
  latestVendorBillCurrency: ReferencePayload | null
}) {
  const invoiceCurrency = normalizeCurrencyCode(params.invoiceCurrency)
  if (!invoiceCurrency) {
    throw new SatServiceError('La factura SAT no trae una moneda valida para NetSuite.', 400)
  }

  const vendorCurrencyFromList = params.vendorCurrencies.find(
    (item) => normalizeCurrencyCode(item.refName) === invoiceCurrency,
  )
  if (vendorCurrencyFromList) {
    return vendorCurrencyFromList
  }

  const vendorCurrency = params.vendorCurrency
  if (vendorCurrency && normalizeCurrencyCode(vendorCurrency.refName) === invoiceCurrency) {
    return vendorCurrency
  }

  const latestCurrency = params.latestVendorBillCurrency
  if (latestCurrency && normalizeCurrencyCode(latestCurrency.refName) === invoiceCurrency) {
    return latestCurrency
  }

  const supportedCurrencies = params.vendorCurrencies
    .map((item) => normalizeCurrencyCode(item.refName))
    .filter((item): item is string => Boolean(item))
  const vendorCurrencyName = normalizeCurrencyCode(params.vendorCurrency?.refName)
  const latestCurrencyName = normalizeCurrencyCode(params.latestVendorBillCurrency?.refName)

  throw new SatServiceError(
    `No pude resolver la moneda ${params.invoiceCurrency} para el vendor bill de NetSuite. ` +
      `Monedas proveedor: ${supportedCurrencies.join(', ') || '--'}. ` +
      `Moneda principal vendor: ${vendorCurrencyName ?? '--'}. ` +
      `Ultimo vendor bill: ${latestCurrencyName ?? '--'}.`,
    400,
  )
}

async function loadLatestVendorBillDefaults(client: NetSuiteClient, vendorId: string) {
  const response = await client.suiteql(
    `
SELECT id, trandate
FROM transaction
WHERE type = 'VendBill'
  AND entity = ${toSuiteQlNumber(vendorId)}
ORDER BY trandate DESC, id DESC
    `.trim(),
    1,
    0,
  )
  const items = readSuiteQlItems(response.json)
  const recordId = asOptionalString(items[0]?.id)
  if (!recordId) {
    return {
      subsidiary: null,
      currency: null,
      terms: null,
      approvalStatus: null,
      department: null,
      location: null,
      classRef: null,
    }
  }

  const vendorBill = (await client.getRecord('vendorBill', recordId, { expandSubResources: true }))
    .json as Record<string, unknown>
  const expenseItems = getSublistItems(vendorBill.expense)
  const firstExpenseLine = getNullableRecord(expenseItems[0])

  return {
    subsidiary: toReferencePayload(vendorBill.subsidiary),
    currency: toReferencePayload(vendorBill.currency),
    terms: toReferencePayload(vendorBill.terms),
    approvalStatus: toReferencePayload(vendorBill.approvalStatus),
    department: toReferencePayload(firstExpenseLine?.department),
    location: toReferencePayload(firstExpenseLine?.location),
    classRef: toReferencePayload(firstExpenseLine?.class),
  }
}

async function loadVendorCurrencyReferences(client: NetSuiteClient, vendorId: string) {
  const cached = vendorCurrencyReferenceCache.get(vendorId)
  if (cached) {
    return cached
  }

  const currencyList = (
    await client.getRecordSubresource('vendor', vendorId, 'currencyList', {
      expandSubResources: true,
    })
  ).json
  const resolved = getSublistItems(currencyList)
    .map((item) => toReferencePayload(item.currency))
    .filter((item): item is ReferencePayload => Boolean(item?.id))

  vendorCurrencyReferenceCache.set(vendorId, resolved)
  return resolved
}

async function createSatUberVendor(params: {
  client: NetSuiteClient
  invoice: PreviewInvoice
  candidate: NonNullable<ReturnType<typeof classifySatUberProviderCandidate>>
}) {
  const draft = buildSatUberVendorDraft(params.candidate)
  const templateVendor = await loadSatUberTemplateVendor(params.client)
  const expenseAccount = await resolveAccountReference(
    params.client,
    params.candidate.defaultExpenseAccount,
  )
  const payablesAccount = await resolveAccountReference(
    params.client,
    params.candidate.defaultPayablesAccount,
  )
  const vendorCategory = await resolveSimpleNamedReference(params.client, {
    recordType: 'vendorcategory',
    expectedValue: SAT_UBER_VENDOR_CATEGORY_NAME,
    label: 'categoria del proveedor automatico',
  })
  const procedencia = await resolveSimpleNamedReference(params.client, {
    recordType: 'customlist_dst_typevendor',
    expectedValue: SAT_UBER_VENDOR_PROCEDENCIA_NAME,
    label: 'procedencia del proveedor automatico',
  })
  const terms =
    toReferencePayload(templateVendor.terms) ??
    (await resolveSimpleNamedReference(params.client, {
      recordType: 'term',
      expectedValue: 'Contra Entrega',
      label: 'terminos del proveedor automatico',
    }))
  const taxItem = await resolveTaxCodeReference(params.client, 'VAT_MX:IVA:IVA Compras 16%')
  const payload: Record<string, unknown> = {
    isPerson: draft.isPerson,
    autoName: false,
    entityId: draft.entityId,
    companyName: draft.companyName,
    legalName: draft.legalName,
    custentity_mx_rfc: params.candidate.rfcEmisor,
    category: vendorCategory,
    custentity_shq_pais_proveedor:
      toReferencePayload(templateVendor.custentity_shq_pais_proveedor) ?? { id: 'MX', refName: 'México' },
    custentity_dst_procedencia: procedencia,
    expenseAccount,
    payablesAccount,
    currency: toReferencePayload(templateVendor.currency) ?? { id: '1', refName: 'MXN' },
    terms,
    taxItem,
    customForm: toReferencePayload(templateVendor.customForm),
    subsidiary: toReferencePayload(templateVendor.subsidiary) ?? toReferencePayloadWithId('1'),
  }

  if (draft.isPerson) {
    payload.firstName = draft.firstName
    payload.lastName = draft.lastName
  }

  const createResponse = await params.client.createRecord('vendor', payload)
  const createdRecordId = normalizeCreatedRecordId(
    asOptionalString((createResponse.json as Record<string, unknown>)?.id) ??
      parseRecordIdFromLocation(createResponse.location),
  )
  if (!createdRecordId) {
    throw new SatServiceError(
      `NetSuite acepto el alta automatica del proveedor ${params.candidate.rfcEmisor}, pero no devolvio internalId.`,
      502,
    )
  }

  const syncedCatalog = await syncNetSuiteEntityCatalog('suppliers')
  const syncedVendor =
    syncedCatalog.items.find((item) => item.internalId === createdRecordId) ??
    syncedCatalog.items.find((item) => normalizeRfc(item.rfc) === params.candidate.rfcEmisor)
  if (!syncedVendor?.internalId) {
    throw new SatServiceError(
      `Cree el proveedor automatico ${params.candidate.rfcEmisor}, pero no pude encontrarlo en el catalogo local despues del sync.`,
      502,
    )
  }

  await upsertSatManualProviderHomologation({
    nombreEmisor: params.invoice.nombreEmisor,
    emisorRfc: params.invoice.rfcEmisor,
    supplierInternalId: syncedVendor.internalId,
    ccDisplayName: params.candidate.defaultPayablesAccount,
    saveByName: true,
    saveByRfc: true,
  })

  vendorReferenceCache.clear()
  return {
    vendor: {
      id: syncedVendor.internalId,
      refName: syncedVendor.displayName || syncedVendor.entityId || syncedVendor.companyName || draft.companyName,
    },
    summary: {
      internalId: syncedVendor.internalId,
      displayName:
        syncedVendor.displayName || syncedVendor.entityId || syncedVendor.companyName || draft.companyName,
      scenario: params.candidate.scenario,
      created: true,
    },
  }
}

async function loadSatUberTemplateVendor(client: NetSuiteClient) {
  if (satUberTemplateVendorCache) {
    return satUberTemplateVendorCache
  }

  const record = (
    await client.getRecord('vendor', SAT_UBER_TEMPLATE_VENDOR_ID, { expandSubResources: true })
  ).json as Record<string, unknown>
  if (!asOptionalString(record.id)) {
    throw new SatServiceError(
      `No pude cargar el vendor template Uber ${SAT_UBER_TEMPLATE_VENDOR_ID} en NetSuite.`,
      404,
    )
  }

  satUberTemplateVendorCache = record
  return record
}

async function findVendorCatalogItem(params: {
  providerName: string | null
  providerRfc: string | null
}) {
  const normalizedName = normalizeComparisonKey(params.providerName)
  const normalizedRfc = normalizeRfc(params.providerRfc)
  if (!normalizedName && !normalizedRfc) {
    return null
  }

  const vendors = await loadOrSyncNetSuiteEntityCatalog('suppliers')

  if (normalizedRfc) {
    const byRfc = vendors.find((item) => normalizeRfc(item.rfc) === normalizedRfc)
    if (byRfc) {
      return byRfc
    }
  }

  if (!normalizedName) {
    return null
  }

  return (
    vendors.find((item) => normalizeComparisonKey(item.displayName) === normalizedName) ??
    vendors.find((item) => normalizeComparisonKey(item.entityId) === normalizedName) ??
    vendors.find((item) => normalizeComparisonKey(item.companyName) === normalizedName) ??
    vendors.find((item) => normalizeComparisonKey(item.altName) === normalizedName) ??
    null
  )
}

async function resolveVendorReference(
  client: NetSuiteClient,
  params: {
    providerName: string | null
    providerRfc: string | null
  },
) {
  const normalizedName = normalizeComparisonKey(params.providerName)
  const normalizedRfc = normalizeRfc(params.providerRfc)
  if (!normalizedName && !normalizedRfc) {
    throw new SatServiceError('La factura SAT no tiene Proveedor Netsuite homologado.', 400)
  }

  if (normalizedRfc) {
    const cached = vendorReferenceCache.get(`rfc:${normalizedRfc}`)
    if (cached) {
      return cached
    }
  }

  if (normalizedName) {
    const cached = vendorReferenceCache.get(`name:${normalizedName}`)
    if (cached) {
      return cached
    }
  }

  const activeVendor = await findVendorCatalogItem(params)

  if (!activeVendor?.internalId) {
    throw new SatServiceError(
      `No pude encontrar en NetSuite al proveedor homologado ${params.providerName ?? params.providerRfc ?? 'sin nombre'}.`,
      404,
    )
  }

  const resolved = {
    id: activeVendor.internalId,
    refName:
      activeVendor.displayName ||
      activeVendor.entityId ||
      activeVendor.companyName ||
      params.providerName ||
      activeVendor.internalId,
  }
  if (normalizedRfc) {
    vendorReferenceCache.set(`rfc:${normalizedRfc}`, resolved)
  }
  if (normalizedName) {
    vendorReferenceCache.set(`name:${normalizedName}`, resolved)
  }
  return resolved
}

async function resolveAccountReference(_client: NetSuiteClient, accountName: string) {
  const sanitizedAccountName = sanitizeRawAccountName(accountName)
  const normalizedName = normalizeComparisonKey(sanitizedAccountName)
  if (!normalizedName) {
    throw new SatServiceError('No recibi una cuenta contable valida para NetSuite.', 400)
  }

  const cached = accountReferenceCache.get(normalizedName)
  if (cached) {
    return cached
  }

  const accountCode = extractAccountCode(sanitizedAccountName)
  const accounts = await loadOrSyncNetSuiteAccountCatalog()
  const matchedAccount =
    accounts.find((item) => normalizeComparisonKey(item.displayName) === normalizedName) ??
    accounts.find((item) => accountCode && extractAccountCode(item.displayName) === accountCode)

  if (!matchedAccount?.internalId) {
    throw new SatServiceError(
      `No pude encontrar la cuenta ${accountName} en NetSuite.`,
      404,
    )
  }

  const resolved = {
    id: matchedAccount.internalId,
    refName: matchedAccount.displayName || accountName,
  }
  accountReferenceCache.set(normalizedName, resolved)
  return resolved
}

async function resolveTaxCodeReference(client: NetSuiteClient, previewTaxCode: string) {
  const normalizedPreviewTaxCode = previewTaxCode.trim()
  if (!normalizedPreviewTaxCode) {
    throw new SatServiceError('La linea SAT no tiene un impuesto valido para NetSuite.', 400)
  }

  const cached = taxCodeReferenceCache.get(normalizedPreviewTaxCode)
  if (cached) {
    return cached
  }

  const netSuiteItemId = PREVIEW_TAX_CODE_TO_NETSUITE_ITEM_ID[normalizedPreviewTaxCode]
  if (!netSuiteItemId) {
    throw new SatServiceError(
      `No tengo un mapeo de taxCode de NetSuite para ${previewTaxCode}.`,
      400,
    )
  }

  const response = await client.suiteql(
    `
SELECT id, itemid
FROM salestaxitem
WHERE UPPER(itemid) = UPPER(${toSuiteQlString(netSuiteItemId)})
ORDER BY id ASC
    `.trim(),
    10,
    0,
  )
  const items = readSuiteQlItems(response.json)
  const taxCodeId = asOptionalString(items[0]?.id)
  if (!taxCodeId) {
    throw new SatServiceError(
      `No pude encontrar en NetSuite el taxCode ${netSuiteItemId}.`,
      404,
    )
  }

  const resolved = {
    id: taxCodeId,
    refName: asOptionalString(items[0]?.itemid) ?? netSuiteItemId,
  }
  taxCodeReferenceCache.set(normalizedPreviewTaxCode, resolved)
  return resolved
}

async function resolveSimpleNamedReference(
  client: NetSuiteClient,
  params: {
    recordType: 'vendorcategory' | 'customlist_dst_typevendor' | 'term'
    expectedValue: string
    label: string
  },
) {
  const normalizedExpectedValue = normalizeComparisonKey(params.expectedValue)
  if (!normalizedExpectedValue) {
    throw new SatServiceError(`No recibi un ${params.label} valido para el proveedor automatico.`, 400)
  }

  const cacheKey = `${params.recordType}:name:${normalizedExpectedValue}`
  const cached = namedReferenceCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const response = await client.suiteql(
    `
SELECT id, name AS refName
FROM ${params.recordType}
WHERE UPPER(name) = UPPER(${toSuiteQlString(params.expectedValue)})
ORDER BY id ASC
    `.trim(),
    20,
    0,
  )
  const items = readSuiteQlItems(response.json)
  const activeItem = items[0] ?? null
  const referenceId = asOptionalString(activeItem?.id)
  const referenceName = asOptionalString(activeItem?.refname)

  if (!referenceId || !referenceName) {
    throw new SatServiceError(
      `No pude encontrar el ${params.label} ${params.expectedValue} en NetSuite.`,
      404,
    )
  }

  const resolved = {
    id: referenceId,
    refName: referenceName,
  }
  namedReferenceCache.set(cacheKey, resolved)
  return resolved
}

async function resolveNamedReference(
  client: NetSuiteClient,
  params: {
    recordType: 'department' | 'location'
    fieldName: 'name'
    expectedValue: string
    label: string
  },
) {
  const normalizedExpectedValue = normalizeComparisonKey(params.expectedValue)
  if (!normalizedExpectedValue) {
    throw new SatServiceError(`No recibi un ${params.label} fijo valido para el upload SAT.`, 400)
  }

  const cacheKey = `${params.recordType}:${params.fieldName}:${normalizedExpectedValue}`
  const cached = namedReferenceCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const response = await client.suiteql(
    `
SELECT id, ${params.fieldName} AS refName, isinactive
FROM ${params.recordType}
WHERE UPPER(${params.fieldName}) = UPPER(${toSuiteQlString(params.expectedValue)})
ORDER BY CASE WHEN isinactive = 'F' THEN 0 ELSE 1 END, id ASC
    `.trim(),
    20,
    0,
  )
  const items = readSuiteQlItems(response.json)
  const activeItem =
    items.find((item) => asOptionalString(item.isinactive)?.toUpperCase() === 'F') ?? items[0] ?? null
  const referenceId = asOptionalString(activeItem?.id)
  const referenceName = asOptionalString(activeItem?.refname)

  if (!referenceId || !referenceName) {
    throw new SatServiceError(
      `No pude encontrar el ${params.label} ${params.expectedValue} en NetSuite.`,
      404,
    )
  }

  if (asOptionalString(activeItem?.isinactive)?.toUpperCase() === 'T') {
    throw new SatServiceError(
      `El ${params.label} ${params.expectedValue} existe en NetSuite, pero esta inactivo.`,
      409,
    )
  }

  const resolved = {
    id: referenceId,
    refName: referenceName,
  }
  namedReferenceCache.set(cacheKey, resolved)
  return resolved
}

async function queryExistingVendorBillsByUuid(client: NetSuiteClient, normalizedUuid: string) {
  const inClause = toSuiteQlString(normalizedUuid)
  const response = await client.suiteql(
    `
SELECT
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.foreigntotal,
  BUILTIN.DF(transaction.entity) AS vendorName,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.externalid,
  transaction.custbody_mx_cfdi_uuid AS mxCfdiUuid,
  transaction.custbody_mx_inbound_bill_uuid AS inboundUuid
FROM transaction
WHERE transaction.type IN ('VendBill', 'VendCred')
  AND (
    UPPER(NVL(transaction.custbody_mx_cfdi_uuid, '')) = ${inClause}
    OR UPPER(NVL(transaction.custbody_mx_inbound_bill_uuid, '')) = ${inClause}
    OR UPPER(NVL(transaction.tranid, '')) = ${inClause}
    OR UPPER(NVL(transaction.externalid, '')) = ${inClause}
  )
    `.trim(),
    20,
    0,
  )

  return readSuiteQlItems(response.json).map((item) => ({
    internalId: asOptionalString(item.id) ?? '',
    transactionNumber: asOptionalString(item.transactionnumber),
    tranId: asOptionalString(item.tranid),
    vendorName: asOptionalString(item.vendorname),
    transactionDate: asOptionalString(item.trandate),
    total: parseNumber(item.foreigntotal),
    currencyName: asOptionalString(item.currencyname),
    matchType: 'uuid-field' as const,
  }))
}

function assertExactDuplicatesMatchInvoiceTotal(params: {
  uuid: string
  invoice: PreviewInvoice
  duplicates: SatAnalysisNetSuiteMatch[]
}) {
  const expectedTotal = roundToTwoDecimals(params.invoice.totalXml)
  const mismatch = params.duplicates.find((duplicate) => {
    if (duplicate.total === null) {
      return true
    }

    return roundToTwoDecimals(Math.abs(duplicate.total)) !== expectedTotal
  })

  if (!mismatch) {
    return
  }

  const duplicateLabel =
    mismatch.transactionNumber ?? mismatch.tranId ?? mismatch.internalId ?? 'registro existente'
  const duplicateTotal =
    mismatch.total === null ? 'sin total legible' : roundToTwoDecimals(Math.abs(mismatch.total)).toFixed(2)
  throw new SatServiceError(
    `La factura ${params.uuid} ya existe en NetSuite (${duplicateLabel}), pero el total ${duplicateTotal} no cuadra contra el XML ${expectedTotal.toFixed(2)}; no se mueve a historico hasta repararla.`,
    409,
  )
}

function getSublistItems(value: unknown) {
  const record = getNullableRecord(value)
  if (!record) {
    return [] as Array<Record<string, unknown>>
  }

  const items = record.items
  if (!Array.isArray(items)) {
    return []
  }

  return items.map((item) => getNullableRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
}

function validateVendorBillPayload(params: {
  invoice: PreviewInvoice
  uuid: string
  payload: Record<string, unknown>
}) {
  const entity = toReferencePayload(params.payload.entity)
  const account = toReferencePayload(params.payload.account)
  const subsidiary = toReferencePayload(params.payload.subsidiary)
  const currency = toReferencePayload(params.payload.currency)
  const tranDate = asOptionalString(params.payload.tranDate)
  const tranId = normalizeUuid(asOptionalString(params.payload.tranId))
  const externalId = normalizeUuid(asOptionalString(params.payload.externalId))
  const cfdiUuid = normalizeUuid(asOptionalString(params.payload.custbody_mx_cfdi_uuid))
  const inboundUuid = normalizeUuid(asOptionalString(params.payload.custbody_mx_inbound_bill_uuid))
  const expenseItems = getSublistItems(params.payload.expense)

  if (!entity?.id) {
    throw new SatServiceError(`La factura ${params.uuid} no tiene proveedor NetSuite valido.`, 400)
  }

  if (!account?.id) {
    throw new SatServiceError(`La factura ${params.uuid} no tiene cuenta de proveedor valida.`, 400)
  }

  if (!subsidiary?.id) {
    throw new SatServiceError(`La factura ${params.uuid} no tiene subsidiaria valida para NetSuite.`, 400)
  }

  if (!currency?.id) {
    throw new SatServiceError(`La factura ${params.uuid} no tiene moneda valida para NetSuite.`, 400)
  }

  if (!tranDate) {
    throw new SatServiceError(`La factura ${params.uuid} no tiene fecha valida para NetSuite.`, 400)
  }

  if (tranId !== params.uuid || externalId !== params.uuid) {
    throw new SatServiceError(
      `La factura ${params.uuid} no conserva el UUID en tranId/externalId del payload.`,
      400,
    )
  }

  if (cfdiUuid !== params.uuid || inboundUuid !== params.uuid) {
    throw new SatServiceError(
      `La factura ${params.uuid} no conserva el UUID en los campos CFDI obligatorios.`,
      400,
    )
  }

  if (expenseItems.length === 0) {
    throw new SatServiceError(`La factura ${params.uuid} no contiene lineas de gasto para subir.`, 400)
  }

  expenseItems.forEach((item, index) => {
    const lineNumber = index + 1
    const account = toReferencePayload(item.account)
    const taxCode = toReferencePayload(item.taxCode)
    const department = toReferencePayload(item.department)
    const location = toReferencePayload(item.location)
    const amount = parseNumber(item.amount)
    const memo = asOptionalString(item.memo)

    if (!account?.id) {
      throw new SatServiceError(
        `La factura ${params.uuid} tiene la linea ${lineNumber} sin cuenta contable valida.`,
        400,
      )
    }

    if (amount === null) {
      throw new SatServiceError(
        `La factura ${params.uuid} tiene la linea ${lineNumber} sin importe valido.`,
        400,
      )
    }

    if (!memo) {
      throw new SatServiceError(
        `La factura ${params.uuid} tiene la linea ${lineNumber} sin memo descriptivo.`,
        400,
      )
    }

    if (!taxCode?.id) {
      throw new SatServiceError(
        `La factura ${params.uuid} tiene la linea ${lineNumber} sin tax code valido.`,
        400,
      )
    }

    if (!department?.id) {
      throw new SatServiceError(
        `La factura ${params.uuid} tiene la linea ${lineNumber} sin departamento obligatorio.`,
        400,
      )
    }

    if (!location?.id) {
      throw new SatServiceError(
        `La factura ${params.uuid} tiene la linea ${lineNumber} sin ubicacion obligatoria.`,
        400,
      )
    }
  })
}

function validateCreatedVendorBill(params: {
  recordId: string
  expectedUuid: string
  invoice: PreviewInvoice
  freshRecord: Record<string, unknown>
}) {
  const createdTotal = parseNumber(params.freshRecord.total)
  if (createdTotal === null) {
    throw new SatServiceError(
      `NetSuite creo el vendor bill ${params.recordId}, pero no devolvio un total legible para validar.`,
      502,
    )
  }

  const totalDifference = roundToTwoDecimals(createdTotal - roundToTwoDecimals(params.invoice.totalXml))
  if (totalDifference !== 0) {
    throw new SatServiceError(
      `NetSuite creo el vendor bill ${params.recordId}, pero el total ${createdTotal.toFixed(2)} no cuadra contra el XML ${roundToTwoDecimals(params.invoice.totalXml).toFixed(2)}.`,
      409,
    )
  }

  const createdTranId = normalizeUuid(asOptionalString(params.freshRecord.tranId))
  if (createdTranId !== params.expectedUuid) {
    throw new SatServiceError(
      `NetSuite creo el vendor bill ${params.recordId}, pero el tranId final no conserva el UUID esperado.`,
      409,
    )
  }

  const createdCurrency = normalizeCurrencyCode(getReferenceRefName(params.freshRecord.currency))
  const invoiceCurrency = normalizeCurrencyCode(params.invoice.moneda)
  if (invoiceCurrency && createdCurrency !== invoiceCurrency) {
    throw new SatServiceError(
      `NetSuite creo el vendor bill ${params.recordId}, pero la moneda final ${createdCurrency ?? '--'} no coincide con ${invoiceCurrency}.`,
      409,
    )
  }
}

function validateCreatedVendorCredit(params: {
  recordId: string
  expectedUuid: string
  invoice: PreviewInvoice
  freshRecord: Record<string, unknown>
}) {
  const createdTotal = parseNumber(params.freshRecord.total)
  if (createdTotal === null) {
    throw new SatServiceError(
      `NetSuite creo el vendor credit ${params.recordId}, pero no devolvio un total legible para validar.`,
      502,
    )
  }

  const totalDifference = roundToTwoDecimals(createdTotal - roundToTwoDecimals(params.invoice.totalXml))
  if (totalDifference !== 0) {
    throw new SatServiceError(
      `NetSuite creo el vendor credit ${params.recordId}, pero el total ${createdTotal.toFixed(2)} no cuadra contra el XML ${roundToTwoDecimals(params.invoice.totalXml).toFixed(2)}.`,
      409,
    )
  }

  const createdTranId = normalizeUuid(asOptionalString(params.freshRecord.tranId))
  if (createdTranId !== params.expectedUuid) {
    throw new SatServiceError(
      `NetSuite creo el vendor credit ${params.recordId}, pero el tranId final no conserva el UUID esperado.`,
      409,
    )
  }

  const createdCurrency = normalizeCurrencyCode(getReferenceRefName(params.freshRecord.currency))
  const invoiceCurrency = normalizeCurrencyCode(params.invoice.moneda)
  if (invoiceCurrency && createdCurrency !== invoiceCurrency) {
    throw new SatServiceError(
      `NetSuite creo el vendor credit ${params.recordId}, pero la moneda final ${createdCurrency ?? '--'} no coincide con ${invoiceCurrency}.`,
      409,
    )
  }
}

function toReferencePayload(value: unknown): ReferencePayload | null {
  const record = getNullableRecord(value)
  const id = asOptionalString(record?.id)
  if (!id) {
    return null
  }

  return {
    id,
    refName: asOptionalString(record?.refName) ?? undefined,
  }
}

function toReferencePayloadWithId(id: string | null) {
  if (!id) {
    return null
  }

  return { id }
}

function getReferenceId(value: unknown) {
  return toReferencePayload(value)?.id ?? null
}

function getReferenceRefName(value: unknown) {
  return toReferencePayload(value)?.refName ?? null
}

function getNullableRecord(value: unknown) {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null
}

function readSuiteQlItems(value: unknown) {
  const record = getNullableRecord(value)
  const items = record?.items
  if (!Array.isArray(items)) {
    return [] as Array<Record<string, unknown>>
  }

  return items.map((item) => getNullableRecord(item)).filter((item): item is Record<string, unknown> => Boolean(item))
}

function normalizeUuid(value: string | null | undefined) {
  const normalized = asOptionalString(value)
  return normalized ? normalized.trim().toUpperCase() : null
}

function normalizeCurrencyCode(value: string | null | undefined) {
  const normalized = asOptionalString(value)
  return normalized ? normalized.trim().toUpperCase() : null
}

function normalizeRfc(value: string | null | undefined) {
  const normalized = asOptionalString(value)
  if (!normalized) {
    return null
  }

  return normalized.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeComparisonKey(value: unknown) {
  const normalized = asOptionalString(value)
  if (!normalized) {
    return null
  }

  return normalized
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase()
}

function extractAccountCode(value: string) {
  const match = value.trim().match(/^([0-9-]+)/)
  return match?.[1] ?? null
}

function sanitizeRawAccountName(value: string) {
  return value.replace(/[\u0000-\u001F\u007F-\u009F\uFEFF]/g, '').trim()
}

function loadSatSourceItemForWindow(windowId: string, uuid: string, allowProcessed: boolean) {
  const window = loadSatAnalysisWindows().find((item) => item.id === windowId)
  if (!window) {
    return null
  }

  const pending = window.analysisItems.find((item) => normalizeUuid(item.uuid) === uuid)
  if (pending) {
    return pending
  }

  if (!allowProcessed) {
    return null
  }

  return window.processedItems.find((item) => normalizeUuid(item.uuid) === uuid) ?? null
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function chunkArray<T>(values: T[], size: number) {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

function toNetSuiteDateString(value: string | null | undefined) {
  const normalized = asOptionalString(value)
  if (!normalized) {
    return null
  }

  const parsed = new Date(normalized)
  if (Number.isNaN(parsed.getTime())) {
    return null
  }

  const year = parsed.getFullYear()
  const month = String(parsed.getMonth() + 1).padStart(2, '0')
  const day = String(parsed.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function parseRecordIdFromLocation(location: string | null) {
  if (!location) {
    return null
  }

  const match = location.match(/\/([^/]+)$/)
  return match?.[1] ?? null
}

function normalizeCreatedRecordId(value: string | null) {
  const normalized = asOptionalString(value)
  return normalized ? normalized : null
}

function toSuiteQlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function toSuiteQlNumber(value: string) {
  if (!/^\d+$/.test(value)) {
    throw new SatServiceError(`El id ${value} no es numerico y no puede ir a SuiteQL.`, 400)
  }

  return value
}

function asOptionalString(value: unknown) {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  return null
}

function roundToTwoDecimals(value: number) {
  return Math.round(value * 100) / 100
}
