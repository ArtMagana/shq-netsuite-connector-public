# Runtime Validation Plan

## Estado actual

- No existe `zod` en dependencias del backend.
- El backend ya cuenta con:
  - `validateBody(...)`
  - guards manuales en `backend/src/routes/bancosValidation.ts`
  - contratos `{ error, code }` para validaciones de bancos

## Objetivo

Introducir validacion runtime mas expresiva sin reescribir todos los endpoints ni romper contratos legacy.

## Endpoints prioritarios

1. `POST /api/bancos/analyze`
2. `POST /api/bancos/analysis/start`

Motivo:

- ya tienen guards
- ya tienen codigos de error especificos
- son el mejor piloto para convivir con el stack actual

## Propuesta incremental

### Fase 1

- agregar `zod` al backend
- crear schemas pequenos solo para bancos
- adaptar `validateBody(...)` o agregar un middleware hermano para schema parsing

### Fase 2

- mantener el contrato existente:
  - status `400`
  - `{ error, code }`

### Fase 3

- documentar como conviven guards legacy y schemas nuevos

## Patron sugerido

Ejemplo conceptual:

1. schema Zod parsea request body
2. si falla, el middleware responde:
   - `error`
   - `code`
3. si pasa, la ruta recibe body ya normalizado

## Convivencia con `validateBody(...)`

Opciones seguras:

- mantener `validateBody(...)` para type guards existentes
- agregar `validateSchema(...)` solo para endpoints nuevos o migrados

No recomendado en esta rama:

- reemplazar todos los guards manuales de golpe

## Error format recomendado

- `error`: mensaje corto y estable
- `code`: codigo de dominio o validacion

No agregar todavia:

- detalle estructurado por campo en toda la API

Motivo:

- eso obliga a revisar consumidores frontend antes de estandarizarlo

## Riesgos de hacerlo de golpe

- mensajes de error distintos en endpoints legacy
- cambios de parseo en rutas sensibles
- tentacion de migrar SAT/NetSuite sin pruebas suficientes

## Primer PR recomendado

- agregar `zod`
- crear `bancosAnalyzeSchema`
- crear `bancosAnalysisStartSchema`
- pilotear solo esos dos endpoints

## Archivos candidatos

- `backend/src/routes/bancosValidation.ts`
- `backend/src/routes/validationMiddleware.ts`
- `backend/src/routes/bancosRoutes.ts`
- `backend/src/routes/httpTypes.ts`

## Validaciones necesarias

- backend build
- `npm test`
- request invalido devuelve `400` con `code`
- request valido mantiene response exitosa actual
- CI verde

## Que no se implemento todavia

- no se agrego `zod`
- no se migraron endpoints SAT
- no se migraron endpoints NetSuite
- no se migraron rutas legacy fuera de bancos
