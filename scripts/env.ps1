$ErrorActionPreference = "Stop"

$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$root = Split-Path -Parent $project

$env:CODEX_DEV_ROOT = $root
$env:RUSTUP_HOME = Join-Path $root ".rustup"
$env:CARGO_HOME = Join-Path $root ".cargo"
$env:npm_config_cache = Join-Path $root ".npm-cache"
$env:npm_config_prefix = Join-Path $root ".npm-global"
$env:TEMP = Join-Path $root ".tmp"
$env:TMP = Join-Path $root ".tmp"

New-Item -ItemType Directory -Force `
  -Path $env:RUSTUP_HOME, $env:CARGO_HOME, $env:npm_config_cache, $env:npm_config_prefix, $env:TEMP, $project `
  | Out-Null

$cargoBin = Join-Path $env:CARGO_HOME "bin"
if (Test-Path -LiteralPath $cargoBin) {
  $env:PATH = "$cargoBin;$env:PATH"
}

if (Test-Path -LiteralPath $env:npm_config_prefix) {
  $env:PATH = "$env:npm_config_prefix;$env:PATH"
}

Set-Location -LiteralPath $project
