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

- `readJsonFile(path, fallback)`
- `createBackupFile(path)`
- `writeJsonFileAtomic(path, payload)`
- `safeJsonStringify(payload)`

Comportamiento recomendado:

- escribir en `*.tmp`
- `fs.renameSync(...)` o equivalente para swap atomico
- backup opcional `*.bak`
- errores con contexto del archivo y operacion

## Estado del prototipo actual

### Utilidades creadas

Archivo:

- `backend/src/infrastructure/storage/fileStoreUtils.ts`

Funciones agregadas:

- `readJsonFile(...)`
- `writeJsonFileAtomic(...)`
- `createBackupFile(...)`
- `safeJsonStringify(...)`

Cobertura actual:

- lectura con fallback cuando el archivo no existe
- parse explicito con contexto si el JSON esta corrupto
- serializacion consistente con newline final
- escritura por archivo temporal + rename
- backup `.bak` optativo antes de sobrescribir

## Limitaciones actuales del prototipo

Este prototipo si mejora:

- escritura atomica con archivo temporal + `rename`
- backup previo al write
- errores explicitos de parseo JSON
- formato JSON estable con newline final

Este prototipo no resuelve todavia:

- `lost updates` por concurrencia `read-modify-write`
- locking entre procesos
- retencion historica de backups
- recuperacion automatica de JSON corrupto
- migracion de todos los stores

En otras palabras:

- reduce el riesgo de truncado y de overwrite sin respaldo inmediato
- no elimina el problema de dos procesos leyendo el mismo estado viejo y escribiendo despues

### Tests agregados

Archivo:

- `tests/file-store-utils.test.mjs`

Casos cubiertos:

- `readJsonFile` devuelve fallback si el archivo no existe
- `readJsonFile` lee JSON valido
- `readJsonFile` falla explicitamente con JSON invalido
- `writeJsonFileAtomic` crea JSON con newline final
- `writeJsonFileAtomic` reemplaza contenido previo
- `createBackupFile` crea `.bak` si existe archivo original
- `createBackupFile` no falla si el archivo no existe

### Tests del store migrado

Archivo:

- `tests/bank-equivalence-store.test.mjs`

Casos cubiertos:

- `loadBankEquivalenceOverrides` devuelve `[]` si no existe archivo
- `upsertBankEquivalenceOverride` crea archivo `version: 2` con timestamps
- un segundo `upsert` del mismo item no duplica registros y genera `.bak`
- un JSON corrupto lanza error explicito con el path del archivo

### Store migrado en este prototipo

- `backend/src/bankEquivalenceStore.ts`

Cambio aplicado:

- lectura manual sustituida por `readJsonFile(...)`
- escritura directa sustituida por:
  - `createBackupFile(...)`
  - `writeJsonFileAtomic(...)`
- resolucion del path movida a `resolveOverrideStorePath()` por llamada

Motivo de seleccion:

- pequeno
- sin secretos
- sin base64
- sin dependencia de arranque base
- estructura simple y buena para validar el patron

Alcance deliberadamente limitado:

- no cambia shape de datos
- no cambia nombre de archivo
- no introduce locking
- no intenta migrar mas stores en esta rama

## Diseno actual del path del store

- `bankEquivalenceStore` ya no fija el path del archivo solo al cargar el modulo
- el path se resuelve en cada `load` y `persist` con `resolveOverrideStorePath()`
- esto mantiene el comportamiento por defecto, pero hace viable probar el store con `BANKS_EQUIVALENCE_OVERRIDE_STORE_PATH` temporal
- no se cambio el nombre del archivo real ni su ubicacion por defecto

## Estrategia de backup

- decision de esta pasada: mantener un solo backup `.bak`
- el `.bak` representa el snapshot inmediato anterior del archivo antes del ultimo write exitoso
- no hay retencion historica ni timestamp en esta fase
- se eligio esta opcion porque:
  - reduce complejidad
  - no cambia naming ni limpieza de archivos
  - sigue siendo suficiente para validar el patron de backup previo a escritura

Lo que implica:

- cada nueva escritura puede sobrescribir el backup anterior
- el `.bak` no sirve como historico largo ni auditoria de cambios

## Estrategia de locking

No implementar en esta rama todavia.

Orden recomendado:

1. atomic write
2. backup
3. metricas/log de conflictos
4. locking si aun hace falta

Motivo:

- meter locks primero complica recovery y portabilidad Docker/NAS

## Recomendacion de locking

Decision actual:

- no tomar el lock manual de `PR #83` como patron general todavia
- si se quiere seguir endureciendo JSON stores de riesgo bajo o medio, el siguiente paso recomendado es evaluar `proper-lockfile`
- para stores criticos o write-heavy, la direccion recomendada ya no es multiplicar lockfiles sino empezar a planear SQLite o un almacenamiento local con transacciones

Siguiente store piloto sugerido:

- `backend/src/bankBalanceValidationStore.ts`

Importante:

- se mantiene solo como candidato de analisis o piloto posterior
- este documento no recomienda migrarlo todavia
- antes debe existir un spike separado que compare lock manual vs `proper-lockfile`

Motivos:

- pequeno
- sin secretos ni base64
- `read-modify-write` claro
- mismo dominio de bancos que el piloto anterior
- facil de testear con archivos temporales

Stores que no conviene usar como siguiente piloto:

- `bankWorkingFileStore.ts`
- `bankIndividualPaymentStore.ts`
- `bankAnalysisRunStore.ts`
- `satDownloadHistoryStore.ts`
- `satManualHomologationStore.ts`
- `netsuiteOAuth.ts`

Motivo:

- son mas sensibles, mas voluminosos o piden una estrategia mas robusta que JSON + lock manual

Documento relacionado:

- `docs/codex/file-store-locking-decision.md`

## Proximo PR recomendado

- crear un spike separado para comparar lock manual vs `proper-lockfile`
- no migrar `bankBalanceValidationStore.ts` todavia
- no agregar SQLite todavia
- validar el spike solo con temp dirs, CI y pruebas documentadas
- documentar requisitos y riesgos para NAS/Docker antes de pensar en uso fuera del laboratorio

## Proxima fase recomendada: locking real

Opciones razonables para la siguiente fase:

### `proper-lockfile`

Pros:

- resuelve locking de archivos con una libreria conocida
- reduce trabajo manual de retry/unlock
- puede acelerar una migracion gradual store por store

Contras:

- agrega dependencia nueva
- hay que validar bien su comportamiento en Docker/NAS y shares de red
- requiere definir timeouts, stale locks y recovery

### lockfile manual con apertura exclusiva

Pros:

- sin dependencia externa
- control total del formato del lock y de la estrategia de expiracion

Contras:

- mas facil equivocarse en edge cases
- mas trabajo de mantenimiento
- recovery de locks huerfanos queda totalmente a cargo del repo

### cola por proceso

Pros:

- simple dentro de un solo proceso Node
- baja el riesgo de colisiones internas sin tocar filesystem locking aun

Contras:

- no protege contra multiples procesos o multiples contenedores
- en Docker/NAS solo cubre una parte del problema real

Recomendacion actual:

- si el siguiente experimento sigue en el repo publico laboratorio, la mejor opcion para evaluar primero es `proper-lockfile`
- si la compatibilidad Docker/NAS genera dudas, hacer un spike pequeno comparando `proper-lockfile` vs lock manual antes de migrar stores adicionales

## Validaciones y tests recomendados

- escribir archivo nuevo en temp dir
- sobrescribir archivo existente y confirmar backup
- simular JSON invalido y verificar error contextual
- simular doble write secuencial y verificar integridad
- backend build
- `npm test`
- `git diff --check`
- `python tools/check-text-encoding.py`

## Stores pendientes prioritarios

Siguientes candidatos razonables despues del piloto:

1. `backend/src/bankBalanceValidationStore.ts`
2. `backend/src/egresosConciliationStore.ts`
3. `backend/src/netsuiteAccountStore.ts`

Stores que conviene dejar para mas adelante:

- `bankAnalysisRunStore.ts`
- `bankWorkingFileStore.ts`
- `bankIndividualPaymentStore.ts`
- `satAnalysisWindows.ts`
- `satDownloadHistoryStore.ts`
- `netsuiteOAuth.ts`

Motivo:

- mayor impacto funcional
- mayor volumen de datos
- base64 o secretos
- flujo mas sensible o cercano a integraciones

## Riesgos restantes

- no hay locking real todavia
- los demas stores siguen con read/modify/write legacy
- `createBackupFile(...)` usa un solo `.bak` y no tiene rotacion
- no hay pruebas de concurrencia
- la mayoria de loaders legacy siguen haciendo silent catch

## Proxima fase recomendada

1. decidir si conviene introducir locking real con `proper-lockfile` o alternativa minima
2. agregar pruebas de concurrencia sobre temp dirs
3. definir retencion de backups `.bak`
4. migrar stores de riesgo bajo-medio de forma gradual
5. definir estrategia de recuperacion para JSON corrupto
6. evaluar si algun store necesita writer asincrono o cola dedicada

## Validacion Docker aislada

- No ejecutada en este entorno de Codex porque `docker` no esta instalado localmente.
- Para validar el runtime aislado del laboratorio, usar:
  - `docker compose -f deploy/test/docker-compose.public-test.yml -p shq-public-test up -d --build`
  - `curl http://127.0.0.1:8090/api/health`
  - `docker ps --format "table {{.Names}}\t{{.Ports}}\t{{.Status}}"`
  - `docker logs --tail=80 shq-public-test`
- Esa validacion debe confirmar que `shq-public-test` responde en `8090` sin tocar la instancia existente.

## Que no se implemento todavia

- no se agrego `proper-lockfile`
- no se migro todo el sistema
- no se tocaron stores con secretos o base64 como piloto
- no se agrego recuperacion automatica de JSON corrupto
- no se tocaron deploys ni integraciones reales
