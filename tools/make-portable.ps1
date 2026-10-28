# Builds Ty-Portable: a folder to copy onto a USB stick (16 GB+) and run on any Windows PC with no
# install and no admin (college PCs). Ty starts her own Ollama from it; NVIDIA cards use CUDA, others
# Vulkan or the CPU.
#
#   powershell -ExecutionPolicy Bypass -File tools\make-portable.ps1 [-Out <folder>] [-Fresh] [-NoModels]
#
#   Ty-Portable\
#     Start Ty.cmd     double-click this
#     Ty\Ty.exe        the app (Ty\portable marks it)
#     ollama\          Ollama (ollama.exe and its GPU libraries)
#     models\          her models (Qwen3 8B, Qwen3 1.7B, Qwen3-VL 2B)
#     TyData\          her settings and memory (a copy of yours, unless -Fresh)
param(
  [string]$Out = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Ty-Portable'),
  [switch]$Fresh,    # no settings or chat memory copied: she starts new
  [switch]$NoModels  # skip the models (copy them yourself later into models\)
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
function Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }
function Mirror($from, $to, [string[]]$skipDirs = @()) {
  $args = @($from, $to, '/E', '/NFL', '/NDL', '/NJH', '/NJS', '/NP', '/R:1', '/W:1')
  if ($skipDirs.Count) { $args += '/XD'; $args += $skipDirs }
  & robocopy @args | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "copying $from failed (robocopy $LASTEXITCODE)" }
}

Step 'Building Ty (a plain folder, no installer)'
Push-Location $root
try { & npx electron-builder --win --dir; if ($LASTEXITCODE) { throw 'electron-builder failed' } } finally { Pop-Location }
$built = Join-Path $root 'dist\win-unpacked'
New-Item -ItemType Directory -Force $Out | Out-Null
Mirror $built (Join-Path $Out 'Ty')
Set-Content (Join-Path $Out 'Ty\portable') 'Ty-Portable: settings in ..\TyData, Ollama in ..\ollama, models in ..\models' -Encoding ascii

Step 'Copying Ollama (CUDA + Vulkan + CPU; the AMD ROCm libraries are left out)'
$ollama = Join-Path $env:LOCALAPPDATA 'Programs\Ollama'
if (-not (Test-Path "$ollama\ollama.exe")) { throw "Ollama isn't installed at $ollama" }
New-Item -ItemType Directory -Force (Join-Path $Out 'ollama') | Out-Null
Copy-Item "$ollama\ollama.exe" (Join-Path $Out 'ollama') -Force
Mirror "$ollama\lib" (Join-Path $Out 'ollama\lib') @('rocm*')

if (-not $NoModels) {
  Step 'Copying her models (about 7.5 GB)'
  $models = if ($env:OLLAMA_MODELS) { $env:OLLAMA_MODELS } else { Join-Path $env:USERPROFILE '.ollama\models' }
  Mirror $models (Join-Path $Out 'models')
}

Step ($(if ($Fresh) { 'Fresh settings' } else { 'Copying her settings, memory and skins' }))
$data = Join-Path $Out 'TyData'
New-Item -ItemType Directory -Force $data | Out-Null
$mine = Join-Path $env:APPDATA 'ty-desktop'
if (-not $Fresh) {
  foreach ($f in 'config.json', 'memory.json') { if (Test-Path "$mine\$f") { Copy-Item "$mine\$f" $data -Force } }
  if (Test-Path "$mine\skins") { Mirror "$mine\skins" (Join-Path $data 'skins') }
}

Set-Content (Join-Path $Out 'Start Ty.cmd') "@echo off`r`nstart `"`" `"%~dp0Ty\Ty.exe`"`r`n" -Encoding ascii
Set-Content (Join-Path $Out 'README.txt') @"
TY PORTABLE
===========
Double-click "Start Ty.cmd". No install, no admin. First start takes a minute while her
model loads onto the graphics card.

Everything stays in this folder: her settings and memory (TyData), Ollama (ollama), and
her models (models). Closing Ty (right-click her > Quit) stops her Ollama too.

If the PC already runs its own Ollama, Ty uses that one instead (and its models).
"@ -Encoding ascii

$size = [math]::Round((Get-ChildItem $Out -Recurse -File | Measure-Object Length -Sum).Sum / 1GB, 1)
Step "Done: $Out ($size GB). Copy the whole folder onto a USB stick."
