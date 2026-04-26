# File Store Reliability Plan

## Objetivo

Reducir el riesgo de corrupcion o race condition en stores JSON sin migrarlos todos de golpe.

## Stores encontrados

- `backend/src/bankAnalysisRunStore.ts`
- `backend/src/bankBalanceValidationStore.ts`
- `backend/src/bankEquivalenceStore.ts`
- `backend/src/bankHistoricalRegistryStore.ts`
- `backend/src/bankIndividualPaymentStore.ts`
- `backend/src/bankRecognitionOverrideStore.ts`
- `backend/src/bankWorkingFileStore.ts`
- `backend/src/banxicoCepRecognitionStore.ts`
- `backend/src/claveSatStore.ts`
- `backend/src/egresosConciliationStore.ts`
- `backend/src/kontempoStore.ts`
- `backend/src/netsuiteAccountStore.ts`
- `backend/src/netsuiteEntityStore.ts`
- `backend/src/satDownloadHistoryStore.ts`
- `backend/src/satIgnoredCfdiStore.ts`
- `backend/src/satManualHomologationStore.ts`
- `backend/src/satRetentionAccountStore.ts`

## Patron actual observado

Patron dominante:

1. leer archivo con `fs.readFileSync(...)`
2. `JSON.parse(...)`
3. transformar arreglo u objeto en memoria
4. escribir con `fs.writeFileSync(...)`

Ejemplos representativos:

- `backend/src/bankAnalysisRunStore.ts`
- `backend/src/bankWorkingFileStore.ts`
- cache/manifiesto en `backend/src/sat.ts`
- token store en `backend/src/netsuiteOAuth.ts`

## Riesgos actuales

### Race condition

- dos requests concurrentes pueden leer el mismo estado viejo y sobrescribir cambios
- el ultimo writer gana sin enterarse del conflicto

### Silent catch

- varios loaders devuelven `[]` o `null` si falla el parseo
- eso puede ocultar corrupcion de archivo o schema drift

### Escritura no atomica

- si el proceso cae durante `writeFileSync(...)`, el archivo puede quedar truncado
- no hay `.tmp` ni rename atomico

### Falta de backup

- no existe una estrategia consistente de `.bak`
- tampoco hay politica de cuantos respaldos retener

## Propuesta incremental

### Paso 1

- documentar stores y elegir piloto
- no tocar todos los stores todavia

### Paso 2

- introducir helper base para:
  - `parseJsonWithContext(...)`
  - `createBackupPath(...)`
  - `writeJsonFileAtomic(...)`
  - `readJsonFileSafe(...)`

### Paso 3

- migrar un store piloto con pruebas en temp dir

### Paso 4

- evaluar locking solo despues de validar el helper base

## Store piloto recomendado

- `backend/src/bankAnalysisRunStore.ts`

Motivos:

- ya participa en analisis async de bancos
- mezcla create/update/read de manera frecuente
- una perdida o overwrite ahi pega a UX y trazabilidad

Segundo candidato:

- `backend/src/bankWorkingFileStore.ts`

## Diseno sugerido de helper base

Contratos deseados:

- `readJsonFileSafe(path, fallbackFactory, options)`
- `parseJsonWithContext(raw, filePath)`
- `createBackupPath(filePath, timestamp)`
- `writeJsonFileAtomic(path, payload, options)`

Comportamiento recomendado:

- escribir en `*.tmp`
- `fs.renameSync(...)` o equivalente para swap atomico
- backup opcional `*.bak`
- errores con contexto del archivo y operacion

## Estrategia de backup

- crear backup solo antes de sobrescribir un archivo existente
- usar sufijo con timestamp UTC o contador
- rotar a un numero pequeno, por ejemplo 3 backups

## Estrategia de locking

No implementar en esta rama todavia.

Orden recomendado:

1. atomic write
2. backup
3. metricas/log de conflictos
4. locking si aun hace falta

Motivo:

- meter locks primero complica recovery y portabilidad Docker/NAS

## Validaciones y tests recomendados

- escribir archivo nuevo en temp dir
- sobrescribir archivo existente y confirmar backup
- simular JSON invalido y verificar error contextual
- simular doble write secuencial y verificar integridad
- backend build
- `npm test`
- `git diff --check`
- `python tools/check-text-encoding.py`

## Que no se implemento todavia

- no se agrego `proper-lockfile`
- no se migro ningun store
- no se cambio comportamiento runtime de persistencia
