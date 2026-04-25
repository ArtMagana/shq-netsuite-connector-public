import fs from 'node:fs'
import path from 'node:path'

type StoredSatRetentionAccountRule = {
  id: string
  label: string
  taxCode: string | null
  rate: number | null
  expenseAccountIncludesAny: string[]
  accountName: string
  rationale: string
  priority: number
  active: boolean
  source: 'seed' | 'manual'
  createdAtUtc: string
  updatedAtUtc: string
}

type StoredSatRetentionAccountRuleStore = {
  version: 1
  rules: StoredSatRetentionAccountRule[]
}

export type SatRetentionAccountResolution = {
  accountName: string
  rule: StoredSatRetentionAccountRule
}

const SAT_RETENTION_ACCOUNT_RULE_STORE_PATH =
  process.env.SAT_RETENTION_ACCOUNT_RULE_STORE_PATH?.trim() ||
  path.join(process.env.LOCALAPPDATA || process.cwd(), 'netsuite-recon', 'sat-retention-account-rules.json')

let retentionAccountRuleStoreCache: StoredSatRetentionAccountRuleStore | null = null

export function resolveSatRetentionAccount(params: {
  taxCode: string | null
  rate: number | null
  expenseAccount: string | null
}) {
  const store = readSatRetentionAccountRuleStore()
  const normalizedTaxCode = normalizeTaxCode(params.taxCode)
  const normalizedExpenseAccount = normalizeComparisonKey(params.expenseAccount)
  const roundedRate = params.rate === null ? null : roundToSixDecimals(params.rate)

  const match = store.rules
    .filter((rule) => rule.active)
    .sort((left, right) => right.priority - left.priority)
    .find((rule) => {
      if (rule.taxCode !== null && rule.taxCode !== normalizedTaxCode) {
        return false
      }

      if (rule.rate !== null && rule.rate !== roundedRate) {
        return false
      }

      if (rule.expenseAccountIncludesAny.length === 0) {
        return true
      }

      if (!normalizedExpenseAccount) {
        return false
      }

      return rule.expenseAccountIncludesAny.some((keyword) =>
        normalizedExpenseAccount.includes(keyword),
      )
    })

  if (!match) {
    return null
  }

  return {
    accountName: match.accountName,
    rule: match,
  } satisfies SatRetentionAccountResolution
}

export function getSatRetentionAccountRuleStorePath() {
  return SAT_RETENTION_ACCOUNT_RULE_STORE_PATH
}

function readSatRetentionAccountRuleStore() {
  if (retentionAccountRuleStoreCache) {
    return retentionAccountRuleStoreCache
  }

  if (!fs.existsSync(SAT_RETENTION_ACCOUNT_RULE_STORE_PATH)) {
    const seeded = createSeededRuleStore()
    persistSatRetentionAccountRuleStore(seeded)
    return seeded
  }

  try {
    const raw = fs
      .readFileSync(SAT_RETENTION_ACCOUNT_RULE_STORE_PATH, 'utf8')
      .replace(/^\uFEFF/u, '')
    const parsed = JSON.parse(raw) as Partial<StoredSatRetentionAccountRuleStore>
    const normalized = normalizeSatRetentionAccountRuleStore(parsed)
    if (normalized.rules.length === 0) {
      const seeded = createSeededRuleStore()
      persistSatRetentionAccountRuleStore(seeded)
      return seeded
    }

    retentionAccountRuleStoreCache = normalized
    return normalized
  } catch {
    const seeded = createSeededRuleStore()
    persistSatRetentionAccountRuleStore(seeded)
    return seeded
  }
}

function persistSatRetentionAccountRuleStore(store: StoredSatRetentionAccountRuleStore) {
  const directoryPath = path.dirname(SAT_RETENTION_ACCOUNT_RULE_STORE_PATH)
  fs.mkdirSync(directoryPath, { recursive: true })
  fs.writeFileSync(
    SAT_RETENTION_ACCOUNT_RULE_STORE_PATH,
    JSON.stringify(store, null, 2),
    'utf8',
  )
  retentionAccountRuleStoreCache = store
}

function createSeededRuleStore() {
  const now = new Date().toISOString()

  return {
    version: 1,
    rules: [
      {
        id: 'retention-iva-autotransporte-4',
        label: 'IVA retenido 4% autotransporte terrestre de bienes',
        taxCode: '002',
        rate: 0.04,
        expenseAccountIncludesAny: [],
        accountName: '216-10-00 Impuestos retenidos : Impuestos retenidos de IVA',
        rationale:
          'Retencion de IVA en autotransporte terrestre de bienes. Se reconoce como pasivo de IVA retenido, no como gasto.',
        priority: 300,
        active: true,
        source: 'seed',
        createdAtUtc: now,
        updatedAtUtc: now,
      },
      {
        id: 'retention-iva-servicios-106667',
        label: 'IVA retenido 10.6667%',
        taxCode: '002',
        rate: 0.106667,
        expenseAccountIncludesAny: [],
        accountName: '216-10-00 Impuestos retenidos : Impuestos retenidos de IVA',
        rationale:
          'Retencion de IVA a personas fisicas donde corresponde entero de IVA retenido.',
        priority: 300,
        active: true,
        source: 'seed',
        createdAtUtc: now,
        updatedAtUtc: now,
      },
      {
        id: 'retention-isr-arrendamiento-10',
        label: 'ISR retenido 10% por arrendamiento',
        taxCode: '001',
        rate: 0.1,
        expenseAccountIncludesAny: ['ARRENDAMIENTO', 'ALQUILER', 'LEASE'],
        accountName: '216-03-00 Impuestos retenidos : Impuestos retenidos de ISR por arrendamiento',
        rationale:
          'Cuando el gasto corresponde a arrendamiento se usa la cuenta especifica de ISR retenido por arrendamiento.',
        priority: 400,
        active: true,
        source: 'seed',
        createdAtUtc: now,
        updatedAtUtc: now,
      },
      {
        id: 'retention-isr-servicios-profesionales-10',
        label: 'ISR retenido 10% por servicios profesionales',
        taxCode: '001',
        rate: 0.1,
        expenseAccountIncludesAny: [],
        accountName: '216-04-00 Impuestos retenidos : Impuestos retenidos de ISR por servicios profesionales',
        rationale:
          'Los vendor bills historicos de NetSuite ya usan 216-04-00 para ISR retenido por servicios profesionales.',
        priority: 200,
        active: true,
        source: 'seed',
        createdAtUtc: now,
        updatedAtUtc: now,
      },
      {
        id: 'retention-isr-resico-125',
        label: 'ISR retenido 1.25% RESICO u otros supuestos sin cuenta especifica',
        taxCode: '001',
        rate: 0.0125,
        expenseAccountIncludesAny: [],
        accountName: '216-12-00 Impuestos retenidos : Otras impuestos retenidos',
        rationale:
          'Retencion ISR 1.25% sin cuenta especifica en el plan contable; se concentra en Otras impuestos retenidos hasta definir una cuenta dedicada.',
        priority: 250,
        active: true,
        source: 'seed',
        createdAtUtc: now,
        updatedAtUtc: now,
      },
    ],
  } satisfies StoredSatRetentionAccountRuleStore
}

function normalizeSatRetentionAccountRuleStore(value: Partial<StoredSatRetentionAccountRuleStore> | null | undefined) {
  const rules = Array.isArray(value?.rules)
    ? value.rules
        .map((rule) => normalizeSatRetentionAccountRule(rule))
        .filter((rule): rule is StoredSatRetentionAccountRule => rule !== null)
    : []

  return {
    version: 1,
    rules,
  } satisfies StoredSatRetentionAccountRuleStore
}

function normalizeSatRetentionAccountRule(value: Partial<StoredSatRetentionAccountRule> | null | undefined) {
  const id = cleanText(value?.id)
  const label = cleanText(value?.label)
  const accountName = cleanText(value?.accountName)
  const rationale = cleanText(value?.rationale)
  const source = value?.source === 'manual' ? 'manual' : 'seed'

  if (!id || !label || !accountName || !rationale) {
    return null
  }

  const rawRate = value?.rate
  const normalizedRate =
    typeof rawRate === 'number' && Number.isFinite(rawRate)
      ? roundToSixDecimals(rawRate)
      : rawRate === null
        ? null
        : null

  return {
    id,
    label,
    taxCode: normalizeTaxCode(value?.taxCode),
    rate: normalizedRate,
    expenseAccountIncludesAny: Array.isArray(value?.expenseAccountIncludesAny)
      ? value.expenseAccountIncludesAny
          .map((keyword) => normalizeComparisonKey(keyword))
          .filter((keyword): keyword is string => Boolean(keyword))
      : [],
    accountName,
    rationale,
    priority:
      typeof value?.priority === 'number' && Number.isFinite(value.priority) ? value.priority : 100,
    active: value?.active !== false,
    source,
    createdAtUtc: cleanText(value?.createdAtUtc) || new Date().toISOString(),
    updatedAtUtc: cleanText(value?.updatedAtUtc) || new Date().toISOString(),
  } satisfies StoredSatRetentionAccountRule
}

function normalizeTaxCode(value: unknown) {
  const rawValue = cleanText(value)
  if (!rawValue) {
    return null
  }

  return rawValue.toUpperCase().padStart(3, '0')
}

function normalizeComparisonKey(value: unknown) {
  const rawValue = cleanText(value)
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

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function roundToSixDecimals(value: number) {
  return Number(value.toFixed(6))
}
