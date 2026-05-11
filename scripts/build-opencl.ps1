$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$bin = Join-Path $root "bin"
$src = Join-Path $root "native/hash256_opencl.c"
$out = Join-Path $bin "hash256-opencl.exe"

New-Item -ItemType Directory -Force -Path $bin | Out-Null

$gcc = Get-Command gcc -ErrorAction SilentlyContinue
if ($gcc) {
  & gcc $src -O3 -o $out -lOpenCL
  Write-Host "Built $out"
  exit 0
}

$cl = Get-Command cl -ErrorAction SilentlyContinue
if ($cl) {
  & cl /O2 /Fe:$out $src OpenCL.lib
  Write-Host "Built $out"
  exit 0
}

throw "Tidak menemukan gcc atau cl. Install MSYS2/MinGW + OpenCL SDK, atau build di Linux dengan: gcc native/hash256_opencl.c -O3 -o bin/hash256-opencl -lOpenCL"
