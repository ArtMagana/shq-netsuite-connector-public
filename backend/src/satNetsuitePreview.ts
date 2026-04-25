import fs from 'node:fs'

import { DOMParser, type Element, type Node } from '@xmldom/xmldom'
import XLSX from 'xlsx'

import { NetSuiteClient } from './netsuiteClient.js'
import { loadOrSyncNetSuiteAccountCatalog } from './netsuiteAccountStore.js'
import { readSatCfdiPackageXmlFiles, type SatPackageXmlFile, SatServiceError } from './sat.js'
import { loadSatManualHomologationOverrides } from './satManualHomologationStore.js'
import { resolveSatRetentionAccount } from './satRetentionAccountStore.js'
import {
  buildSatNuevoProveedorCandidate,
  classifySatUberProviderCandidate,
  SAT_UBER_DEFAULT_PAYABLES_ACCOUNT,
} from './satUberVendors.js'

type WorkbookProviderMapping = {
  nombreProveedor: string | null
  rfc: string | null
  proveedorNetsuite: string | null
  cc: string | null
  sourceRowNumber: number
}

type WorkbookMappings = {
  workbookPath: string
  accountByClave: Map<string, string>
  providerByName: Map<string, WorkbookProviderMapping>
  providerByRfc: Map<string, WorkbookProviderMapping>
  warnings: string[]
}

type ParsedCfdiConcept = {
  conceptIndex: number
  claveProdServ: string | null
  descripcion: string | null
  importe: number
  descuento: number
}

type ParsedCfdiRetention = {
  conceptIndex: number
  rate: number | null
  amount: number
  taxCode: string | null
}

type ParsedCfdiTransfer = {
  conceptIndex: number
  amount: number
  base: number | null
  rate: number | null
  taxCode: string | null
}

type ParsedCfdiLocalTransfer = {
  localTransferIndex: number
  conceptIndex: number | null
  name: string | null
  rate: number | null
  amount: number
}

type ParsedCfdiRelation = {
  tipoRelacion: string | null
  uuid: string | null
}

type ParsedCfdi = {
  fileName: string
  uuid: string | null
  fecha: string | null
  serie: string | null
  folio: string | null
  tipoComprobante: string | null
  moneda: string | null
  tipoCambio: number | null
  subtotal: number
  descuento: number
  total: number
  rfcEmisor: string | null
  nombreEmisor: string | null
  concepts: ParsedCfdiConcept[]
  transfers: ParsedCfdiTransfer[]
  retentions: ParsedCfdiRetention[]
  localTransfers: ParsedCfdiLocalTransfer[]
  relations: ParsedCfdiRelation[]
}

type PreviewProviderMatchSource = 'name' | 'rfc' | 'manual'
type PreviewRowType = 'normal' | 'discount' | 'retention' | 'ieps' | 'local_tax'

type PreviewRow = {
  rowId: string
  uuid: string | null
  conceptIndex: number
  lineType: PreviewRowType
  fecha: string | null
  serieFolio: string | null
  claveProdServ: string | null
  cuentaGastos: string | null
  descripcion: string | null
  nombreEmisor: string | null
  rfcEmisor: string | null
  proveedorNetsuite: string | null
  importe: number
  importeTraslado: number
  monto: number
  ivaTipo: string
  cc: string | null
  tipoCambio: number
  moneda: string
  descuento: number
  providerMatchSource: PreviewProviderMatchSource
  retentionRate: number | null
  issues: string[]
}

type PreviewInvoice = {
  uuid: string | null
  fileName: string
  fecha: string | null
  serieFolio: string | null
  tipoComprobante: string | null
  cfdiRelations: ParsedCfdiRelation[]
  nombreEmisor: string | null
  rfcEmisor: string | null
  proveedorNetsuite: string | null
  providerMatchSource: PreviewProviderMatchSource
  duplicateStatus: 'clear' | 'exact' | 'possible'
  duplicateMatches: NetSuiteDuplicateMatch[]
  cc: string | null
  moneda: string
  tipoCambio: number
  subtotalXml: number
  descuentoXml: number
  totalXml: number
  lineTotalPreview: number
  differenceVsXmlTotal: number
  normalLineCount: number
  discountLineCount: number
  retentionLineCount: number
  totalLineCount: number
  readyToImport: boolean
  issues: string[]
}

type NetSuiteDuplicateMatch = {
  internalId: string
  transactionNumber: string | null
  tranId: string | null
  vendorName: string | null
  transactionDate: string | null
  total: number | null
  currencyName: string | null
  memo: string | null
  otherRefNum: string | null
  externalId: string | null
  mxCfdiUuid: string | null
  inboundUuid: string | null
  matchType: 'uuid-field' | 'tranid' | 'externalid' | 'possible'
}

type NetSuiteDuplicateAssessment = {
  status: 'clear' | 'exact' | 'possible'
  matches: NetSuiteDuplicateMatch[]
  error?: string
}

const TABLAS_SHEET_NAME = 'Tablas'
const MATERIA_PRIMA_CC =
  '201-01-00 Proveedores : Proveedores nacionales de materia prima'
const COMPRAS_ACUMULADAS = 'Compras acumuladas'

export async function previewSatPackageForNetsuite(packageId: string) {
  const mappings = readWorkbookMappings()
  const accountCatalog = await loadOrSyncNetSuiteAccountCatalog()
  const accountByClaveFromNetSuite = buildNetSuiteAccountByClave(accountCatalog)
  const packageFiles = await readSatCfdiPackageXmlFiles(packageId)
  const parsedCfdis = packageFiles
    .map((file) => parseCfdiXml(file))
    .filter((item): item is ParsedCfdi => item !== null)
  const duplicateAssessments = await assessNetSuiteDuplicates(parsedCfdis, mappings)

  const rows: PreviewRow[] = []
  const invoices: PreviewInvoice[] = []

  let normalLineCount = 0
  let discountLineCount = 0
  let retentionLineCount = 0
  let missingExpenseAccountLines = 0
  let unknownRetentionRateLines = 0
  let manualHomologationInvoices = 0
  let invoicesWithDiff = 0
  let exactDuplicateInvoices = 0
  let possibleDuplicateInvoices = 0

  for (const cfdi of parsedCfdis) {
    const providerMatch = matchProvider(cfdi, mappings)
    const tipoComprobante = normalizeCfdiDocumentType(cfdi.tipoComprobante)
    const uberProviderCandidate = classifySatUberProviderCandidate({
      nombreEmisor: cfdi.nombreEmisor,
      rfcEmisor: cfdi.rfcEmisor,
      concepts: cfdi.concepts,
    })
    const duplicateAssessment =
      duplicateAssessments.get(buildDuplicateAssessmentKey(cfdi)) ?? { status: 'clear', matches: [] }
    const providerIssues = new Set<string>()

    if (!providerMatch.mapping && !uberProviderCandidate) {
      providerIssues.add('Proveedor sin homologacion automatica; requiere revision manual.')
    } else {
      if (!providerMatch.mapping?.proveedorNetsuite && !uberProviderCandidate) {
        providerIssues.add('La equivalencia del proveedor no tiene Proveedor Netsuite definido.')
      }
      if (!providerMatch.mapping?.cc && !uberProviderCandidate) {
        providerIssues.add('La equivalencia del proveedor no tiene Cuenta proveedor definida.')
      }
    }

    const providerBaseCc =
      providerMatch.mapping?.cc ??
      (uberProviderCandidate ? uberProviderCandidate.defaultPayablesAccount : null)
    const proveedorNetsuite = providerMatch.mapping?.proveedorNetsuite ?? null
    const moneda = normalizeCurrency(cfdi.moneda)
    const tipoCambio = cfdi.tipoCambio ?? 1
    const serieFolio = buildSerieFolio(cfdi.serie, cfdi.folio)
    const vatTransferByConcept = aggregateTransfersByTaxCode(cfdi.transfers, '002')
    const iepsTransferByConcept = aggregateTransfersByTaxCode(cfdi.transfers, '003')
    const transfersByConcept = groupTransfersByConcept(cfdi.transfers)
    const retentionsByConcept = aggregateRetentions(cfdi.retentions)
    const localTransfersByConcept = groupLocalTransfersByConcept(cfdi.localTransfers)
    const invoiceRows: PreviewRow[] = []
    const invoiceIssues = new Set(providerIssues)
    if (tipoComprobante !== 'I') {
      invoiceIssues.add(
        `TipoDeComprobante ${tipoComprobante ?? 'sin valor'} no se importa como factura proveedor; requiere flujo especifico.`,
      )
    }

    if (cfdi.localTransfers.some((transfer) => transfer.conceptIndex === null)) {
      invoiceIssues.add(
        'El impuesto local trasladado no se pudo asociar a una ClaveProdServ; requiere revision manual.',
      )
    }

    if (providerMatch.source === 'manual') {
      manualHomologationInvoices += 1
    }

    if (duplicateAssessment.status === 'exact') {
      invoiceIssues.add('La factura ya existe en NetSuite con coincidencia exacta.')
      exactDuplicateInvoices += 1
    } else if (duplicateAssessment.status === 'possible') {
      invoiceIssues.add('La factura parece ya existir en NetSuite y requiere revision manual.')
      possibleDuplicateInvoices += 1
    }

    for (const concept of cfdi.concepts) {
      const accountKey = normalizeComparisonKey(concept.claveProdServ)
      const accountFromClave = accountKey ? mappings.accountByClave.get(accountKey) ?? null : null
      const accountFromNetSuiteClave =
        accountKey && !accountFromClave ? accountByClaveFromNetSuite.get(accountKey) ?? null : null
      const finalExpenseAccount =
        providerBaseCc === MATERIA_PRIMA_CC
          ? COMPRAS_ACUMULADAS
          : uberProviderCandidate
            ? uberProviderCandidate.defaultExpenseAccount
            : accountFromClave ?? accountFromNetSuiteClave
      const expenseAccountResolvable = finalExpenseAccount
        ? canResolveNetSuiteAccount(accountCatalog, finalExpenseAccount)
        : false
      const vatTransferAmount = vatTransferByConcept.get(concept.conceptIndex) ?? 0
      const iepsTransferAmount = iepsTransferByConcept.get(concept.conceptIndex) ?? 0

      const normalIssues = buildBaseLineIssues({
        providerMapping: providerMatch.mapping,
        cuentaGastos: finalExpenseAccount,
        cuentaGastosResolvable: expenseAccountResolvable,
        allowAutoUberVendor: Boolean(uberProviderCandidate),
      })
      normalIssues.push(
        ...buildTransferModelIssues({
          concept,
          transfers: transfersByConcept.get(concept.conceptIndex) ?? [],
        }),
      )
      if (normalIssues.includes('Cuenta gastos sin homologacion para la ClaveProdServ.')) {
        missingExpenseAccountLines += 1
      }
      normalIssues.forEach((issue) => invoiceIssues.add(issue))

      invoiceRows.push(
        buildPreviewRow({
          cfdi,
          concept,
          lineType: 'normal',
          fecha: cfdi.fecha ? formatCfdiDate(cfdi.fecha) : null,
          serieFolio,
          moneda,
          tipoCambio,
          proveedorNetsuite,
          providerBaseCc,
          providerMatchSource: providerMatch.source,
          cuentaGastos: finalExpenseAccount,
          importe: concept.importe,
          importeTraslado: vatTransferAmount,
          monto: concept.importe + vatTransferAmount,
          ivaTipo: vatTransferAmount === 0 ? 'VAT_MX:IVA:IVA 0%' : 'VAT_MX:IVA:IVA Compras 16%',
          cc: providerBaseCc,
          retentionRate: null,
          issues: normalIssues,
        }),
      )
      normalLineCount += 1

      if (Math.abs(iepsTransferAmount) > 0.000001) {
        const iepsIssues = buildBaseLineIssues({
          providerMapping: providerMatch.mapping,
          cuentaGastos: finalExpenseAccount,
          cuentaGastosResolvable: expenseAccountResolvable,
          allowAutoUberVendor: Boolean(uberProviderCandidate),
        })
        if (iepsIssues.includes('Cuenta gastos sin homologacion para la ClaveProdServ.')) {
          missingExpenseAccountLines += 1
        }
        iepsIssues.forEach((issue) => invoiceIssues.add(issue))

        invoiceRows.push(
          buildPreviewRow({
            cfdi,
            concept,
            lineType: 'ieps',
            fecha: cfdi.fecha ? formatCfdiDate(cfdi.fecha) : null,
            serieFolio,
            moneda,
            tipoCambio,
            proveedorNetsuite,
            providerBaseCc,
            providerMatchSource: providerMatch.source,
            cuentaGastos: finalExpenseAccount,
            descripcionOverride: `IEPS - ${concept.descripcion ?? concept.claveProdServ ?? 'partida SAT'}`,
            importe: iepsTransferAmount,
            importeTraslado: 0,
            monto: iepsTransferAmount,
            ivaTipo: 'VAT_MX:IVA:IVA 0%',
            cc: providerBaseCc,
            retentionRate: null,
            issues: iepsIssues,
          }),
        )
      }

      const conceptLocalTransfers = localTransfersByConcept.get(concept.conceptIndex) ?? []
      for (const localTransfer of conceptLocalTransfers) {
        const localTaxIssues = buildBaseLineIssues({
          providerMapping: providerMatch.mapping,
          cuentaGastos: finalExpenseAccount,
          cuentaGastosResolvable: expenseAccountResolvable,
          allowAutoUberVendor: Boolean(uberProviderCandidate),
        })
        if (localTaxIssues.includes('Cuenta gastos sin homologacion para la ClaveProdServ.')) {
          missingExpenseAccountLines += 1
        }
        localTaxIssues.forEach((issue) => invoiceIssues.add(issue))

        invoiceRows.push(
          buildPreviewRow({
            cfdi,
            concept,
            lineType: 'local_tax',
            rowKey: `local-${localTransfer.localTransferIndex}`,
            fecha: cfdi.fecha ? formatCfdiDate(cfdi.fecha) : null,
            serieFolio,
            moneda,
            tipoCambio,
            proveedorNetsuite,
            providerBaseCc,
            providerMatchSource: providerMatch.source,
            cuentaGastos: finalExpenseAccount,
            descripcionOverride: buildLocalTransferDescription(localTransfer, concept),
            importe: localTransfer.amount,
            importeTraslado: 0,
            monto: localTransfer.amount,
            ivaTipo: 'VAT_MX:IVA:IVA 0%',
            cc: providerBaseCc,
            retentionRate: null,
            issues: localTaxIssues,
          }),
        )
      }

      if (Math.abs(concept.descuento) > 0.000001) {
        const discountIssues = buildBaseLineIssues({
          providerMapping: providerMatch.mapping,
          cuentaGastos: finalExpenseAccount,
          cuentaGastosResolvable: expenseAccountResolvable,
          allowAutoUberVendor: Boolean(uberProviderCandidate),
        })
        if (discountIssues.includes('Cuenta gastos sin homologacion para la ClaveProdServ.')) {
          missingExpenseAccountLines += 1
        }
        discountIssues.forEach((issue) => invoiceIssues.add(issue))

        invoiceRows.push(
          buildPreviewRow({
            cfdi,
            concept,
            lineType: 'discount',
            fecha: cfdi.fecha ? formatCfdiDate(cfdi.fecha) : null,
            serieFolio,
            moneda,
            tipoCambio,
            proveedorNetsuite,
            providerBaseCc,
            providerMatchSource: providerMatch.source,
            cuentaGastos: finalExpenseAccount,
            importe: -concept.descuento,
            importeTraslado: 0,
            monto: -concept.descuento,
            ivaTipo: 'VAT_MX:IVA:IVA 0%',
            cc: providerBaseCc,
            retentionRate: null,
            issues: discountIssues,
          }),
        )
        discountLineCount += 1
      }

      const conceptRetentions = retentionsByConcept.get(concept.conceptIndex) ?? []
      for (const retention of conceptRetentions) {
        const retentionResolution = resolveSatRetentionAccount({
          taxCode: retention.taxCode,
          rate: retention.rate,
          expenseAccount: finalExpenseAccount,
        })
        const retentionAccount = retentionResolution?.accountName ?? null
        const retentionIssues = buildRetentionLineIssues({
          providerMapping: providerMatch.mapping,
          retentionAccount,
          allowAutoUberVendor: Boolean(uberProviderCandidate),
        })

        if (!retentionAccount) {
          retentionIssues.push(
            'La retencion no tiene cuenta contable configurada para esta tasa.',
          )
          unknownRetentionRateLines += 1
        }

        retentionIssues.forEach((issue) => invoiceIssues.add(issue))

        invoiceRows.push(
          buildPreviewRow({
            cfdi,
            concept,
            lineType: 'retention',
            fecha: cfdi.fecha ? formatCfdiDate(cfdi.fecha) : null,
            serieFolio,
            moneda,
            tipoCambio,
            proveedorNetsuite,
            providerBaseCc,
            providerMatchSource: providerMatch.source,
            cuentaGastos: retentionAccount,
            importe: -retention.amount,
            importeTraslado: 0,
            monto: -retention.amount,
            ivaTipo: 'VAT_MX:IVA:IVA 0%',
            cc: providerBaseCc,
            retentionRate: retention.rate,
            issues: retentionIssues,
          }),
        )
        retentionLineCount += 1
      }
    }

    const sortedRows = sortPreviewRows(invoiceRows)
    const resolvedAutoProviderCandidate =
      uberProviderCandidate ??
      classifySatUberProviderCandidate({
        nombreEmisor: cfdi.nombreEmisor,
        rfcEmisor: cfdi.rfcEmisor,
        concepts: sortedRows
          .filter((row) => row.lineType === 'normal')
          .map((row) => ({ claveProdServ: row.claveProdServ })),
      }) ??
      buildGenericNuevoProveedorCandidate({
        cfdi,
        providerMapping: providerMatch.mapping,
        rows: sortedRows,
      })
    const autoProviderCanOverrideMapping =
      Boolean(resolvedAutoProviderCandidate) &&
      (!providerMatch.mapping?.proveedorNetsuite || !providerMatch.mapping?.cc)
    const resolvedProviderBaseCc =
      providerBaseCc ??
      (resolvedAutoProviderCandidate ? resolvedAutoProviderCandidate.defaultPayablesAccount : null)
    const normalizedRows =
      autoProviderCanOverrideMapping
        ? sortedRows.map((row) => ({
            ...row,
            cc: row.cc ?? resolvedProviderBaseCc,
            issues: stripAutoProviderIssues(row.issues),
          }))
        : sortedRows
    const currencyRows = applyCurrencyRoundingAdjustment(normalizedRows, cfdi.total)
    const lineTotalPreview = roundToCurrency(
      currencyRows.reduce((sum, row) => sum + row.monto, 0),
    )
    const differenceVsXmlTotal = roundToCurrency(lineTotalPreview - roundToCurrency(cfdi.total))
    const currencyDifferenceVsXmlTotal = roundToCurrency(
      roundToCurrency(lineTotalPreview) - roundToCurrency(cfdi.total),
    )
    if (currencyDifferenceVsXmlTotal !== 0) {
      invoiceIssues.add(
        'La suma de las lineas que se subirian a NetSuite no cuadra exactamente contra el total XML.',
      )
      invoicesWithDiff += 1
    }

    const uniqueIssues = autoProviderCanOverrideMapping
      ? stripAutoProviderIssues([...invoiceIssues])
      : [...invoiceIssues]
    rows.push(...currencyRows)
    invoices.push({
      uuid: cfdi.uuid,
      fileName: cfdi.fileName,
      fecha: cfdi.fecha ? formatCfdiDate(cfdi.fecha) : null,
      serieFolio,
      tipoComprobante,
      cfdiRelations: cfdi.relations,
      nombreEmisor: cfdi.nombreEmisor,
      rfcEmisor: cfdi.rfcEmisor,
      proveedorNetsuite,
      providerMatchSource: providerMatch.source,
      duplicateStatus: duplicateAssessment.status,
      duplicateMatches: duplicateAssessment.matches,
      cc: resolvedProviderBaseCc,
      moneda,
      tipoCambio,
      subtotalXml: cfdi.subtotal,
      descuentoXml: cfdi.descuento,
      totalXml: cfdi.total,
      lineTotalPreview,
      differenceVsXmlTotal,
      normalLineCount: currencyRows.filter((row) => row.lineType === 'normal').length,
      discountLineCount: currencyRows.filter((row) => row.lineType === 'discount').length,
      retentionLineCount: currencyRows.filter((row) => row.lineType === 'retention').length,
      totalLineCount: currencyRows.length,
      readyToImport: uniqueIssues.length === 0,
      issues: uniqueIssues,
    })
  }

  return {
    success: true as const,
    generatedAtUtc: new Date().toISOString(),
    packageId,
    workbook: {
      path: mappings.workbookPath,
      warnings: mappings.warnings,
      accountMappings: mappings.accountByClave.size,
      providerNameMappings: mappings.providerByName.size,
      providerRfcMappings: mappings.providerByRfc.size,
    },
    summary: {
      xmlFiles: packageFiles.length,
      parsedInvoices: invoices.length,
      outputLines: rows.length,
      normalLineCount,
      discountLineCount,
      retentionLineCount,
      readyInvoices: invoices.filter((invoice) => invoice.readyToImport).length,
      manualHomologationInvoices,
      missingExpenseAccountLines,
      unknownRetentionRateLines,
      invoicesWithDifferenceWarning: invoicesWithDiff,
      exactDuplicateInvoices,
      possibleDuplicateInvoices,
    },
    invoices,
    rows,
  }
}

function readWorkbookMappings(): WorkbookMappings {
  const workbookPath = resolveConfiguredPath(process.env.SAT_XML_MODEL_WORKBOOK_PATH)
  if (!workbookPath || !fs.existsSync(workbookPath)) {
    throw new SatServiceError(
      'Falta SAT_XML_MODEL_WORKBOOK_PATH o el archivo de equivalencias no existe.',
      503,
    )
  }

  const workbook = XLSX.readFile(workbookPath, {
    raw: false,
    dense: false,
  })
  const sheet = workbook.Sheets[TABLAS_SHEET_NAME]
  if (!sheet) {
    throw new SatServiceError(
      `No existe la hoja ${TABLAS_SHEET_NAME} en el archivo de equivalencias SAT.`,
      503,
    )
  }

  const rows = XLSX.utils.sheet_to_json<Array<string | number | null>>(sheet, {
    header: 1,
    defval: null,
    blankrows: false,
  })

  if (rows.length === 0) {
    throw new SatServiceError('La hoja Tablas del archivo SAT no tiene informacion.', 503)
  }

  const headerRow = rows[0].map((value) => normalizeHeader(value))
  const columnIndexes = {
    clave: findHeaderIndex(headerRow, 'clave'),
    cuentaGastos: findHeaderIndex(headerRow, 'cuenta gastos'),
    nombreProveedor: findHeaderIndex(headerRow, 'nombre proveedor'),
    proveedorNetsuite: findHeaderIndex(headerRow, 'proveedor netsuite'),
    ccNetsuite: findHeaderIndex(headerRow, 'cc netsuite'),
    rfc: findHeaderIndex(headerRow, 'rfc'),
  }

  const accountByClave = new Map<string, string>()
  const providerByName = new Map<string, WorkbookProviderMapping>()
  const providerByRfc = new Map<string, WorkbookProviderMapping>()
  const warnings: string[] = []

  rows.slice(1).forEach((row, rowIndex) => {
    const sourceRowNumber = rowIndex + 2
    const clave = asOptionalString(row[columnIndexes.clave])
    const cuentaGastos = asOptionalString(row[columnIndexes.cuentaGastos])
    const nombreProveedor = asOptionalString(row[columnIndexes.nombreProveedor])
    const proveedorNetsuite = asOptionalString(row[columnIndexes.proveedorNetsuite])
    const cc = asOptionalString(row[columnIndexes.ccNetsuite])
    const rfc = sanitizeWorkbookRfc(asOptionalString(row[columnIndexes.rfc]))

    const normalizedClave = normalizeComparisonKey(clave)
    if (normalizedClave && cuentaGastos) {
      const current = accountByClave.get(normalizedClave)
      if (!current) {
        accountByClave.set(normalizedClave, cuentaGastos)
      } else if (current !== cuentaGastos) {
        warnings.push(
          `La ClaveProdServ ${clave} tiene cuentas de gasto distintas en Tablas; se conserva la primera.`,
        )
      }
    }

    const providerMapping: WorkbookProviderMapping = {
      nombreProveedor,
      rfc,
      proveedorNetsuite,
      cc,
      sourceRowNumber,
    }

    const normalizedName = normalizeComparisonKey(nombreProveedor)
    if (normalizedName) {
      registerProviderMapping(providerByName, normalizedName, providerMapping, warnings, 'nombre')
    }

    const normalizedRfc = normalizeRfc(rfc)
    if (normalizedRfc) {
      registerProviderMapping(providerByRfc, normalizedRfc, providerMapping, warnings, 'RFC')
    }
  })

  const manualOverrides = loadSatManualHomologationOverrides()

  for (const override of manualOverrides.accountOverrides) {
    accountByClave.set(override.normalizedClaveProdServ, override.cuentaGastos)
  }

  for (const override of manualOverrides.providerOverrides) {
    const providerMapping: WorkbookProviderMapping = {
      nombreProveedor: override.matchBy === 'name' ? override.matchValue : null,
      rfc: override.matchBy === 'rfc' ? override.matchValue : null,
      proveedorNetsuite: override.proveedorNetsuite,
      cc: override.cc,
      sourceRowNumber: 0,
    }

    if (override.matchBy === 'name') {
      providerByName.set(override.normalizedMatchValue, providerMapping)
      continue
    }

    providerByRfc.set(override.normalizedMatchValue, providerMapping)
  }

  return {
    workbookPath,
    accountByClave,
    providerByName,
    providerByRfc,
    warnings: uniqueStrings(warnings),
  }
}

function registerProviderMapping(
  target: Map<string, WorkbookProviderMapping>,
  key: string,
  candidate: WorkbookProviderMapping,
  warnings: string[],
  label: 'nombre' | 'RFC',
) {
  const current = target.get(key)
  if (!current) {
    target.set(key, candidate)
    return
  }

  if (
    current.proveedorNetsuite !== candidate.proveedorNetsuite ||
    current.cc !== candidate.cc
  ) {
    warnings.push(
      `La equivalencia por ${label} ${key} aparece con resultados distintos en Tablas; se conserva la primera coincidencia.`,
    )
  }
}

function buildNetSuiteAccountByClave(accounts: Array<{ displayName: string }>) {
  const grouped = new Map<string, string[]>()

  for (const account of accounts) {
    const match = account.displayName.match(/^(\d{8})\b/u)
    if (!match) {
      continue
    }

    const clave = normalizeComparisonKey(match[1])
    if (!clave) {
      continue
    }

    const items = grouped.get(clave) ?? []
    items.push(account.displayName)
    grouped.set(clave, items)
  }

  const uniqueMatches = new Map<string, string>()
  for (const [clave, displayNames] of grouped) {
    const uniqueDisplayNames = uniqueStrings(displayNames)
    if (uniqueDisplayNames.length === 1) {
      uniqueMatches.set(clave, uniqueDisplayNames[0])
    }
  }

  return uniqueMatches
}

function canResolveNetSuiteAccount(
  accounts: Array<{ internalId?: string | null; displayName: string }>,
  accountName: string,
) {
  const normalizedName = normalizeComparisonKey(accountName)
  if (!normalizedName) {
    return false
  }

  const accountCode = extractAccountCode(accountName)
  return accounts.some((account) => {
    if (!account.internalId) {
      return false
    }

    return (
      normalizeComparisonKey(account.displayName) === normalizedName ||
      Boolean(accountCode && extractAccountCode(account.displayName) === accountCode)
    )
  })
}

function buildGenericNuevoProveedorCandidate(params: {
  cfdi: ParsedCfdi
  providerMapping: WorkbookProviderMapping | null
  rows: PreviewRow[]
}) {
  if (params.providerMapping?.proveedorNetsuite) {
    return null
  }

  const normalRows = params.rows.filter((row) => row.lineType === 'normal')
  if (normalRows.length === 0 || normalRows.some((row) => !row.cuentaGastos)) {
    return null
  }

  return buildSatNuevoProveedorCandidate({
    nombreEmisor: params.cfdi.nombreEmisor,
    rfcEmisor: params.cfdi.rfcEmisor,
    defaultExpenseAccount: normalRows[0].cuentaGastos,
  })
}

function findHeaderIndex(headers: string[], expectedHeader: string) {
  const index = headers.findIndex((header) => header === expectedHeader)
  if (index < 0) {
    throw new SatServiceError(
      `No encontre la columna ${expectedHeader} en la hoja Tablas del archivo SAT.`,
      503,
    )
  }

  return index
}

async function assessNetSuiteDuplicates(parsedCfdis: ParsedCfdi[], mappings: WorkbookMappings) {
  const assessments = new Map<string, NetSuiteDuplicateAssessment>()
  if (parsedCfdis.length === 0) {
    return assessments
  }

  let client: NetSuiteClient
  try {
    client = NetSuiteClient.fromEnv()
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'No pude inicializar el cliente de NetSuite para validar duplicados.'

    for (const cfdi of parsedCfdis) {
      assessments.set(buildDuplicateAssessmentKey(cfdi), {
        status: 'clear',
        matches: [],
        error: message,
      })
    }

    return assessments
  }

  const exactMatches = await queryExactDuplicateMatches(client, parsedCfdis)
  const possibleCandidates = await queryPossibleDuplicateCandidates(client, parsedCfdis, mappings)

  for (const cfdi of parsedCfdis) {
    const key = buildDuplicateAssessmentKey(cfdi)
    const exact = findExactDuplicateMatches(cfdi, exactMatches)
    if (exact.length > 0) {
      assessments.set(key, {
        status: 'exact',
        matches: exact,
      })
      continue
    }

    const possible = findPossibleDuplicateMatches(cfdi, mappings, possibleCandidates)
    if (possible.length > 0) {
      assessments.set(key, {
        status: 'possible',
        matches: possible,
      })
      continue
    }

    assessments.set(key, {
      status: 'clear',
      matches: [],
    })
  }

  return assessments
}

async function queryExactDuplicateMatches(client: NetSuiteClient, parsedCfdis: ParsedCfdi[]) {
  const uuids = uniqueStrings(
    parsedCfdis
      .map((cfdi) => normalizeRfc(cfdi.uuid))
      .filter((value): value is string => Boolean(value)),
  )

  if (uuids.length === 0) {
    return []
  }

  const matches: NetSuiteDuplicateMatch[] = []

  for (const chunk of chunkArray(uuids, 20)) {
    const inClause = chunk.map(toSuiteQlString).join(', ')
    const query = `
SELECT
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.foreigntotal,
  BUILTIN.DF(transaction.entity) AS vendorName,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.memo,
  transaction.otherrefnum,
  transaction.externalid,
  transaction.custbody_mx_cfdi_uuid AS mxCfdiUuid,
  transaction.custbody_mx_inbound_bill_uuid AS inboundUuid
FROM transaction
WHERE transaction.type IN ('VendBill', 'VendCred')
  AND (
    UPPER(NVL(transaction.custbody_mx_cfdi_uuid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.custbody_mx_inbound_bill_uuid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.tranid, '')) IN (${inClause})
    OR UPPER(NVL(transaction.externalid, '')) IN (${inClause})
  )
    `.trim()

    const response = await client.suiteql(query, 200, 0)
    const items = readSuiteQlItems(response.json)
    matches.push(...items.map((item) => normalizeDuplicateMatch(item)))
  }

  return matches
}

async function queryPossibleDuplicateCandidates(
  client: NetSuiteClient,
  parsedCfdis: ParsedCfdi[],
  mappings: WorkbookMappings,
) {
  const candidateVendors = uniqueStrings(
    parsedCfdis
      .map((cfdi) => {
        const providerMatch = matchProvider(cfdi, mappings)
        return providerMatch.mapping?.proveedorNetsuite ?? null
      })
      .filter((value): value is string => Boolean(value)),
  )

  const candidateDates = parsedCfdis
    .map((cfdi) => extractCfdiDateKey(cfdi.fecha))
    .filter((value): value is string => Boolean(value))

  if (candidateVendors.length === 0 || candidateDates.length === 0) {
    return []
  }

  const minDate = [...candidateDates].sort()[0]
  const maxDate = [...candidateDates].sort().at(-1)
  if (!minDate || !maxDate) {
    return []
  }

  const matches: NetSuiteDuplicateMatch[] = []

  for (const vendorChunk of chunkArray(candidateVendors, 20)) {
    const vendorsClause = vendorChunk.map(toSuiteQlString).join(', ')
    const query = `
SELECT
  transaction.id,
  transaction.tranid,
  transaction.transactionnumber,
  transaction.trandate,
  transaction.foreigntotal,
  BUILTIN.DF(transaction.entity) AS vendorName,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.memo,
  transaction.otherrefnum,
  transaction.externalid,
  transaction.custbody_mx_cfdi_uuid AS mxCfdiUuid,
  transaction.custbody_mx_inbound_bill_uuid AS inboundUuid
FROM transaction
WHERE transaction.type IN ('VendBill', 'VendCred')
  AND BUILTIN.DF(transaction.entity) IN (${vendorsClause})
  AND transaction.trandate BETWEEN TO_DATE(${toSuiteQlString(minDate)}, 'YYYY-MM-DD') AND TO_DATE(${toSuiteQlString(maxDate)}, 'YYYY-MM-DD')
    `.trim()

    const response = await client.suiteql(query, 500, 0)
    const items = readSuiteQlItems(response.json)
    matches.push(...items.map((item) => normalizeDuplicateMatch(item)))
  }

  return matches
}

function findExactDuplicateMatches(cfdi: ParsedCfdi, candidates: NetSuiteDuplicateMatch[]) {
  const normalizedUuid = normalizeRfcLikeIdentifier(cfdi.uuid)
  if (!normalizedUuid) {
    return []
  }

  return candidates.filter((candidate) => {
    if (normalizeRfcLikeIdentifier(candidate.mxCfdiUuid) === normalizedUuid) {
      candidate.matchType = 'uuid-field'
      return true
    }
    if (normalizeRfcLikeIdentifier(candidate.inboundUuid) === normalizedUuid) {
      candidate.matchType = 'uuid-field'
      return true
    }
    if (normalizeRfcLikeIdentifier(candidate.tranId) === normalizedUuid) {
      candidate.matchType = 'tranid'
      return true
    }
    if (normalizeRfcLikeIdentifier(candidate.externalId) === normalizedUuid) {
      candidate.matchType = 'externalid'
      return true
    }

    return false
  })
}

function findPossibleDuplicateMatches(
  cfdi: ParsedCfdi,
  mappings: WorkbookMappings,
  candidates: NetSuiteDuplicateMatch[],
) {
  const providerMatch = matchProvider(cfdi, mappings)
  const targetVendorName = normalizeComparisonKey(providerMatch.mapping?.proveedorNetsuite)
  const targetDate = extractCfdiDateKey(cfdi.fecha)
  const targetSerieFolio = normalizeReferenceKey(buildSerieFolio(cfdi.serie, cfdi.folio))
  if (!targetVendorName || !targetDate) {
    return []
  }

  return candidates
    .filter((candidate) => {
      const candidateVendor = normalizeComparisonKey(candidate.vendorName)
      if (candidateVendor !== targetVendorName) {
        return false
      }

      if (normalizeNetSuiteDateKey(candidate.transactionDate) !== targetDate) {
        return false
      }

      const candidateTotal = candidate.total === null ? null : roundToCurrency(Math.abs(candidate.total))
      if (candidateTotal === null || Math.abs(candidateTotal - roundToCurrency(cfdi.total)) > 0.01) {
        return false
      }

      const candidateMemo = normalizeReferenceKey(candidate.memo)
      const candidateOtherRef = normalizeReferenceKey(candidate.otherRefNum)
      const candidateTranId = normalizeReferenceKey(candidate.tranId)

      return Boolean(
        targetSerieFolio &&
          (candidateMemo === targetSerieFolio ||
            candidateOtherRef === targetSerieFolio ||
            candidateTranId === targetSerieFolio),
      )
    })
    .map((candidate) => ({
      ...candidate,
      matchType: 'possible' as const,
    }))
}

function normalizeDuplicateMatch(item: Record<string, unknown>): NetSuiteDuplicateMatch {
  return {
    internalId: asOptionalString(item.id) ?? '',
    transactionNumber: asOptionalString(item.transactionnumber),
    tranId: asOptionalString(item.tranid),
    vendorName: asOptionalString(item.vendorname),
    transactionDate: asOptionalString(item.trandate),
    total: parseNumber(asOptionalString(item.foreigntotal)),
    currencyName: asOptionalString(item.currencyname),
    memo: asOptionalString(item.memo),
    otherRefNum: asOptionalString(item.otherrefnum),
    externalId: asOptionalString(item.externalid),
    mxCfdiUuid: asOptionalString(item.mxcfdiuuid),
    inboundUuid: asOptionalString(item.inbounduuid),
    matchType: 'possible',
  }
}

function readSuiteQlItems(json: unknown) {
  if (!json || typeof json !== 'object') {
    return []
  }

  const items = (json as { items?: Array<Record<string, unknown>> }).items
  return Array.isArray(items) ? items : []
}

function buildDuplicateAssessmentKey(cfdi: ParsedCfdi) {
  return cfdi.uuid ?? cfdi.fileName
}

function parseCfdiXml(file: SatPackageXmlFile): ParsedCfdi | null {
  const parser = new DOMParser({
    onError: () => undefined,
  })

  const document = parser.parseFromString(sanitizeXmlContent(file.content), 'application/xml')
  const comprobante = firstDescendantByLocalName(document, 'Comprobante')
  if (!comprobante) {
    return null
  }

  const emisor = firstChildElementByLocalName(comprobante, 'Emisor')
  const timbre = firstDescendantByLocalName(comprobante, 'TimbreFiscalDigital')
  const conceptosContainer = firstChildElementByLocalName(comprobante, 'Conceptos')
  const conceptos = childElementsByLocalName(conceptosContainer, 'Concepto')
  const cfdiRelations = childElementsByLocalName(comprobante, 'CfdiRelacionados').flatMap((relationContainer) => {
    const tipoRelacion = asOptionalString(getAttributeValue(relationContainer, 'TipoRelacion'))
    return childElementsByLocalName(relationContainer, 'CfdiRelacionado').map((relationElement) => ({
      tipoRelacion,
      uuid: normalizeCfdiUuid(asOptionalString(getAttributeValue(relationElement, 'UUID'))),
    }))
  })

  const parsedConcepts: ParsedCfdiConcept[] = []
  const transfers: ParsedCfdiTransfer[] = []
  const retentions: ParsedCfdiRetention[] = []
  const localTransfers: ParsedCfdiLocalTransfer[] = []

  conceptos.forEach((conceptElement, index) => {
    const conceptIndex = index + 1
    parsedConcepts.push({
      conceptIndex,
      claveProdServ: asOptionalString(getAttributeValue(conceptElement, 'ClaveProdServ')),
      descripcion: asOptionalString(getAttributeValue(conceptElement, 'Descripcion')),
      importe: parseNumber(getAttributeValue(conceptElement, 'Importe')) ?? 0,
      descuento: parseNumber(getAttributeValue(conceptElement, 'Descuento')) ?? 0,
    })

    const impuestos = firstChildElementByLocalName(conceptElement, 'Impuestos')
    const traslados = firstChildElementByLocalName(impuestos, 'Traslados')
    const retencionesContainer = firstChildElementByLocalName(impuestos, 'Retenciones')

    childElementsByLocalName(traslados, 'Traslado').forEach((transferElement) => {
      const amount = parseNumber(getAttributeValue(transferElement, 'Importe')) ?? 0
      if (Math.abs(amount) <= 0.000001) {
        return
      }

      transfers.push({
        conceptIndex,
        amount,
        base: parseNumber(getAttributeValue(transferElement, 'Base')),
        rate: parseNumber(getAttributeValue(transferElement, 'TasaOCuota')),
        taxCode: asOptionalString(getAttributeValue(transferElement, 'Impuesto')),
      })
    })

    childElementsByLocalName(retencionesContainer, 'Retencion').forEach((retentionElement) => {
      const amount = parseNumber(getAttributeValue(retentionElement, 'Importe')) ?? 0
      if (Math.abs(amount) <= 0.000001) {
        return
      }

      retentions.push({
        conceptIndex,
        rate: parseNumber(getAttributeValue(retentionElement, 'TasaOCuota')),
        amount,
        taxCode: asOptionalString(getAttributeValue(retentionElement, 'Impuesto')),
      })
    })
  })

  const localTaxesContainer = firstDescendantByLocalName(comprobante, 'ImpuestosLocales')
  childElementsByLocalName(localTaxesContainer, 'TrasladosLocales').forEach((localTransferElement, index) => {
    const amount = parseNumber(getAttributeValue(localTransferElement, 'Importe')) ?? 0
    if (Math.abs(amount) <= 0.000001) {
      return
    }

    const localTransfer = {
      localTransferIndex: index + 1,
      name: asOptionalString(getAttributeValue(localTransferElement, 'ImpLocTrasladado')),
      rate:
        parseNumber(getAttributeValue(localTransferElement, 'TasadeTraslado')) ??
        parseNumber(getAttributeValue(localTransferElement, 'TasaOCuota')),
      amount,
    }

    localTransfers.push({
      ...localTransfer,
      conceptIndex: resolveLocalTransferConceptIndex(parsedConcepts, localTransfer),
    })
  })

  return {
    fileName: file.name,
    uuid:
      asOptionalString(getAttributeValue(timbre, 'UUID')) ??
      file.uuid ??
      null,
    fecha: asOptionalString(getAttributeValue(comprobante, 'Fecha')),
    serie: asOptionalString(getAttributeValue(comprobante, 'Serie')),
    folio: asOptionalString(getAttributeValue(comprobante, 'Folio')),
    tipoComprobante: asOptionalString(getAttributeValue(comprobante, 'TipoDeComprobante')),
    moneda: asOptionalString(getAttributeValue(comprobante, 'Moneda')),
    tipoCambio: parseNumber(getAttributeValue(comprobante, 'TipoCambio')),
    subtotal: parseNumber(getAttributeValue(comprobante, 'SubTotal')) ?? 0,
    descuento: parseNumber(getAttributeValue(comprobante, 'Descuento')) ?? 0,
    total: parseNumber(getAttributeValue(comprobante, 'Total')) ?? 0,
    rfcEmisor: asOptionalString(getAttributeValue(emisor, 'Rfc')),
    nombreEmisor: asOptionalString(getAttributeValue(emisor, 'Nombre')),
    concepts: parsedConcepts,
    transfers,
    retentions,
    localTransfers,
    relations: cfdiRelations,
  }
}

function matchProvider(cfdi: ParsedCfdi, mappings: WorkbookMappings) {
  const normalizedName = normalizeComparisonKey(cfdi.nombreEmisor)
  if (normalizedName) {
    const mappingByName = mappings.providerByName.get(normalizedName)
    if (mappingByName) {
      return {
        source: 'name' as const,
        mapping: mappingByName,
      }
    }
  }

  const normalizedRfc = normalizeRfc(cfdi.rfcEmisor)
  if (normalizedRfc) {
    const mappingByRfc = mappings.providerByRfc.get(normalizedRfc)
    if (mappingByRfc) {
      return {
        source: 'rfc' as const,
        mapping: mappingByRfc,
      }
    }
  }

  return {
    source: 'manual' as const,
    mapping: null,
  }
}

function aggregateTransfersByTaxCode(transfers: ParsedCfdiTransfer[], taxCode: string) {
  const grouped = new Map<number, number>()

  for (const transfer of transfers) {
    if (transfer.taxCode !== taxCode) {
      continue
    }
    grouped.set(
      transfer.conceptIndex,
      roundToSixDecimals((grouped.get(transfer.conceptIndex) ?? 0) + transfer.amount),
    )
  }

  return grouped
}

function groupTransfersByConcept(transfers: ParsedCfdiTransfer[]) {
  const grouped = new Map<number, ParsedCfdiTransfer[]>()

  for (const transfer of transfers) {
    const conceptItems = grouped.get(transfer.conceptIndex) ?? []
    conceptItems.push(transfer)
    grouped.set(transfer.conceptIndex, conceptItems)
  }

  return grouped
}

function aggregateRetentions(retentions: ParsedCfdiRetention[]) {
  const grouped = new Map<number, Array<{ rate: number | null; amount: number; taxCode: string | null }>>()

  for (const retention of retentions) {
    const conceptItems = grouped.get(retention.conceptIndex) ?? []
    const roundedRate = retention.rate === null ? null : roundToSixDecimals(retention.rate)
    const existing = conceptItems.find(
      (item) => item.rate === roundedRate && item.taxCode === retention.taxCode,
    )

    if (existing) {
      existing.amount = roundToSixDecimals(existing.amount + retention.amount)
    } else {
      conceptItems.push({
        rate: roundedRate,
        amount: retention.amount,
        taxCode: retention.taxCode,
      })
    }

    grouped.set(retention.conceptIndex, conceptItems)
  }

  for (const conceptItems of grouped.values()) {
    conceptItems.sort((left, right) => {
      if (left.rate === null && right.rate === null) {
        return 0
      }
      if (left.rate === null) {
        return 1
      }
      if (right.rate === null) {
        return -1
      }
      return left.rate - right.rate
    })
  }

  return grouped
}

function groupLocalTransfersByConcept(localTransfers: ParsedCfdiLocalTransfer[]) {
  const grouped = new Map<number, ParsedCfdiLocalTransfer[]>()

  for (const localTransfer of localTransfers) {
    if (localTransfer.conceptIndex === null) {
      continue
    }

    const conceptItems = grouped.get(localTransfer.conceptIndex) ?? []
    conceptItems.push(localTransfer)
    grouped.set(localTransfer.conceptIndex, conceptItems)
  }

  return grouped
}

function resolveLocalTransferConceptIndex(
  concepts: ParsedCfdiConcept[],
  localTransfer: {
    name: string | null
    rate: number | null
    amount: number
  },
) {
  if (concepts.length === 0) {
    return null
  }

  if (concepts.length === 1) {
    return concepts[0].conceptIndex
  }

  const amountMatches =
    localTransfer.rate === null
      ? []
      : concepts.filter((concept) => (
          Math.abs(roundToCurrency(concept.importe * localTransfer.rate!) - roundToCurrency(localTransfer.amount)) <= 0.01
        ))

  if (amountMatches.length === 1) {
    return amountMatches[0].conceptIndex
  }

  const lodgingMatches = amountMatches.filter((concept) => isLodgingConcept(concept))
  if (isLodgingLocalTransfer(localTransfer) && lodgingMatches.length === 1) {
    return lodgingMatches[0].conceptIndex
  }

  const lodgingConcepts = concepts.filter((concept) => isLodgingConcept(concept))
  if (isLodgingLocalTransfer(localTransfer) && lodgingConcepts.length === 1) {
    return lodgingConcepts[0].conceptIndex
  }

  return null
}

function isLodgingLocalTransfer(localTransfer: { name: string | null }) {
  const normalizedName = normalizeComparisonKey(localTransfer.name)
  return normalizedName === 'ISH' || Boolean(normalizedName?.includes('HOSPEDAJE'))
}

function isLodgingConcept(concept: ParsedCfdiConcept) {
  return (
    normalizeComparisonKey(concept.claveProdServ) === '90111500' ||
    Boolean(normalizeComparisonKey(concept.descripcion)?.includes('HOSPEDAJE')) ||
    Boolean(normalizeComparisonKey(concept.descripcion)?.includes('HOTEL'))
  )
}

function buildTransferModelIssues(params: {
  concept: ParsedCfdiConcept
  transfers: ParsedCfdiTransfer[]
}) {
  const issues: string[] = []
  const transfersWithAmount = params.transfers.filter((transfer) => Math.abs(transfer.amount) > 0.000001)
  if (transfersWithAmount.length === 0) {
    return issues
  }

  const unsupportedTransfers = transfersWithAmount.filter(
    (transfer) => transfer.taxCode !== '002' && transfer.taxCode !== '003',
  )
  if (unsupportedTransfers.length > 0) {
    issues.push('El concepto tiene traslados fiscales no soportados; requiere modelo fiscal manual antes de subir.')
  }

  const vatTransfers = transfersWithAmount.filter((transfer) => transfer.taxCode === '002')
  if (vatTransfers.length > 1) {
    issues.push('El concepto tiene multiples traslados de IVA; requiere modelo fiscal manual antes de subir.')
  }

  for (const transfer of vatTransfers) {
    if (transfer.rate === null || Math.abs(transfer.rate - 0.16) > 0.000001) {
      issues.push('El traslado XML no es IVA 16%; requiere mapeo fiscal antes de subir.')
      continue
    }
  }

  return uniqueStrings(issues)
}

function buildBaseLineIssues(params: {
  providerMapping: WorkbookProviderMapping | null
  cuentaGastos: string | null
  cuentaGastosResolvable?: boolean
  allowAutoUberVendor?: boolean
}) {
  const issues: string[] = []

  if (!params.providerMapping && !params.allowAutoUberVendor) {
    issues.push('Proveedor sin homologacion automatica; requiere revision manual.')
  } else {
    if (!params.providerMapping?.proveedorNetsuite && !params.allowAutoUberVendor) {
      issues.push('La equivalencia del proveedor no tiene Proveedor Netsuite definido.')
    }
    if (!params.providerMapping?.cc && !params.allowAutoUberVendor) {
      issues.push('La equivalencia del proveedor no tiene Cuenta proveedor definida.')
    }
  }

  if (!params.cuentaGastos) {
    issues.push('Cuenta gastos sin homologacion para la ClaveProdServ.')
  } else if (!params.cuentaGastosResolvable) {
    issues.push('Cuenta gastos homologada no existe activa en el catalogo NetSuite.')
  }

  return issues
}

function buildRetentionLineIssues(params: {
  providerMapping: WorkbookProviderMapping | null
  retentionAccount: string | null
  allowAutoUberVendor?: boolean
}) {
  const issues: string[] = []

  if (!params.providerMapping && !params.allowAutoUberVendor) {
    issues.push('Proveedor sin homologacion automatica; requiere revision manual.')
  } else {
    if (!params.providerMapping?.proveedorNetsuite && !params.allowAutoUberVendor) {
      issues.push('La equivalencia del proveedor no tiene Proveedor Netsuite definido.')
    }
    if (!params.providerMapping?.cc && !params.allowAutoUberVendor) {
      issues.push('La equivalencia del proveedor no tiene Cuenta proveedor definida.')
    }
  }

  if (!params.retentionAccount) {
    issues.push('La retencion no tiene cuenta contable configurada.')
  }

  return issues
}

function stripAutoProviderIssues(issues: string[]) {
  return issues.filter((issue) =>
    issue !== 'Proveedor sin homologacion automatica; requiere revision manual.' &&
    issue !== 'La equivalencia del proveedor no tiene Proveedor Netsuite definido.' &&
    issue !== 'La equivalencia del proveedor no tiene Cuenta proveedor definida.',
  )
}

function buildLocalTransferDescription(
  localTransfer: ParsedCfdiLocalTransfer,
  concept: ParsedCfdiConcept,
) {
  const localTaxName =
    normalizeComparisonKey(localTransfer.name) === 'ISH'
      ? 'ISH - Impuesto local sobre hospedaje'
      : `Impuesto local${localTransfer.name ? ` ${localTransfer.name}` : ''}`
  const rateLabel =
    localTransfer.rate === null
      ? null
      : `${roundToSixDecimals(localTransfer.rate * 100)}%`
  const conceptLabel = concept.descripcion ?? concept.claveProdServ ?? 'partida SAT'

  return [localTaxName, rateLabel, conceptLabel].filter(Boolean).join(' - ')
}

function buildPreviewRow(params: {
  cfdi: ParsedCfdi
  concept: ParsedCfdiConcept
  lineType: PreviewRowType
  rowKey?: string | null
  fecha: string | null
  serieFolio: string | null
  moneda: string
  tipoCambio: number
  proveedorNetsuite: string | null
  providerBaseCc: string | null
  providerMatchSource: PreviewProviderMatchSource
  cuentaGastos: string | null
  descripcionOverride?: string | null
  importe: number
  importeTraslado: number
  monto: number
  ivaTipo: string
  cc: string | null
  retentionRate: number | null
  issues: string[]
}) {
  const importe = roundToCurrency(params.importe)
  const importeTraslado = roundToCurrency(params.importeTraslado)
  const monto = roundToCurrency(importe + importeTraslado)

  return {
    rowId: [
      params.cfdi.uuid ?? params.cfdi.fileName,
      String(params.concept.conceptIndex),
      params.lineType,
      params.rowKey ?? (params.retentionRate === null ? 'base' : String(params.retentionRate)),
    ].join(':'),
    uuid: params.cfdi.uuid,
    conceptIndex: params.concept.conceptIndex,
    lineType: params.lineType,
    fecha: params.fecha,
    serieFolio: params.serieFolio,
    claveProdServ: params.concept.claveProdServ,
    cuentaGastos: params.cuentaGastos,
    descripcion: params.descripcionOverride ?? params.concept.descripcion,
    nombreEmisor: params.cfdi.nombreEmisor,
    rfcEmisor: params.cfdi.rfcEmisor,
    proveedorNetsuite: params.proveedorNetsuite,
    importe,
    importeTraslado,
    monto,
    ivaTipo: params.ivaTipo,
    cc: params.cc,
    tipoCambio: params.tipoCambio,
    moneda: params.moneda,
    descuento: roundToSixDecimals(params.concept.descuento),
    providerMatchSource: params.providerMatchSource,
    retentionRate: params.retentionRate,
    issues: uniqueStrings(params.issues),
  }
}

function applyCurrencyRoundingAdjustment(rows: PreviewRow[], totalXml: number) {
  const targetTotal = roundToCurrency(totalXml)
  const currentTotal = roundToCurrency(rows.reduce((sum, row) => sum + row.monto, 0))
  let remainingCents = Math.round((targetTotal - currentTotal) * 100)

  if (remainingCents === 0) {
    return rows
  }

  const adjustmentSign = remainingCents > 0 ? 1 : -1
  const candidates = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => (
      row.lineType === 'normal' &&
      row.ivaTipo === 'VAT_MX:IVA:IVA 0%' &&
      roundToCurrency(row.importe + adjustmentSign / 100) > 0
    ))
    .sort((left, right) => Math.abs(right.row.importe) - Math.abs(left.row.importe))

  if (candidates.length === 0 || Math.abs(remainingCents) > candidates.length) {
    return rows
  }

  const adjustedRows = [...rows]
  for (const candidate of candidates) {
    if (remainingCents === 0) {
      break
    }

    const adjustment = adjustmentSign / 100
    adjustedRows[candidate.index] = {
      ...adjustedRows[candidate.index],
      importe: roundToCurrency(adjustedRows[candidate.index].importe + adjustment),
      monto: roundToCurrency(adjustedRows[candidate.index].monto + adjustment),
    }
    remainingCents -= adjustmentSign
  }

  return adjustedRows
}

function sortPreviewRows(rows: PreviewRow[]) {
  return [...rows].sort((left, right) => {
    const leftUuid = left.uuid ?? ''
    const rightUuid = right.uuid ?? ''
    if (leftUuid !== rightUuid) {
      return leftUuid.localeCompare(rightUuid)
    }

    if (left.conceptIndex !== right.conceptIndex) {
      return left.conceptIndex - right.conceptIndex
    }

    const leftRank = getLineTypeSortRank(left.lineType)
    const rightRank = getLineTypeSortRank(right.lineType)
    if (leftRank !== rightRank) {
      return leftRank - rightRank
    }

    if (left.retentionRate === null && right.retentionRate === null) {
      return left.rowId.localeCompare(right.rowId)
    }
    if (left.retentionRate === null) {
      return -1
    }
    if (right.retentionRate === null) {
      return 1
    }

    return left.retentionRate - right.retentionRate
  })
}

function getLineTypeSortRank(lineType: PreviewRowType) {
  switch (lineType) {
    case 'normal':
      return 1
    case 'discount':
      return 3
    case 'ieps':
      return 3.5
    case 'local_tax':
      return 3.6
    case 'retention':
      return 4
  }
}

function formatCfdiDate(rawValue: string) {
  const parsed = new Date(rawValue)
  if (Number.isNaN(parsed.getTime())) {
    return rawValue
  }

  return `${parsed.getDate()}.${parsed.getMonth() + 1}.${parsed.getFullYear()}`
}

function buildSerieFolio(serie: string | null, folio: string | null) {
  if (!serie && !folio) {
    return null
  }
  if (!serie) {
    return folio
  }
  if (!folio) {
    return serie
  }
  return `${serie} - ${folio}`
}

function normalizeCurrency(value: string | null) {
  const normalized = asOptionalString(value) ?? 'MXN'
  return normalized.toUpperCase() === 'XXX' ? 'MXN' : normalized
}

function normalizeCfdiDocumentType(value: string | null) {
  return asOptionalString(value)?.toUpperCase() ?? null
}

function normalizeCfdiUuid(value: string | null) {
  return asOptionalString(value)?.toUpperCase() ?? null
}

function extractCfdiDateKey(rawValue: string | null) {
  const normalized = asOptionalString(rawValue)
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

function normalizeNetSuiteDateKey(rawValue: string | null) {
  const normalized = asOptionalString(rawValue)
  if (!normalized) {
    return null
  }

  const parts = normalized.split('.').map((segment) => segment.trim())
  if (parts.length !== 3) {
    return null
  }

  const [day, month, year] = parts
  return `${year.padStart(4, '0')}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
}

function resolveConfiguredPath(value: string | undefined) {
  const normalized = asOptionalString(value)
  if (!normalized) {
    return null
  }

  return normalized
}

function normalizeHeader(value: string | number | null) {
  return normalizeComparisonKey(value)?.toLowerCase() ?? ''
}

function normalizeComparisonKey(value: unknown) {
  const rawValue = asOptionalString(value)
  if (!rawValue) {
    return null
  }

  return rawValue
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

function normalizeRfc(value: unknown) {
  const rawValue = asOptionalString(value)
  if (!rawValue) {
    return null
  }

  return rawValue.replace(/\s+/g, '').toUpperCase()
}

function normalizeRfcLikeIdentifier(value: unknown) {
  const normalized = normalizeRfc(value)
  return normalized ? normalized.replace(/-/g, '') : null
}

function normalizeReferenceKey(value: unknown) {
  const normalized = normalizeComparisonKey(value)
  return normalized ? normalized.replace(/\s*-\s*/g, ' ').replace(/\s+/g, ' ') : null
}

function sanitizeWorkbookRfc(value: string | null) {
  if (!value) {
    return null
  }

  const normalized = value.trim()
  if (!normalized || normalized === '#N/A') {
    return null
  }

  return normalized
}

function asOptionalString(value: unknown) {
  if (value === null || value === undefined) {
    return null
  }

  const normalized = String(value).trim()
  return normalized ? normalized : null
}

function parseNumber(value: string | null) {
  const normalized = asOptionalString(value)
  if (!normalized) {
    return null
  }

  const parsed = Number(normalized)
  return Number.isFinite(parsed) ? parsed : null
}

function roundToSixDecimals(value: number) {
  return Number(value.toFixed(6))
}

function roundToCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function uniqueStrings(values: string[]) {
  return [...new Set(values)]
}

function chunkArray<T>(items: T[], chunkSize: number) {
  const chunks: T[][] = []
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize))
  }
  return chunks
}

function toSuiteQlString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function sanitizeXmlContent(content: string) {
  const withoutBom = content.replace(/^\uFEFF+/, '')
  const firstTagIndex = withoutBom.indexOf('<')
  const trimmed = firstTagIndex > 0 ? withoutBom.slice(firstTagIndex) : withoutBom
  return trimmed.trimStart()
}

function firstChildElementByLocalName(node: Element | null, targetLocalName: string) {
  if (!node) {
    return null
  }

  for (const child of elementChildren(node)) {
    if (readLocalName(child) === targetLocalName) {
      return child
    }
  }

  return null
}

function childElementsByLocalName(node: Element | null, targetLocalName: string) {
  if (!node) {
    return []
  }

  return elementChildren(node).filter((child) => readLocalName(child) === targetLocalName)
}

function firstDescendantByLocalName(root: Node | null, targetLocalName: string): Element | null {
  if (!root) {
    return null
  }

  const childNodes = root.childNodes
  for (let index = 0; index < childNodes.length; index += 1) {
    const child = childNodes.item(index)
    if (!child || child.nodeType !== 1) {
      continue
    }

    if (readLocalName(child as Element) === targetLocalName) {
      return child as Element
    }

    const descendant = firstDescendantByLocalName(child, targetLocalName)
    if (descendant) {
      return descendant
    }
  }

  return null
}

function elementChildren(node: Element) {
  const children: Element[] = []
  const childNodes = node.childNodes

  for (let index = 0; index < childNodes.length; index += 1) {
    const child = childNodes.item(index)
    if (child && child.nodeType === 1) {
      children.push(child as Element)
    }
  }

  return children
}

function readLocalName(element: Element) {
  return element.localName || element.nodeName.split(':').pop() || element.nodeName
}

function getAttributeValue(element: Element | null, targetAttributeName: string) {
  if (!element) {
    return null
  }

  const directValue = element.getAttribute(targetAttributeName)
  if (directValue !== null) {
    return directValue
  }

  const attributes = element.attributes
  for (let index = 0; index < attributes.length; index += 1) {
    const attribute = attributes.item(index)
    if (!attribute) {
      continue
    }

    const attributeName =
      attribute.localName || attribute.nodeName.split(':').pop() || attribute.nodeName
    if (attributeName === targetAttributeName) {
      return attribute.value
    }
  }

  return null
}
