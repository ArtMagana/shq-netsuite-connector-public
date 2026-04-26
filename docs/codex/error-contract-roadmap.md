# Error Contract Roadmap

## Contrato actual

Hoy conviven al menos cuatro patrones:

1. `{ error, code }`
2. `{ error }`
3. `{ success: false, error, code }`
4. respuestas de dominio como `{ success: false, ... }` fuera del middleware global

## Rutas ya alineadas mejor

- `backend/src/routes/validationMiddleware.ts`
- `backend/src/internalApiKey.ts`
- validaciones de `bancosRoutes.ts`
- `errorMiddleware.ts` cuando recibe `AppError` o errores con `code`

## Rutas legacy identificadas

### Legacy con `{ error }`

- `backend/src/routes/inventarioRoutes.ts`
- `POST /api/bancos/analysis/recover`
- `GET /api/bancos/analysis/:analysisId`
- gran parte de las rutas que siguen en `backend/src/app.ts`

### Mixed envelope

- `errorMiddleware.ts` responde `{ success: false, error, code }`
- `startBankImportAnalysisRun(...)` ya devuelve un shape de dominio propio cuando falla

## Contrato objetivo recomendado

### Objetivo pragmatica de corto plazo

- todos los errores route-local deben devolver:
  - `error`
  - `code`

### Decision pendiente para mediano plazo

- decidir si toda la app debe usar o no `success: false`

Recomendacion:

- no imponer `success: false` global todavia
- primero unificar `error` y `code`

Motivo:

- es menos disruptivo para frontend y tooling interno

## Orden de migracion sugerido

1. `inventarioRoutes.ts`
2. rutas ya extraidas de `bancos`
3. helpers comunes para `app.ts`
4. bloques legacy de `app.ts` por dominio
5. decision final de envelope global

## Estrategia por fase

### Fase 1

- documentar que rutas siguen legacy
- no tocar status HTTP exitosos

### Fase 2

- agregar `code` a inventario y nuevos routers pequenos

### Fase 3

- introducir helper comun para errores route-local

### Fase 4

- decidir si `errorMiddleware` y las rutas locales convergen al mismo envelope

## Riesgos

- cambiar todos los contratos legacy en una sola rama rompe clientes
- mezclar error contract con refactor masivo de `app.ts` agranda demasiado el diff

## Validaciones necesarias por PR

- backend build
- `npm test`
- smoke manual de frontend si una vista consume el endpoint
- `git diff --check`
- `python tools/check-text-encoding.py`
