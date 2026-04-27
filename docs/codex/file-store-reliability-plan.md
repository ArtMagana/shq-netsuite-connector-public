# File Store Reliability Plan

## Objetivo

Reducir el riesgo de corrupcion o race condition en stores JSON sin migrarlos todos de golpe.

## Inventario real de stores principales

| Archivo | Tipo de datos que maneja | Usa JSON | Lee y escribe | Riesgo de race condition | Riesgo de corrupcion parcial | Tiene silent catch | Candidato para primer prototipo | Riesgo de migrarlo |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `backend/src/bankAnalysisRunStore.ts` | corridas de analisis bancario | Si | Si | Alto | Alto | Si | No | Medio-alto |
| `backend/src/bankBalanceValidationStore.ts` | saldos bancarios validados | Si | Si | Medio | Medio | Si | No | Medio |
| `backend/src/bankEquivalenceStore.ts` | equivalencias manuales de contrapartes | Si | Si | Medio | Medio | Si | Si | Bajo-medio |
| `backend/src/bankHistoricalRegistryStore.ts` | registros de cargas historicas bancarias | Si | Si | Alto | Alto | Si | No | Alto |
| `backend/src/bankIndividualPaymentStore.ts` | archivos de pagos individuales con base64 | Si | Si | Medio | Alto | Si | No | Medio-alto |
| `backend/src/bankRecognitionOverrideStore.ts` | overrides manuales de reconocimiento bancario | Si | Si | Alto | Alto | Si | No | Medio-alto |
| `backend/src/bankWorkingFileStore.ts` | archivo bancario de trabajo con base64 | Si | Si | Alto | Alto | Si | No | Medio-alto |
| `backend/src/banxicoCepRecognitionStore.ts` | reconocimientos manuales CEP | Si | Si | Medio-alto | Alto | Si | No | Medio-alto |
| `backend/src/claveSatStore.ts` | snapshot de catalogo Clave SAT | Si | Si | Bajo-medio | Medio | Si | No | Medio |
| `backend/src/egresosConciliationStore.ts` | conciliaciones locales de egresos | Si | Si | Medio | Medio | Si | No | Medio |
| `backend/src/kontempoStore.ts` | homologaciones, recognitions e import runs de Kontempo | Si | Si | Alto | Alto | Si | No | Alto |
| `backend/src/netsuiteAccountStore.ts` | cache de catalogo de cuentas NetSuite | Si | Si | Bajo-medio | Medio | Si | No | Medio |
| `backend/src/netsuiteEntityStore.ts` | cache de catalogos de entidades NetSuite | Si | Si | Bajo-medio | Medio | Si | No | Medio |
| `backend/src/satDownloadHistoryStore.ts` | historial de paquetes y CFDI SAT | Si | Si | Alto | Alto | Si | No | Alto |
| `backend/src/satIgnoredCfdiStore.ts` | CFDI ignorados y motivos | Si | Si | Medio | Medio-alto | Si | No | Medio-alto |
| `backend/src/satManualHomologationStore.ts` | homologaciones manuales SAT | Si | Si | Alto | Alto | Si | No | Alto |
| `backend/src/satRetentionAccountStore.ts` | reglas de cuentas de retenciones SAT | Si | Si | Medio | Medio | Si | No | Medio |

## Persistencias JSON auxiliares relacionadas

Estas rutas no siguen el patron `*Store.ts`, pero si participan en el riesgo general de persistencia local y deben entrar en la hoja de ruta:

| Archivo | Tipo de datos que maneja | Usa JSON | Lee y escribe | Riesgo principal | Silent catch | Notas |
| --- | --- | --- | --- | --- | --- | --- |
| `backend/src/netsuiteOAuth.ts` | sesion OAuth almacenada en disco | Si | Si | secreto en texto plano y write no atomico | No | no es candidato del prototipo por sensibilidad |
| `backend/src/satAnalysisWindows.ts` | ventanas de analisis SAT | Si | Si | overwrites y estado de workflow | Si | mejor dejarlo para una fase posterior |
| `backend/src/sat.ts` | manifiestos de cache SAT en disco | Si | Si | cache parcial o inconsistente | Si | mezcla cache binario y JSON |
| `backend/src/inventoryLotReplacementRegistry.ts` | registry de reemplazos de lote | Si | Si | escritura async directa sin backup | Si | ligado a inventario, no ideal para piloto |

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

Hallazgos comunes:

- varios stores limpian BOM manualmente, pero no todos
- la mayoria atrapa `JSON.parse(...)` con `catch { return [] }`
- no hay atomicidad ni backups consistentes
- no hay un helper compartido; cada store reimplementa lectura/escritura

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

- candidato elegido para este prototipo: `backend/src/bankEquivalenceStore.ts`

Motivos:

- es pequeno y autocontenido
- no guarda secretos ni archivos base64
- no participa en el arranque base ni en `api/health`
- su estructura es simple:
  - `version`
  - `items`
- el flujo de `load/upsert/persist` es directo y facil de probar
- si una corrupcion de JSON aparece, el impacto de negocio es menor que en SAT, OAuth, working files o analysis runs

Candidatos de segunda linea:

- `backend/src/bankBalanceValidationStore.ts`
- `backend/src/egresosConciliationStore.ts`

Candidatos descartados para esta primera migracion:

- `bankWorkingFileStore.ts`
  - guarda base64 de archivos bancarios
- `bankIndividualPaymentStore.ts`
  - guarda base64 y volumen de datos mayor
- `bankAnalysisRunStore.ts`
  - mas critico para trazabilidad de analisis
- `netsuiteOAuth.ts`
  - maneja tokens/sesion y requiere un diseno de seguridad separado

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
