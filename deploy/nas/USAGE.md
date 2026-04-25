# Uso rapido del deploy

## Comando normal

Desde tu PC, en el root del repo:

```powershell
powershell -ExecutionPolicy Bypass -File .\Deploy-NAS.ps1
```

Ese comando:

- exige repo limpio por defecto
- copia codigo y archivos de despliegue al NAS
- conserva `deploy/nas/data` para no pisar historicos ni stores vivos
- usa `deploy/nas/netsuite-recon.env` si existe
- reconstruye y reinicia el contenedor
- espera a que `api/health` responda bien

No uses como flujo normal ediciones manuales directo sobre `/volume1/docker/netsuite-recon/app`.
Si el NAS se corrige a mano en una urgencia, trae esos cambios de vuelta al repo y redeploya cuanto antes para no dejar la copia viva desalineada del codigo fuente.

## Cuando el repo esta sucio

```powershell
powershell -ExecutionPolicy Bypass -File .\Deploy-NAS.ps1 -AllowDirtyWorktree
```

Usalo solo si quieres desplegar el working tree actual sin commit.

## Si tambien quieres sincronizar config local del folder `deploy/nas/config`

```powershell
powershell -ExecutionPolicy Bypass -File .\Deploy-NAS.ps1 -SyncConfig
```

Esto reemplaza los archivos remotos de ese folder por los locales.

## Si quieres forzar tambien la data runtime desde `deploy/nas/data`

```powershell
powershell -ExecutionPolicy Bypass -File .\Deploy-NAS.ps1 -SyncRuntimeData
```

No es el flujo normal. Solo usalo si conscientemente quieres sobrescribir stores del NAS.

## Password

Si no pasas password por parametro, el script la pide por consola.

Tambien puedes usar:

```powershell
$env:NAS_DEPLOY_PASSWORD='tu_password'
powershell -ExecutionPolicy Bypass -File .\Deploy-NAS.ps1
```

## Flujo recomendado

1. Cambios locales
2. `git add`
3. `git commit`
4. `git push`
5. `.\Deploy-NAS.ps1`
