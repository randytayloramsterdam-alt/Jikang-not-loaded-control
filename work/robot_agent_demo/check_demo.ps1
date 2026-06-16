$ErrorActionPreference = "Stop"

$port = if ($env:ROBOT_AGENT_PORT) { $env:ROBOT_AGENT_PORT } else { "53123" }
$baseUrl = "http://127.0.0.1:$port"

Write-Host "Checking $baseUrl ..."

$homeResponse = Invoke-WebRequest -UseBasicParsing -Uri "$baseUrl/" -TimeoutSec 5
Write-Host "Home status: $($homeResponse.StatusCode)"

$body = @{ text = "你是谁？古琴是什么？" } | ConvertTo-Json -Compress
$response = Invoke-RestMethod -Uri "$baseUrl/api/chat" -Method Post -ContentType "application/json; charset=utf-8" -Body $body -TimeoutSec 90

$audioBytes = 0
if ($response.audio_base64) {
  $audioBytes = [Math]::Round($response.audio_base64.Length * 3 / 4)
}

[PSCustomObject]@{
  Reply = $response.reply
  Emotion = $response.emotion
  Gaze = $response.gaze
  Expression = $response.expression
  AudioBytes = $audioBytes
  AudioError = $response.audio_error
  SerialEnabled = $response.serial_enabled
  LLM = $response.llm
} | Format-List
