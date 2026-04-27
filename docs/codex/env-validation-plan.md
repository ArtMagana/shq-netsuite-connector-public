# Environment Validation Plan

## Objetivo

Mejorar la lectura y validacion de variables de entorno sin romper el laboratorio ni exigir credenciales reales para `api/health` o la UI.

## Variables actuales observadas por categoria

### Runtime basico

- `HOST`
- `PORT`
- `APP_PUBLIC_BASE_URL`
- `ALLOWED_ORIGINS`
- `JSON_BODY_LIMIT`
- `FRONTEND_DIST_DIR`
- `NODE_ENV`

### Auth interna

- `INTERNAL_API_KEY`

### NetSuite TBA/OAuth

- `NETSUITE_AUTH_MODE`
- `NETSUITE_ACCOUNT_ID`
- `NETSUITE_BASE_URL`
- `NETSUITE_CONSUMER_KEY`
- `NETSUITE_CONSUMER_SECRET`
- `NETSUITE_TOKEN_ID`
- `NETSUITE_TOKEN_SECRET`
- `NETSUITE_OAUTH_CLIENT_ID`
- `NETSUITE_OAUTH_CLIENT_SECRET`
- `NETSUITE_OAUTH_REDIRECT_URI`
- `NETSUITE_OAUTH_SCOPES`
- `NETSUITE_OAUTH_FRONTEND_RETURN_URL`
- `NETSUITE_OAUTH_TOKEN_STORE_PATH`

### SAT

- `SAT_EFIRMA_CERT_PATH`
- `SAT_EFIRMA_KEY_PATH`
- `SAT_EFIRMA_KEY_PASSWORD`
- `SAT_EFIRMA_KEY_PASSWORD_FILE`
- `SAT_PACKAGE_CACHE_DIR`
- `SAT_DOWNLOAD_HISTORY_STORE_PATH`
- `SAT_IGNORED_CFDI_STORE_PATH`
- `SAT_MANUAL_HOMOLOGATION_STORE_PATH`
- `SAT_RETENTION_ACCOUNT_RULE_STORE_PATH`
- `SAT_XML_MODEL_WORKBOOK_PATH`

### Bancos y stores

- `BANKS_*`
- `BANXICO_*`
- rutas `*_STORE_PATH`

## Requeridas vs opcionales

### Requeridas para arranque basico del laboratorio

- ninguna credencial externa
- `ALLOWED_ORIGINS` solo en produccion real
- `PORT` opcional porque hay default

### Requeridas por dominio

- `INTERNAL_API_KEY` solo para mutaciones protegidas
- `NETSUITE_*` solo para integracion NetSuite real
- `SAT_*` solo para integracion SAT real
- varias `BANKS_*` solo para flujos especificos

## Diferencias por entorno

### Local

- puede usar `.env.local`
- puede levantar sin NetSuite/SAT reales

### Docker laboratorio

- corre con `NODE_ENV=production`
- no debe exigir credenciales reales para `api/health`

### CI

- solo necesita compilar, lint y testear
- no debe depender de secretos reales

### NAS laboratorio

- usa compose separado
- debe mantenerse aislado del deploy actual

## Propuesta de `config/env.ts`

Introducir helpers por dominio:

- `readRequiredString(...)`
- `readOptionalString(...)`
- `readBoolean(...)`
- `readCsv(...)`
- `readFilePath(...)`

Y luego agrupar:

- `readRuntimeEnv()`
- `readInternalAuthEnv()`
- `readNetSuiteEnv()`
- `readSatEnv()`
- `readBankStoreEnv()`

## Riesgo de hacer fail-fast global

- puede romper `api/health`
- puede romper la UI del laboratorio sin necesidad
- obliga a configurar NetSuite/SAT incluso cuando la prueba no los usa

## Orden de migracion recomendado

1. runtime basico y CORS
2. auth interna
3. NetSuite
4. SAT
5. stores y rutas de archivos

## Validaciones necesarias

- backend build
- frontend build
- healthcheck sin credenciales reales
- smoke Docker laboratorio
- CI verde

## Que no se implementa todavia

- no se agrega `config/env.ts`
- no se activa fail-fast global
- no se exigen credenciales reales para abrir la app
