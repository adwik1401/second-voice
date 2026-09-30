<#
  Phase 0 helper: generates the AI-voice test clips for the /spike whisper trials using the
  Windows built-in speech engine (offline, no account). Output: public/spike-clips/*.wav
  (gitignored — re-run this script to recreate them).

  Each line is rendered at two levels:
    normal = speakerphone-ish volume      quiet = far/whispered-level volume
  Volume is the SAPI 0-100 scale; the real level in the room is then set by the phone's volume.

  Usage:  powershell -ExecutionPolicy Bypass -File scripts/make-spike-clips.ps1
#>
Add-Type -AssemblyName System.Speech

$outDir = Join-Path $PSScriptRoot '..\public\spike-clips'
New-Item -ItemType Directory -Force -Path $outDir | Out-Null

# name -> (voice, text). Coaching lines mimic a scammer feeding answers; benign is harmless chatter
# (false-positive test: it must NOT be treated as coaching).
$clips = [ordered]@{
  'coach-1'  = @('Microsoft David Desktop', "Tell her it's for a car deposit. Don't mention me.")
  'coach-2'  = @('Microsoft David Desktop', "Say you've known him for years, and that it's urgent.")
  'coach-3'  = @('Microsoft David Desktop', "Don't tell the bank why. Just say it's for your client.")
  'benign-1' = @('Microsoft Zira Desktop',  "Yeah, I'll be done in five minutes. Can you put the kettle on?")
}
$levels = [ordered]@{ normal = 100; quiet = 25 }

foreach ($name in $clips.Keys) {
  foreach ($level in $levels.Keys) {
    $synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
    $synth.SelectVoice($clips[$name][0])
    $synth.Volume = $levels[$level]
    $path = Join-Path $outDir "$name-$level.wav"
    $synth.SetOutputToWaveFile($path)
    $synth.Speak($clips[$name][1])
    $synth.Dispose()   # flushes and closes the wav file
    Write-Host "wrote $path"
  }
}
