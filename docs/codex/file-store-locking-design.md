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

- metadata minima dentro del `.lock` con `pid` y timestamp
- timeout corto de espera para fallar de forma explicita
- remocion de stale locks por edad configurable
- tests en temp dirs para asegurar cleanup y exclusividad basica

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
