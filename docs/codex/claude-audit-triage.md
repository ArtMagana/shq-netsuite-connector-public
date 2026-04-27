# Claude Audit Triage

## Objetivo

Este documento convierte la auditoria de Claude en un plan incremental para el repo publico laboratorio. No aplica sus recomendaciones de golpe; las clasifica segun el estado real del repo y el riesgo de implementarlas literalmente.

## Estado de la serie de PRs

Antes de este corte documental, los cambios seguros de laboratorio ya quedaron separados en PRs pequenos:

- `#85`: CI + encoding guardrails
- `#86`: HTTP error contracts + internal API key codes
- `#87`: bancos route hardening/documentation
- `#88`: frontend `httpClient` structured errors

Este PR `#89` queda intencionalmente como docs-only:

- no repite file-store locking/reliability
- no reabre cambios funcionales
- solo deja roadmap y triage para trabajo posterior

## OAuth token encryption

- Clasificacion: valido y urgente.
- Diagnostico: `backend/src/netsuiteOAuth.ts` guarda la sesion OAuth en JSON plano.
- Estado actual real del repo: el token store usa `LOCALAPPDATA` o `process.cwd()` y escribe con `fs.writeFileSync(...)`.
- Riesgo si se implementa de golpe: alto si se reescribe el flujo OAuth actual o se intenta migrar sesiones existentes sin rollback.
- Propuesta incremental: disenar primero un vault cifrado y migrar despues con feature flag o lector dual.
- Primer PR recomendado: disenar `TokenVault` y agregar un reader/writer cifrado sin activarlo por defecto.
- Archivos candidatos: `backend/src/netsuiteOAuth.ts`, `docs/codex/token-vault-design.md`.
- Validaciones necesarias: backend build, smoke test de arranque, prueba de lectura/escritura en ruta dummy, CI verde.

## CSRF

- Clasificacion: valido pero requiere diseno.
- Diagnostico: hoy el backend usa `X-Internal-Api-Key` en rutas mutantes y no hay sesion browser basada en cookies.
- Estado actual real del repo: el frontend puede inyectar `VITE_INTERNAL_API_KEY`, pero el riesgo principal hoy no es CSRF clasico sino exponer una llave interna en browser.
- Riesgo si se implementa de golpe: medio-alto, porque un CSRF global puede romper APIs internas y herramientas no browser sin resolver el problema de auth real.
- Propuesta incremental: primero documentar si CSRF aplica de verdad y en que endpoints antes de meter middleware global.
- Primer PR recomendado: threat model + decision record, sin codigo.
- Archivos candidatos: `backend/src/internalApiKey.ts`, `frontend/src/services/api/httpClient.ts`, `docs/codex/csrf-threat-model.md`.
- Validaciones necesarias: backend build, frontend build, revision de consumers internos, CI verde.

## Zod validation

- Clasificacion: valido pero requiere diseno.
- Diagnostico: hoy `validateBody(...)` ya permite guards livianos, pero no hay validacion runtime estandarizada con schemas.
- Estado actual real del repo: `bancosValidation.ts` usa type guards manuales y los endpoints mas criticos de bancos ya pasan por `validateBody(...)`.
- Riesgo si se implementa de golpe: medio, porque migrar todo el backend a Zod cambiaria mensajes, contratos y posiblemente ramas legacy.
- Propuesta incremental: introducir Zod solo en dos endpoints de bancos y adaptarlo al contrato `{ error, code }`.
- Primer PR recomendado: agregar `zod` al backend y pilotear `/api/bancos/analyze` y `/api/bancos/analysis/start`.
- Archivos candidatos: `backend/src/routes/bancosValidation.ts`, `backend/src/routes/validationMiddleware.ts`, `docs/codex/runtime-validation-plan.md`.
- Validaciones necesarias: backend build, smoke de validacion 400, diff check, CI verde.

## File locks / file stores

- Clasificacion: valido y urgente.
- Diagnostico: varios stores JSON hacen `read/modify/write` sincronico sin atomicidad ni locks.
- Estado actual real del repo: `bankAnalysisRunStore.ts`, `bankWorkingFileStore.ts`, stores SAT y NetSuite persisten directo a disco.
- Riesgo si se implementa de golpe: alto si se migran todos los stores juntos o se introduce locking sin pilotear rutas de error y recovery.
- Propuesta incremental: tratarlo en una rama y PR separados, fuera de este corte documental de arquitectura general.
- Primer PR recomendado: no incluirlo aqui; manejarlo como spike independiente de file-store reliability.
- Archivos candidatos: `backend/src/*Store.ts`.
- Validaciones necesarias: backend build, tests de persistencia en temp dir, diff check, CI verde.

## Bank import consistency / event sourcing

- Clasificacion: valido pero requiere diseno.
- Diagnostico: el dominio de bancos mezcla analisis, estados, working files, correcciones y persistencia en varios stores.
- Estado actual real del repo: PR #81 ya cerro mejor el borde HTTP de bancos, pero el core sigue en modulos legacy pesados.
- Riesgo si se implementa de golpe: muy alto; un intento literal de event sourcing tocaria persistencia, replays y contratos operativos sensibles.
- Propuesta incremental: estabilizar primero stores, luego modelar eventos solo para analisis run y correcciones.
- Primer PR recomendado: documento de modelo de estados para `analysis/run` y store piloto con append log.
- Archivos candidatos: `backend/src/bankImports.ts`, `backend/src/bankAnalysisRunStore.ts`, `backend/src/bankWorkingFileStore.ts`.
- Validaciones necesarias: backend build, pruebas sin integraciones reales, verificacion de compatibilidad de archivos existentes.

## Testing

- Clasificacion: ya atendido parcialmente por PR #81 y sigue siendo valido y urgente.
- Diagnostico: el repo no tenia suite JS minima para middleware/validation, aunque ya existia `tests/test_engine.py`.
- Estado actual real del repo: ahora existe `npm test` con `node:test` y CI lo corre despues del build.
- Riesgo si se implementa de golpe: medio si se intenta meter Vitest/Jest/Playwright en esta misma rama.
- Propuesta incremental: ampliar `node:test` para backend y preservar Python unittest para el motor actual.
- Primer PR recomendado: expandir cobertura de `bancosRoutes` y `tools/check-text-encoding.py`.
- Archivos candidatos: `tests/backend-safety.test.mjs`, `tests/test_engine.py`, `.github/workflows/ci.yml`, `docs/codex/testing-plan.md`.
- Validaciones necesarias: backend build, frontend build, `npm test`, Python unittest, CI verde.

## Hexagonal architecture

- Clasificacion: valido pero requiere diseno.
- Diagnostico: `backend/src/app.ts` sigue siendo un hotspot y varios dominios todavia acoplan HTTP, filesystem y servicios externos.
- Estado actual real del repo: ya existen routers y algunos services, pero la arquitectura todavia es mixta.
- Riesgo si se implementa de golpe: muy alto; un literal "hexagonal" podria crear capas nuevas sin reducir riesgo operativo inmediato.
- Propuesta incremental: seguir extrayendo por fronteras de dominio y contratos de errores antes de introducir puertos/adapters formales.
- Primer PR recomendado: terminar cierres pequenos de `bancos` e `inventario`, luego introducir una capa de application service solo donde ya haya valor.
- Archivos candidatos: `backend/src/app.ts`, `backend/src/routes/*.ts`, `backend/src/services/`.
- Validaciones necesarias: backend build, smoke de arranque, revision de diff por dominio, CI verde.

## Error handling

- Clasificacion: ya atendido parcialmente por PR #81 y sigue siendo valido y urgente.
- Diagnostico: hoy conviven `{ error }`, `{ error, code }` y el envelope del `errorMiddleware`.
- Estado actual real del repo: `validationMiddleware.ts` e `internalApiKey.ts` ya responden con `code`; `bancos` ya documenta mejor sus contratos; `inventario` sigue legacy.
- Riesgo si se implementa de golpe: medio si se cambian todos los contratos legacy en un solo corte.
- Propuesta incremental: documentar roadmap y migrar por dominios, empezando por inventario y rutas ya extraidas.
- Primer PR recomendado: agregar `code` a un subconjunto seguro de rutas de inventario o centralizar helpers de error route-local.
- Archivos candidatos: `backend/src/routes/errorMiddleware.ts`, `backend/src/routes/inventarioRoutes.ts`, `backend/src/routes/bancosRoutes.ts`, `docs/codex/error-contract-roadmap.md`.
- Validaciones necesarias: backend build, pruebas de status/body, smoke del frontend, CI verde.

## Logging estructurado

- Clasificacion: valido pero requiere diseno.
- Diagnostico: hoy el repo usa respuestas HTTP y errores, pero no una capa de logging estructurado uniforme.
- Estado actual real del repo: no hay `pino` ni estrategia comun de correlation id, redaction o sinks.
- Riesgo si se implementa de golpe: medio-alto; introducir Pino global sin politica de datos puede exponer tokens, XML o payloads sensibles.
- Propuesta incremental: definir primero politicas de redaction y campos obligatorios; despues pilotear logger estructurado en rutas no sensibles.
- Primer PR recomendado: documentar esquema de logs y helper local de `logEvent(...)` sin reemplazar todo `console`.
- Archivos candidatos: `backend/src/app.ts`, `backend/src/netsuiteClient.ts`, `backend/src/sat.ts`.
- Validaciones necesarias: backend build, revision de redaction, smoke logs en test dummy, CI verde.

## Frontend state management

- Clasificacion: valido pero requiere diseno.
- Diagnostico: el frontend tiene paginas grandes y fetch ad hoc, pero todavia no hay server-state layer formal.
- Estado actual real del repo: React 19, React Router 7, Bootstrap, `httpClient.ts`, `httpErrors.ts`, sin TanStack Query ni Zustand.
- Riesgo si se implementa de golpe: medio; meter TanStack Query o Zustand global en una rama de hardening mezclaria DX, UI y comportamiento.
- Propuesta incremental: elegir una feature chica y pilotear server state solo ahi cuando el backend tenga errores mas consistentes.
- Primer PR recomendado: plan de premium migration y feature piloto contenida, no `BancosPage.tsx`.
- Archivos candidatos: `frontend/src/services/api/httpClient.ts`, `frontend/src/features/inventory/*`, `docs/codex/frontend-premium-plan.md`.
- Validaciones necesarias: frontend build, smoke de navegacion, CI verde.

## Frontend components

- Clasificacion: valido pero requiere diseno.
- Diagnostico: varias features viven en archivos muy grandes y no hay biblioteca interna de componentes funcionales reutilizables.
- Estado actual real del repo: existen paginas grandes como `BancosPage.tsx` y `FacturasSatPage.tsx`, pero no un kit comun para loading, error states o tablas.
- Riesgo si se implementa de golpe: medio-alto si se intenta redisenar el frontend completo en esta rama laboratorio.
- Propuesta incremental: empezar por componentes transversales sin impacto visual fuerte.
- Primer PR recomendado: `StatusBadge`, `FormField`, `ErrorPanel` y `LoadingBlock` en una feature pequena.
- Archivos candidatos: `frontend/src/features/inventory/*`, `frontend/src/app/AppShell.tsx`.
- Validaciones necesarias: frontend build, smoke manual, snapshot visual opcional en fase posterior.

## TypeScript strict

- Clasificacion: desactualizado respecto al repo actual.
- Diagnostico: la recomendacion de activar `strict` ya no aplica como tarea principal.
- Estado actual real del repo: `backend/tsconfig.json`, `frontend/tsconfig.app.json` y `frontend/tsconfig.node.json` ya usan `strict: true`.
- Riesgo si se implementa de golpe: bajo, porque ya esta activado; el riesgo real es convivir con `any` y contracts implicitos dentro de codigo estricto.
- Propuesta incremental: eliminar `any` en puntos de wiring y APIs locales antes de tocar reglas mas agresivas.
- Primer PR recomendado: seguir tipando route deps y helpers HTTP.
- Archivos candidatos: `backend/src/routes/*.ts`, `frontend/src/services/api/*.ts`.
- Validaciones necesarias: backend build, frontend build, CI verde.

## CI/CD pipeline

- Clasificacion: ya atendido parcialmente por PR #81 y sigue siendo valido.
- Diagnostico: el pipeline era minimo; ahora ya usa `npm ci`, encoding check y test smoke.
- Estado actual real del repo: GitHub Actions corre install reproducible, lint, build, encoding check y `npm test`.
- Riesgo si se implementa de golpe: medio si se mezcla con despliegue real, release automation o secretos del repo privado.
- Propuesta incremental: mantener CI de laboratorio enfocada en build/test/guardrails y separar cualquier pipeline de deploy.
- Primer PR recomendado: opcionalmente sumar Python unittest del motor o un smoke de docker build, sin tocar produccion.
- Archivos candidatos: `.github/workflows/ci.yml`, `package.json`, `tests/`.
- Validaciones necesarias: CI verde, reproducibilidad local, no uso de secretos reales.

## Docker / DATA_DIR

- Clasificacion: valido pero requiere diseno.
- Diagnostico: Docker hoy corre con Node 24, como root, y varios stores caen en rutas por defecto ligadas a `process.cwd()` o `LOCALAPPDATA`.
- Estado actual real del repo: ya existe compose de laboratorio en `deploy/test/docker-compose.public-test.yml`, pero no una estrategia general de `DATA_DIR`.
- Riesgo si se implementa de golpe: medio-alto; mover rutas de store sin plan puede romper archivos existentes o healthchecks.
- Propuesta incremental: documentar primero los stores y luego introducir `DATA_DIR` solo para rutas de persistencia nuevas o piloto.
- Primer PR recomendado: plan de environment validation y data root, dejando file-store reliability para su PR separado.
- Archivos candidatos: `Dockerfile`, `deploy/test/docker-compose.public-test.yml`, `backend/src/*Store.ts`.
- Validaciones necesarias: docker build, arranque de instancia aislada, compatibilidad con rutas dummy, CI verde.

## Env validation

- Clasificacion: valido pero requiere diseno.
- Diagnostico: hoy cada dominio lee `process.env` localmente y falla en distintos momentos.
- Estado actual real del repo: eso permite que `api/health` y la UI arranquen sin NetSuite/SAT reales, pero hace mas dificil saber que variables faltan por dominio.
- Riesgo si se implementa de golpe: alto si se mete fail-fast global y se rompe el laboratorio sin credenciales reales.
- Propuesta incremental: crear un `config/env.ts` por dominios y mantener lazy validation para integraciones sensibles.
- Primer PR recomendado: env inventory por categorias y helper `readOptionalString/readRequiredString`.
- Archivos candidatos: `backend/src/runtimeSecurity.ts`, `backend/src/netsuiteClient.ts`, `backend/src/netsuiteOAuth.ts`, `backend/src/sat.ts`, `docs/codex/env-validation-plan.md`.
- Validaciones necesarias: backend build, healthcheck sin credenciales, smoke Docker laboratorio, CI verde.
