export type SatAutoProviderKind = 'uber' | 'nuevo_proveedor'
export type SatAutoProviderScenario = 'individual' | 'company'

export type SatAutoProviderCandidate = {
  kind: SatAutoProviderKind
  scenario: SatAutoProviderScenario
  nombreEmisor: string | null
  rfcEmisor: string
  defaultExpenseAccount: string
  defaultPayablesAccount: string
}

export type SatAutoVendorDraft = {
  kind: SatAutoProviderKind
  scenario: SatAutoProviderScenario
  isPerson: boolean
  entityId: string
  companyName: string
  legalName: string
  firstName: string | null
  lastName: string | null
}

const SAT_UBER_CLAVE_PROD_SERV = '78111808'
const SAT_UBER_ALLOWED_AUXILIARY_CLAVES = new Set(['93161600'])
const SAT_RESTAURANT_CLAVE_PROD_SERV = '90101501'

export const SAT_AUTO_DEFAULT_PAYABLES_ACCOUNT =
  '201-02-00 Proveedores : Proveedores nacionales'
export const SAT_UBER_DEFAULT_EXPENSE_ACCOUNT =
  '78111808 Transporte de pasajeros : Alquiler de vehiculos'
export const SAT_RESTAURANT_DEFAULT_EXPENSE_ACCOUNT =
  '90101501 Establecimientos para comer y beber : Restaurantes'
export const SAT_UBER_DEFAULT_COMPANY_NAME = 'Uber'

export function classifySatAutoProviderCandidate(params: {
  nombreEmisor?: string | null
  rfcEmisor?: string | null
  concepts: Array<{ claveProdServ?: string | null }>
}): SatAutoProviderCandidate | null {
  const normalizedRfc = normalizeRfc(params.rfcEmisor)
  if (!normalizedRfc) {
    return null
  }

  const normalizedClaves = Array.isArray(params.concepts)
    ? params.concepts
        .map((concept) => normalizeClaveProdServ(concept.claveProdServ))
        .filter((item): item is string => Boolean(item))
    : []
  if (normalizedClaves.length === 0) {
    return null
  }

  const providerKind = resolveAutoProviderKind(normalizedClaves)
  if (!providerKind) {
    return null
  }

  const scenario = resolveProviderScenario(normalizedRfc)
  if (!scenario) {
    return null
  }

  return {
    kind: providerKind,
    scenario,
    nombreEmisor: cleanText(params.nombreEmisor),
    rfcEmisor: normalizedRfc,
    defaultExpenseAccount: resolveDefaultExpenseAccount(providerKind),
    defaultPayablesAccount: SAT_AUTO_DEFAULT_PAYABLES_ACCOUNT,
  }
}

export function buildSatNuevoProveedorCandidate(params: {
  nombreEmisor?: string | null
  rfcEmisor?: string | null
  defaultExpenseAccount?: string | null
}): SatAutoProviderCandidate | null {
  const normalizedRfc = normalizeRfc(params.rfcEmisor)
  const defaultExpenseAccount = cleanText(params.defaultExpenseAccount)
  if (!normalizedRfc || !defaultExpenseAccount) {
    return null
  }

  const scenario = resolveProviderScenario(normalizedRfc)
  if (!scenario) {
    return null
  }

  return {
    kind: 'nuevo_proveedor',
    scenario,
    nombreEmisor: cleanText(params.nombreEmisor),
    rfcEmisor: normalizedRfc,
    defaultExpenseAccount,
    defaultPayablesAccount: SAT_AUTO_DEFAULT_PAYABLES_ACCOUNT,
  }
}

export function buildSatAutoVendorDraft(candidate: SatAutoProviderCandidate): SatAutoVendorDraft {
  const nombreEmisor = cleanText(candidate.nombreEmisor)
  if (!nombreEmisor) {
    throw new Error(
      `La factura ${candidate.rfcEmisor} requiere alta automatica de proveedor, pero no trae NombreEmisor utilizable.`,
    )
  }

  if (candidate.scenario === 'individual') {
    const splitName = splitIndividualFullName(nombreEmisor)
    const preservedName = preserveVendorName(candidate.kind, nombreEmisor)
    return {
      kind: candidate.kind,
      scenario: 'individual',
      isPerson: true,
      entityId: nombreEmisor,
      companyName: preservedName,
      legalName: preservedName,
      firstName: splitName.firstName,
      lastName: splitName.lastName,
    }
  }

  const companyName =
    candidate.kind === 'uber' ? SAT_UBER_DEFAULT_COMPANY_NAME : nombreEmisor
  return {
    kind: candidate.kind,
    scenario: 'company',
    isPerson: false,
    entityId: nombreEmisor,
    companyName,
    legalName: companyName,
    firstName: null,
    lastName: null,
  }
}

function resolveAutoProviderKind(
  normalizedClaves: string[],
): SatAutoProviderKind | null {
  const hasUberTransportLine = normalizedClaves.includes(SAT_UBER_CLAVE_PROD_SERV)
  const allUberLines = normalizedClaves.every(
    (clave) => clave === SAT_UBER_CLAVE_PROD_SERV || SAT_UBER_ALLOWED_AUXILIARY_CLAVES.has(clave),
  )
  if (hasUberTransportLine && allUberLines) {
    return 'uber'
  }

  const allRestaurantLines = normalizedClaves.every(
    (clave) => clave === SAT_RESTAURANT_CLAVE_PROD_SERV,
  )
  if (allRestaurantLines) {
    return 'nuevo_proveedor'
  }

  return null
}

function resolveProviderScenario(rfc: string): SatAutoProviderScenario | null {
  if (rfc.length === 13) {
    return 'individual'
  }

  if (rfc.length === 12) {
    return 'company'
  }

  return null
}

function resolveDefaultExpenseAccount(kind: SatAutoProviderKind) {
  switch (kind) {
    case 'uber':
      return SAT_UBER_DEFAULT_EXPENSE_ACCOUNT
    case 'nuevo_proveedor':
      return SAT_RESTAURANT_DEFAULT_EXPENSE_ACCOUNT
  }
}

function preserveVendorName(kind: SatAutoProviderKind, nombreEmisor: string) {
  if (kind === 'uber') {
    return `${nombreEmisor} (Uber)`
  }

  return nombreEmisor
}

function splitIndividualFullName(fullName: string) {
  const parts = fullName.split(/\s+/).map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) {
    return {
      firstName: fullName,
      lastName: 'Proveedor',
    }
  }

  if (parts.length >= 5) {
    return {
      firstName: parts.slice(0, -2).join(' '),
      lastName: parts.slice(-2).join(' '),
    }
  }

  if (parts.length === 4) {
    return {
      firstName: parts.slice(0, 2).join(' '),
      lastName: parts.slice(2).join(' '),
    }
  }

  if (parts.length === 3) {
    return {
      firstName: parts[0],
      lastName: parts.slice(1).join(' '),
    }
  }

  if (parts.length === 2) {
    return {
      firstName: parts[0],
      lastName: parts[1],
    }
  }

  return {
    firstName: parts[0],
    lastName: 'Proveedor',
  }
}

function normalizeClaveProdServ(value: string | null | undefined) {
  const normalized = cleanText(value)
  return normalized ? normalized.replace(/\s+/g, '') : null
}

function normalizeRfc(value: string | null | undefined) {
  const normalized = cleanText(value)
  if (!normalized) {
    return null
  }

  return normalized.toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function cleanText(value: unknown) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim()
  return normalized ? normalized : null
}

export {
  classifySatAutoProviderCandidate as classifySatUberProviderCandidate,
  buildSatAutoVendorDraft as buildSatUberVendorDraft,
  SAT_AUTO_DEFAULT_PAYABLES_ACCOUNT as SAT_UBER_DEFAULT_PAYABLES_ACCOUNT,
}
