## Incidente Higo 2026-04-24

### Que paso

- Un diario existente de NetSuite se reutilizo para dos movimientos distintos de `$100,000.00`.
- `LOG AND SUPPLAI` y `MANUFACTURA SHQ` quedaron ligados al mismo diario `29341`.
- La UI dejo de mostrar `MANUFACTURA SHQ` como lista para subir porque ya aparecia como reconocida por override.
- El saldo de Higo quedo `$100,000.00` arriba hasta crear el diario faltante `29344`.

### Causa raiz

- La deteccion de `findExistingBankJournalByMovementEvidence` aceptaba un match solo por:
  - misma fecha
  - mismo importe
  - mismo memo de linea
- En Payana/Higo eso no es suficiente porque varios movimientos pueden compartir memo corto como `shq`.
- Cuando el post devolvia `skipped`, el backend persistia igualmente un override de reconocimiento como si fuera confirmacion fuerte del mismo movimiento.

### Protecciones que quedaron

- La reutilizacion por evidencia ahora exige evidencia textual fuerte y unica contra entidad o memo de cabecera; si hay ambiguedad, no reutiliza el diario.
- Los resultados `skipped` por `movement_evidence` ya no persisten overrides ni historicos como si fueran confirmaciones finales.
- Solo los `created` o los `skipped` por `external_id` se consideran confirmaciones seguras para persistencia.
- El deploy del NAS quedo recompilado y validado con `api/health`.

### Operacion segura a partir de hoy

- No editar archivos sueltos directamente en `/volume1/docker/netsuite-recon/app` como flujo normal.
- Hacer cambios en el repo local y desplegar con `Deploy-NAS.ps1` o con `docker compose -f docker-compose.nas.yml up -d --build` desde la copia controlada.
- Si un movimiento desaparece de `listos` pero el saldo sigue descuadrado, revisar primero:
  - `bank-recognition-overrides.json`
  - `recognizedRows` del analisis
  - diarios creados el mismo dia con mismo importe
- Antes de dar por cerrado Higo, validar:
  - `readyRows = 0`
  - saldo NetSuite vs saldo bancario externo
  - que no haya overrides duplicados para mismo importe y fecha con tracking keys distintos

### Comandos de verificacion utiles

```powershell
Invoke-WebRequest -UseBasicParsing -Uri "http://192.168.1.63:3000/api/health"
```

```powershell
$body = @{
  query = "SELECT ROUND(SUM(NVL(tal.debit,0) - NVL(tal.credit,0)), 2) AS balance FROM TransactionAccountingLine tal INNER JOIN transaction ON transaction.id = tal.transaction WHERE tal.account = 1765 AND transaction.posting = 'T'"
  limit = 10
  offset = 0
} | ConvertTo-Json
Invoke-RestMethod -Uri "http://192.168.1.63:3000/api/netsuite/suiteql" -Method Post -ContentType "application/json" -Body $body
```

### Resultado final del incidente

- Diario faltante creado: `29344`
- Saldo final confirmado en NetSuite Higo: `$3,500,009.57`
- Pendiente remanente no relacionado con saldo: `American Express` por `$29,202.44` sin equivalencia exacta en `Proveedores`
