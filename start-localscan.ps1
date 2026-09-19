[CmdletBinding()]
param(
    [string]$ProjectRoot = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'

$cargoBin = Join-Path $env:USERPROFILE '.cargo\bin'
if (Test-Path -LiteralPath $cargoBin) {
    $env:Path = "$cargoBin;$env:Path"
}

$pythonScripts = Join-Path $env:APPDATA 'Python\Python38\Scripts'
if (Test-Path -LiteralPath $pythonScripts) {
    $env:Path = "$pythonScripts;$env:Path"
    $podmanCompose = Join-Path $pythonScripts 'podman-compose.exe'
    if (Test-Path -LiteralPath $podmanCompose) {
        $env:PODMAN_COMPOSE_PROVIDER = $podmanCompose
    }
}

$env:PODMAN_COMPOSE_WARNING_LOGS = 'false'
$ErrorActionPreference = 'Continue'

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "'$Name' was not found on PATH. Install it, restart PowerShell, then run this script again."
    }
}

function Start-HiddenService {
    param(
        [string]$Name,
        [string]$Command
    )

    $logRoot = Join-Path $ProjectRoot '.localscan\boot'
    $logPath = Join-Path $logRoot "$Name.log"
    $errorPath = Join-Path $logRoot "$Name.error.log"
    $pidPath = Join-Path $logRoot "$Name.pid"
    $serviceCommand = "Set-Location -LiteralPath '$ProjectRoot'; $Command"
    $process = Start-Process -FilePath 'powershell.exe' -WindowStyle Hidden -WorkingDirectory $ProjectRoot `
        -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', $serviceCommand) `
        -RedirectStandardOutput $logPath -RedirectStandardError $errorPath -PassThru
    Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii
}

function Stop-PreviousServices {
    param([string]$LogRoot)

    $stoppedPids = [System.Collections.Generic.List[int]]::new()
    Get-ChildItem -LiteralPath $LogRoot -Filter '*.pid' -ErrorAction SilentlyContinue | ForEach-Object {
        $pidText = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
        $servicePid = 0
        if ([int]::TryParse($pidText.Trim(), [ref]$servicePid)) {
            $serviceProcess = Get-Process -Id $servicePid -ErrorAction SilentlyContinue
            if ($serviceProcess) {
                & taskkill /PID $servicePid /T /F *> $null
                if ($LASTEXITCODE -ne 0) {
                    throw "Unable to stop the previous $($_.BaseName) process tree."
                }
                $stoppedPids.Add($servicePid)
            }
        }
    }

    for ($attempt = 1; $attempt -le 40 -and $stoppedPids.Count -gt 0; $attempt++) {
        $runningPids = @($stoppedPids | Where-Object {
            Get-Process -Id $_ -ErrorAction SilentlyContinue
        })
        if ($runningPids.Count -eq 0) {
            break
        }
        Start-Sleep -Milliseconds 250
    }
}

function Remove-BootLogs {
    param([string]$LogRoot)

    $logFiles = @(Get-ChildItem -LiteralPath $LogRoot -Filter '*.log' -File -ErrorAction SilentlyContinue)
    foreach ($logFile in $logFiles) {
        $removed = $false
        for ($attempt = 1; $attempt -le 20; $attempt++) {
            try {
                Remove-Item -LiteralPath $logFile.FullName -Force -ErrorAction Stop
                $removed = $true
                break
            } catch [System.IO.IOException] {
                Start-Sleep -Milliseconds 250
            }
        }
        if (-not $removed) {
            throw "Unable to remove the previous log '$($logFile.FullName)'. A LocalScan process may still be using it."
        }
    }
}

if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) {
    throw "LocalScan was not found at '$ProjectRoot'. Pass its location with -ProjectRoot 'C:\path\to\localscan'."
}

foreach ($command in 'npm', 'cargo') {
    Assert-Command $command
}

$envFile = Join-Path $ProjectRoot '.env'
if (-not (Test-Path -LiteralPath $envFile -PathType Leaf)) {
    throw "Missing $envFile. Copy .env.example to .env and adjust it before starting LocalScan."
}

$axeFile = Join-Path $ProjectRoot 'workers\crates\scoring\assets\axe.min.js'
if (-not (Test-Path -LiteralPath $axeFile) -or (Get-Item -LiteralPath $axeFile).Length -lt 100000) {
    throw "Missing the axe-core bundle at '$axeFile'. Run: npm install --no-save --prefix apps\\web axe-core; Copy-Item apps\\web\\node_modules\\axe-core\\axe.min.js workers\\crates\\scoring\\assets\\axe.min.js -Force"
}

$envLines = Get-Content -LiteralPath $envFile | Where-Object {
    $_ -match '^\s*[^#\s][^=]*=' 
}
$envAssignments = foreach ($line in $envLines) {
    $name, $value = $line -split '=', 2
    "`$env:$($name.Trim())='$($value.Trim().Replace("'", "''"))'"
}
$workerEnvironment = $envAssignments -join '; '

Assert-Command 'podman'
& podman compose version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "Podman Compose is unavailable. Install its provider with: py -m pip install --user podman-compose"
}

$machineList = & podman machine list --format '{{.Name}} {{.Running}}' 2>$null
if (-not $machineList) {
    Write-Host 'Creating the default Podman machine...' -ForegroundColor Cyan
    & podman machine init
    if ($LASTEXITCODE -ne 0) { throw 'Podman machine initialization failed.' }
}
if ($machineList -notmatch '\btrue\b') {
    Write-Host 'Starting the Podman machine...' -ForegroundColor Cyan
    & podman machine start
    if ($LASTEXITCODE -ne 0) { throw 'Podman machine start failed.' }
}

$bootRoot = Join-Path $ProjectRoot '.localscan\boot'
New-Item -ItemType Directory -Force -Path $bootRoot | Out-Null
Stop-PreviousServices -LogRoot $bootRoot
Remove-BootLogs -LogRoot $bootRoot
Get-ChildItem -LiteralPath $bootRoot -Filter '*.pid' -ErrorAction SilentlyContinue | Remove-Item -Force

$webBuildRoot = Join-Path $ProjectRoot 'apps\web\.next'
if (Test-Path -LiteralPath $webBuildRoot -PathType Container) {
    Remove-Item -LiteralPath $webBuildRoot -Recurse -Force
}

Write-Host 'Starting LocalScan dependencies (Redis and Postgres)...' -ForegroundColor Cyan
$composeFile = Join-Path $ProjectRoot 'docker-compose.yml'
foreach ($containerName in 'localscan_redis_1', 'localscan_postgres_1') {
    & podman container exists $containerName
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Removing the existing $containerName container..." -ForegroundColor Yellow
        & podman rm -f $containerName
        if ($LASTEXITCODE -ne 0) {
            throw "Unable to remove the existing $containerName container."
        }
    }
}
& podman compose -f $composeFile up -d
if ($LASTEXITCODE -ne 0) {
    throw 'LocalScan dependency startup failed.'
}

Write-Host 'Waiting for Postgres to accept connections...' -ForegroundColor Cyan
$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    & podman compose -f $composeFile exec -T postgres pg_isready -U localscan -d localscan *> $null
    if ($LASTEXITCODE -eq 0) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 1
}
if (-not $ready) {
    throw 'Postgres did not become ready within 30 seconds. Run "podman compose logs postgres" in the project folder for details.'
}

$schemaCheck = "SELECT to_regclass('public.businesses') IS NOT NULL;"
$schemaExists = & podman compose -f $composeFile exec -T postgres psql -U localscan -d localscan -tAc $schemaCheck
if ($schemaExists.Trim() -ne 't') {
    Write-Host 'Initializing the LocalScan database schema...' -ForegroundColor Cyan
    Get-Content -LiteralPath (Join-Path $ProjectRoot 'db\migrations\001_init.sql') |
        & podman compose -f $composeFile exec -T postgres psql -U localscan -d localscan -v ON_ERROR_STOP=1
}

$migrationPath = Join-Path $ProjectRoot 'db\migrations\002_add_discovery_job_id.sql'
Get-Content -LiteralPath $migrationPath |
    & podman compose -f $composeFile exec -T postgres psql -U localscan -d localscan -v ON_ERROR_STOP=1

Start-HiddenService -Name 'web' -Command "$workerEnvironment; Set-Location apps\web; npm run dev -- --hostname 127.0.0.1 --port 3000"
Start-HiddenService -Name 'discovery' -Command "$workerEnvironment; Set-Location workers; cargo run --bin discovery-worker"
Start-HiddenService -Name 'scoring' -Command "$workerEnvironment; Set-Location workers; cargo run --bin scoring-worker"
Start-HiddenService -Name 'dependencies' -Command 'podman compose logs --follow'

Write-Host ''
Write-Host 'LocalScan is starting.' -ForegroundColor Green
Write-Host 'The web app, workers, and dependency logs are running in hidden processes.'
Write-Host 'Opening the single-screen dashboard at http://localhost:3000/boot.'
Start-Process 'http://localhost:3000/boot'
Write-Host 'To stop dependencies later: podman compose -f "{0}" down' $composeFile
