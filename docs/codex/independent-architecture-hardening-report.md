# Independent Architecture Hardening Report

## Estado actual del repo

- Rama de trabajo: `codex/independent-architecture-hardening-pass`.
- `main` no fue modificado y no se hizo merge.
- El checkout local se valido desde la raiz correcta del repositorio.
- La rama ya contiene una pasada pequena y segura de hardening, tipado y DX sin tocar integraciones reales ni comportamiento sensible exitoso.

## Auditoria inicial

### Alcance auditado

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

- `backend/src/runtimeSecurity.ts` ya centralizaba reglas de CORS y limites de JSON, y exigia `ALLOWED_ORIGINS` en produccion.
- `backend/src/routes/errorMiddleware.ts` y `backend/src/errors/AppError.ts` ya daban una base comun para errores tipados.
- `backend/src/routes/bancosRoutes.ts` ya habia extraido una parte sensible de `app.ts` a un modulo dedicado.
- `backend/src/services/bancosService.ts` ya devolvia un resultado tipado para el inicio del analisis y registraba contexto util sin tocar datos sensibles.
- `frontend/src/services/api/httpClient.ts` ya concentraba encabezados, `fetch` y el encapsulamiento de errores HTTP.
- `.editorconfig` y `.gitattributes` ya marcaban una convencion clara de UTF-8 y fin de linea.
- `.github/workflows/ci.yml` ya tenia cache por lockfile y ejecutaba lint + build.
- `Dockerfile` ya estaba estructurado como build multi-stage.

### Riesgos y deuda detectados en la auditoria inicial

- `backend/src/app.ts` seguia demasiado grande y concentraba mucho wiring, reglas de borde y respuestas HTTP, con riesgo alto de conflicto de merge.
- La estrategia de errores no era uniforme en todo el backend:
  - algunas rutas devolvian `{ success: false, error, code }`
  - otras devolvian solo `{ error }`
  - otras resolvian status de forma manual sin `AppError`
- `backend/src/routes/basicRoutes.ts` usaba `any` de forma amplia, lo que debilitaba el tipado.
- `backend/src/internalApiKey.ts` protegia endpoints internos, pero respondia sin `code` estructurado.
- `backend/src/routes/validationMiddleware.ts` ya soportaba codigos especificos, pero `bancosRoutes.ts` no los aprovechaba todavia.
- `backend/src/routes/bancosRoutes.ts` cargaba una dependencia `BankImportError` que no participaba en la logica de la ruta.
- Habia deriva de runtime entre entornos:
  - CI usaba Node 22
  - `Dockerfile` usaba Node 24
  - `npm --prefix backend ci` mostraba advertencias `EBADENGINE` en dependencias con soporte declarado hasta Node 22
- No existia verificacion automatica para BOM, bidi e invisibles peligrosos en archivos criticos.

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
- `npm --prefix backend ci`: OK con advertencias `EBADENGINE`
- `npm --prefix frontend ci`: OK

## Cambios ya aplicados en esta rama

### Documentacion

- `docs: add independent architecture hardening report`
  - se agrego este reporte para dejar trazabilidad de la auditoria, los cambios aplicados y los pendientes reales.

### Hardening pequeno en rutas de bancos

- `refactor: use specific bancos validation codes`
  - `/api/bancos/analyze` ahora usa `BANK_ANALYZE_VALIDATION_ERROR`
  - `/api/bancos/analysis/start` ahora usa `BANK_ANALYSIS_START_VALIDATION_ERROR`
- `refactor: remove unused bancos route error dependency`
  - se elimino el wiring no usado de `BankImportError` entre `backend/src/routes/bancosRoutes.ts` y `backend/src/app.ts`
- ajuste adicional solicitado despues:
  - se elimino `getErrorStatus` de `backend/src/routes/bancosRoutes.ts` porque ya no tenia referencias reales

### Tipado minimo compartido

- `refactor: add validation error response type`
  - se agrego `backend/src/routes/httpTypes.ts`
  - `validationMiddleware.ts` ahora declara `Response<ValidationErrorResponse>` sin forzar una arquitectura mayor

### DX y reproducibilidad

- `ci: use npm ci for reproducible installs`
  - `.github/workflows/ci.yml` cambio `npm install` por `npm ci` para `backend` y `frontend`
- `chore: add text encoding diagnostic tool`
  - se agrego `tools/check-text-encoding.py` para detectar BOM, bidi e invisibles peligrosos
- ajuste adicional solicitado despues:
  - el workflow de CI ahora ejecuta `python3 tools/check-text-encoding.py`

### Validaciones ejecutadas despues de aplicar cambios

- `npm --prefix backend run build`
- `npm --prefix frontend run build`
- `git diff --check`
- `python tools/check-text-encoding.py`

Estado actual al momento de esta actualizacion:

- `npm --prefix backend run build`: OK
- `npm --prefix frontend run build`: OK
- `git diff --check`: OK
- `python tools/check-text-encoding.py`: OK

## Pendientes reales despues de esta rama

### Riesgos y deuda que siguen abiertos

- `backend/src/app.ts` sigue siendo el principal punto de concentracion y conflicto potencial; conviene seguir extrayendo rutas por dominios pequenos y validables.
- La estrategia de errores del backend sigue siendo heterogenea fuera del alcance reducido de esta rama.
- `backend/src/routes/basicRoutes.ts` sigue necesitando reemplazar `any` por tipos concretos o contratos minimos.
- `backend/src/internalApiKey.ts` sigue respondiendo sin `code` estructurado y podria alinearse con la capa de errores endurecida.
- La divergencia de version de Node entre CI y `Dockerfile` sigue abierta y requiere una decision deliberada de plataforma.
- El frontend sigue recibiendo `HttpClientError.body` como `string` crudo; podria mejorarse con parseo opcional de errores JSON conocidos si se hace sin acoplar mas a los consumidores.

### Cambios que no conviene hacer todavia

- No refactorizar `backend/src/app.ts` de forma masiva en esta misma rama.
- No unificar toda la estrategia de errores de golpe.
- No tocar autenticacion real de NetSuite, SAT, Banxico u otras integraciones externas.
- No tocar secretos, `.env` reales, certificados, XML, CFDI, logs ni tokens.
- No cambiar el frontend visual ni el comportamiento UX.
- No tocar despliegue real ni produccion.

### Orden recomendado de PRs futuros

1. PR de consistencia de errores:
   - alinear respuestas de validacion, auth interna y errores de dominio sobre un contrato comun
2. PR de tipado:
   - eliminar `any` de `basicRoutes.ts` y contratos cercanos
3. PR estructural por dominios:
   - seguir extrayendo rutas de `app.ts` en modulos pequenos y con validacion estricta por paso
4. PR de plataforma:
   - alinear version de Node entre desarrollo, CI y Docker solo despues de validar compatibilidad real

### Riesgos de merge

- Riesgo medio en `backend/src/app.ts` si el flujo manual principal sigue tocando el wiring al mismo tiempo.
- Riesgo medio en `.github/workflows/ci.yml` por posible solapamiento con otros cambios de CI.
- Riesgo bajo en `bancosRoutes.ts`, `validationMiddleware.ts`, `httpTypes.ts` y `tools/check-text-encoding.py` por ser cambios pequenos y localizados.

### Fuera de alcance

- Ejecucion real contra NetSuite, SAT, Banxico, bancos, NAS u otros servicios externos.
- Validacion con datos reales o archivos sensibles.
- Refactors grandes de arquitectura.
- Cambios de produccion o deploy real.
- Cambios visuales del frontend.
- Pruebas end-to-end o de integracion que requieran credenciales o rediseno estructural.
