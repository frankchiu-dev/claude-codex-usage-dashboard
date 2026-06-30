param(
  [switch]$Uninstall,
  [switch]$NoStart
)

$ErrorActionPreference = 'Stop'

$root = $PSScriptRoot
$runner = Join-Path $root 'run-desktop-hidden.vbs'
$electron = Join-Path $root 'node_modules\electron\dist\electron.exe'
$shortcutName = 'AIUsageDashboardDesktop.lnk'
$legacyNames = @('AIUsageDashboard.lnk')

$locations = @(
  [pscustomobject]@{ Name = 'startup'; Path = [Environment]::GetFolderPath('Startup') },
  [pscustomobject]@{ Name = 'desktop'; Path = [Environment]::GetFolderPath('Desktop') }
)

function Remove-Shortcut {
  param([string]$Directory, [string]$Name)

  if (-not $Directory) { return }
  $path = Join-Path $Directory $Name
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Force
    Write-Host "Removed $path"
  }
}

function New-DashboardShortcut {
  param([string]$Directory)

  if (-not (Test-Path -LiteralPath $Directory)) {
    New-Item -ItemType Directory -Path $Directory -Force | Out-Null
  }

  $path = Join-Path $Directory $shortcutName
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut($path)
  $lnk.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $lnk.Arguments = '"' + $runner + '"'
  $lnk.WorkingDirectory = $root
  $lnk.IconLocation = $electron + ',0'
  $lnk.Save()
  Write-Host "Installed $path"
}

if ($Uninstall) {
  foreach ($location in $locations) {
    Remove-Shortcut -Directory $location.Path -Name $shortcutName
    foreach ($legacyName in $legacyNames) {
      Remove-Shortcut -Directory $location.Path -Name $legacyName
    }
  }
  exit 0
}

if (-not (Test-Path -LiteralPath $electron)) {
  throw "Missing Electron. Run npm install first: $electron"
}

if (-not (Test-Path -LiteralPath $runner)) {
  throw "Missing launcher: $runner"
}

foreach ($location in $locations) {
  foreach ($legacyName in $legacyNames) {
    Remove-Shortcut -Directory $location.Path -Name $legacyName
  }
  New-DashboardShortcut -Directory $location.Path
}

if (-not $NoStart) {
  Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList ('"' + $runner + '"')
}
