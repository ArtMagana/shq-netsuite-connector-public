param(
  [string]$NasHost = '192.168.1.63',
  [string]$NasUser = 'artmagana',
  [string]$RemoteRoot = '/volume1/docker/netsuite-recon/app',
  [string]$NasPassword = '',
  [switch]$AllowDirtyWorktree,
  [switch]$SyncConfig,
  [switch]$SyncRuntimeData,
  [int]$HealthTimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'

function Resolve-WorkspaceRoot {
  return $PSScriptRoot
}

function Resolve-PythonExecutable {
  foreach ($candidate in @('python', 'py')) {
    $command = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($command) {
      return $command.Source
    }
  }

  throw 'Python no esta disponible. Instala Python 3 para usar Deploy-NAS.ps1.'
}

function ConvertTo-PlainText {
  param(
    [Security.SecureString]$SecureString
  )

  if (-not $SecureString) {
    return ''
  }

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Read-EnvFileValue {
  param(
    [string]$Path,
    [string]$Key
  )

  if (-not (Test-Path -LiteralPath $Path)) {
    return $null
  }

  foreach ($line in Get-Content -LiteralPath $Path) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith('#')) {
      continue
    }

    $separatorIndex = $trimmed.IndexOf('=')
    if ($separatorIndex -le 0) {
      continue
    }

    $currentKey = $trimmed.Substring(0, $separatorIndex).Trim()
    if ($currentKey -ne $Key) {
      continue
    }

    return $trimmed.Substring($separatorIndex + 1).Trim()
  }

  return $null
}

function Assert-CleanGitWorktree {
  param(
    [string]$WorkspaceRoot
  )

  $status = git -C $WorkspaceRoot status --porcelain
  if ($LASTEXITCODE -ne 0) {
    throw 'No se pudo leer el estado de git.'
  }

  if ($status) {
    throw 'El repo tiene cambios sin commitear. Usa -AllowDirtyWorktree si de verdad quieres desplegar el working tree actual.'
  }
}

function Assert-ParamikoAvailable {
  param(
    [string]$PythonExecutable
  )

  @'
import importlib.util
raise SystemExit(0 if importlib.util.find_spec("paramiko") else 1)
'@ | & $PythonExecutable -

  if ($LASTEXITCODE -ne 0) {
    throw 'Falta paramiko en Python. Instala con: python -m pip install paramiko'
  }
}

function Wait-Health {
  param(
    [string]$HealthUrl,
    [int]$TimeoutSeconds
  )

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $HealthUrl -TimeoutSec 10
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 400) {
        return $response.Content
      }
    }
    catch {
      Start-Sleep -Seconds 3
      continue
    }

    Start-Sleep -Seconds 3
  }

  throw "El deploy termino, pero el servicio no respondio sano en $HealthUrl dentro de $TimeoutSeconds segundos."
}

$workspaceRoot = Resolve-WorkspaceRoot
$pythonExecutable = Resolve-PythonExecutable

if (-not $AllowDirtyWorktree) {
  Assert-CleanGitWorktree -WorkspaceRoot $workspaceRoot
}

Assert-ParamikoAvailable -PythonExecutable $pythonExecutable

if (-not $NasPassword) {
  if ($env:NAS_DEPLOY_PASSWORD) {
    $NasPassword = $env:NAS_DEPLOY_PASSWORD
  } else {
    $securePassword = Read-Host -Prompt "Contrasena SSH para $NasUser@$NasHost" -AsSecureString
    $NasPassword = ConvertTo-PlainText -SecureString $securePassword
  }
}

if (-not $NasPassword) {
  throw 'No se recibio contrasena SSH para el NAS.'
}

$nasEnvPath = Join-Path $workspaceRoot 'deploy\nas\netsuite-recon.env'
$healthPort = Read-EnvFileValue -Path $nasEnvPath -Key 'PORT'
if (-not $healthPort) {
  $healthPort = '3000'
}

$healthUrl = "http://${NasHost}:$healthPort/api/health"

$env:CODEX_NAS_DEPLOY_HOST = $NasHost
$env:CODEX_NAS_DEPLOY_USER = $NasUser
$env:CODEX_NAS_DEPLOY_PASSWORD = $NasPassword
$env:CODEX_NAS_DEPLOY_REMOTE_ROOT = $RemoteRoot
$env:CODEX_NAS_DEPLOY_WORKSPACE_ROOT = $workspaceRoot
$env:CODEX_NAS_DEPLOY_SYNC_CONFIG = if ($SyncConfig) { '1' } else { '0' }
$env:CODEX_NAS_DEPLOY_SYNC_RUNTIME_DATA = if ($SyncRuntimeData) { '1' } else { '0' }

@'
import io
import os
import posixpath
import tarfile
from pathlib import Path

import paramiko


HOST = os.environ["CODEX_NAS_DEPLOY_HOST"]
USERNAME = os.environ["CODEX_NAS_DEPLOY_USER"]
PASSWORD = os.environ["CODEX_NAS_DEPLOY_PASSWORD"]
REMOTE_ROOT = os.environ["CODEX_NAS_DEPLOY_REMOTE_ROOT"]
WORKSPACE_ROOT = Path(os.environ["CODEX_NAS_DEPLOY_WORKSPACE_ROOT"])
SYNC_CONFIG = os.environ.get("CODEX_NAS_DEPLOY_SYNC_CONFIG") == "1"
SYNC_RUNTIME_DATA = os.environ.get("CODEX_NAS_DEPLOY_SYNC_RUNTIME_DATA") == "1"

ROOT_FILES = [
    ".dockerignore",
    "Dockerfile",
    "docker-compose.nas.yml",
]

REPO_FILES = [
    "backend/.env.example",
    "backend/package.json",
    "backend/package-lock.json",
    "backend/tsconfig.json",
    "frontend/.env.example",
    "frontend/index.html",
    "frontend/package.json",
    "frontend/package-lock.json",
    "frontend/tsconfig.json",
    "frontend/tsconfig.app.json",
    "frontend/tsconfig.node.json",
    "frontend/vite.config.ts",
    "deploy/nas/README.md",
    "deploy/nas/netsuite-recon.env.example",
]

SOURCE_DIRS = [
    "backend/src",
    "frontend/scripts",
    "frontend/src",
]


def add_path_to_tar(tar: tarfile.TarFile, local_path: Path, arcname: str):
    if not local_path.exists():
        raise FileNotFoundError(str(local_path))
    tar.add(local_path, arcname=arcname)


def build_archive():
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w:gz") as tar:
        for relative_path in ROOT_FILES + REPO_FILES:
            add_path_to_tar(tar, WORKSPACE_ROOT / relative_path, relative_path)

        env_path = WORKSPACE_ROOT / "deploy" / "nas" / "netsuite-recon.env"
        if env_path.exists():
            add_path_to_tar(tar, env_path, "deploy/nas/netsuite-recon.env")

        for directory in SOURCE_DIRS:
            base_path = WORKSPACE_ROOT / directory
            for path in base_path.rglob("*"):
                if path.is_dir():
                    continue
                if path.name.endswith(".tsbuildinfo"):
                    continue
                add_path_to_tar(tar, path, path.relative_to(WORKSPACE_ROOT).as_posix())

        if SYNC_CONFIG:
            config_root = WORKSPACE_ROOT / "deploy" / "nas" / "config"
            if config_root.exists():
                for path in config_root.rglob("*"):
                    if path.is_dir() or path.name == ".gitkeep":
                        continue
                    add_path_to_tar(tar, path, path.relative_to(WORKSPACE_ROOT).as_posix())

        if SYNC_RUNTIME_DATA:
            data_root = WORKSPACE_ROOT / "deploy" / "nas" / "data"
            if data_root.exists():
                for path in data_root.rglob("*"):
                    if path.is_dir() or path.name == ".gitkeep":
                        continue
                    add_path_to_tar(tar, path, path.relative_to(WORKSPACE_ROOT).as_posix())

    archive.seek(0)
    return archive


def run_remote_command(client: paramiko.SSHClient, command: str, timeout: int = 1200):
    stdin, stdout, stderr = client.exec_command(command, timeout=timeout)
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "ignore")
    err = stderr.read().decode("utf-8", "ignore")
    safe_output = (out + ("\nSTDERR:\n" + err if err.strip() else "")).encode("ascii", "replace").decode("ascii")
    if safe_output.strip():
        print(safe_output)
    if exit_status != 0:
        raise RuntimeError(err or out or f"Remote command failed with status {exit_status}: {command}")


archive = build_archive()
print(f"Deploy archive size: {len(archive.getbuffer())} bytes")

client = paramiko.SSHClient()
client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
client.connect(
    hostname=HOST,
    username=USERNAME,
    password=PASSWORD,
    timeout=20,
    look_for_keys=False,
    allow_agent=False,
)

try:
    cleanup_commands = [
        f"mkdir -p {REMOTE_ROOT}",
        f"mkdir -p {posixpath.join(REMOTE_ROOT, 'deploy/nas/config/bancos')}",
        f"mkdir -p {posixpath.join(REMOTE_ROOT, 'deploy/nas/config/sat')}",
        f"mkdir -p {posixpath.join(REMOTE_ROOT, 'deploy/nas/data/sat')}",
        f"rm -rf {posixpath.join(REMOTE_ROOT, 'backend')}",
        f"rm -rf {posixpath.join(REMOTE_ROOT, 'frontend')}",
        f"rm -f {posixpath.join(REMOTE_ROOT, '.dockerignore')}",
        f"rm -f {posixpath.join(REMOTE_ROOT, 'Dockerfile')}",
        f"rm -f {posixpath.join(REMOTE_ROOT, 'docker-compose.nas.yml')}",
        f"rm -f {posixpath.join(REMOTE_ROOT, 'deploy/nas/README.md')}",
        f"rm -f {posixpath.join(REMOTE_ROOT, 'deploy/nas/netsuite-recon.env.example')}",
    ]

    if (WORKSPACE_ROOT / "deploy" / "nas" / "netsuite-recon.env").exists():
        cleanup_commands.append(f"rm -f {posixpath.join(REMOTE_ROOT, 'deploy/nas/netsuite-recon.env')}")

    if SYNC_CONFIG:
        cleanup_commands.append(f"find {posixpath.join(REMOTE_ROOT, 'deploy/nas/config')} -type f ! -name '.gitkeep' -delete")

    if SYNC_RUNTIME_DATA:
        cleanup_commands.append(f"find {posixpath.join(REMOTE_ROOT, 'deploy/nas/data')} -type f ! -name '.gitkeep' -delete")

    run_remote_command(client, " && ".join(cleanup_commands), timeout=120)

    stdin, stdout, stderr = client.exec_command(f"tar -xzf - -C {REMOTE_ROOT}", timeout=1200)
    stdin.write(archive.getvalue())
    stdin.flush()
    stdin.channel.shutdown_write()
    exit_status = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", "ignore")
    err = stderr.read().decode("utf-8", "ignore")
    if exit_status != 0:
        raise RuntimeError(err or out or "Remote extract failed.")

    run_remote_command(
        client,
        f"cd {REMOTE_ROOT} && docker compose -f docker-compose.nas.yml up -d --build",
        timeout=1800,
    )
finally:
    client.close()
'@ | & $pythonExecutable -

$healthPayload = Wait-Health -HealthUrl $healthUrl -TimeoutSeconds $HealthTimeoutSeconds

$branchName = git -C $workspaceRoot branch --show-current
$commitSha = git -C $workspaceRoot rev-parse --short HEAD

[pscustomobject]@{
  NasHost = $NasHost
  ServiceUrl = "http://${NasHost}:$healthPort"
  Branch = $branchName
  Commit = $commitSha
  SyncConfig = [bool]$SyncConfig
  SyncRuntimeData = [bool]$SyncRuntimeData
  Health = $healthPayload
} | Format-List
