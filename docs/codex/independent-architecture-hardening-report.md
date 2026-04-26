# Independent Architecture Hardening Report

## Estado actual del repo

- Rama de trabajo: `codex/independent-architecture-hardening-pass`.
- `main` no fue modificado y no se hizo merge.
- El PR #81 sigue en draft.
- La rama ya contiene una pasada de hardening incremental, con cambios pequenos y revisables por commit.
- No se ejecutaron integraciones reales contra NetSuite, SAT, Banxico, bancos, NAS ni otros servicios externos.

## Auditoria inicial

### Alcance auditado al inicio de la rama

- `backend/src/app.ts`
- `backend/src/routes/bancosRoutes.ts`
- `backend/src/routes/bancosValidation.ts`
- `backend/src/routes/validationMiddleware.ts`
- `backend/src/services/bancosService.ts`
- `backend/src/routes/errorMiddleware.ts`
- `backend/src/errors/AppError.ts`
- `backend/src/internalApiKey.ts`
- `backend/src/runtimeSecurity.ts`
- `backend/src/routes/basicRoutes.ts`
- `frontend/src/services/api/httpClient.ts`
- `.github/workflows/ci.yml`
- `Dockerfile`
- `.gitattributes`
- `.editorconfig`

### Que estaba bien desde el inicio

- `runtimeSecurity.ts` ya centralizaba CORS y limites de JSON.
- `AppError` y `errorMiddleware` ya daban una base comun para errores tipados.
- `bancosRoutes.ts` ya habia empezado a sacar responsabilidad de `app.ts`.
- `bancosService.ts` ya devolvia un resultado tipado para el arranque de analisis.
- `frontend/src/services/api/httpClient.ts` ya concentraba la capa de `fetch`.
- `.editorconfig` y `.gitattributes` ya marcaban UTF-8 y fin de linea.
- CI ya tenia cache por lockfile.
- `Dockerfile` ya usaba multi-stage build.

### Riesgos y deuda detectados en la auditoria inicial

- `backend/src/app.ts` seguia demasiado grande y con mucho wiring manual.
- La estrategia de errores era heterogenea:
  - algunas rutas devolvian `{ success: false, error, code }`
  - otras devolvian solo `{ error }`
  - otras dependian del middleware global
- `basicRoutes.ts` usaba `any` de forma amplia.
- `internalApiKey.ts` no devolvia `code`.
- `validationMiddleware.ts` ya aceptaba `code`, pero `bancosRoutes.ts` todavia no lo aprovechaba.
- No existia diagnostico automatizado para BOM, bidi e invisibles peligrosos.
- La plataforma estaba desalineada:
  - CI usa Node 22
  - Docker usa Node 24
  - `npm --prefix backend ci` mostraba warnings `EBADENGINE`

### Validaciones ejecutadas al inicio

- `pwd`
- `ls`
- `git status`
- verificacion de `backend/package.json`
- `npm --prefix backend ci`
- `npm --prefix frontend ci`
- `npm --prefix backend run build`

Resultado de arranque:

- `npm --prefix backend run build`: OK
- `npm --prefix backend ci`: OK con warnings `EBADENGINE`
- `npm --prefix frontend ci`: OK

## Cambios ya aplicados en esta rama

### Guardrails y CI

- CI sigue usando `npm --prefix backend ci` y `npm --prefix frontend ci`.
- CI ahora ejecuta `python3 tools/check-text-encoding.py`.
- El ultimo GitHub Actions CI del PR esta en verde.
- Se agrego `tools/check-text-encoding.py` para detectar:
  - BOM
  - caracteres bidireccionales ocultos
  - caracteres invisibles peligrosos
- No se agrego script root `check:encoding` en `package.json`.
  - se intento un fallback `python || python3`
  - se descarto porque no fue seguro en PowerShell
  - se prefirio mantener el guardrail en CI y por comando directo para no introducir una trampa cross-shell

### Contrato minimo de errores HTTP

- `backend/src/routes/httpTypes.ts` ahora expone:
  - `ErrorResponse`
  - `ValidationErrorResponse`
  - `AuthErrorResponse`
- `validationMiddleware.ts` usa `ValidationErrorResponse`.
- `internalApiKey.ts` ahora conserva los status actuales pero responde con `error` + `code`:
  - `INTERNAL_API_KEY_MISSING`
  - `INTERNAL_API_KEY_INVALID`
- Esto endurece el contrato para una app interna, pero no sustituye autenticacion enterprise real.
- `VITE_INTERNAL_API_KEY` en frontend no debe considerarse un secreto fuerte; es solo un mecanismo de conveniencia interna.

### Revision de consistencia de errores

- Los errores nuevos documentados con `code` ya devuelven `code` realmente en codigo:
  - `validationMiddleware.ts`
  - `internalApiKey.ts`
  - `startBankImportAnalysisRun(...)` cuando responde `success: false`
- Los endpoints legacy de `bancos` que siguen devolviendo solo `{ error }` se mantienen documentados como legacy:
  - `POST /api/bancos/analysis/recover`
  - `GET /api/bancos/analysis/:analysisId`
- No se cambiaron esos contratos legacy en esta pasada para evitar romper clientes.

### Cierre incremental de bancos

- `bancosRoutes.ts` ya usa constantes de validacion en `bancosErrorCodes.ts`:
  - `BANK_ANALYZE_VALIDATION_ERROR`
  - `BANK_ANALYSIS_START_VALIDATION_ERROR`
- `handleAnalysisRecover` ahora usa un tipo derivado del parametro real de `recoverBankImportAnalysisRun(...)` en vez de reaprovechar el tipo de `analysis/start`.
- Se movieron a `bancosRoutes.ts` dos endpoints pequenos antes ubicados en `app.ts`:
  - `POST /api/bancos/analysis/recover`
  - `GET /api/bancos/analysis/:analysisId`
- La extraccion mantuvo a proposito el contrato legacy de error de esos endpoints:
  - mismo status
  - mismo body `{ error }`
- Se documento `docs/api/bancos.md` con los endpoints ya migrados y sus contratos confirmados por codigo.

### Frontend readiness sin cambios visuales

- `frontend/src/services/api/httpClient.ts` conserva compatibilidad con `status` y `body`.
- `HttpClientError` ahora tambien preserva:
  - `parsedBody`
  - `errorCode`
  - `errorMessage`
- `frontend/src/services/api/httpErrors.ts` agrega helpers pequenos y seguros:
  - `isHttpClientError(error)`
  - `getHttpErrorMessage(error, fallback)`
  - `getHttpErrorCode(error)`
- No se tocaron pantallas, estilos ni consumidores existentes.
- Los consumidores pueden migrar gradualmente desde `JSON.parse(reason.body)` hacia propiedades ya parseadas.
- Uso recomendado para una siguiente pasada:
  - reemplazar parseos manuales de `reason.body`
  - preferir `getHttpErrorMessage(...)` para mensajes de fallback
  - preferir `getHttpErrorCode(...)` para estados de error orientados por `code`

### Guardrails preventivos para archivos sensibles

- `.gitignore` ahora cubre mejor:
  - `.env.*` con excepcion para `**/.env.example`
  - `*.pem`
  - `*.key`
  - `*.p12`
  - `*.pfx`
  - `*.crt`
  - `*.cer`
  - `logs/`
  - `tmp/`
- No se agrego `*.xml`.
  - se descarto por riesgo de ocultar fixtures XML legitimos o insumos validos del repo
  - si mas adelante se detectan CFDI reales en el flujo de trabajo, conviene atacar el problema con reglas mas especificas

### Validaciones corridas durante la rama

- `npm --prefix backend run build`
- `npm --prefix frontend run build`
- `git diff --check`
- `python tools/check-text-encoding.py`

Estado de validacion al momento de esta actualizacion:

- `npm --prefix backend run build`: OK
- `npm --prefix frontend run build`: OK
- `git diff --check`: OK
- `python tools/check-text-encoding.py`: OK

## Pendientes reales despues de esta rama

### Deuda y riesgos que siguen abiertos

- `backend/src/app.ts` sigue siendo el principal punto de concentracion y conflicto potencial.
- Todavia existen rutas legacy que devuelven solo `{ error }` sin `code`.
- `basicRoutes.ts` sigue usando `any`.
- `internalApiKey.ts` ya tiene `code`, pero el resto del backend no esta estandarizado todavia.
- `analysis/recover` y `analysis/:analysisId` siguen con contrato legacy por decision deliberada de no romper clientes.
- La divergencia de runtime sigue abierta:
  - CI Node 22
  - Docker Node 24
  - warnings `EBADENGINE`
- No se cambio version de Node en esta rama porque no fue claramente seguro.

### Priorizacion de extraccion pendiente de bancos

| Endpoint | Complejidad | Dependencias | Riesgo | Recomendacion |
| --- | --- | --- | --- | --- |
| `POST /api/bancos/history/upload` | Media | `requireInternalApiKey`, `uploadBankHistoricalStatement`, `BankImportError`, body grande | Medio | Mover despues de `pagos-individuales`; es acotado, pero ya toca flujo de carga historica |
| `GET /api/bancos/pagos-individuales` | Baja | `listBankIndividualPaymentFileMetadata`, `BankImportBankId` | Bajo | Muy buen candidato para el siguiente PR pequeno |
| `POST /api/bancos/pagos-individuales/upload` | Baja-media | `requireInternalApiKey`, `upsertBankIndividualPaymentFiles`, body grande | Bajo-medio | Mover junto con el GET anterior en un PR enfocado |
| `GET /api/bancos/sample` | Media | `analyzeBankImportSample`, `BankImportError`, parseo de query | Medio | Dejar para un PR especifico de sample |
| `POST /api/bancos/sample` | Media | `analyzeBankImportSample`, `BankImportError`, `transientCorrections` | Medio | Mover junto con el GET de sample |
| `GET /api/bancos/candidates` | Media | `searchBankImportCandidates`, varios query params, `BankImportError` | Medio | Aplazar hasta despues de `sample` |
| `POST /api/bancos/corrections` | Media-alta | `requireInternalApiKey`, `saveBankImportCorrection`, `BankImportError` | Medio-alto | Postergar por ser mutacion interna |
| `POST /api/bancos/journals/post` | Alta | `requireInternalApiKey`, `postBankImportJournals`, `BankImportError` | Alto | Dejar para una fase con mas pruebas y contexto de negocio |
| `POST /api/bancos/saldo-validado` | Media | `requireInternalApiKey`, `saveBankImportValidatedBalance`, `BankImportError` | Medio | Mover solo despues de cerrar correcciones mutantes |
| `GET /api/bancos/cep/status` | Media | `getBanxicoCepInstitutions`, `BanxicoServiceError` | Medio | Dejar fuera del siguiente PR; ya depende de servicio externo |
| `GET /api/bancos/cep/institutions` | Media | `getBanxicoCepInstitutions`, `BanxicoServiceError` | Medio | Mover junto con `cep/status` si se hace un PR de solo lectura CEP |
| `POST /api/bancos/cep/lookup` | Media-alta | `lookupBanxicoCep`, `BanxicoServiceError` | Medio-alto | Posponer por dependencia externa |
| `POST /api/bancos/cep/details` | Alta | `requireInternalApiKey`, retry manual, `downloadBanxicoCepDetails`, `upsertBanxicoCepRecognition`, remocion de XML | Alto | Dejar para una fase aislada y con mucha cautela |

Siguiente PR pequeno recomendado:

- mover `GET /api/bancos/pagos-individuales`
- mover `POST /api/bancos/pagos-individuales/upload`

Motivo:

- comparten dominio
- no dependen de NetSuite ni Banxico
- el contrato es simple
- el diff deberia seguir pequeno y revisable

### Cambios descartados por riesgo

- No se agrego script root `check:encoding` por incompatibilidad cross-shell.
- No se cambio la version de Node de CI ni Docker.
- No se refactorizo `app.ts` de forma masiva.
- No se migraron endpoints complejos de `bancos` como `candidates`, `cep`, `journals`, `history/upload` o `corrections`.
- No se agrego framework de tests nuevo porque la infraestructura actual no esta lista y meterla aqui ensuciaria la rama.
- No se ignoro `*.xml` para no romper posibles fixtures legitimos.

### Cobertura de pruebas minima recomendada

Infraestructura observada:

- no hay script `test` en `package.json`
- no hay `vitest`
- no hay `jest`
- no hay `tsx`
- no hay `ts-node`
- no se detecto un runner de tests listo para usar sin cambios adicionales

Recomendacion pragmatica:

- primera opcion recomendada: `node:test` con archivos pequenos fuera del flujo principal y sin framework grande
- segunda opcion, si se acepta una dependencia minima futura: `tsx` para ejecutar tests TypeScript pequenos con `node:test`

Primeros archivos a cubrir:

1. `backend/src/routes/bancosValidation.ts`
2. `backend/src/routes/validationMiddleware.ts`
3. `backend/src/internalApiKey.ts`
4. `tools/check-text-encoding.py`

Casos minimos sugeridos:

- `isBancosAnalyzeRequest` acepta `bankId` valido y rechaza vacios
- `isBancosAnalysisStartRequest` exige `bankId`, `fileName` y `fileBase64`
- `validateBody` responde `400` con `error` + `code`
- `requireInternalApiKey` responde `401` y `503` con `code`
- `check-text-encoding.py` falla con BOM y con bidi

Comandos propuestos para una fase futura:

- opcion sin framework grande:
  - `npm --prefix backend run build`
  - `node --test backend/test/**/*.test.mjs`
- opcion con dependencia minima futura:
  - `tsx --test backend/test/**/*.test.ts`

## Mapa de arquitectura del backend

| Modulo | Estado | Evaluacion | Siguiente paso recomendado |
| --- | --- | --- | --- |
| `backend/src/app.ts` | Legacy grande | Concentracion alta de wiring y contratos HTTP mezclados | Seguir extrayendo por dominios pequenos y con diffs controlados |
| `backend/src/routes/` | Parcialmente migrado | Ya existe una capa de routers, pero no todos los dominios estan uniformados | Priorizar bancos, luego bloques con menos dependencias externas |
| `backend/src/services/` | Parcialmente migrado | `bancosService.ts` ya aporta una capa intermedia util | Repetir el patron solo donde agregue validacion o error handling claro |
| `backend/src/bankImports.ts` | Dominio pesado | Mucha logica real y rutas legacy dependen de este modulo | Mantener cambios pequenos alrededor del borde HTTP antes de tocar logica interna |
| Inventario | Parcialmente migrado | Ya existe `inventarioRoutes.ts` y separacion visible | Continuar con endpoints pequenos y contratos claros |
| SAT | Mayormente legacy de borde | Varias rutas viven todavia en `app.ts` | Postergar hasta cerrar errores comunes y auth interna |
| NetSuite | Mayormente legacy de borde | Integracion sensible y con mucho riesgo operativo | No mover sin objetivos muy delimitados y sin tocar integraciones reales |
| Egresos | Legacy de borde | Sigue colgando de `app.ts` | Posponer hasta despues de errores unificados |
| Facturas | Legacy de borde | Muchas rutas mutantes e integracion sensible | Posponer hasta despues de testing minimo y mejor tipado |
| Frontend API client | Parcialmente preparado | Ya conserva `parsedBody`, `errorCode` y `errorMessage` | Migrar consumidores gradualmente a errores estructurados |
| CI / Docker | Parcialmente alineado | CI ya tiene guardrails mejores, pero runtime sigue desalineado | Resolver Node 22 vs 24 en una rama de plataforma separada |

Orden recomendado para seguir reduciendo `app.ts`:

1. seguir con `bancos` en endpoints pequenos y de solo borde HTTP
2. completar `pagos-individuales` como siguiente corte pequeno de `bancos`
3. continuar con `inventario` donde ya hay separacion previa
4. atacar contratos de error comunes antes de mover dominios mas sensibles
5. dejar SAT, NetSuite, egresos y facturas para fases con mas pruebas y aislamiento

## Riesgos de merge

- Riesgo medio en `backend/src/app.ts` porque sigue siendo un hotspot de wiring.
- Riesgo medio en `.github/workflows/ci.yml` si hay trabajo paralelo sobre CI.
- Riesgo bajo en `httpTypes.ts`, `validationMiddleware.ts`, `internalApiKey.ts` y `httpClient.ts` por alcance localizado.
- Riesgo bajo en `docs/api/bancos.md`, `tools/check-text-encoding.py` y `.gitignore`.

## Fuera de alcance

- Integraciones reales contra NetSuite, SAT, Banxico, bancos, NAS u otros servicios externos.
- Cambios en secretos, `.env` reales, certificados, XML reales, CFDI reales o tokens.
- Cambios visuales fuertes de frontend.
- Refactor masivo de `app.ts`.
- Cambios de produccion, deploy real o merge a `main`.

## Estrategia de merge recomendada

### Opcion A: merge completo del PR

Ventajas:

- aterriza de una vez los guardrails, contratos HTTP minimos, cierre parcial de `bancos`, readiness de frontend y documentacion
- evita trabajo adicional de rearmado
- ya existe CI verde y el PR sigue siendo revisable por commits

Riesgos:

- mezcla varios temas en un solo diff
- obliga a revisar backend, frontend, CI y documentacion en el mismo PR
- aumenta la carga de contexto para reviewers

### Opcion B: dividir por commits o por bloques tematicos

Bloques naturales:

1. CI y encoding guardrails
2. HTTP errors e `internalApiKey`
3. `bancos` router + documentacion API
4. frontend HTTP helpers/readiness
5. reporte, roadmap y estrategia

Ventajas:

- reduce el radio de revision por PR
- permite mergear primero lo menos controversial
- simplifica rollback selectivo si algo incomoda

Riesgos:

- requiere trabajo manual adicional para rearmar PRs
- puede introducir costo de coordinacion innecesario si el equipo ya esta comodo revisando por commits

### Recomendacion final

- Si el equipo quiere velocidad y puede revisar por commits: el merge completo es razonable.
- Si el equipo prioriza historia mas limpia y menor carga de revision: conviene dividir por bloques tematicos.
- Recomendacion preferida: revisar este PR por commits y, si aparece resistencia por alcance, dividirlo en bloques tematicos en vez de seguir creciendo esta rama.

## Roadmap para SaaS interno premium

### 1. Backend foundation

- completar la migracion incremental de `bancos`
- unificar errores HTTP
- mantener auth interna consistente
- partir `app.ts` por dominios pequenos

### 2. Data/import reliability

- validacion fuerte de payloads
- limites claros de archivos
- trazabilidad de corridas
- logging seguro y sin datos sensibles

### 3. Testing

- cobertura de validadores
- cobertura de services
- cobertura de routes
- smoke tests de build y rutas criticas

### 4. Frontend premium

- design system interno consistente
- loading states claros
- empty states utiles
- error states por `code`
- responsive consistente
- tablas mas profesionales

### 5. Operations

- healthchecks confiables
- backups
- rollback documentado
- Docker no-root
- variables obligatorias
- checklist de deploy

### 6. Security

- auth real futura
- separacion de secretos
- secret scanning
- permisos por rol
- auditoria y trazabilidad

### 7. Release process

- staging
- PR template
- changelog
- versionado
- migraciones controladas
