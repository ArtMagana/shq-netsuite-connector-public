# File Store Reliability Plan

## Objetivo

Crear una base pequena y revisable para mejorar la persistencia local en stores JSON sin migrar todo el sistema ni introducir locking todavia.

## Alcance de este PR

Este port solo trae la parte util del prototipo original:

- `backend/src/infrastructure/storage/fileStoreUtils.ts`
- migracion puntual de `backend/src/bankEquivalenceStore.ts`
- `tests/file-store-utils.test.mjs`
- `tests/bank-equivalence-store.test.mjs`

Queda fuera de alcance:

- locking manual o con dependencia externa
- migracion de mas stores
- cambios a `package.json`
- cambios al runner de tests
- cambios de API, deploy o integraciones reales

## Problema que se quiere reducir

El patron actual de muchos stores JSON es:

1. leer archivo
2. parsear JSON
3. modificar en memoria
4. reescribir el archivo completo

Eso deja varios riesgos:

- escrituras parciales si el proceso cae durante el write
- ausencia de backup inmediato
- parse errors ocultos por `catch { return [] }`
- read/modify/write repetido sin helper compartido

Este PR solo ataca la parte de atomicidad basica, backup inmediato y errores de parseo explicitos.

## Utilidades nuevas

Archivo:

- `backend/src/infrastructure/storage/fileStoreUtils.ts`

Funciones:

- `readJsonFile(...)`
- `writeJsonFileAtomic(...)`
- `createBackupFile(...)`
- `safeJsonStringify(...)`

Comportamiento:

- `readJsonFile(...)`
  - devuelve fallback si el archivo no existe
  - limpia BOM UTF-8 al leer
  - lanza error explicito con path si el JSON esta corrupto
- `writeJsonFileAtomic(...)`
  - serializa con formato consistente y newline final
  - escribe primero a `*.tmp`
  - usa `rename` para reemplazo atomico
  - reduce el riesgo de escrituras parciales al evitar sobrescribir el archivo final directamente
  - no garantiza durabilidad total ante corte electrico o crash del sistema porque no hace `fsync` ni del archivo temporal ni del directorio
  - para este port inicial es aceptable, pero si el patron se mueve a stores criticos habra que evaluar `fsync` y requisitos de durabilidad mas adelante
- `createBackupFile(...)`
  - crea un `.bak` del archivo existente antes de sobrescribir
  - no falla si el archivo aun no existe

## Store migrado en este PR

Archivo:

- `backend/src/bankEquivalenceStore.ts`

Cambios aplicados:

- la lectura manual se reemplaza por `readJsonFile(...)`
- la escritura directa se reemplaza por:
  - `createBackupFile(...)`
  - `writeJsonFileAtomic(...)`
- el path del store se resuelve por llamada con `resolveOverrideStorePath()`

## Cambio de comportamiento importante

Antes de este port, `loadBankEquivalenceOverrides()` hacia silent catch si el JSON estaba corrupto y devolvia `[]`.

Con este port:

- si el archivo no existe, sigue devolviendo `[]`
- si el JSON esta corrupto, ahora lanza un error explicito con el path del archivo

Este cambio es intencional porque evita ocultar corrupcion real del store, pero si cambia el comportamiento previo ante archivos danados.

## Compatibilidad y riesgo

Compatibilidad mantenida:

- no cambia el shape de datos
- no cambia el nombre del archivo
- no cambia la ubicacion por defecto
- no cambia contratos API

Riesgo introducido:

- un archivo corrupto deja de degradar silenciosamente a `[]` y pasa a fallar explicitamente

Ese riesgo es aceptable para este port porque hace visible un problema de datos que antes quedaba oculto, pero debe revisarse antes de extender el patron a stores mas sensibles.

## Tests incluidos

### `tests/file-store-utils.test.mjs`

Cubre:

- fallback cuando el archivo no existe
- lectura de JSON valido
- error explicito con JSON invalido
- write atomico con newline final
- reemplazo de contenido existente
- creacion de `.bak`
- no fallo cuando no existe archivo original

### `tests/bank-equivalence-store.test.mjs`

Cubre:

- `loadBankEquivalenceOverrides()` devuelve `[]` si no existe archivo
- `upsertBankEquivalenceOverride(...)` crea archivo `version: 2`
- segundo upsert del mismo item no duplica registros
- se crea `.bak` al sobrescribir
- un JSON corrupto lanza error explicito

## Lo que este PR no resuelve todavia

- `lost updates` por concurrencia `read-modify-write`
- locking entre procesos
- retencion historica de backups
- recuperacion automatica de JSON corrupto
- migracion del resto de stores JSON

## Siguiente paso recomendado

Si este port resulta util y estable en `main`, el siguiente paso deberia ser un PR separado para:

1. evaluar otro store pequeno y no sensible
2. decidir si hace falta locking
3. definir si el comportamiento de error explicito ante JSON corrupto debe mantenerse igual en todos los stores o adaptarse por dominio
