# File Store Locking Decision

## Objetivo

Definir una decision tecnica clara para el siguiente paso de persistencia local despues del prototipo de locking de `PR #83`, sin expandir todavia el patron a mas stores.

## Insumos revisados

- `backend/src/infrastructure/storage/fileStoreLock.ts` en `codex/file-store-locking-prototype`
- `backend/src/bankEquivalenceStore.ts` en `codex/file-store-locking-prototype`
- `tests/file-store-lock.test.mjs`
- `tests/bank-equivalence-store.test.mjs`
- `docs/codex/file-store-locking-design.md`
- `docs/codex/file-store-reliability-plan.md`
- stores locales listados en `backend/src`

## Resumen ejecutivo

La decision recomendada no es elegir una sola opcion para todos los stores.

Recomendacion por capas:

1. no expandir el lock manual actual como patron general
2. mantener `PR #83` como experimento acotado y util para aprendizaje
3. si se quiere seguir endureciendo JSON stores de riesgo bajo o medio, evaluar `proper-lockfile` antes de migrar mas stores
4. para stores criticos, write-heavy o con valor de auditoria, empezar a planear migracion a SQLite o un almacenamiento local con transacciones
5. mantener algunos stores legacy temporalmente cuando su concurrencia sea baja y el costo de migracion hoy no se justifique

## Comparacion de opciones

| Opcion | Que problema resuelve | Riesgos | Complejidad | Impacto en NAS/Docker | Impacto en Windows/Linux | Impacto en CI | Riesgo de bloquear event loop | Riesgo de stale lock | Riesgo de lost updates | Facilidad de testeo | Facilidad de revertir |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A) Mantener lock manual actual | serializa `read-modify-write` en un store puntual sin dependencias nuevas | ownership no atomico, stale lock heuristico, mantenimiento manual | baja-media | bueno para laboratorio si el filesystem respeta `open('wx')` y `rename`; requiere validacion real en montajes NAS | bueno en teoria, pero hay que vigilar semantica de archivos y permisos | baja friccion; solo corre tests Node actuales | alto, porque usa `Atomics.wait(...)` y espera bloqueante | medio | bajo en el store protegido, alto en los demas | alta para casos basicos; media para edge cases multi-proceso | alta |
| B) Usar `proper-lockfile` | mejora manejo de lockfile, retries y stale lock sin reimplementar tanta logica | dependencia nueva, aun depende del filesystem, configuracion incorrecta puede dar falsa seguridad | media | mejor que el lock manual para uso extendido si valida bien en NAS | razonable, pero hay que probar diferencias entre Windows y Linux | media; hay que agregar instalacion y tests de libreria | bajo-medio si se usa version async; menor que el lock manual bloqueante | medio-bajo | bajo para stores protegidos | media-alta | media |
| C) Usar SQLite / local DB para stores criticos | reduce `lost updates` con transacciones reales, mejora consistencia y consultas | migracion mayor, schema/versionado, nueva capa operativa | alta | muy bueno si el contenedor escribe a volumen local estable; mas robusto que muchos JSON sueltos | bueno y conocido; SQLite funciona bien en Windows y Linux | media; hay que agregar tests/inicializacion, pero sigue siendo local | bajo | muy bajo | muy bajo | media | media-baja |
| D) Usar proceso unico / queue para writes intensivos | serializa escrituras dentro de una instancia y reduce colisiones en flujos write-heavy | no protege multiples procesos o multiples contenedores por si solo | media | util si realmente hay una sola instancia escritora; limitado si el NAS levanta mas de una | poco dependiente del SO; mas dependiente del modelo de despliegue | media; requiere harness especifico | bajo-medio | nulo si no usa lockfile; depende de la cola | medio si hay mas de un proceso | media | media |
| E) Mantener algunos stores legacy temporalmente | evita tocar stores de baja concurrencia o alta sensibilidad mientras se disena mejor | deja deuda tecnica y riesgo residual | baja | sin impacto inmediato | sin impacto inmediato | sin impacto inmediato | nulo | nulo | medio o alto segun store | alta, porque no cambia nada | muy alta |

## Analisis por opcion

### A) Mantener lock manual actual

Conviene solo como experimento de laboratorio y como referencia de diseño.

Fortalezas:

- ya existe
- no agrega dependencias
- ya cubre ownership basico, stale cleanup heuristico y test multi-proceso del store piloto

Limites:

- usa espera bloqueante con `Atomics.wait(...)`
- la seguridad del release sigue dependiendo de pasos separados de lectura y borrado
- stale cleanup se basa en `mtime`, no en heartbeat ni lease real

Decision:

- no recomendarlo como patron general para todos los stores
- si se conserva, que sea solo para aprender y para comparar contra la siguiente opcion

### B) Usar `proper-lockfile`

Es la mejor opcion incremental si se quiere seguir con JSON stores un tiempo mas.

Fortalezas:

- reduce logica artesanal de locking
- permite avanzar store por store sin migrar de golpe a otra tecnologia
- baja el riesgo de bugs propios del lock manual

Limites:

- no elimina todos los riesgos del filesystem compartido
- sigue siendo lockfile sobre archivos JSON
- requiere validar bien tiempos, stale behavior y semantica en NAS

Decision:

- mejor siguiente paso incremental para stores JSON de riesgo bajo o medio
- no implementarlo todavia en esta rama

### C) Usar SQLite / local DB

Es la mejor opcion de fondo para stores criticos, de auditoria o con muchas escrituras.

Fortalezas:

- transacciones
- consistencia mucho mas fuerte
- menos fragilidad que coordinar muchos JSON con lockfiles

Limites:

- migracion mayor
- cambia operacion y testing
- no es una mejora pequena como las fases anteriores

Decision:

- recomendar como direccion futura para stores criticos
- no usarlo como siguiente experimento pequeno

### D) Usar proceso unico / queue

Sirve como complemento, no como solucion universal.

Fortalezas:

- bueno para flujos con muchas escrituras y trabajo secuencial
- evita bloquear por lockfiles dentro del mismo proceso

Limites:

- no resuelve el problema entre procesos o contenedores
- depende de supuestos de despliegue mas que de la persistencia en si

Decision:

- reservarlo para flujos write-heavy y casos donde una sola instancia escritora sea realista
- no usarlo como solucion primaria para todos los stores locales

### E) Mantener stores legacy temporalmente

Es razonable para caches y snapshots con baja concurrencia.

Fortalezas:

- evita tocar stores donde el retorno inmediato es bajo
- concentra el esfuerzo en los stores que si tienen riesgo real

Limites:

- no resuelve deuda tecnica
- deja `lost updates` y silent catches donde ya existen

Decision:

- si, pero de forma explicitamente temporal y priorizada

## Clasificacion de stores locales

### Stores principales

| Archivo | Tipo de datos | Read-modify-write | Puede tener concurrencia | Datos sensibles | Prioridad para locking | Recomendacion |
| --- | --- | --- | --- | --- | --- | --- |
| `backend/src/bankEquivalenceStore.ts` | equivalencias manuales de contrapartes | si | media | no alta | ya piloto | mantener como referencia del prototipo; no expandir mas en esta rama |
| `backend/src/bankRecognitionOverrideStore.ts` | overrides manuales de reconocimiento bancario | si | media-alta | media | alta | no usar lock manual directamente; evaluar `proper-lockfile` o esperar una fase mas madura |
| `backend/src/bankBalanceValidationStore.ts` | saldos validados por archivo/hash/corte | si | media | baja-media | media-alta | mejor siguiente store piloto si se sigue con JSON + locking |
| `backend/src/bankHistoricalRegistryStore.ts` | corroboraciones y resumen historico bancario | si | media-alta | media | alta | postergar a una opcion mas robusta; mejor `proper-lockfile` o DB |
| `backend/src/bankIndividualPaymentStore.ts` | archivos de pagos individuales con base64 | si | media | media-alta | media | no usar como siguiente piloto; volumen y base64 lo vuelven peor candidato |
| `backend/src/bankWorkingFileStore.ts` | archivo bancario de trabajo con base64 | si | alta | media-alta | alta | evitar piloto con lock manual; mejor atomicidad fuerte o almacenamiento mas robusto |
| `backend/src/banxicoCepRecognitionStore.ts` | reconocimientos manuales CEP | si | media | media | media | posible candidato futuro despues de validar mejor la estrategia |
| `backend/src/claveSatStore.ts` | snapshot de catalogo SAT | si, pero mas tipo snapshot/cache | baja | baja | baja | puede quedarse legacy o migrar solo a atomic write; no urge locking |
| `backend/src/egresosConciliationStore.ts` | conciliaciones locales de egresos | si | media | media | media-alta | buen candidato secundario despues de `bankBalanceValidationStore` |
| `backend/src/kontempoStore.ts` | homologaciones, recognitions e import runs de Kontempo | si | alta | media | alta | demasiado grande para siguiente piloto; pensar en DB o estrategia dedicada |
| `backend/src/netsuiteAccountStore.ts` | cache catalogo de cuentas NetSuite | si, pero snapshot/cache | baja | baja-media | baja | mantener legacy temporalmente; priorizar atomic write antes que locking |
| `backend/src/netsuiteEntityStore.ts` | cache catalogos NetSuite | si, pero snapshot/cache | baja | baja-media | baja | mantener legacy temporalmente; no necesita siguiente piloto |
| `backend/src/satDownloadHistoryStore.ts` | historial de descargas SAT y CFDI | si | alta | alta | muy alta | mejor candidato a SQLite o almacenamiento transaccional, no a otro piloto pequeno |
| `backend/src/satIgnoredCfdiStore.ts` | archivo de CFDI ignorados | si | media | media-alta | media-alta | no piloto inmediato; considerar despues con estrategia mas estable |
| `backend/src/satManualHomologationStore.ts` | homologaciones manuales SAT | si | media-alta | alta | alta | no piloto pequeno; mejor cuando exista decision mas robusta |
| `backend/src/satRetentionAccountStore.ts` | reglas de cuentas de retenciones SAT | si | media-baja | media | media | puede esperar; correctness importante pero write frequency menor |

### Persistencias auxiliares relacionadas

| Archivo | Tipo de datos | Read-modify-write | Puede tener concurrencia | Datos sensibles | Prioridad para locking | Recomendacion |
| --- | --- | --- | --- | --- | --- | --- |
| `backend/src/bankAnalysisRunStore.ts` | corridas de analisis bancario y resultados | si | alta | media | muy alta | no seguir con lock manual; pensar en DB local o estrategia de proceso/cola |
| `backend/src/netsuiteOAuth.ts` | sesion OAuth y tokens | si | baja-media | muy alta | no por locking | priorizar token vault / cifrado, no locking |
| `backend/src/satAnalysisWindows.ts` | estado de workflow SAT | si | alta | alta | muy alta | candidato claro para DB o modelo mas robusto que JSON + lockfile |
| `backend/src/inventoryLotReplacementRegistry.ts` | registry de reemplazos de lote | si | media | baja-media | media | tecnicamente pequeno, pero mejor mantener foco en bancos para el siguiente piloto |

## Siguiente store piloto sugerido

Recomendacion principal:

- `backend/src/bankBalanceValidationStore.ts`

Por que:

- sigue el mismo patron `read-modify-write` que ya se endurecio en `bankEquivalenceStore`
- es pequeno y acotado
- no guarda secretos ni blobs base64
- tiene claves de negocio claras (`bankId`, `sourceFileHash`, `cutoffDate`)
- es facil de testear con archivos temporales
- pertenece al mismo dominio de bancos, lo que reduce cambio de contexto respecto al prototipo anterior

Segunda opcion si se quisiera un siguiente paso fuera de bancos:

- `backend/src/egresosConciliationStore.ts`

Por que no recomiendo otros como siguiente piloto:

- `bankRecognitionOverrideStore.ts`: mas impacto de negocio y matching mas delicado
- `bankWorkingFileStore.ts` y `bankIndividualPaymentStore.ts`: base64 y volumen de datos
- `sat*` y `bankAnalysisRunStore.ts`: mejor pensar ya en una estrategia mas fuerte que lock manual

## Recomendacion de arquitectura

Recomendacion final:

1. mantener `PR #83` como prototipo y no tomar el lock manual como estandar final
2. si el equipo quiere una mejora incremental sobre JSON, el siguiente spike deberia comparar el lock manual contra `proper-lockfile`
3. si esa comparacion sale bien, aplicar la opcion elegida a `bankBalanceValidationStore.ts`
4. en paralelo, planear una ruta distinta para stores criticos:
   - `bankAnalysisRunStore.ts`
   - `satDownloadHistoryStore.ts`
   - `satAnalysisWindows.ts`
   - `kontempoStore.ts`
5. para esos stores criticos, la direccion recomendada es SQLite o un almacenamiento local con transacciones, no una proliferacion de lockfiles manuales

## Que no se recomienda hacer ahora

- no expandir el lock manual actual a muchos stores sin una comparacion contra `proper-lockfile`
- no migrar stores sensibles de SAT u OAuth con el mismo patron experimental
- no asumir que el prototipo de `PR #83` ya es suficiente para produccion o para todos los filesystems
