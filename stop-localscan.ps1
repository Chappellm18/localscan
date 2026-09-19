[CmdletBinding()]
param(
    [string]$SearchRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'

function Stop-ProcessTree {
    param([int]$ProcessId)

    if (Get-Process -Id $ProcessId -ErrorAction SilentlyContinue) {
        & taskkill /PID $ProcessId /T /F *> $null
        if ($LASTEXITCODE -ne 0) {
            Write-Warning "Unable to stop process tree rooted at PID $ProcessId."
        }
    }
}

if (-not (Test-Path -LiteralPath $SearchRoot -PathType Container)) {
    throw "Search root was not found: '$SearchRoot'."
}

$stoppedPids = [System.Collections.Generic.HashSet[int]]::new()
$bootDirectories = Get-ChildItem -LiteralPath $SearchRoot -Directory -Force -Filter '.localscan' -Recurse -ErrorAction SilentlyContinue |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'boot') -PathType Container } |
    ForEach-Object { Join-Path $_.FullName 'boot' }

foreach ($bootDirectory in $bootDirectories) {
    Get-ChildItem -LiteralPath $bootDirectory -Filter '*.pid' -File -ErrorAction SilentlyContinue | ForEach-Object {
        $servicePid = 0
        $pidText = Get-Content -LiteralPath $_.FullName -Raw -ErrorAction SilentlyContinue
        if ([int]::TryParse($pidText.Trim(), [ref]$servicePid) -and $stoppedPids.Add($servicePid)) {
            Stop-ProcessTree -ProcessId $servicePid
        }
    }
}

$processes = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match '(?i)localscan' -and
        $_.CommandLine -match '(?i)(next(\.cmd)?\s+dev|discovery-worker|scoring-worker|start-localscan\.ps1)'
    }

foreach ($process in $processes) {
    $processId = [int]$process.ProcessId
    if ($stoppedPids.Add($processId)) {
        Stop-ProcessTree -ProcessId $processId
    }
}

$composeFiles = Get-ChildItem -LiteralPath $SearchRoot -Filter 'docker-compose.yml' -File -Recurse -ErrorAction SilentlyContinue
foreach ($composeFile in $composeFiles) {
    if (Get-Command podman -ErrorAction SilentlyContinue) {
        & podman compose -f $composeFile.FullName down *> $null
    } elseif (Get-Command docker -ErrorAction SilentlyContinue) {
        & docker compose -f $composeFile.FullName down *> $null
    } else {
        Write-Warning 'Neither podman nor docker was found; dependency containers were not stopped.'
        break
    }
}

Write-Host "Stopped $($stoppedPids.Count) LocalScan process tree(s) and shut down dependency containers." -ForegroundColor Green
