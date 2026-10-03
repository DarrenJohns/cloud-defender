<#
.SYNOPSIS
  Generates fallback announcer clips in public/assets/voice using Windows text-to-speech.

.DESCRIPTION
  Lines are read from scripts/voice-lines.json. Each line is spoken with System.Speech, then encoded as a small mono MP3.
  The main clips are made by generate-voices-neural.py; this is a quick no-Python fallback.
  To use your own recordings instead, replace the MP3 files and keep the same file names.
  ffmpeg is used from PATH when available; otherwise ffmpeg-static is installed into a temp folder.

.EXAMPLE
  pwsh scripts/generate-voices.ps1
  pwsh scripts/generate-voices.ps1 -Voice "Microsoft Zira Desktop" -Rate 1
#>
param(
  [string]$Voice = "Microsoft David Desktop",
  [int]$Rate = 0,
  [string]$OutDir = (Join-Path $PSScriptRoot "..\public\assets\voice")
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech

$linesPath = Join-Path $PSScriptRoot "voice-lines.json"
$lines = [ordered]@{}
foreach ($entry in (Get-Content $linesPath -Raw | ConvertFrom-Json).PSObject.Properties) {
  $lines[$entry.Name] = if ($entry.Value -is [string]) { $entry.Value } else { $entry.Value.text }
}

function Get-Ffmpeg {
  $onPath = Get-Command ffmpeg -ErrorAction SilentlyContinue
  if ($onPath) { return $onPath.Source }
  $toolDir = Join-Path $env:TEMP "cloud-defender-ffmpeg"
  $binary = Join-Path $toolDir "node_modules\ffmpeg-static\ffmpeg.exe"
  if (-not (Test-Path $binary)) {
    New-Item -ItemType Directory -Force $toolDir | Out-Null
    Push-Location $toolDir
    try { npm install --silent --no-audit --no-fund ffmpeg-static@5 | Out-Null } finally { Pop-Location }
  }
  if (-not (Test-Path $binary)) { throw "ffmpeg not found and ffmpeg-static install failed." }
  return $binary
}

$ffmpeg = Get-Ffmpeg
New-Item -ItemType Directory -Force $OutDir | Out-Null
$workDir = Join-Path $env:TEMP "cloud-defender-voice-wav"
New-Item -ItemType Directory -Force $workDir | Out-Null

$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$synth.SelectVoice($Voice)
$synth.Rate = $Rate
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)

try {
  foreach ($entry in $lines.GetEnumerator()) {
    $wav = Join-Path $workDir "$($entry.Key).wav"
    $mp3 = Join-Path $OutDir "$($entry.Key).mp3"
    $synth.SetOutputToWaveFile($wav, $format)
    $synth.Speak($entry.Value)
    $synth.SetOutputToNull()
    # Trim leading/trailing silence so lines start promptly, then encode a small mono MP3.
    & $ffmpeg -y -loglevel error -i $wav -af "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse" -ac 1 -ar 22050 -b:a 40k $mp3
    if ($LASTEXITCODE -ne 0) { throw "ffmpeg failed for $($entry.Key)" }
    Write-Host ("{0,-14} {1,6:N0} bytes  ""{2}""" -f $entry.Key, (Get-Item $mp3).Length, $entry.Value)
  }
} finally {
  $synth.Dispose()
  Remove-Item -Recurse -Force $workDir -ErrorAction SilentlyContinue
}
