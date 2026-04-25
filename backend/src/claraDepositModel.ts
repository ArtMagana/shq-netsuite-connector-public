import type { BankImportMappingSheet, BankImportSuggestedCandidate } from './types.js'

type MappingSheetKey = BankImportMappingSheet['key']

export type ClaraDepositSeedMapping = {
  counterpartyName: string
  mappingSheetKey: MappingSheetKey
  netsuiteName: string
}

type OrderingPartyAlias = {
  matchCompactNames: string[]
  matchRfc?: string | null
  canonicalCounterpartyName: string
}

export type ClaraDepositOrderingPartyResolution = {
  counterpartyName: string
}

export type ClaraDepositAutoCandidateResolution = {
  candidate: BankImportSuggestedCandidate
  preferredTransactionType: string | null
}

const ORDERING_PARTY_ALIASES: OrderingPartyAlias[] = [
  {
    matchCompactNames: ['BBVABANCOMERSISTEMADEPAGO'],
    matchRfc: 'BBA830831LJ2',
    canonicalCounterpartyName: 'BBVA Mexico SA',
  },
]

const SEEDED_MAPPINGS: ClaraDepositSeedMapping[] = [
  {
    counterpartyName: 'BBVA Mexico SA',
    mappingSheetKey: 'suppliers',
    netsuiteName: 'BBVA Mexico SA',
  },
  {
    counterpartyName: 'GCE HEALTH & BEAUTY S DE RL DE CV',
    mappingSheetKey: 'customers',
    netsuiteName: '100 GCE HEALTH & BEAUTY',
  },
  {
    counterpartyName: 'HUNAB CHEMICALS SA D E CV',
    mappingSheetKey: 'suppliers',
    netsuiteName: 'Hunab Chemicals SA de CV',
  },
]

const SUPPLIER_REFUND_KEYWORDS = [
  'DEVOLUCION',
  'DEPOSITO INDEBIDO',
  'DEVOLUCION DEPOSITO INDEBIDO',
  'REEMBOLSO',
  'REINTEGRO',
]

export function getClaraDepositSeedMappings() {
  return [...SEEDED_MAPPINGS]
}

export function resolveClaraDepositOrderingParty(input: {
  orderingPartyName: string | null
  orderingPartyRfc?: string | null
  beneficiaryName?: string | null
  trackingKey?: string | null
  referenceNumber?: string | null
}): ClaraDepositOrderingPartyResolution | null {
  const cleanedOrderingName = cleanText(input.orderingPartyName)
  if (!cleanedOrderingName) {
    return null
  }

  const alias = ORDERING_PARTY_ALIASES.find((item) => {
    if (item.matchRfc && compactText(item.matchRfc) !== compactText(input.orderingPartyRfc)) {
      return false
    }

    const compactOrderingName = compactText(cleanedOrderingName)
    return item.matchCompactNames.some((matchName) => compactOrderingName === compactText(matchName))
  })
  if (alias) {
    return {
      counterpartyName: alias.canonicalCounterpartyName,
    }
  }

  if (!isMeaningfulClaraCounterpartyName(cleanedOrderingName, input.trackingKey, input.referenceNumber)) {
    return null
  }

  if (compactText(cleanedOrderingName) === compactText(input.beneficiaryName)) {
    return null
  }

  return {
    counterpartyName: cleanedOrderingName,
  }
}

export function pickClaraDepositAutoCandidate(input: {
  counterpartyName: string
  statementCounterpartyName: string | null
  paymentConcept: string | null
  candidates: BankImportSuggestedCandidate[]
}): ClaraDepositAutoCandidateResolution | null {
  const highConfidenceCandidates = dedupeCandidates(input.candidates).filter((candidate) => candidate.score >= 0.99)
  if (highConfidenceCandidates.length === 0) {
    return null
  }

  const seededResolution = resolveSeededCandidate(input.counterpartyName, highConfidenceCandidates)
  if (seededResolution) {
    return seededResolution
  }

  if (looksLikeSupplierRefund(input.counterpartyName, input.statementCounterpartyName, input.paymentConcept)) {
    const supplierCandidate = selectBestCandidate(highConfidenceCandidates, 'suppliers')
    if (supplierCandidate) {
      return {
        candidate: supplierCandidate,
        preferredTransactionType: 'DEPOSIT',
      }
    }
  }

  if (highConfidenceCandidates.length === 1) {
    const [candidate] = highConfidenceCandidates
    return {
      candidate,
      preferredTransactionType: candidate.mappingSheetKey === 'suppliers' ? 'DEPOSIT' : null,
    }
  }

  const uniqueEntityMatches = dedupeByEntity(highConfidenceCandidates)
  if (uniqueEntityMatches.length === 1) {
    const [candidate] = uniqueEntityMatches
    return {
      candidate,
      preferredTransactionType: candidate.mappingSheetKey === 'suppliers' ? 'DEPOSIT' : null,
    }
  }

  return null
}

function resolveSeededCandidate(
  counterpartyName: string,
  candidates: BankImportSuggestedCandidate[],
): ClaraDepositAutoCandidateResolution | null {
  const normalizedCounterpartyName = normalizeText(counterpartyName)
  const seededMapping = SEEDED_MAPPINGS.find((item) => normalizeText(item.counterpartyName) === normalizedCounterpartyName)
  if (!seededMapping) {
    return null
  }

  const candidate = candidates.find(
    (item) =>
      item.mappingSheetKey === seededMapping.mappingSheetKey &&
      normalizeText(item.netsuiteName) === normalizeText(seededMapping.netsuiteName),
  )
  if (!candidate) {
    return null
  }

  return {
    candidate,
    preferredTransactionType: candidate.mappingSheetKey === 'suppliers' ? 'DEPOSIT' : null,
  }
}

function looksLikeSupplierRefund(
  counterpartyName: string,
  statementCounterpartyName: string | null,
  paymentConcept: string | null,
) {
  const comparableValues = [
    normalizeText(counterpartyName),
    normalizeText(statementCounterpartyName),
    normalizeText(paymentConcept),
  ].filter(Boolean)

  return SUPPLIER_REFUND_KEYWORDS.some((keyword) =>
    comparableValues.some((value) => value.includes(normalizeText(keyword))),
  )
}

function selectBestCandidate(candidates: BankImportSuggestedCandidate[], mappingSheetKey: MappingSheetKey) {
  return candidates
    .filter((candidate) => candidate.mappingSheetKey === mappingSheetKey)
    .sort(compareCandidates)[0]
}

function dedupeCandidates(candidates: BankImportSuggestedCandidate[]) {
  const merged = new Map<string, BankImportSuggestedCandidate>()

  candidates.forEach((candidate) => {
    const key = [candidate.mappingSheetKey, normalizeText(candidate.netsuiteName), normalizeText(candidate.creditAccount)].join(':')
    const current = merged.get(key)
    if (!current || compareCandidates(candidate, current) < 0) {
      merged.set(key, candidate)
    }
  })

  return Array.from(merged.values()).sort(compareCandidates)
}

function dedupeByEntity(candidates: BankImportSuggestedCandidate[]) {
  const merged = new Map<string, BankImportSuggestedCandidate>()

  candidates.forEach((candidate) => {
    const key = [candidate.mappingSheetKey, normalizeText(candidate.netsuiteName)].join(':')
    const current = merged.get(key)
    if (!current || compareCandidates(candidate, current) < 0) {
      merged.set(key, candidate)
    }
  })

  return Array.from(merged.values()).sort(compareCandidates)
}

function compareCandidates(left: BankImportSuggestedCandidate, right: BankImportSuggestedCandidate) {
  return (
    right.score - left.score ||
    left.mappingSheetKey.localeCompare(right.mappingSheetKey) ||
    left.netsuiteName.localeCompare(right.netsuiteName) ||
    left.creditAccount.localeCompare(right.creditAccount)
  )
}

function cleanText(value: unknown) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

function normalizeText(value: unknown) {
  return cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
}

function compactText(value: unknown) {
  return normalizeText(value).replace(/[^A-Z0-9]/g, '')
}

function isMeaningfulClaraCounterpartyName(
  value: string | null | undefined,
  trackingKey: string | null | undefined,
  referenceNumber: string | null | undefined,
) {
  const cleanedValue = cleanText(value)
  const compactValue = compactText(cleanedValue)
  if (!cleanedValue || !compactValue) {
    return false
  }

  if (compactValue === compactText(trackingKey) || compactValue === compactText(referenceNumber)) {
    return false
  }

  if (/^\d+$/u.test(cleanedValue)) {
    return false
  }

  if (/^(?=.*\d)[A-Z0-9]{12,}$/u.test(compactValue)) {
    return false
  }

  if (compactValue.startsWith('DEPOSITREF')) {
    return false
  }

  const unicodeLetters = cleanedValue.match(/\p{L}/gu) ?? []
  return unicodeLetters.length >= 4
}
