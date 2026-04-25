import { NetSuiteClient } from './netsuiteClient.js'
import type {
  NetSuiteAnalysisBootstrapResponse,
  NetSuiteAnalysisQueryDefinition,
  NetSuiteAnalysisQueryResult,
} from './types.js'

const DEFAULT_LIMITS = {
  openInvoices: 10,
  arJournalCandidates: 10,
  postingPeriods: 12,
} as const

function normalizeLimit(value: unknown, fallback: number) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return fallback
  }

  return Math.max(1, Math.min(100, Math.trunc(parsed)))
}

function buildOpenInvoicesQuery(limit: number): NetSuiteAnalysisQueryDefinition {
  return {
    id: 'openInvoices',
    title: 'Facturas abiertas con saldo pendiente',
    purpose:
      'Trae una muestra de facturas de cliente con impacto A/R y saldo impagado para arrancar el analisis.',
    limit,
    query: `
SELECT
  transaction.id AS transactionId,
  NVL(transaction.tranid, transaction.transactionnumber) AS documentNumber,
  transaction.trandate AS transactionDate,
  transaction.duedate AS dueDate,
  transaction.entity AS customerId,
  BUILTIN.DF(transaction.entity) AS customerName,
  transaction.subsidiary AS subsidiaryId,
  BUILTIN.DF(transaction.subsidiary) AS subsidiaryName,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  transaction.foreigntotal AS grossAmount,
  SUM(tal.amountunpaid) AS openAmount,
  BUILTIN.CF(transaction.status) AS statusCode,
  BUILTIN.DF(transaction.status) AS statusName
FROM transaction
INNER JOIN transactionline line
  ON line.transaction = transaction.id
  AND line.mainline = 'T'
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctRec'
WHERE transaction.type = 'CustInvc'
GROUP BY
  transaction.id,
  NVL(transaction.tranid, transaction.transactionnumber),
  transaction.trandate,
  transaction.duedate,
  transaction.entity,
  BUILTIN.DF(transaction.entity),
  transaction.subsidiary,
  BUILTIN.DF(transaction.subsidiary),
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.currency,
  BUILTIN.DF(transaction.currency),
  transaction.foreigntotal,
  BUILTIN.CF(transaction.status),
  BUILTIN.DF(transaction.status)
HAVING ABS(SUM(tal.amountunpaid)) > 0.005
ORDER BY transaction.trandate DESC
    `.trim(),
  }
}

function buildArJournalCandidatesQuery(limit: number): NetSuiteAnalysisQueryDefinition {
  return {
    id: 'arJournalCandidates',
    title: 'Diarios candidatos a cobro de cliente',
    purpose:
      'Busca journals con cliente en la linea principal e impacto A/R para revisar si hoy los cobros entran asi.',
    limit,
    query: `
SELECT
  transaction.id AS transactionId,
  NVL(transaction.tranid, transaction.transactionnumber) AS documentNumber,
  transaction.trandate AS transactionDate,
  line.entity AS customerId,
  BUILTIN.DF(line.entity) AS customerName,
  line.subsidiary AS subsidiaryId,
  BUILTIN.DF(line.subsidiary) AS subsidiaryName,
  transaction.postingperiod AS postingPeriodId,
  BUILTIN.DF(transaction.postingperiod) AS postingPeriodName,
  transaction.currency AS currencyId,
  BUILTIN.DF(transaction.currency) AS currencyName,
  SUM(tal.amount) AS arImpactAmount,
  MAX(transaction.memo) AS memo,
  MAX(transaction.otherrefnum) AS referenceNumber
FROM transaction
INNER JOIN transactionline line
  ON line.transaction = transaction.id
  AND line.mainline = 'T'
INNER JOIN transactionaccountingline tal
  ON tal.transaction = transaction.id
  AND tal.posting = 'T'
  AND tal.accounttype = 'AcctRec'
WHERE transaction.type = 'Journal'
  AND line.entity IS NOT NULL
GROUP BY
  transaction.id,
  NVL(transaction.tranid, transaction.transactionnumber),
  transaction.trandate,
  line.entity,
  BUILTIN.DF(line.entity),
  line.subsidiary,
  BUILTIN.DF(line.subsidiary),
  transaction.postingperiod,
  BUILTIN.DF(transaction.postingperiod),
  transaction.currency,
  BUILTIN.DF(transaction.currency)
ORDER BY transaction.trandate DESC
    `.trim(),
  }
}

function buildPostingPeriodsQuery(limit: number): NetSuiteAnalysisQueryDefinition {
  return {
    id: 'postingPeriods',
    title: 'Periodos contables recientes',
    purpose:
      'Nos da el mapa base de periodos para analizar diferencias mensuales y restricciones contables.',
    limit,
    query: `
SELECT
  accountingperiod.id,
  accountingperiod.periodname,
  accountingperiod.startdate,
  accountingperiod.enddate,
  accountingperiod.closed,
  accountingperiod.isposting,
  accountingperiod.isadjust
FROM accountingperiod
WHERE accountingperiod.isposting = 'T'
ORDER BY accountingperiod.startdate DESC
    `.trim(),
  }
}

export function getBootstrapQueries(rawLimits?: Record<string, unknown>) {
  return [
    buildOpenInvoicesQuery(normalizeLimit(rawLimits?.openInvoices, DEFAULT_LIMITS.openInvoices)),
    buildArJournalCandidatesQuery(
      normalizeLimit(rawLimits?.arJournalCandidates, DEFAULT_LIMITS.arJournalCandidates),
    ),
    buildPostingPeriodsQuery(normalizeLimit(rawLimits?.postingPeriods, DEFAULT_LIMITS.postingPeriods)),
  ]
}

async function executeQuery(
  client: NetSuiteClient,
  definition: NetSuiteAnalysisQueryDefinition,
): Promise<NetSuiteAnalysisQueryResult> {
  try {
    const response = await client.suiteql(definition.query, definition.limit, 0)
    const json = response.json as {
      items?: Record<string, unknown>[]
      count?: number
      totalResults?: number
    }

    return {
      ...definition,
      status: 'ok',
      statusCode: response.statusCode,
      count: json.count,
      totalResults: json.totalResults,
      items: json.items ?? [],
    }
  } catch (error) {
    return {
      ...definition,
      status: 'error',
      error: error instanceof Error ? error.message : 'Unknown NetSuite analysis error.',
    }
  }
}

export async function runBootstrapAnalysis(
  client: NetSuiteClient,
  rawLimits?: Record<string, unknown>,
): Promise<NetSuiteAnalysisBootstrapResponse> {
  const definitions = getBootstrapQueries(rawLimits)
  const queries = await Promise.all(definitions.map((definition) => executeQuery(client, definition)))

  return {
    readOnly: true,
    generatedAtUtc: new Date().toISOString(),
    queries,
  }
}
