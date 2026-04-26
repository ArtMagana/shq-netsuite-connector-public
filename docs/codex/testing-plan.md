# Testing Plan

## Estado actual

- Ya existia `tests/test_engine.py` para el motor Python `netsuite_ar_recon`.
- Esta rama agrega `npm test` con `node:test` en `tests/backend-safety.test.mjs`.
- CI ya corre:
  - build backend
  - build frontend
  - `npm test`
  - encoding check

## Cobertura minima ya implementada

- `backend/src/routes/bancosValidation.ts`
- `backend/src/routes/validationMiddleware.ts`
- `backend/src/internalApiKey.ts`

Objetivo de esta cobertura:

- detectar regresiones obvias de guards
- asegurar que `validateBody(...)` mantiene `{ error, code }`
- asegurar que `requireInternalApiKey(...)` mantiene status y `code`

## Runner recomendado por etapa

### Etapa actual

- `node:test` para pruebas JS pequenas sobre `backend/dist`
- `python -m unittest` para el motor Python ya existente

Motivo:

- no agrega framework nuevo
- no mete transformadores TS
- no toca integraciones reales
- entra limpio en CI

### Etapa futura opcional

- `tsx` + `node:test` si se vuelve necesario testear TypeScript sin pasar por `dist`

Motivo:

- mantiene un stack ligero
- evita introducir Vitest/Jest todavia

## Prioridades siguientes

1. `backend/src/routes/bancosRoutes.ts`
2. `backend/src/routes/inventarioRoutes.ts`
3. `tools/check-text-encoding.py`
4. `frontend/src/services/api/httpErrors.ts`
5. `frontend/src/services/api/httpClient.ts`

## Casos sugeridos

### Bancos routes

- `POST /api/bancos/analyze` rechaza payload invalido con `BANK_ANALYZE_VALIDATION_ERROR`
- `POST /api/bancos/analysis/start` exige internal API key y payload valido
- `POST /api/bancos/analysis/recover` conserva contrato legacy de error

### Inventario routes

- construir el router con deps stub sin fallar
- `requireInternalApiKey` se conecta en endpoints mutantes
- errores route-local siguen devolviendo `{ error }`

### Encoding tool

- archivo con BOM falla
- archivo con bidi oculto falla
- archivo normal pasa

### Frontend API helpers

- `getHttpErrorMessage(...)` prefiere `errorMessage`
- `getHttpErrorCode(...)` extrae `errorCode`
- `isHttpClientError(...)` discrimina correctamente

## Estrategia de CI recomendada

### Ahora

- dejar `npm test` despues del build
- no bloquear por coverage aun
- no agregar E2E

### Despues

- sumar Python unittest explicitamente al workflow
- evaluar smoke de docker build
- evaluar snapshot o smoke visual solo cuando haya componentes compartidos

## Que no hacer todavia

- no meter Playwright
- no meter coverage minima 80%
- no agregar mocks de NetSuite/SAT/Banxico sin un diseno de adapters
- no mezclar pruebas unitarias con integraciones reales
