# Token Vault Design

## Estado actual

- `backend/src/netsuiteOAuth.ts` guarda la sesion OAuth en JSON plano.
- La ruta default depende de:
  - `NETSUITE_OAUTH_TOKEN_STORE_PATH`
  - o `LOCALAPPDATA`
  - o `process.cwd()`

## Riesgos actuales

- tokens en texto plano en disco
- lectura accidental en backups o shares
- poca separacion entre datos de app y secretos
- ausencia de rotacion o versionado de formato

## Por que `keytar` no es la solucion obvia aqui

- en Docker/NAS/headless puede no haber keychain del sistema
- la portabilidad entre Windows local, CI y NAS seria peor
- agrega una dependencia acoplada al entorno host

## Propuesta

Usar un vault cifrado por archivo con Node `crypto` y AES-256-GCM.

## Variable propuesta

- `TOKEN_VAULT_KEY`

Requisitos:

- base64 o hex estable
- 32 bytes reales de clave
- no compartirla con frontend

## Formato sugerido del archivo cifrado

```json
{
  "version": 1,
  "algorithm": "aes-256-gcm",
  "keyId": "primary",
  "iv": "<base64>",
  "tag": "<base64>",
  "ciphertext": "<base64>",
  "metadata": {
    "createdAtUtc": "2026-04-26T00:00:00.000Z",
    "updatedAtUtc": "2026-04-26T00:00:00.000Z"
  }
}
```

## Estrategia de migracion

### Paso 1

- introducir reader/writer cifrado sin activarlo

### Paso 2

- intentar leer vault cifrado
- si no existe, leer formato plano legacy

### Paso 3

- al guardar, escribir formato cifrado
- opcionalmente respaldar el archivo plano a `.bak`

### Paso 4

- despues de una ventana de estabilidad, retirar soporte de escritura plana

## Backup antes de migrar

- crear copia `*.bak`
- no borrar el archivo viejo en la primera version

## Comportamiento si falta clave en produccion

Recomendacion:

- si hay OAuth habilitado y se intenta escribir/leer sesiones sin `TOKEN_VAULT_KEY`, fallar con error explicito

No recomendado:

- caer silenciosamente a texto plano

## Comportamiento en desarrollo

Opciones seguras:

- permitir modo legacy solo con warning explicito
- o exigir `TOKEN_VAULT_KEY` solo cuando se use OAuth real

Recomendacion:

- no bloquear `api/health` ni la UI por ausencia de vault key si OAuth no se usa

## Plan de rollback

- conservar lector dual durante una fase
- mantener backup del archivo anterior
- permitir feature flag para volver al reader legacy temporalmente

## Que no se implementa en esta rama

- no se tocan tokens reales
- no se migran sesiones existentes
- no se cambia el flujo OAuth
- no se modifica `NETSUITE_OAUTH_TOKEN_STORE_PATH`
