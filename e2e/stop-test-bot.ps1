# Stops the test bot, the OpenCode server it started and the stand's proxies.
#
# Deliberately narrow: it only touches processes that provably belong to the
# test setup.
#   - OpenCode: the pid recorded in .tmp/e2e/opencode-server.pid, and only when
#     that pid is still the listener on the port from e2e/.env. No recorded pid,
#     or a different listener on that port, is left alone. Your working OpenCode
#     on another port is never touched.
#   - Bot: node processes whose pid appears in a log file name inside
#     .tmp/e2e/home/logs. A production bot started from the same dist/ writes to
#     a different home, so it is not matched.
#   - Fault proxy: the node process named in .tmp/e2e/fault-proxy/proxy.pid,
#     only if its command line runs fault-proxy.mjs.
#   - Forward proxy: the node process named in .tmp/e2e/forward-proxy/proxy.pid,
#     only if its command line runs forward-proxy.mjs.
#
# Usage:
#   .\e2e\stop-test-bot.ps1

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$testHome = Join-Path $projectRoot ".tmp\e2e\home"
$logsDir = Join-Path $testHome "logs"
$sourceEnv = Join-Path $PSScriptRoot ".env"
$opencodePidFile = Join-Path $projectRoot ".tmp\e2e\opencode-server.pid"
$proxyPidFile = Join-Path $projectRoot ".tmp\e2e\fault-proxy\proxy.pid"
$forwardPidFile = Join-Path $projectRoot ".tmp\e2e\forward-proxy\proxy.pid"

# --- OpenCode -------------------------------------------------------------

$port = 4096
if (Test-Path $sourceEnv) {
    $apiUrl = (Get-Content $sourceEnv | Where-Object { $_ -match '^\s*OPENCODE_API_URL\s*=' } | Select-Object -Last 1)
    if ($apiUrl -and $apiUrl -match ':(\d+)') {
        $port = [int]$Matches[1]
    }
}

Write-Host "OpenCode port from config: $port"

$recordedPid = 0
if (Test-Path $opencodePidFile) {
    $parsedPid = 0
    if ([int]::TryParse((Get-Content $opencodePidFile -Raw).Trim(), [ref]$parsedPid) -and $parsedPid -gt 0) {
        $recordedPid = $parsedPid
    }
}

if ($recordedPid -eq 0) {
    Write-Host "  no recorded stand server pid; leaving port $port alone"
} else {
    $listener = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Where-Object { $_.OwningProcess -eq $recordedPid } |
        Select-Object -First 1
    if (-not $listener) {
        Write-Host "  recorded PID $recordedPid is not listening on $port; leaving the port alone"
    } else {
        $ocProc = Get-Process -Id $recordedPid -ErrorAction SilentlyContinue
        Write-Host "  stopping OpenCode: PID $recordedPid ($($ocProc.ProcessName))"
        try {
            Stop-Process -Id $recordedPid -Force -ErrorAction Stop
            Remove-Item $opencodePidFile -Force -ErrorAction SilentlyContinue
            Write-Host "  stopped"
        } catch {
            Write-Warning "  failed to stop PID ${recordedPid}: $($_.Exception.Message)"
        }
    }
}

# --- Test bot -------------------------------------------------------------

$loggedPids = @()
if (Test-Path $logsDir) {
    $loggedPids = Get-ChildItem $logsDir -Filter "bot-*.log" -ErrorAction SilentlyContinue |
        ForEach-Object { if ($_.Name -match '_(\d+)\.log$') { [int]$Matches[1] } } |
        Select-Object -Unique
}

Write-Host "Test bot pids seen in $logsDir : $($loggedPids.Count)"

$stopped = 0
foreach ($botPid in $loggedPids) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$botPid" -ErrorAction SilentlyContinue
    if (-not $proc) { continue }
    if ($proc.Name -ne "node.exe") { continue }
    if ($proc.CommandLine -notlike "*dist\index.js*") { continue }

    Write-Host "  stopping bot: PID $botPid"
    try {
        Stop-Process -Id $botPid -Force -ErrorAction Stop
        $stopped++
        Write-Host "  stopped"
    } catch {
        Write-Warning "  failed to stop PID ${botPid}: $($_.Exception.Message)"
    }
}

if ($stopped -eq 0) {
    Write-Host "  no running test bot found"
}

# --- Fault proxy and forward proxy ----------------------------------------

function Stop-TestProxy([string]$pidFile, [string]$scriptName, [string]$label) {
    $proxyStopped = $false
    if (Test-Path $pidFile) {
        $proxyPid = [int](Get-Content $pidFile -Raw).Trim()
        $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$proxyPid" -ErrorAction SilentlyContinue
        if ($proc -and $proc.Name -eq "node.exe" -and $proc.CommandLine -like "*$scriptName*") {
            Write-Host "  stopping ${label}: PID $proxyPid"
            try {
                Stop-Process -Id $proxyPid -Force -ErrorAction Stop
                $proxyStopped = $true
                Write-Host "  stopped"
            } catch {
                Write-Warning "  failed to stop PID ${proxyPid}: $($_.Exception.Message)"
            }
        }
        Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    }

    if (-not $proxyStopped) {
        Write-Host "  no $label running"
    }
}

Stop-TestProxy $proxyPidFile "fault-proxy.mjs" "fault proxy"
Stop-TestProxy $forwardPidFile "forward-proxy.mjs" "forward proxy"

# --- Result ---------------------------------------------------------------

Start-Sleep -Milliseconds 500
$still = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
Write-Host ""
if ($still) {
    Write-Warning "Port $port is still in use."
} else {
    Write-Host "Port $port is free."
}
