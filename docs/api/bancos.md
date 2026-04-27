# Bancos API

## Estado

Los siguientes endpoints ya viven en `backend/src/routes/bancosRoutes.ts`:

- `GET /api/bancos/config`
- `POST /api/bancos/analyze`
- `POST /api/bancos/analysis/start`
- `POST /api/bancos/analysis/recover`
- `GET /api/bancos/analysis/:analysisId`

Otros endpoints de `bancos` siguen en `backend/src/app.ts` y mantienen contratos legacy.

## GET /api/bancos/config

- Proteccion: ninguna
- Payload esperado: no aplica
- Respuesta exitosa:
  - devuelve el JSON producido por `getBankImportConfig()`
- Respuesta de error:
  - no hay manejo de error especifico en el router; cualquier error sube al middleware global

## POST /api/bancos/analyze

- Proteccion: ninguna
- Payload esperado:
  - validacion de ruta minima confirmada:
    - `bankId: string` no vacio
  - cualquier campo adicional se reenvia a `analyzeBankImport(request.body)` sin validacion adicional en el router
- Respuesta exitosa:
  - devuelve el JSON resuelto por `analyzeBankImport(request.body)`
- Respuesta de error de validacion:
  - status `400`
  - body:

```json
{
  "error": "La solicitud de analisis bancario no es valida.",
  "code": "BANK_ANALYZE_VALIDATION_ERROR"
}
```

- Otros errores:
  - errores asincronos del handler suben al middleware global
  - el middleware global responde con `success`, `error` y `code`
- Codigos posibles confirmados en la ruta:
  - `BANK_ANALYZE_VALIDATION_ERROR`

## POST /api/bancos/analysis/start

- Proteccion: `x-internal-api-key`
- Payload esperado:
  - validacion de ruta minima confirmada:
    - `bankId: string` no vacio
    - `fileName: string` no vacio
    - `fileBase64: string` no vacio
  - puede haber campos adicionales aceptados por capas inferiores, pero este router solo confirma los tres campos anteriores
- Respuesta exitosa:
  - devuelve el `BancosServiceResult` exitoso producido por `startBankImportAnalysisRun(request.body)`
- Respuesta de error de autenticacion:
  - status `401` o `503` segun el caso
  - body:

```json
{
  "error": "Invalid internal API key.",
  "code": "INTERNAL_API_KEY_INVALID"
}
```

o

```json
{
  "error": "Internal API key is not configured.",
  "code": "INTERNAL_API_KEY_MISSING"
}
```

- Respuesta de error de validacion:
  - status `400`
  - body:

```json
{
  "error": "La solicitud de analisis bancario no es valida.",
  "code": "BANK_ANALYSIS_START_VALIDATION_ERROR"
}
```

- Respuesta de error de servicio:
  - status `400`
  - body:

```json
{
  "success": false,
  "error": "string",
  "code": "string"
}
```

- Codigos posibles confirmados en la ruta:
  - `INTERNAL_API_KEY_INVALID`
  - `INTERNAL_API_KEY_MISSING`
  - `BANK_ANALYSIS_START_VALIDATION_ERROR`
  - codigos devueltos por `startBankImportAnalysisRun(...)` cuando responde `success: false`

## POST /api/bancos/analysis/recover

- Proteccion: `x-internal-api-key`
- Payload esperado:
  - el router no valida el body
  - el body se reenvia a `recoverBankImportAnalysisRun(request.body)`
  - hoy la funcion downstream acepta el mismo shape base que `analysis/start`, pero esa precondicion no se valida en el borde HTTP
- Respuesta exitosa:
  - devuelve el JSON resuelto por `recoverBankImportAnalysisRun(request.body)`
- Respuesta de error de autenticacion:
  - status `401` o `503`
  - body con `error` y `code`
  - codigos confirmados:
    - `INTERNAL_API_KEY_INVALID`
    - `INTERNAL_API_KEY_MISSING`

```json
{
  "error": "string",
  "code": "string"
}
```
- Respuesta de error de dominio:
  - mantiene el contrato legacy actual
  - status `error.status` cuando el error es `BankImportError`, en otro caso `503`
  - body:

```json
{
  "error": "string"
}
```

## GET /api/bancos/analysis/:analysisId

- Proteccion: ninguna
- Payload esperado:
  - parametro de ruta `analysisId`
- Respuesta exitosa:
  - devuelve el JSON resuelto por `getBankImportAnalysisRunStatus(analysisId)`
- Respuesta de error:
  - mantiene el contrato legacy actual
  - status `error.status` cuando el error es `BankImportError`, en otro caso `503`
  - body:

```json
{
  "error": "string"
}
```

## Nota de migracion

- El contrato `error + code` ya esta confirmado en validacion de:
  - `POST /api/bancos/analyze`
  - `POST /api/bancos/analysis/start`
- `analysis/recover` y `analysis/:analysisId` ya viven en el router, pero conservan sus respuestas legacy de error para evitar cambios funcionales innecesarios en esta rama.
- Endpoints mas complejos de `bancos` como `candidates`, `cep`, `journals`, `history/upload`, `corrections` y otros siguen en `backend/src/app.ts`.
