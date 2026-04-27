# Instancia aislada de prueba del repo publico

## Objetivo

Esta guia explica como levantar una instancia de prueba separada usando:

- repo: `ArtMagana/shq-netsuite-connector-public`
- branch: `codex/independent-architecture-hardening-pass`
- carpeta sugerida: `shq-public-test`
- nombre de instancia sugerido: `shq-public-test`
- puerto sugerido: `8090`

La meta es probar este repo publico sin tocar:

- el repo privado `ArtMagana/shq-netsuite-connector`
- la instancia actual
- credenciales reales
- despliegues existentes

Si hoy existe una app en `8088`, debe quedarse intacta.

## Reglas de seguridad para esta prueba

- Trabaja siempre desde un checkout separado del repo publico.
- No copies `.env` desde el repo privado.
- No reutilices credenciales reales de NetSuite, SAT, Banxico, bancos o NAS.
- No montes volumenes ni rutas de produccion.
- No reutilices el puerto `8088`.
- No hagas merge a `main` para probar.

## Definition of Done para cambios revisables por web

Una tarea no debe considerarse cerrada solo por build o CI. Para que un cambio quede revisable por web, debe existir:

- PR abierto en draft o listo para revision, segun corresponda.
- GitHub Actions CI en verde.
- deploy aislado en `shq-public-test` o equivalente de laboratorio, separado del repo privado y de produccion.
- URL de prueba entregada.
- `GET /api/health` respondiendo OK.
- UI abriendo correctamente en la URL de prueba.
- smoke test basico de rutas publicas OK.
- validacion de al menos un endpoint protegido con dummy API key si aplica.
- confirmacion explicita de que `supplai-app-1`, `netsuite-recon` u otra instancia existente no cambiaron.

Importante:

- `http://127.0.0.1:8090` solo sirve para validacion local desde el mismo host.
- El gate web se considera cerrado solo cuando existe una URL de host o NAS que el usuario pueda abrir directamente desde su navegador.
- Si solo existe `localhost` o `127.0.0.1`, el estado correcto es `PARTIAL / BLOCKED FOR USER VERIFICATION`.

## Camino 1: prueba local en Windows / PowerShell

### 1. Crear una carpeta separada

Ejemplo:

```powershell
New-Item -ItemType Directory -Path C:\work -Force | Out-Null
Set-Location C:\work
git clone https://github.com/ArtMagana/shq-netsuite-connector-public.git shq-public-test
Set-Location .\shq-public-test
git checkout codex/independent-architecture-hardening-pass
```

No ejecutes estos pasos dentro de:

- `ArtMagana/shq-netsuite-connector`

Ejecutalos solo dentro de:

- `ArtMagana/shq-netsuite-connector-public`

### 2. Confirmar que estas en el repo publico

```powershell
pwd
git remote -v
git branch --show-current
```

Debes ver:

- remoto `ArtMagana/shq-netsuite-connector-public`
- rama `codex/independent-architecture-hardening-pass`

### 3. Crear variables dummy de prueba

Crea `backend/.env.local` a partir de `backend/.env.example` y deja solo valores de laboratorio.

Ejemplo seguro:

```dotenv
HOST=127.0.0.1
PORT=8090
APP_PUBLIC_BASE_URL=http://127.0.0.1:8090
ALLOWED_ORIGINS=http://127.0.0.1:8090,http://localhost:8090
JSON_BODY_LIMIT=1mb
INTERNAL_API_KEY=dummy-public-test-key
NETSUITE_AUTH_MODE=tba
NETSUITE_ACCOUNT_ID=
NETSUITE_BASE_URL=
NETSUITE_CONSUMER_KEY=
NETSUITE_CONSUMER_SECRET=
NETSUITE_TOKEN_ID=
NETSUITE_TOKEN_SECRET=
NETSUITE_OAUTH_CLIENT_ID=
NETSUITE_OAUTH_CLIENT_SECRET=
NETSUITE_OAUTH_REDIRECT_URI=https://example.invalid/api/auth/netsuite/callback
NETSUITE_OAUTH_SCOPES=rest_webservices
NETSUITE_OAUTH_FRONTEND_RETURN_URL=http://127.0.0.1:8090/#/ingresos
SAT_EFIRMA_CERT_PATH=
SAT_EFIRMA_KEY_PATH=
SAT_EFIRMA_KEY_PASSWORD=
SAT_EFIRMA_KEY_PASSWORD_FILE=
```

Notas:

- Si una variable real de NetSuite, SAT o Banxico no es necesaria para abrir la UI o consultar `healthcheck`, dejala sin configurar o vacia.
- No copies archivos del repo privado para llenar esas variables.
- `LARGE_JSON_BODY_LIMIT` no hace falta aqui; el backend usa un valor fijo para esos endpoints.

Opcionalmente, si quieres que un frontend compilado incluya un header dummy para endpoints internos, crea `frontend/.env.local` solo con valores de laboratorio:

```dotenv
VITE_API_BASE_URL=/api
VITE_INTERNAL_API_KEY=dummy-public-test-key
```

Eso es opcional. Para abrir la UI y comprobar `healthcheck`, no es obligatorio.

Alternativa sin archivos locales extra:

- exportar `VITE_API_BASE_URL=/api`
- exportar `VITE_INTERNAL_API_KEY=dummy-public-test-key`
- compilar frontend con esas variables de entorno

### 4. Instalar dependencias y compilar

```powershell
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run build
$env:VITE_API_BASE_URL='/api'
$env:VITE_INTERNAL_API_KEY='dummy-public-test-key'
npm --prefix frontend run build
git diff --check
python tools/check-text-encoding.py
```

### 5. Levantar la instancia aislada

La forma mas simple es servir el frontend compilado desde el backend ya construido:

```powershell
npm --prefix backend run start
```

Con `PORT=8090`, la app deberia quedar en:

- `http://127.0.0.1:8090`
- diagnostico ligero: `http://127.0.0.1:8090/#/lab`

Estas URLs son validas solo para la maquina donde corre el backend.

### 6. Validar que la prueba es aislada

En otra consola de PowerShell:

```powershell
Get-NetTCPConnection -LocalPort 8088,8090 -State Listen -ErrorAction SilentlyContinue
Invoke-WebRequest http://127.0.0.1:8090/api/health | Select-Object -ExpandProperty Content
Start-Process http://127.0.0.1:8090
```

Que revisar:

- `8090` debe corresponder a la app de prueba.
- `8088` no debe ser reutilizado por esta prueba.
- Si ya habia una instancia en `8088`, debe seguir intacta.
- `/#/lab` debe mostrar:
  - `Healthcheck OK`
  - `Ambiente: public-test / lab`
  - `Frontend internal API key: Configured`

### 7. Como apagarla

Deten la consola donde corre `npm --prefix backend run start`.

## Camino 2: prueba separada en NAS / Docker

Este repo ya tiene `Dockerfile`, asi que si es seguro dejar un laboratorio separado, usa:

- `deploy/test/docker-compose.public-test.yml`

Ese compose:

- usa nombre de servicio distinto
- usa nombre de contenedor distinto
- publica `8090`
- no usa `deploy/nas/netsuite-recon.env`
- no monta rutas reales de produccion
- no incluye secretos
- inyecta `VITE_API_BASE_URL=/api` y `VITE_INTERNAL_API_KEY=dummy-public-test-key` como build args de laboratorio para el frontend

### 1. Crear una carpeta separada en NAS o servidor

Ejemplo conceptual:

- `/volume1/docker/shq-public-test`

o cualquier ruta equivalente que no sea la del despliegue actual.

### 2. Clonar el repo publico y cambiar a la rama del PR

```bash
git clone https://github.com/ArtMagana/shq-netsuite-connector-public.git shq-public-test
cd shq-public-test
git checkout codex/independent-architecture-hardening-pass
git remote -v
git branch --show-current
```

Debes ver el repo publico y la rama del PR, no el repo privado.

### 3. Levantar el compose de laboratorio

Desde la raiz del checkout publico:

```bash
docker compose -f deploy/test/docker-compose.public-test.yml -p shq-public-test up -d --build
```

### 4. Validar que la instancia aislada no toca la actual

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
docker compose -f deploy/test/docker-compose.public-test.yml -p shq-public-test ps
curl http://127.0.0.1:8090/api/health
node tools/verify-public-test.mjs http://127.0.0.1:8090
```

Que revisar:

- debe existir un contenedor distinto al actual
- el contenedor nuevo debe llamarse `shq-public-test`
- el puerto publicado debe ser `8090`
- la instancia existente no debe cambiar de nombre ni de puerto
- si ya habia algo en `8088`, debe seguir igual
- `http://127.0.0.1:8090/#/lab` debe abrir el panel de diagnostico del laboratorio web

### 5. Como apagarla

```bash
docker compose -f deploy/test/docker-compose.public-test.yml -p shq-public-test down
```

## Variables de entorno de prueba

Minimo recomendado para una prueba aislada:

```dotenv
NODE_ENV=production
HOST=0.0.0.0
PORT=3000
APP_PUBLIC_BASE_URL=http://127.0.0.1:8090
ALLOWED_ORIGINS=http://127.0.0.1:8090,http://localhost:8090
JSON_BODY_LIMIT=1mb
INTERNAL_API_KEY=dummy-public-test-key
```

Build args de laboratorio para Docker:

```dotenv
VITE_API_BASE_URL=/api
VITE_INTERNAL_API_KEY=dummy-public-test-key
```

Notas de seguridad para esos build args:

- `VITE_INTERNAL_API_KEY` no es un secreto fuerte.
- su presencia en el bundle solo es aceptable para laboratorio o validacion interna controlada.
- no debe reutilizarse esta configuracion en produccion.
- no debe copiarse ninguna key real a variables `VITE_*`.

Para prueba local fuera de Docker, `PORT=8090`.

Para Docker:

- el contenedor escucha en `3000`
- el host publica `8090:3000`

Variables que pueden quedarse vacias o sin configurar para una prueba de UI y `healthcheck`:

- `NETSUITE_*`
- `SAT_*`
- rutas de certificados
- rutas de workbooks operativos
- rutas de almacenamiento real

## Checklist de validacion

- `npm --prefix backend run build` OK
- `npm --prefix frontend run build` OK
- `git diff --check` OK
- `python tools/check-text-encoding.py` OK
- la app levanta en `8090`
- `GET /api/health` responde
- la UI abre en la URL de prueba
- `node tools/verify-public-test.mjs http://127.0.0.1:8090` pasa
- el repo privado no fue tocado
- la instancia actual en `8088` sigue intacta
- no hay `.env` reales copiados
- no hay secretos en archivos nuevos
- no hay certificados ni XML reales agregados

## Cierre real del gate web

El gate queda realmente cerrado solo si se cumplen los dos niveles:

1. Validacion local:
   - `127.0.0.1:8090`
   - `node tools/verify-public-test.mjs http://127.0.0.1:8090`
   - `/#/lab`

2. Validacion por usuario:
   - URL accesible por el usuario fuera del host local
   - ejemplo: `http://<NAS-O-IP-DE-PRUEBA>:8090`
   - mismo healthcheck OK
   - misma UI abriendo
   - mismas comprobaciones de smoke test

Si el segundo nivel no existe todavia, el estado correcto del gate es:

- `PARTIAL / BLOCKED FOR USER VERIFICATION`

## Resultado de prueba real en NAS

Resultado observado con la instancia aislada levantada desde esta rama:

- carpeta usada: `/volume1/docker/shq-public-test`
- contenedor: `shq-public-test`
- puerto publicado: `8090 -> 3000`
- healthcheck probado: `curl http://127.0.0.1:8090/api/health`
- campos minimos esperados en la respuesta: `{ "status": "ok", "service": "netsuite-recon-backend" }`
- nota: el endpoint real tambien incluye `timestampUtc`
- `supplai-app-1` en `8088` quedo intacto
- `netsuite-recon` en `3000` quedo intacto

Hallazgo real detectado durante la prueba:

- `docker build` terminaba bien, pero el contenedor caia en restart loop al arrancar
- la causa fue un wiring incompleto de `createInventarioRoutes(...)` en `backend/src/app.ts`
- el fix quedo documentado y aplicado en esta rama con `fix: restore inventario route dependencies`
- la prueba aislada sirvio para detectar y corregir el bug sin tocar el repo privado ni produccion

## Comandos utiles para comprobar que no se toco la instancia actual

### Windows / PowerShell

```powershell
git remote -v
Get-NetTCPConnection -LocalPort 8088,8090 -State Listen -ErrorAction SilentlyContinue
Invoke-WebRequest http://127.0.0.1:8090/api/health | Select-Object -ExpandProperty Content
node tools/verify-public-test.mjs http://127.0.0.1:8090
```

### Docker / NAS

```bash
docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"
docker compose -f deploy/test/docker-compose.public-test.yml -p shq-public-test ps
curl http://127.0.0.1:8090/api/health
node tools/verify-public-test.mjs http://127.0.0.1:8090
```

## Que NO hacer

- No copiar `.env` del repo privado.
- No usar tokens reales.
- No montar volumenes de produccion.
- No reutilizar el puerto `8088`.
- No cambiar el deploy existente.
- No mezclar la carpeta del repo privado con la carpeta del repo publico.
- No hacer merge a `main` para probar.
- No pegar certificados reales, XML reales, CFDI reales ni secretos en archivos nuevos.
