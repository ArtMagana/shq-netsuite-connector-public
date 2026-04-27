# File Store Locking Design

## Objetivo

Agregar un primer mecanismo de locking para reducir `lost updates` en ciclos `read-modify-write` sobre stores JSON locales.

## Problema que si resuelve

- dos escritores concurrentes pueden leer el mismo estado previo y sobrescribir cambios del otro
- un lock alrededor de todo el ciclo `read-modify-write` serializa escrituras sobre el mismo archivo

## Problema que no resuelve

- corrupcion previa del JSON antes de adquirir el lock
- merge semantico de cambios incompatibles
- coordinacion distribuida fuera del filesystem local compartido, si existiera
- conflictos logicos entre operaciones validas que necesiten resolucion de dominio

## Opciones evaluadas

### `proper-lockfile`

Pros:

- libreria conocida para locks de archivos
- incluye manejo de stale locks y reintentos
- podria simplificar una migracion gradual futura

Contras:

- agrega dependencia nueva al backend
- necesita validacion especifica en Docker y NAS
- introduce mas superficie de configuracion para un primer experimento

### lockfile manual con `fs.openSync('wx')`

Pros:

- sin dependencias nuevas
- facil de auditar
- suficiente para un prototipo pequeno y localizado

Contras:

- stale locks y timeouts quedan a cargo del repo
- hay que documentar bien sus limites
- no cubre escenarios distribuidos complejos

### cola en memoria por proceso

Pros:

- implementacion simple
- baja contencion dentro de un solo proceso Node

Contras:

- no protege entre procesos ni contenedores
- no ataca el riesgo real del laboratorio NAS/Docker

### mutex async local

Pros:

- ergonomia comoda si toda la capa fuera async

Contras:

- no encaja bien con stores actuales, que son sincronos
- solo protege dentro del proceso actual

### no locking y solo atomic write

Pros:

- menor complejidad
- ya reduce truncados y escrituras parciales

Contras:

- no evita `lost updates`
- deja abierto el riesgo principal identificado para stores JSON

## Recomendacion para este prototipo

- preferir un lockfile manual en filesystem local con `fs.openSync('wx')`
- mantenerlo pequeno, sin dependencia externa, para validar comportamiento y tests
- reservar `proper-lockfile` para una fase posterior solo si este prototipo resulta insuficiente o fragil

## Recomendacion para NAS / Docker

- este prototipo asume un filesystem local o montado donde `open(..., 'wx')` y `rename` mantengan semantica consistente
- para el laboratorio actual, eso es suficiente como primera aproximacion
- antes de cualquier uso serio fuera del laboratorio, conviene verificar comportamiento sobre el montaje real del NAS y revisar si aparecen locks stale o errores de permisos

## Riesgos del enfoque

- deadlocks practicos si un lock queda stale y el cleanup no ocurre
- falsos positivos de stale lock si el timeout es demasiado agresivo
- diferencias de permisos o semantica entre Windows y Linux
- cleanup en crash abrupto del proceso
- posibilidad de que un share remoto no respete exactamente la semantica esperada

## Mitigaciones propuestas

- metadata minima dentro del `.lock` con `lockId`, `pid`, `filePath` y timestamp
- timeout corto de espera para fallar de forma explicita
- validacion de ownership antes de liberar el lock
- remocion de stale locks por edad configurable con doble lectura antes del delete
- tests en temp dirs para asegurar cleanup y exclusividad basica

## Implementacion actual del prototipo

- `withFileLock(...)` sigue siendo sincrono para encajar con stores sincronos existentes
- el helper crea `${filePath}.lock`
- la adquisicion usa `fs.openSync(lockPath, 'wx')`
- el metadata del lock incluye `lockId`, `pid`, `filePath` y `createdAtUtc`
- `releaseLock(...)` relee el metadata y solo borra el lock si el `lockId` coincide
- el cleanup de stale lock relee el archivo antes del delete para bajar el riesgo de borrar un lock recien reemplazado

## Limites del ownership actual

- el ownership check evita borrar un lock ajeno si el archivo ya fue reemplazado antes de `release`
- no garantiza un compare-and-delete atomico a nivel filesystem
- si otro proceso reemplazara el lock exactamente entre la verificacion y el `rmSync`, el prototipo no puede impedirlo con este enfoque manual
- ese limite sigue siendo aceptable solo para laboratorio y debe revisarse antes de pensar en un uso mas amplio

## Limites del stale cleanup actual

- el prototipo usa antiguedad por `mtime` para considerar un lock stale
- relee el lock antes de borrarlo para reducir falsos positivos
- si el filesystem ofrece resolucion pobre de timestamps o semantica rara en un share remoto, el riesgo no desaparece por completo
- metadata invalida no rompe el flujo; si el lock ya es stale, el helper puede limpiarlo usando el snapshot observado

## Riesgo especifico para callbacks largos

- `withFileLock(...)` no debe usarse para callbacks largos
- si un callback tarda mas que `staleAfterMs`, otro proceso podria interpretar el lock como stale aunque siga activo
- eso vuelve inseguro este enfoque para operaciones de larga duracion o rutas con trabajo pesado dentro del callback
- el prototipo solo es aceptable para callbacks cortos y sin I/O prolongado, como `bankEquivalenceStore.upsert`
- para operaciones largas o stores mas sensibles se deberia evaluar:
  - heartbeat o refresh del lock
  - aumentar `staleAfterMs` con criterio operativo
  - `proper-lockfile`
  - o una estrategia de cola / proceso unico

## Limite de bloqueo del event loop

- el helper usa `Atomics.wait(...)` como espera bloqueante entre reintentos
- durante esa espera, el event loop del proceso queda bloqueado
- eso solo es aceptable aqui porque el prototipo opera sobre stores locales pequenos y callbacks cortos
- no debe usarse para operaciones largas ni para rutas con alta contencion
- los timeouts deben mantenerse cortos para que el bloqueo sea acotado

## Primer store candidato

- `backend/src/bankEquivalenceStore.ts`

Motivos:

- ya usa `readJsonFile`, `createBackupFile` y `writeJsonFileAtomic`
- no maneja secretos ni base64
- su `upsert` cubre un caso real de `read-modify-write`
- el impacto funcional es menor que en stores de SAT, OAuth o analysis runs

## Alcance deliberadamente limitado

- no migrar todos los stores
- no agregar locking global
- no resolver merges semanticos
- no tocar produccion ni integraciones reales
- no introducir colas distribuidas ni coordinacion entre servicios

## Nota de verificacion de hidden Unicode

- se escaneo explicitamente el diff del PR #83 y los archivos modificados del prototipo
- ese scan no encontro BOM, bidi controls, zero-width chars, soft hyphen ni `U+FEFF`
- GitHub UI puede seguir mostrando un warning generico de hidden Unicode, pero el scan reproducible del diff y de los archivos no encontro caracteres ocultos peligrosos
