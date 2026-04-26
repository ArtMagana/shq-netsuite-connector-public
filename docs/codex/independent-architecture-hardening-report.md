# Independent Architecture Hardening Report

## 1. Estado actual del repo

- Rama de trabajo: `codex/independent-architecture-hardening-pass`.
- `main` no fue modificado y no se hizo merge.
- El checkout local estaba en la raiz correcta del repositorio al momento de la auditoria.
- Validacion de arranque completada con:
  - `pwd`
  - `ls`
  - `git status`
  - verificacion de `backend/package.json`
- Dependencias instaladas para reproducibilidad local con:
  - `npm --prefix backend ci`
  - `npm --prefix frontend ci`
- Build validado con:
  - `npm --prefix backend run build`
- El backend compila correctamente despues de instalar dependencias.
- El repo ya tiene una base de hardening parcial:
  - `AppError` y `errorMiddleware`
  - control centralizado de CORS y limites de JSON en `runtimeSecurity.ts`
  - separacion inicial de rutas de `bancos` y `basic`
  - configuracion de fin de linea en `.editorconfig` y `.gitattributes`
  - CI con cache de `package-lock.json`
  - Dockerfile multi-stage

## 2. Que esta bien

- `backend/src/runtimeSecurity.ts` concentra reglas de CORS y body size, y exige `ALLOWED_ORIGINS` en produccion.
- `backend/src/routes/errorMiddleware.ts` y `backend/src/errors/AppError.ts` ya dan una base comun para errores tipados.
- `backend/src/routes/bancosRoutes.ts` extrae una parte sensible de `app.ts` a un modulo dedicado, lo cual reduce acoplamiento.
- `backend/src/services/bancosService.ts` envuelve el inicio del analisis con un resultado tipado y logging seguro de contexto basico.
- `frontend/src/services/api/httpClient.ts` centraliza encabezados, manejo de `fetch` y encapsula errores HTTP.
- `.editorconfig` y `.gitattributes` ya establecen una convencion clara para UTF-8 y EOL.
- `.github/workflows/ci.yml` ya usa cache por lockfile y ejecuta lint + build.
- `Dockerfile` separa dependencias, build y runtime, lo cual es mejor que una imagen monolitica.

## 3. Riesgos encontrados

- `backend/src/app.ts` sigue siendo un archivo demasiado grande y concentra mucho wiring, errores HTTP y reglas de borde. Eso aumenta riesgo de conflicto de merge y dificulta cambios seguros.
- La estrategia de errores no es uniforme en todo el backend:
  - algunas rutas responden con `{ success: false, error, code }`
  - otras solo con `{ error }`
  - otras calculan status manualmente sin `AppError`
- `backend/src/routes/basicRoutes.ts` usa `any` de forma amplia en dependencias y respuestas. Eso degrada tipado y vuelve mas facil introducir regresiones silenciosas.
- `backend/src/internalApiKey.ts` protege endpoints internos, pero responde sin `code` estructurado, distinto al resto de la capa endurecida.
- `backend/src/routes/validationMiddleware.ts` soporta codigos especificos, pero `bancosRoutes.ts` todavia no los aprovecha en `/analyze` y `/analysis/start`.
- `backend/src/routes/bancosRoutes.ts` mantiene una dependencia `BankImportError` que no participa en la logica actual del modulo.
- Hay deriva de runtime entre entornos:
  - CI usa Node 22
  - `Dockerfile` usa Node 24
  - durante `npm --prefix backend ci` aparecieron advertencias `EBADENGINE` de dependencias que declaran soporte `>=18 <=22 || ^16`
- No existe una verificacion automatica en repo para detectar BOM, caracteres bidireccionales o invisibles peligrosos en archivos criticos.

## 4. Deuda tecnica

- `app.ts` necesita seguir dividiendose por dominios y middleware, pero en PRs pequenos y con validacion fuerte por cada extraccion.
- `basicRoutes.ts` necesita reemplazar `any` por tipos concretos compartidos o contratos minimos.
- La respuesta de error deberia converger a una forma estable para validacion, autenticacion y fallos internos.
- El frontend hoy recibe el cuerpo de error como `string` crudo en `HttpClientError.body`; falta una capa opcional para interpretar errores JSON conocidos sin duplicar parseo en consumidores.
- Falta una verificacion local barata para encoding/texto que complemente `.editorconfig` y `.gitattributes`.
- La divergencia de version de Node entre CI y Docker deberia resolverse en una rama separada y con validacion de compatibilidad real.

## 5. Cambios seguros que propones

- TAREA A: usar codigos especificos de validacion en `backend/src/routes/bancosRoutes.ts`:
  - `/analyze` -> `BANK_ANALYZE_VALIDATION_ERROR`
  - `/analysis/start` -> `BANK_ANALYSIS_START_VALIDATION_ERROR`
- TAREA B: eliminar la dependencia no usada `BankImportError` del wiring de `bancos`.
- TAREA C: agregar un tipo minimo compartido `ValidationErrorResponse` solo si mantiene simple `validationMiddleware.ts`.
- TAREA D: cambiar `npm install` por `npm ci` en `.github/workflows/ci.yml` para hacer instalaciones reproducibles.
- TAREA E: agregar `tools/check-text-encoding.py` para detectar BOM, bidi e invisibles peligrosos en archivos criticos.

## 6. Cambios que NO debes hacer todavia

- No dividir `backend/src/app.ts` de forma masiva en esta rama.
- No unificar de golpe toda la estrategia de errores del backend.
- No cambiar autenticacion real de NetSuite, SAT, Banxico ni integraciones externas.
- No tocar secretos, `.env` reales, certificados, XML, CFDI, logs ni tokens.
- No cambiar comportamiento visual ni UX del frontend.
- No cambiar Docker de produccion solo por las advertencias de engine; primero hace falta una decision explicita de version de Node.
- No cambiar contratos publicos de API fuera de ajustes documentados y claramente no funcionales.

## 7. Orden recomendado de PRs futuros

1. PR pequeno de hardening de rutas `bancos`:
   - codigos especificos de validacion
   - limpieza de dependencia no usada
   - tipo compartido minimo de error de validacion si se mantiene trivial
2. PR de DX/guardrails:
   - `npm ci` en CI
   - verificacion de encoding local y eventualmente en CI
3. PR de consistencia de errores:
   - normalizar respuestas de validacion, auth interna y errores de dominio a un contrato comun
4. PR de tipado:
   - eliminar `any` de `basicRoutes.ts` y contratos cercanos
5. PR estructural por dominio:
   - seguir extrayendo rutas de `app.ts` en modulos pequenos y validables
6. PR de plataforma:
   - alinear version de Node entre CI, desarrollo y Docker despues de validar compatibilidad de dependencias

## 8. Validaciones ejecutadas

- `pwd`
- `ls`
- `git status`
- verificacion de `backend/package.json`
- `npm --prefix backend ci`
- `npm --prefix frontend ci`
- `npm --prefix backend run build`

Resultado actual:

- `npm --prefix backend run build`: OK
- `npm --prefix backend ci`: OK con advertencias `EBADENGINE`
- `npm --prefix frontend ci`: OK

## 9. Riesgos de merge

- Riesgo medio en `backend/src/app.ts` porque es un archivo con mucho movimiento potencial y alto acoplamiento.
- Riesgo medio en `.github/workflows/ci.yml` si otro flujo paralelo toca CI al mismo tiempo.
- Riesgo bajo en `bancosRoutes.ts`, `validationMiddleware.ts` y un posible `httpTypes.ts` porque el alcance es pequeno y localizado.
- Riesgo bajo en el script de encoding si queda aislado en `tools/`.

## 10. Que quedo fuera de alcance

- Ejecucion real contra NetSuite, SAT, Banxico, bancos, NAS u otros servicios externos.
- Validacion de endpoints con datos reales o archivos sensibles.
- Refactors grandes de arquitectura.
- Cambios de produccion, deploy o infraestructura real.
- Cambios visuales del frontend.
- Pruebas end-to-end o de integracion que requieran credenciales o redisenar la estructura actual.

## Nota sobre la tarea C

- A priori si aporta claridad agregar `ValidationErrorResponse`, porque hace explicito el contrato minimo de `validationMiddleware.ts` sin forzar una arquitectura nueva.
- Si al aplicar la tarea aumenta acoplamiento o obliga a tocar mas rutas de las previstas, se debe descartar y dejar este punto solo documentado.
