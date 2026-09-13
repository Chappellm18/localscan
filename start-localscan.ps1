[CmdletBinding()]
param(
    [string]$ProjectRoot = "C:\Desktop\localscan"
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

function Assert-Command {
    param([string]$Name)

    if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
        throw "'$Name' was not found on PATH. Install it, restart PowerShell, then run this script again."
    }
}

function Open-ServiceTerminal {
    param(
        [string]$Title,
        [string]$Command
    )

    $terminalCommand = "`$host.UI.RawUI.WindowTitle = '$Title'; Set-Location -LiteralPath '$ProjectRoot'; $Command"
    Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-Command', $terminalCommand) | Out-Null
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
& podman compose version *> $null
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

Write-Host 'Starting LocalScan dependencies (Redis and Postgres)...' -ForegroundColor Cyan
& podman compose -f (Join-Path $ProjectRoot 'docker-compose.yml') up -d

Write-Host 'Waiting for Postgres to accept connections...' -ForegroundColor Cyan
$ready = $false
for ($attempt = 1; $attempt -le 30; $attempt++) {
    & podman compose -f (Join-Path $ProjectRoot 'docker-compose.yml') exec -T postgres pg_isready -U localscan -d localscan *> $null
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
$schemaExists = & podman compose -f (Join-Path $ProjectRoot 'docker-compose.yml') exec -T postgres psql -U localscan -d localscan -tAc $schemaCheck
if ($schemaExists.Trim() -ne 't') {
    Write-Host 'Initializing the LocalScan database schema...' -ForegroundColor Cyan
    Get-Content -LiteralPath (Join-Path $ProjectRoot 'db\migrations\001_init.sql') |
        & podman compose -f (Join-Path $ProjectRoot 'docker-compose.yml') exec -T postgres psql -U localscan -d localscan -v ON_ERROR_STOP=1
}

Open-ServiceTerminal -Title 'LocalScan - Web' -Command 'Set-Location apps\web; npm run dev'
Open-ServiceTerminal -Title 'LocalScan - Discovery Worker' -Command "$workerEnvironment; Set-Location workers; cargo run --bin discovery-worker"
Open-ServiceTerminal -Title 'LocalScan - Scoring Worker' -Command "$workerEnvironment; Set-Location workers; cargo run --bin scoring-worker"
Open-ServiceTerminal -Title 'LocalScan - Dependencies' -Command 'podman compose logs --follow'

Write-Host ''
Write-Host 'LocalScan is starting.' -ForegroundColor Green
Write-Host 'Dependencies are running in Podman; four PowerShell windows were opened for their logs, the web app, and the workers.'
Write-Host 'Open http://localhost:3000 after the web terminal reports Ready.'
Write-Host 'To stop dependencies later: podman compose -f "{0}" down' (Join-Path $ProjectRoot 'docker-compose.yml')
