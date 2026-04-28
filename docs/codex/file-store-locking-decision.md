# File Store Locking Decision

## Estado

Draft decision record for the public repo after `PR #90`.

## Fecha

2026-04-27

## Contexto

- `PR #90` ya porto a `main` la base util de confiabilidad para file stores:
  - `fileStoreUtils`
  - atomic write con archivo temporal + `rename`
  - backup `.bak`
  - tests del helper
  - migracion inicial de `bankEquivalenceStore`
- `PR #82` queda reemplazado por `#90` y ya no debe usarse como base de trabajo.
- `PR #83` queda solo como prototipo historico de locking manual.

La pregunta abierta ya no es como portar la base de confiabilidad, sino que estrategia de locking o persistencia conviene si en el futuro se quiere seguir endureciendo stores JSON o migrar stores mas criticos.

## Decision

La recomendacion actual es:

1. no expandir el lock manual del prototipo como patron general
2. si seguimos con JSON stores, evaluar `proper-lockfile` en un spike separado
3. reservar SQLite o local DB para stores criticos o write-heavy
4. mantener algunos stores legacy temporalmente mientras su riesgo no justifique una migracion mayor

## Opciones consideradas

### 1. Lock manual

Que resuelve:

- serializa `read-modify-write` en un store puntual sin dependencia nueva

Ventajas:

- control total del comportamiento
- facil de prototipar en un store pequeno
- reversible

Riesgos:

- logica artesanal
- stale lock heuristico
- ownership dificil de hacer realmente atomico
- event loop blocking si la espera es sincrona
- alta sensibilidad a edge cases de filesystem y despliegue

Recomendacion:

- no usarlo como patron general
- mantenerlo solo como referencia historica del laboratorio de `PR #83`

### 2. `proper-lockfile`

Que resuelve:

- ofrece una base mas madura para locking sobre archivos sin reimplementar toda la logica a mano

Ventajas:

- menos logica casera
- mejor punto de partida para un spike serio en JSON stores
- mas facil de comparar y descartar rapidamente que un rediseño completo

Riesgos:

- agrega dependencia nueva
- requiere validar comportamiento real en NAS/Docker y en el filesystem del despliegue
- no sustituye una estrategia de datos mejor para stores criticos

Recomendacion:

- mejor siguiente spike si se quiere seguir con JSON stores

### 3. SQLite / local DB

Que resuelve:

- reduce mucho mejor el riesgo de `lost updates`
- da transacciones, consistencia y una base mas seria para estados criticos

Ventajas:

- mejor modelo para stores con muchas escrituras o mayor importancia operativa
- mas robusto que sumar lockfiles sobre JSON indefinidamente

Riesgos:

- migracion mas grande
- schema, versionado y operacion nuevos
- no conviene como siguiente paso si solo se quiere un spike pequeno

Recomendacion:

- reservarlo para stores criticos o write-heavy

### 4. Queue / proceso unico

Que resuelve:

- serializa escrituras dentro de una instancia o flujo controlado

Ventajas:

- puede simplificar colisiones internas sin tocar el formato de datos de inmediato

Riesgos:

- no protege por si solo multiples procesos o multiples contenedores
- depende mucho del modelo de despliegue real

Recomendacion:

- evaluarlo solo donde el flujo lo justifique, no como solucion general para todos los stores

### 5. Mantener legacy temporalmente

Que resuelve:

- evita tocar stores sensibles o de bajo beneficio inmediato mientras se define mejor la siguiente fase

Ventajas:

- cero riesgo inmediato de regresion
- permite priorizar mejor

Riesgos:

- mantiene deuda tecnica y riesgo residual de concurrencia

Recomendacion:

- aceptable en stores de baja concurrencia o poco valor como siguiente candidato

## Consecuencias

Esta decision implica:

- no abrir un port de `PR #83` tal cual
- no expandir el lock manual a mas stores
- si hay siguiente fase, hacerla en una rama nueva desde `main`
- separar claramente:
  - spike de locking para JSON stores
  - migraciones mas serias para stores criticos

## Siguiente candidato de analisis

Candidato sugerido solo para analisis posterior:

- `backend/src/bankBalanceValidationStore.ts`

Motivos:

- dominio acotado
- `read-modify-write` claro
- mas razonable para un spike pequeno que stores con base64, SAT, OAuth o analisis bancario mas critico

Importante:

- esto no recomienda implementarlo ya
- solo lo deja como siguiente store a revisar si se abre un spike separado

## Fuera de alcance

- no implementa locking
- no agrega `proper-lockfile`
- no agrega SQLite
- no migra stores adicionales
- no toca backend, frontend, tests ni `package.json`
- no toca produccion ni el repo privado
