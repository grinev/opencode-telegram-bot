# Starts the bot against an isolated home directory so e2e runs never touch
# the real .env / settings.json / logs of the working copy.
#
# Usage:
#   .\e2e\run-test-bot.ps1
#   .\e2e\run-test-bot.ps1 -SkipBuild
#   .\e2e\run-test-bot.ps1 -FaultProxy            # route Bot API calls through e2e/fault-proxy.mjs
#   .\e2e\run-test-bot.ps1 -ForwardProxy socks5h  # reach Telegram through e2e/forward-proxy.mjs
#   .\e2e\run-test-bot.ps1 -OpencodeVersion v1    # this launch only: OpenCode V1 instead of e2e/.env's version

[CmdletBinding()]
param(
    [switch]$SkipBuild,
    [switch]$FaultProxy,
    [string]$ForwardProxy,
    [string]$OpencodeVersion
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$testHome = Join-Path $projectRoot ".tmp\e2e\home"
$sourceEnv = Join-Path $PSScriptRoot ".env"
$runtimeEnv = Join-Path $testHome ".env"
$proxyDir = Join-Path $projectRoot ".tmp\e2e\fault-proxy"
$proxyPidFile = Join-Path $proxyDir "proxy.pid"
$proxyPort = 8765
$proxyRoot = "http://127.0.0.1:$proxyPort"
$useForwardProxy = $PSBoundParameters.ContainsKey("ForwardProxy")
$forwardSchemes = @("socks", "socks4", "socks4a", "socks5", "socks5h", "http", "https")
$forwardDir = Join-Path $projectRoot ".tmp\e2e\forward-proxy"
$forwardPidFile = Join-Path $forwardDir "proxy.pid"
$forwardPort = 8766
$forwardProxyUrl = "${ForwardProxy}://127.0.0.1:$forwardPort"
$opencodeStateHome = Join-Path $projectRoot ".tmp\e2e\opencode-state"

function Get-TestEnvValue([string]$name) {
    $line = Get-Content $sourceEnv | Where-Object { $_ -match "^\s*$name\s*=" } | Select-Object -Last 1
    if (-not $line) { return "" }
    return ($line -replace "^\s*$name\s*=\s*", "").Trim().Trim('"').Trim("'")
}

function Stop-LeftoverProxy([string]$pidFile, [string]$scriptName, [string]$label) {
    if (-not (Test-Path $pidFile)) { return }
    $leftoverPid = [int](Get-Content $pidFile -Raw).Trim()
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$leftoverPid" -ErrorAction SilentlyContinue
    if ($proc -and $proc.Name -eq "node.exe" -and $proc.CommandLine -like "*$scriptName*") {
        Write-Host "Stopping $label left from a previous launch: PID $leftoverPid"
        Stop-Process -Id $leftoverPid -Force
    }
    Remove-Item $pidFile -Force
}

function Restore-EnvValue([string]$name, $previousValue) {
    if ($null -eq $previousValue) {
        Remove-Item "env:$name" -ErrorAction SilentlyContinue
    } else {
        Set-Item "env:$name" $previousValue
    }
}

# Case-sensitive on purpose: the proxy and the bot's agents only know lowercase schemes.
if ($useForwardProxy -and ($forwardSchemes -cnotcontains $ForwardProxy)) {
    Write-Error "Unknown -ForwardProxy scheme '$ForwardProxy'. Supported: $($forwardSchemes -join ', ')."
    exit 1
}

if ($OpencodeVersion -and (@("v1", "v2") -cnotcontains $OpencodeVersion)) {
    Write-Error "Unknown -OpencodeVersion '$OpencodeVersion'. Supported: v1, v2."
    exit 1
}

if (-not (Test-Path $testHome)) {
    New-Item -ItemType Directory -Force -Path $testHome | Out-Null
    Write-Host "Created test home: $testHome"
}

if (-not (Test-Path $sourceEnv)) {
    Copy-Item (Join-Path $PSScriptRoot ".env.example") $sourceEnv
    Write-Host "Created $sourceEnv from e2e/.env.example."
    Write-Host "Fill in TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID, then run again."
    exit 1
}

# e2e/.env is the single source of truth. The test home holds runtime state
# only (settings.json, logs), so the config is re-synced on every launch.
Copy-Item $sourceEnv $runtimeEnv -Force

# dotenv does not override variables that already exist in the environment, so
# anything inherited from the parent process would silently win over the test
# config. Clear every key the test .env defines.
Get-Content $runtimeEnv | ForEach-Object {
    if ($_ -match '^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=') {
        Remove-Item "env:$($Matches[1])" -ErrorAction SilentlyContinue
    }
}

if ($FaultProxy) {
    # The bot rejects TELEGRAM_PROXY_URL together with TELEGRAM_API_ROOT, and the
    # fault proxy cannot tunnel through a SOCKS/HTTP proxy itself.
    if (Get-TestEnvValue "TELEGRAM_PROXY_URL") {
        Write-Error "-FaultProxy cannot be used while e2e/.env sets TELEGRAM_PROXY_URL."
        exit 1
    }
}

if ($useForwardProxy) {
    if ($FaultProxy) {
        Write-Error "-ForwardProxy cannot be combined with -FaultProxy."
        exit 1
    }
    # The launcher owns TELEGRAM_PROXY_URL in this mode, and the bot rejects it
    # together with TELEGRAM_API_ROOT. Whatever is still in the environment after
    # the clearing above was inherited from the caller.
    foreach ($name in @("TELEGRAM_PROXY_URL", "TELEGRAM_API_ROOT")) {
        if ((Get-TestEnvValue $name) -or (Test-Path "env:$name")) {
            Write-Error "-ForwardProxy cannot be used while $name is set in e2e/.env or the environment."
            exit 1
        }
    }
}

# e2e/.env names the stand's OpenCode version; -OpencodeVersion overrides it for this
# launch. The bot's own default is v1.
$effectiveOpencodeVersion = $OpencodeVersion
if (-not $effectiveOpencodeVersion) { $effectiveOpencodeVersion = Get-TestEnvValue "OPENCODE_SERVER_VERSION" }
if (-not $effectiveOpencodeVersion) { $effectiveOpencodeVersion = "v1" }

# The V2 background server takes its password from the user's OpenCode config
# (service.json), and the bot must send the same one.
$opencodePassword = ""
if ($effectiveOpencodeVersion -eq "v2") {
    $configHome = if ($env:XDG_CONFIG_HOME) { $env:XDG_CONFIG_HOME } else { Join-Path $HOME ".config" }
    $serviceConfig = Join-Path $configHome "opencode\service.json"
    if (Test-Path $serviceConfig) {
        $opencodePassword = [string](Get-Content $serviceConfig -Raw | ConvertFrom-Json).password
    }
    if (-not $opencodePassword) {
        Write-Error "OpenCode V2 needs a server password, and $serviceConfig has none. Set one with 'opencode service set password <value>'."
        exit 1
    }
}

# The bot starts `opencode` from PATH, so the chosen version's bin goes first: both
# versions install an `opencode` command.
$opencodePackage = if ($effectiveOpencodeVersion -eq "v2") { "@opencode\cli" } else { "opencode-ai" }
$opencodeBin = Join-Path (npm root -g) "$opencodePackage\bin"
if (-not (Test-Path (Join-Path $opencodeBin "opencode.exe"))) {
    Write-Warning "No global npm install of $opencodePackage found; the bot starts whichever opencode is on PATH."
    $opencodeBin = ""
}

if (-not $SkipBuild) {
    Write-Host "Building..."
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Error "Build failed."
        exit $LASTEXITCODE
    }
}

$env:OPENCODE_TELEGRAM_HOME = $testHome

if ($FaultProxy) {
    Stop-LeftoverProxy $proxyPidFile "fault-proxy.mjs" "fault proxy"
    New-Item -ItemType Directory -Force -Path $proxyDir | Out-Null

    # A stand that reaches Telegram through its own reverse proxy keeps doing so:
    # that root becomes the fault proxy's upstream.
    $upstream = Get-TestEnvValue "TELEGRAM_API_ROOT"
    if (-not $upstream) { $upstream = "https://api.telegram.org" }

    # No output redirection: with it the proxy inherits this shell's handles and
    # keeps a caller's pipe open for as long as it runs.
    $proxyScript = Join-Path $PSScriptRoot "fault-proxy.mjs"
    Start-Process node -ArgumentList @("`"$proxyScript`"", "--port", $proxyPort, "--upstream", "`"$upstream`"") `
        -WindowStyle Hidden

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        try {
            Invoke-RestMethod "$proxyRoot/__fault/state" -TimeoutSec 1 | Out-Null
            $ready = $true
            break
        } catch {
            Start-Sleep -Milliseconds 250
        }
    }
    if (-not $ready) {
        Write-Error "Fault proxy did not come up on port $proxyPort. Run 'node e2e/fault-proxy.mjs' in the foreground to see why."
        exit 1
    }
}

if ($useForwardProxy) {
    Stop-LeftoverProxy $forwardPidFile "forward-proxy.mjs" "forward proxy"
    New-Item -ItemType Directory -Force -Path $forwardDir | Out-Null

    # No output redirection, as for the fault proxy. Readiness is the pid file the
    # proxy writes once it listens: a probe connection would land in its log.
    $forwardScript = Join-Path $PSScriptRoot "forward-proxy.mjs"
    $forwardProcess = Start-Process node `
        -ArgumentList @("`"$forwardScript`"", "--scheme", $ForwardProxy, "--port", $forwardPort) `
        -WindowStyle Hidden -PassThru

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
        if ($forwardProcess.HasExited) { break }
        if (Test-Path $forwardPidFile) {
            $ready = $true
            break
        }
        Start-Sleep -Milliseconds 250
    }
    if (-not $ready) {
        if (-not $forwardProcess.HasExited) { Stop-Process -Id $forwardProcess.Id -Force }
        Write-Error "Forward proxy did not come up on port $forwardPort. Run 'node e2e/forward-proxy.mjs --scheme $ForwardProxy' in the foreground to see why."
        exit 1
    }
}

Write-Host ""
Write-Host "Test home : $testHome"
Write-Host "Logs      : $(Join-Path $testHome 'logs')"
Write-Host "Settings  : $(Join-Path $testHome 'settings.json')"
if ($opencodeBin) {
    Write-Host "OpenCode  : $effectiveOpencodeVersion ($opencodeBin)"
} else {
    Write-Host "OpenCode  : $effectiveOpencodeVersion (opencode on PATH)"
}
if ($effectiveOpencodeVersion -eq "v2") {
    Write-Host "OC state  : $opencodeStateHome"
}
if ($FaultProxy) {
    Write-Host "Proxy     : $proxyRoot -> $upstream (control: $proxyRoot/__fault/state)"
    Write-Host "Call log  : $proxyDir"
}
if ($useForwardProxy) {
    Write-Host "Proxy     : $ForwardProxy forward proxy on 127.0.0.1:$forwardPort"
    Write-Host "Bot env   : TELEGRAM_PROXY_URL=$forwardProxyUrl"
    Write-Host "Conn log  : $forwardDir"
}
Write-Host ""

# This script runs in the caller's session, so TELEGRAM_API_ROOT is pointed at the
# proxy for the bot launch only and restored even on Ctrl+C. Otherwise the next
# launch without -FaultProxy would silently go through the proxy. The forward
# proxy's variables follow the same rule, and the forward proxy itself stops with
# the bot, so a bot that fails to start leaves nothing behind.
$previousApiRoot = $env:TELEGRAM_API_ROOT
$previousProxyUrl = $env:TELEGRAM_PROXY_URL
$previousExtraCaCerts = $env:NODE_EXTRA_CA_CERTS
$previousPath = $env:PATH
$previousServerVersion = $env:OPENCODE_SERVER_VERSION
$previousServerPassword = $env:OPENCODE_SERVER_PASSWORD
$previousStateHome = $env:XDG_STATE_HOME
$previousConfigDir = $env:OPENCODE_CONFIG_DIR
if ($opencodeBin) { $env:PATH = "$opencodeBin;$env:PATH" }
if ($OpencodeVersion) { $env:OPENCODE_SERVER_VERSION = $OpencodeVersion }
if ($effectiveOpencodeVersion -eq "v2") {
    $env:OPENCODE_SERVER_PASSWORD = $opencodePassword
    # V2 keeps one registered background server per user, recorded under XDG_STATE_HOME.
    # A state home of the stand's own keeps its server from replacing the user's one.
    $env:XDG_STATE_HOME = $opencodeStateHome
    # V2 reads OPENCODE_CONFIG_DIR instead of ~/.config/opencode, not on top of it: a
    # directory inherited from the caller would hide the user's config and its password.
    Remove-Item env:OPENCODE_CONFIG_DIR -ErrorAction SilentlyContinue
}
if ($FaultProxy) { $env:TELEGRAM_API_ROOT = $proxyRoot }
if ($useForwardProxy) {
    $env:TELEGRAM_PROXY_URL = $forwardProxyUrl
    # The https proxy presents the committed test certificate; only this launch trusts it.
    if ($ForwardProxy -ceq "https") {
        $env:NODE_EXTRA_CA_CERTS = Join-Path $PSScriptRoot "forward-proxy-test-only.crt"
    }
}
try {
    node (Join-Path $projectRoot "dist\index.js")
} finally {
    Restore-EnvValue "PATH" $previousPath
    Restore-EnvValue "OPENCODE_SERVER_VERSION" $previousServerVersion
    Restore-EnvValue "OPENCODE_SERVER_PASSWORD" $previousServerPassword
    Restore-EnvValue "XDG_STATE_HOME" $previousStateHome
    Restore-EnvValue "OPENCODE_CONFIG_DIR" $previousConfigDir
    if ($FaultProxy) {
        Restore-EnvValue "TELEGRAM_API_ROOT" $previousApiRoot
    }
    if ($useForwardProxy) {
        Restore-EnvValue "TELEGRAM_PROXY_URL" $previousProxyUrl
        Restore-EnvValue "NODE_EXTRA_CA_CERTS" $previousExtraCaCerts
        if (-not $forwardProcess.HasExited) {
            Stop-Process -Id $forwardProcess.Id -Force -ErrorAction SilentlyContinue
        }
        Remove-Item $forwardPidFile -Force -ErrorAction SilentlyContinue
    }
}
