# File Store Locking Decision

## Estado

Draft decision para laboratorio.

Recomendacion tecnica posterior al prototipo de `PR #83`.

## Fecha

2026-04-27

## Contexto

`PR #83` probo un lock manual sobre `backend/src/bankEquivalenceStore.ts` para cubrir un caso real de `read-modify-write` concurrente.

Ese prototipo fue util para validar varias cosas:

- un `lockId` propio por adquisicion
- validacion de ownership antes de liberar el `.lock`
- stale cleanup con doble snapshot
- cobertura basica del helper de lock
- smoke test multi-proceso para el store piloto

Tambien dejo claros sus limites:

- espera bloqueante con `Atomics.wait(...)`
- stale cleanup heuristico basado en `mtime`
- riesgo de event loop blocking bajo contencion
- no es una base suficiente para expandir el patron a todos los stores sin una decision previa

Por eso este documento no implementa una tecnologia nueva. Solo fija la recomendacion para el siguiente paso.

## Decision

La recomendacion es hibrida:

1. no expandir el lock manual actual como patron general
2. evaluar `proper-lockfile` para JSON stores de riesgo bajo o medio
3. planear SQLite o local DB para stores criticos o write-heavy
4. mantener algunos stores legacy temporalmente cuando su concurrencia sea baja y el costo de migracion hoy no se justifique

## Opciones consideradas

### A) Mantener lock manual actual

Que problema resuelve:

- serializa `read-modify-write` en un store puntual sin dependencias nuevas

Riesgos:

- ownership no atomico
- stale lock heuristico
- logica artesanal de mantenimiento

Complejidad:

- baja a media

Impacto en NAS/Docker:

- util para laboratorio si el filesystem respeta `open('wx')` y `rename`
- requiere validacion real en montajes NAS

Impacto en Windows/Linux:

- teoricamente portable, pero sensible a permisos y semantica de archivos

Impacto en CI:

- bajo; usa el test runner actual

Riesgo de bloquear event loop:

- alto por `Atomics.wait(...)`

Riesgo de stale lock:

- medio

Riesgo de lost updates:

- bajo en el store protegido
- alto en los stores no migrados

Que tan facil es testearlo:

- alto para casos basicos
- medio para edge cases multi-proceso

Que tan facil es revertirlo:

- alto

### B) Usar `proper-lockfile`

Que problema resuelve:

- mejora manejo de lockfile, retries y stale lock sin reimplementar tanta logica propia

Riesgos:

- dependencia nueva
- falsa sensacion de seguridad si no se valida en NAS/Docker

Complejidad:

- media

Impacto en NAS/Docker:

- potencialmente mejor que el lock manual, pero depende de validacion real sobre el montaje

Impacto en Windows/Linux:

- razonable, con menos logica casera que mantener

Impacto en CI:

- medio; hay que instalar y cubrir la dependencia

Riesgo de bloquear event loop:

- menor que el lock manual si se usa flujo async

Riesgo de stale lock:

- medio a bajo, segun configuracion y pruebas reales

Riesgo de lost updates:

- bajo para los stores protegidos

Que tan facil es testearlo:

- medio a alto

Que tan facil es revertirlo:

- medio

### C) Usar SQLite / local DB para stores criticos

Que problema resuelve:

- reduce `lost updates` con transacciones reales
- mejora consistencia, trazabilidad y consultas

Riesgos:

- migracion mayor
- schema y versionado
- nueva capa operativa

Complejidad:

- alta

Impacto en NAS/Docker:

- bueno si el volumen local esta bien definido
- mas robusto que muchos JSON con lockfiles

Impacto en Windows/Linux:

- bueno y conocido

Impacto en CI:

- medio; necesita inicializacion y tests de persistencia

Riesgo de bloquear event loop:

- bajo

Riesgo de stale lock:

- muy bajo

Riesgo de lost updates:

- muy bajo

Que tan facil es testearlo:

- medio

Que tan facil es revertirlo:

- medio a bajo

### D) Usar proceso unico / queue para operaciones write-heavy

Que problema resuelve:

- serializa escrituras dentro de una instancia
- reduce colisiones en flujos con muchas escrituras

Riesgos:

- no protege multiples procesos o multiples contenedores por si solo

Complejidad:

- media

Impacto en NAS/Docker:

- util solo si el despliegue realmente tiene una sola instancia escritora

Impacto en Windows/Linux:

- bajo impacto por SO; alto impacto por modelo de despliegue

Impacto en CI:

- medio; requiere harness especifico

Riesgo de bloquear event loop:

- bajo a medio

Riesgo de stale lock:

- nulo si no usa lockfile

Riesgo de lost updates:

- medio si hay mas de un proceso o contenedor

Que tan facil es testearlo:

- medio

Que tan facil es revertirlo:

- medio

### E) Mantener algunos stores legacy temporalmente

Que problema resuelve:

- evita tocar stores de baja concurrencia o alta sensibilidad mientras se disena mejor la estrategia

Riesgos:

- deja deuda tecnica
- mantiene riesgo residual de `lost updates`

Complejidad:

- baja

Impacto en NAS/Docker:

- nulo inmediato

Impacto en Windows/Linux:

- nulo inmediato

Impacto en CI:

- nulo inmediato

Riesgo de bloquear event loop:

- nulo

Riesgo de stale lock:

- nulo

Riesgo de lost updates:

- medio o alto segun store

Que tan facil es testearlo:

- alto, porque no cambia nada

Que tan facil es revertirlo:

- muy alto

## Consecuencias

Esta decision habilita:

- una ruta incremental para stores JSON de riesgo bajo o medio
- una ruta distinta para stores criticos, sin forzar un lock manual donde no conviene
- una priorizacion explicita de stores antes de tocar mas codigo

Esta decision no resuelve todavia:

- el comportamiento real de `proper-lockfile` en NAS/Docker
- la migracion de stores criticos a SQLite
- la deuda actual de stores legacy
- el problema de produccion para todos los filesystems posibles

## Clasificacion actual de stores

### Stores principales

| Archivo | Tipo de datos | Read-modify-write | Puede tener concurrencia | Toca datos sensibles | Prioridad para locking | Recomendacion |
| --- | --- | --- | --- | --- | --- | --- |
| `backend/src/bankEquivalenceStore.ts` | equivalencias manuales de contrapartes | si | media | no alta | ya piloto | mantener como referencia del prototipo |
| `backend/src/bankRecognitionOverrideStore.ts` | overrides manuales de reconocimiento bancario | si | media-alta | media | alta | no usar lock manual directo; evaluar `proper-lockfile` o una fase mas madura |
| `backend/src/bankBalanceValidationStore.ts` | saldos validados por archivo/hash/corte | si | media | baja-media | media-alta | mejor candidato para un piloto posterior |
| `backend/src/bankHistoricalRegistryStore.ts` | corroboraciones y resumen historico bancario | si | media-alta | media | alta | postergar a una opcion mas robusta |
| `backend/src/bankIndividualPaymentStore.ts` | pagos individuales con base64 | si | media | media-alta | media | no usar como siguiente piloto |
| `backend/src/bankWorkingFileStore.ts` | archivo bancario de trabajo con base64 | si | alta | media-alta | alta | evitar piloto con lock manual |
| `backend/src/banxicoCepRecognitionStore.ts` | reconocimientos manuales CEP | si | media | media | media | posible candidato futuro, no inmediato |
| `backend/src/claveSatStore.ts` | snapshot de catalogo SAT | si, mas tipo cache | baja | baja | baja | puede quedarse legacy temporalmente |
| `backend/src/egresosConciliationStore.ts` | conciliaciones locales de egresos | si | media | media | media-alta | buen candidato secundario |
| `backend/src/kontempoStore.ts` | homologaciones, recognitions e import runs | si | alta | media | alta | demasiado grande para siguiente piloto |
| `backend/src/netsuiteAccountStore.ts` | cache de cuentas NetSuite | si, mas tipo cache | baja | baja-media | baja | mantener legacy temporalmente |
| `backend/src/netsuiteEntityStore.ts` | cache de entidades NetSuite | si, mas tipo cache | baja | baja-media | baja | mantener legacy temporalmente |
| `backend/src/satDownloadHistoryStore.ts` | historial SAT y CFDI | si | alta | alta | muy alta | mejor candidato a SQLite, no a otro piloto pequeno |
| `backend/src/satIgnoredCfdiStore.ts` | archivo de CFDI ignorados | si | media | media-alta | media-alta | no piloto inmediato |
| `backend/src/satManualHomologationStore.ts` | homologaciones manuales SAT | si | media-alta | alta | alta | no piloto pequeno |
| `backend/src/satRetentionAccountStore.ts` | reglas de cuentas de retenciones SAT | si | media-baja | media | media | puede esperar |

### Persistencias auxiliares relacionadas

| Archivo | Tipo de datos | Read-modify-write | Puede tener concurrencia | Toca datos sensibles | Prioridad para locking | Recomendacion |
| --- | --- | --- | --- | --- | --- | --- |
| `backend/src/bankAnalysisRunStore.ts` | corridas de analisis bancario y resultados | si | alta | media | muy alta | pensar en DB local o proceso/cola, no en otro lock manual |
| `backend/src/netsuiteOAuth.ts` | sesion OAuth y tokens | si | baja-media | muy alta | no por locking | priorizar cifrado o token vault |
| `backend/src/satAnalysisWindows.ts` | estado de workflow SAT | si | alta | alta | muy alta | candidato a DB o modelo mas robusto |
| `backend/src/inventoryLotReplacementRegistry.ts` | registry de reemplazos de lote | si | media | baja-media | media | pequeno, pero fuera del foco actual |

## Siguiente experimento recomendado

1. no migrar mas stores todavia
2. crear un PR separado para comparar lock manual vs `proper-lockfile`
3. usar `backend/src/bankBalanceValidationStore.ts` como candidato de analisis o piloto posterior
4. solo aplicar la estrategia al store si el spike demuestra que es segura en temp dirs, CI y entorno similar a NAS/Docker

## Fuera de alcance

- no implementacion en esta rama
- no `proper-lockfile` todavia
- no SQLite todavia
- no migracion de stores
- no cambios en produccion
- no validacion contra NAS real
- no cambios en el repo privado

## Verificacion de hidden Unicode

- se escaneo explicitamente el diff del PR y los archivos modificados
- ese scan no encontro BOM, bidi controls, zero-width chars, soft hyphen ni `U+FEFF`
- GitHub UI puede seguir mostrando warning generico, pero el scan reproducible del diff y de los archivos no encontro caracteres ocultos peligrosos
