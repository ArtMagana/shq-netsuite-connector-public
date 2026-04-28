# Despliegue NAS

Este modo deja una copia estable del sistema corriendo como contenedor, separada de tu carpeta de trabajo local.

## Que resuelve

- El servicio sigue vivo aunque apagues tu PC.
- Tus cambios locales no afectan al proceso que ya esta corriendo en el NAS.
- Toda la persistencia queda en `deploy/nas/data`, no dentro del contenedor.

## Requisitos

- Un NAS o servidor que soporte Docker / Container Manager.
- Salida de red hacia NetSuite y Banxico.
- Los archivos operativos que usa el backend en `deploy/nas/config`.

## Archivos del despliegue

- `Dockerfile`
- `docker-compose.nas.yml`
- `deploy/nas/netsuite-recon.env`
- `deploy/nas/data/`
- `deploy/nas/config/`

## Preparacion

1. Copia `deploy/nas/netsuite-recon.env.example` a `deploy/nas/netsuite-recon.env`.
2. Ajusta `APP_PUBLIC_BASE_URL` a la IP o DNS real del NAS.
3. Ajusta credenciales NetSuite.
4. Si usaras SAT, coloca estos archivos:
   - `deploy/nas/config/sat/efirma.cer`
   - `deploy/nas/config/sat/efirma.key`
   - `deploy/nas/config/sat/efirma-password.txt`
   - `deploy/nas/config/sat/xml-model.xlsx`
5. Coloca en `deploy/nas/config/bancos/` el workbook de equivalencias bancarias con este nombre:
   - `deploy/nas/config/bancos/carga-pagos-modelo.xlsx`

## Arranque

```bash
cp deploy/nas/netsuite-recon.env.example deploy/nas/netsuite-recon.env
docker compose -f docker-compose.nas.yml up -d --build
```

Si tu NAS usa una interfaz tipo Container Manager en vez de terminal, probablemente querras editar
las rutas de `volumes` en `docker-compose.nas.yml` para apuntar a carpetas absolutas del NAS.

## Actualizar sin interrumpir tu trabajo local

```bash
git pull
docker compose -f docker-compose.nas.yml up -d --build
```

El contenedor recompila y reinicia con la nueva version desplegada. Tus cambios locales sin publicar no afectan al NAS.

Desde tu PC tambien puedes usar el deploy de un comando en [Deploy-NAS.ps1](<\\?\UNC\NASMaga\artmaganaV2\Personal (AMM)\Supplai\webAPP (SHQ) NetsuiteConnector\Deploy-NAS.ps1>) y la guia corta en [deploy/nas/USAGE.md](<\\?\UNC\NASMaga\artmaganaV2\Personal (AMM)\Supplai\webAPP (SHQ) NetsuiteConnector\deploy\nas\USAGE.md>).

## Persistencia

Todo esto queda fuera del contenedor y sobrevive reinicios:

- corridas de analisis bancario
- historico BBVA
- cache/reconocimientos Banxico
- cache SAT y ventanas SAT
- catalogos sincronizados de NetSuite
- token OAuth almacenado

## Cosas a cuidar

- No apuntes el contenedor a tu carpeta de trabajo viva como volumen de codigo.
- Usa `APP_PUBLIC_BASE_URL` real para que OAuth y enlaces de retorno no queden amarrados a `127.0.0.1`.
- Configura `ALLOWED_ORIGINS` en `netsuite-recon.env` con la URL real del NAS antes de desplegar. En produccion el backend rechaza arrancar con la lista vacia.
- Si quieres OAuth 2.0 de NetSuite, el `redirect URI` debe ser HTTPS o un dominio/tunel valido.
- Si solo usaras TBA, puedes dejar OAuth vacio.

## Acceso

Una vez arriba, entra por:

- `http://IP-DEL-NAS:3000`

Ya no por `http://127.0.0.1:3000`.
