# NetSuite Reconciliation Console

Consola operativa para conciliacion de cuentas por cobrar en NetSuite, pensada como un proyecto full-stack con interfaz React y backend Node.

## Stack aprobado

- `frontend/`: React + TypeScript + Bootstrap Grid + Vite
- `backend/`: Node + TypeScript + Express
- `GitHub`: repositorio, CI/CD, secretos por ambiente y despliegues
- `NetSuite`: consumido solo desde el backend por REST y SuiteQL

## Arquitectura operativa

```text
Tu app / usuarios internos
        |
        v
React Admin Console
        |
        v
Node Reconciliation API
        |
        +--> Preview engine + rules + audit
        |
        +--> NetSuite REST / SuiteQL
```

## Como se administra

La operacion vive en una app web interna. El navegador nunca toca credenciales de NetSuite. La administracion se hace desde la consola:

- dashboard de salud y sincronizacion
- ingresos y facturas abiertas en NetSuite
- bancos y homologaciones operativas
- facturas SAT para descarga masiva CFDI
- Search / Find para busqueda independiente de transacciones
- reglas y preview de conciliacion
- auditoria operativa

## Estructura del workspace

```text
backend/                 API Node para orquestacion, preview y NetSuite
frontend/                consola React con Bootstrap Grid
netsuite_ar_recon/       prototipo Python inicial de exploracion
tests/                   pruebas del prototipo Python
*.ps1 / *.psm1           utilidades de conectividad y SuiteQL
```

## Scripts raiz

```powershell
npm run install:all
npm run dev:backend
npm run dev:frontend
npm run build
```

En este workspace de red evitamos `npm workspaces` en el root para no depender de symlinks sobre rutas UNC. Por eso el root usa `npm --prefix` para backend y frontend.
Los scripts de Vite del frontend (`npm run dev` y `npm run build`) detectan shares UNC en Windows y relanzan Vite desde una unidad temporal mapeada, para que no vuelva a romper al ejecutar desde el NAS.

Si quieres abrir la consola desde esta carpeta de red sin pelear con Vite sobre UNC, puedes usar:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-LocalPreview.ps1
```

Ese script crea una copia temporal local, instala dependencias, compila backend y frontend, y levanta el preview en `http://127.0.0.1:3000`.
Ahora el preview estable sirve el frontend compilado desde el mismo backend en `3000` y deja un watchdog local que reinicia el proceso si deja de responder.

Si quieres una instancia siempre encendida y separada de tu entorno local, el repo ya incluye un despliegue por contenedor para NAS/servidor en [deploy/nas/README.md](<\\?\UNC\NASMaga\artmaganaV2\Personal (AMM)\Supplai\webAPP (SHQ) NetsuiteConnector\deploy\nas\README.md>) con `docker-compose.nas.yml`.

## Backend

Variables esperadas para la integracion real con NetSuite:

```powershell
$env:NETSUITE_AUTH_MODE="tba"
$env:NETSUITE_ACCOUNT_ID="..."
$env:NETSUITE_BASE_URL="https://5613433.suitetalk.api.netsuite.com"
$env:NETSUITE_CONSUMER_KEY="..."
$env:NETSUITE_CONSUMER_SECRET="..."
$env:NETSUITE_TOKEN_ID="..."
$env:NETSUITE_TOKEN_SECRET="..."
$env:NETSUITE_OAUTH_CLIENT_ID="..."
$env:NETSUITE_OAUTH_CLIENT_SECRET="..."
$env:NETSUITE_OAUTH_REDIRECT_URI="https://your-domain.example/api/auth/netsuite/callback"
$env:NETSUITE_OAUTH_SCOPES="rest_webservices"
```

Variables esperadas para la integracion SAT XML:

```powershell
$env:SAT_EFIRMA_CERT_PATH="C:\ruta\a\tu\efirma.cer"
$env:SAT_EFIRMA_KEY_PATH="C:\ruta\a\tu\efirma.key"
$env:SAT_EFIRMA_KEY_PASSWORD="..."
# o bien
$env:SAT_EFIRMA_KEY_PASSWORD_FILE="C:\ruta\a\archivo-con-password.txt"
```

Para trabajar establemente desde la consola local, crea `backend/.env.local` a partir de `backend/.env.example`.
El backend ya carga `backend/.env.local` al arrancar, asi que tanto `npm run start` como
`Start-LocalPreview.ps1` tomaran esas credenciales automaticamente.

## OAuth 2.0 recomendado

Para la solucion bien hecha sobre NetSuite REST, usa `OAuth 2.0 Authorization Code Grant`:

1. En NetSuite, crea o edita una `Integration Record`.
2. Marca `Authorization Code Grant`.
3. Marca `REST Web Services`.
4. Registra como redirect URI:
   `https://your-domain.example/api/auth/netsuite/callback`
5. En `backend/.env.local`, cambia:
   `NETSUITE_AUTH_MODE=oauth2`
6. Carga `NETSUITE_OAUTH_CLIENT_ID` y `NETSUITE_OAUTH_CLIENT_SECRET`.
7. Abre la pestana `Analysis` y pulsa `Connect OAuth 2.0`.

La consola abre el login de NetSuite, recibe el authorization code en el backend, guarda el
refresh token localmente y luego renueva el access token automaticamente cuando haga falta.

Importante: Oracle documenta que el redirect URI de OAuth 2.0 debe usar `https://` o un esquema
custom. Para desarrollo local, lo correcto es exponer tu backend local con un tunnel HTTPS o usar
un backend de staging con HTTPS.

Nota importante: si habilitas OAuth 2.0 sobre una integracion existente que ya usaba TBA,
NetSuite documenta que puedes reutilizar el mismo client ID y client secret o resetearlos
para generar otros nuevos.

Endpoints base del backend:

- `GET /api/health`
- `GET /api/console/overview`
- `GET /api/rules/default`
- `GET /api/audit`
- `GET /api/reconcile/demo`
- `GET /api/reconcile/examples`
- `GET /api/reconcile/policy`
- `GET /api/auth/netsuite/status`
- `GET /api/search/bootstrap`
- `GET /api/sat/status`
- `GET /api/sat/cfdi/request/:requestId`
- `GET /api/sat/cfdi/package/:packageId`
- `GET /api/sat/cfdi/package/:packageId/download`
- `GET /api/auth/netsuite/login`
- `GET /api/auth/netsuite/callback`
- `GET /api/netsuite/ping`
- `GET /api/netsuite/analysis/bootstrap`
- `POST /api/auth/netsuite/revoke`
- `POST /api/sat/auth/test`
- `POST /api/sat/cfdi/request`
- `POST /api/netsuite/suiteql`
- `POST /api/search/transactions`
- `POST /api/reconcile/preview`

Primer endpoint de analisis real en modo lectura:

- `GET /api/netsuite/analysis/bootstrap`

Este endpoint ejecuta tres consultas `SuiteQL` separadas y devuelve cada bloque con su propio estado:

- facturas abiertas con saldo pendiente
- diarios candidatos a cobro con impacto `A/R`
- periodos contables recientes

Si alguna consulta no aplica a tu cuenta o rol, el backend devuelve el error de ese bloque sin dejar de mostrarnos las consultas base para afinarlas.

## Frontend

La consola React esta pensada como tool interna de finanzas y operaciones:

- `Dashboard`
- `Ingresos`
- `Bancos`
- `Facturas (SAT)`
- `Rules`
- `Search / Find`

La pestana `Ingresos` corre el bootstrap real contra NetSuite en modo lectura y separa:

- facturas abiertas
- diarios candidatos a cobro con impacto `A/R`
- periodos contables
- estado de OAuth 2.0 y boton de autorizacion

La pestana `Facturas (SAT)` reemplaza a la vieja `Queue` y ya expone:

- test de autenticacion real con e.firma
- solicitud de descarga al SAT
- verificacion de request id
- inspeccion del paquete ZIP devuelto
- descarga del ZIP generado por el SAT

El frontend consume por defecto `/api`. En desarrollo con Vite, `/api` se proxya automaticamente a `http://127.0.0.1:3001`. Si necesitas forzar otra URL, puedes cambiarla con:

```powershell
$env:VITE_API_BASE_URL="http://127.0.0.1:3001/api"
```

## Nota del entorno actual

En este workspace ya existe una base Python funcional para pruebas de conectividad y preview. El nuevo stack Node/React es la direccion principal aprobada para el producto.

## GitHub

El repo ya queda planteado para ejecutarse con GitHub Actions:

- instalacion de dependencias
- lint
- build de backend y frontend

La idea es usar GitHub como `control plane`: repositorio, CI/CD, secretos por ambiente y despliegue, mientras la API viva corre fuera de GitHub.

## Primera regla productiva sembrada

El backend ya quedo orientado a una politica mas segura:

- `AUTO_APPLY` solo para match exacto
- diferencias pequenas pasan a `REVIEW_TOLERANCE`
- cruces entre periodos pasan a `REVIEW_CROSS_PERIOD`
- ambiguedades o conflictos quedan en `EXCEPTION_CASE`

Esto nos permite avanzar con un motor real sin comprometer todavia ajustes automaticos o asientos de periodo hasta que definas esas reglas conmigo.
