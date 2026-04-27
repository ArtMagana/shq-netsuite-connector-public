# Independent Architecture Hardening Report

## Estado actual del repo

- Rama de trabajo: `codex/independent-architecture-hardening-pass`.
- `main` no fue modificado y no se hizo merge.
- El PR #81 sigue en draft.
- La rama ya contiene una pasada de hardening incremental, con cambios pequenos y revisables por commit.
- El repo publico ya se uso como laboratorio tecnico aislado en NAS sin tocar el repo privado.
- La instancia `shq-public-test` levanto correctamente en `8090` despues de corregir un bug real de wiring en `inventario`.
- No se ejecutaron integraciones reales contra NetSuite, SAT, Banxico, bancos, NAS ni otros servicios externos.

## Nota de laboratorio aislado

- Se levanto una instancia publica separada en `/volume1/docker/shq-public-test`.
- El contenedor `shq-public-test` publico `8090 -> 3000`.
- El healthcheck `curl http://127.0.0.1:8090/api/health` respondio OK.
- `supplai-app-1` en `8088` quedo intacto.
- `netsuite-recon` en `3000` quedo intacto.
- Durante esa prueba se detecto un fallo de arranque real:
  - `createInventarioRoutes(...)` usaba dependencias que `app.ts` no estaba inyectando
  - el build pasaba, pero el contenedor fallaba al registrar rutas
  - se corrigio en esta rama con `fix: restore inventario route dependencies`
- La prueba aislada valido el enfoque de usar el repo publico como laboratorio sin tocar el privado ni produccion.

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
- `.github/workflows/ci.yml` ya usa `actions/checkout@v5` y `actions/setup-node@v5`.
- El runtime de build de la app en CI se mantiene en Node 22 por ahora.
- CI ahora ejecuta `python3 tools/check-text-encoding.py`.
- CI ahora tambien ejecuta `npm test` despues del build para correr la cobertura minima de seguridad.
- El ultimo GitHub Actions CI del PR esta en verde.
- Se agrego `tools/check-text-encoding.py` para detectar:
  - BOM
  - caracteres bidireccionales ocultos
  - caracteres invisibles peligrosos
- El chequeo de encoding ahora cubre:
  - `.github/workflows/*.yml`
  - `.gitignore`
  - `package.json`
  - `backend/src/**/*.ts`
  - `frontend/src/**/*.ts`
  - `frontend/src/**/*.tsx`
  - `tests/**/*.mjs`
  - `tools/**/*.py`
  - `deploy/**/*.yml`
  - `docs/**/*.md`
- El script excluye `node_modules`, `dist`, `build`, caches y otros directorios generados.
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

### Seguridad de wiring en routers

- `backend/src/routes/inventarioRoutes.ts` ya no recibe `deps: any`.
- `backend/src/routes/basicRoutes.ts` ya no usa `any` para sus dependencias principales.
- El wiring de `inventario` en `backend/src/app.ts` quedo alineado con las dependencias realmente usadas por el router.
- Esto baja el riesgo de que otro `undefined` compile y solo reviente al arrancar el contenedor.

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

### Testing minimo ya habilitado

- Se agrego una base minima de `node:test` en `tests/backend-safety.test.mjs`.
- Esa suite cubre:
  - `isBancosAnalyzeRequest(...)`
  - `isBancosAnalysisStartRequest(...)`
  - `validateBody(...)`
  - `requireInternalApiKey(...)`
  - smoke test de `createApp()` para detectar wiring roto de rutas
  - contrato de error de `startBankImportAnalysisRun(...)` en entradas invalidas
  - estabilidad de `BANK_ANALYZE_VALIDATION_ERROR`
  - estabilidad de `BANK_ANALYSIS_START_VALIDATION_ERROR`
- La suite corre sobre `backend/dist` despues del build, sin tocar integraciones reales.
- Se agrego el script root `npm test`.
- CI ahora ejecuta esa suite despues del build.
- La cobertura sigue siendo pequena a proposito; la meta aqui es detectar regresiones obvias de contratos y middleware sin meter un framework grande todavia.
- Los helpers de frontend `httpErrors.ts` siguen cubiertos solo por build:
  - la rama no agrega un test runner de frontend
  - las pruebas de comportamiento de esos helpers deben esperar a una infraestructura de test frontend dedicada

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
- `npm test`
- `git diff --check`
- `python tools/check-text-encoding.py`
- scan explicito de `gh pr diff 81`, body del PR y archivos modificados por BOM, bidi, zero-width, soft hyphen y `U+FEFF`

Estado de validacion al momento de esta actualizacion:

- `npm --prefix backend run build`: OK
- `npm --prefix frontend run build`: OK
- `npm test`: OK
- `git diff --check`: OK
- `python tools/check-text-encoding.py`: OK
- scan explicito de hidden Unicode: sin hallazgos; GitHub UI puede seguir mostrando un warning generico o stale

## Pendientes reales despues de esta rama

### Deuda y riesgos que siguen abiertos

- `backend/src/app.ts` sigue siendo el principal punto de concentracion y conflicto potencial.
- `PR #81` ya es grande y no conviene seguir creciendo esta rama con cambios funcionales adicionales.
- Todavia existen rutas legacy que devuelven solo `{ error }` sin `code`.
- Aunque `basicRoutes.ts` e `inventarioRoutes.ts` ya tipan mejor sus deps, aun quedan contratos de route wiring que dependen de convenciones manuales fuera de esos routers.
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

### Cambios descartados por riesgo

- No se agrego script root `check:encoding` por incompatibilidad cross-shell.
- No se cambio la version de Node de CI ni Docker.
- No se refactorizo `app.ts` de forma masiva.
- No se migraron endpoints complejos de `bancos` como `candidates`, `cep`, `journals`, `history/upload` o `corrections`.
- No se agrego framework de tests nuevo porque la infraestructura actual no esta lista y meterla aqui ensuciaria la rama.
- No se ignoro `*.xml` para no romper posibles fixtures legitimos.

### Cobertura de pruebas minima recomendada

Infraestructura observada:

- ya existe `tests/test_engine.py` para el motor Python
- ahora existe `npm test` con `node:test` para smoke tests JS sobre `backend/dist`
- no hay `vitest`
- no hay `jest`
- no hay `tsx`
- no hay `ts-node`

Recomendacion pragmatica:

- mantener `node:test` para pruebas pequenas de contratos y middleware
- preservar `python -m unittest tests/test_engine.py` para el motor Python existente
- evaluar `tsx` mas adelante solo si hace falta testear TypeScript de frontend o backend sin pasar por `dist`

Primeros archivos a cubrir:

1. ampliar la suite actual de `backend/src/routes/bancosValidation.ts`
2. ampliar la suite actual de `backend/src/routes/validationMiddleware.ts`
3. ampliar la suite actual de `backend/src/internalApiKey.ts`
4. sumar `backend/src/routes/bancosRoutes.ts`
5. sumar `tools/check-text-encoding.py`

Casos minimos sugeridos:

- `isBancosAnalyzeRequest` acepta `bankId` valido y rechaza vacios
- `isBancosAnalysisStartRequest` exige `bankId`, `fileName` y `fileBase64`
- `validateBody` responde `400` con `error` + `code`
- `requireInternalApiKey` responde `401` y `503` con `code`
- `check-text-encoding.py` falla con BOM y con bidi

Comandos propuestos para una fase futura:

- baseline actual:
  - `npm --prefix backend run build`
  - `npm test`
  - `python -m unittest tests/test_engine.py`
- opcion con dependencia minima futura:
  - `tsx --test tests/**/*.test.ts`

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

## Fase de laboratorio posterior a auditoria Claude

Documentos nuevos o actualizados en esta fase:

- `docs/deploy/public-test-instance.md`
- `docs/codex/claude-audit-triage.md`
- `docs/codex/testing-plan.md`
- `docs/codex/file-store-reliability-plan.md`
- `docs/codex/runtime-validation-plan.md`
- `docs/codex/error-contract-roadmap.md`
- `docs/codex/token-vault-design.md`
- `docs/codex/csrf-threat-model.md`
- `docs/codex/env-validation-plan.md`
- `docs/codex/frontend-premium-plan.md`

Conclusiones de esta fase:

- El repo publico ya funciona como laboratorio tecnico real, no solo como PR documental.
- La prueba aislada en NAS encontro un bug de arranque que el build no detectaba.
- El tipado de deps en routers y la base minima de `node:test` reducen el riesgo de repetir ese patron.
- La auditoria de Claude quedo aterrizada en PRs futuros concretos en vez de intentar un mega-refactor.
- La recomendacion sigue siendo mantener este PR en draft y decidir siguientes pasos como PRs atomicos.

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

## Decision recomendada para PR #81

### Opcion A: mantener PR #81 como laboratorio y no mergear completo

Pros:

- preserva `#81` como bitacora tecnica del laboratorio publico
- evita meter un diff muy ancho al repo objetivo de forma apresurada
- permite seguir usandolo como indice de PRs atomicos posteriores

Contras:

- deja valor util atrapado en una rama draft
- obliga a rearmar PRs mas pequenos si se quiere aterrizar cambios

### Opcion B: mergear completo despues de revision humana

Pros:

- aterriza de una sola vez guardrails, contratos HTTP minimos, cierre parcial de `bancos`, readiness de frontend y documentacion
- evita trabajo manual adicional de rebase o cherry-pick

Contras:

- mezcla backend, frontend, CI, tests y documentacion en un mismo diff
- eleva la carga de revision y rollback

### Opcion C: dividir por bloques

Bloques sugeridos:

1. CI + encoding + `.gitignore`
2. HTTP contracts + `internalApiKey`
3. `bancos` router + `docs/api/bancos.md`
4. frontend HTTP error readiness
5. tests minimos
6. docs, roadmaps y lab deploy

Pros:

- reduce el radio de revision por PR
- permite mergear primero lo menos controversial
- simplifica rollback selectivo si algo incomoda

Contras:

- requiere trabajo manual adicional para separar commits
- aumenta el costo de coordinacion si el equipo ya esta comodo revisando por commits

### Recomendacion final

- Si el objetivo es llevar cambios al repo privado con bajo riesgo, conviene dividir por bloques.
- Si el objetivo es seguir explorando arquitectura en el repo publico, conviene mantener `#81` como laboratorio tecnico y no seguir agrandandolo.
- Recomendacion preferida: no seguir creciendo `#81`; usarlo como rama cerrada de laboratorio y extraer PRs atomicos desde aqui.

## Siguiente PR recomendado

Titulo sugerido:

- `refactor: move bancos individual payments routes`

Alcance:

- mover `GET /api/bancos/pagos-individuales`
- mover `POST /api/bancos/pagos-individuales/upload`

Por que este corte es el mejor siguiente paso:

- baja dependencia externa
- dominio acotado
- buen siguiente paso para seguir reduciendo `app.ts`
- evita tocar Banxico/CEP, NetSuite, journals o SAT

Reglas para ese siguiente PR:

- PR separado
- no hacerlo dentro de `#81`
- no tocar el repo privado
- no tocar produccion

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
