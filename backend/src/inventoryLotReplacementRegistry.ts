import { promises as fs } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

type InventoryLotReplacementRegistryEntry = {
  itemId: string
  lot: string
  productionDate: string
  expirationDate: string
  coaFileName: string
  adjustmentId: string
  tranId: string | null
  accountId: string
  executedAtUtc: string
}

const moduleDir = dirname(fileURLToPath(import.meta.url))
const backendRootDir = resolve(moduleDir, '..')
const registryPath = resolve(backendRootDir, 'storage', 'inventory-lot-replacements.json')

export async function findInventoryLotReplacementRegistryEntry(itemId: string, lot: string) {
  const entries = await loadRegistryEntries()

  return (
    entries.find(
      (entry) =>
        normalizeForMatch(entry.itemId) === normalizeForMatch(itemId) &&
        normalizeForMatch(entry.lot) === normalizeForMatch(lot),
    ) ?? null
  )
}

export async function upsertInventoryLotReplacementRegistryEntry(
  entry: InventoryLotReplacementRegistryEntry,
) {
  const entries = await loadRegistryEntries()
  const nextEntries = entries.filter(
    (candidate) =>
      !(
        normalizeForMatch(candidate.itemId) === normalizeForMatch(entry.itemId) &&
        normalizeForMatch(candidate.lot) === normalizeForMatch(entry.lot)
      ),
  )

  nextEntries.unshift(entry)
  await fs.mkdir(dirname(registryPath), { recursive: true })
  await fs.writeFile(registryPath, JSON.stringify(nextEntries, null, 2), 'utf8')
}

async function loadRegistryEntries() {
  try {
    const fileContents = await fs.readFile(registryPath, 'utf8')
    const parsed = JSON.parse(fileContents)
    return Array.isArray(parsed)
      ? parsed.filter(isRegistryEntry)
      : ([] as InventoryLotReplacementRegistryEntry[])
  } catch {
    return [] as InventoryLotReplacementRegistryEntry[]
  }
}

function isRegistryEntry(value: unknown): value is InventoryLotReplacementRegistryEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false
  }

  const candidate = value as Record<string, unknown>
  return [
    candidate.itemId,
    candidate.lot,
    candidate.productionDate,
    candidate.expirationDate,
    candidate.coaFileName,
    candidate.adjustmentId,
    candidate.accountId,
    candidate.executedAtUtc,
  ].every((field) => typeof field === 'string' && field.trim())
}

function normalizeForMatch(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '')
    .toLowerCase()
}
