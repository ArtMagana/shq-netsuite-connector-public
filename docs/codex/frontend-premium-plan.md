# Frontend Premium Plan

## Estado actual del frontend

- React 19
- React Router 7 con `HashRouter`
- Bootstrap como base visual
- TypeScript `strict: true`
- paginas grandes por feature
- capa API concentrada en `frontend/src/services/api/httpClient.ts`
- helpers de error en `frontend/src/services/api/httpErrors.ts`

## Riesgos actuales

- paginas demasiado grandes:
  - `BancosPage.tsx`
  - `FacturasSatPage.tsx`
  - `EgresosPage.tsx`
- server state mezclado con UI state local
- manejo de loading/error no completamente unificado
- poca reutilizacion de componentes funcionales

## Server state vs UI state

### Server state

- respuestas HTTP
- caches
- reintentos
- invalidacion

### UI state

- tabs locales
- filtros locales
- dialogos
- formularios en edicion

## Cuando introducir TanStack Query

Si y solo si:

- los contratos de error del backend ya son mas uniformes
- existe al menos una feature piloto contenida
- se necesita cache, refetch y estados asincronos repetidos

No recomendado todavia:

- instalarlo globalmente en esta rama

## Cuando introducir Zustand

Solo si aparece estado compartido transfeature que ya no quepa limpio en props ni hooks locales.

No recomendado todavia:

- usarlo como reemplazo general de todo el state local

## Componentes compartidos sugeridos

- `LoadingBlock`
- `ErrorPanel`
- `DataTable`
- `FormField`
- `ConfirmDialog`
- `StatusBadge`

## Estrategia de migracion por feature

1. elegir una feature contenida
2. extraer componentes pequenos
3. unificar loading/error
4. luego evaluar server-state layer

## Primera feature candidata

- `frontend/src/features/inventory/InventorySettingsPage.tsx`

Motivos:

- alcance mas acotado que `BancosPage.tsx`
- ya esta cerca de un dominio parcialmente aislado en backend
- serviria para pilotear formularios, errores y acciones protegidas sin reescribir todo el frontend

## Que no hacer todavia

- no instalar TanStack Query
- no instalar Zustand
- no rehacer pantallas masivamente
- no activar una refactorizacion visual grande
- no mezclar esta fase con rediseño visual
