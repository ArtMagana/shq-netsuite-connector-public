export type EntityTabSlug = 'clientes' | 'proveedores' | 'cuentas'

export type EntityTabDefinition = {
  slug: EntityTabSlug
  label: string
  description: string
}

export const entityTabs: EntityTabDefinition[] = [
  {
    slug: 'clientes',
    label: 'Clientes',
    description: 'Base local de clientes para equivalencias y busquedas.',
  },
  {
    slug: 'proveedores',
    label: 'Proveedores',
    description: 'Base local de proveedores desde NetSuite.',
  },
  {
    slug: 'cuentas',
    label: 'Cuentas',
    description: 'Catalogo contable local y carga de cuentas faltantes.',
  },
]

export function resolveEntityTab(value: string | null | undefined) {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (!normalized) {
    return null
  }
  return entityTabs.find((item) => item.slug === normalized) ?? null
}

export function getEntityTabPath(slug: EntityTabSlug) {
  return `/entidades/${slug}`
}
