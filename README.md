# Ji Kang Robot Head Agent

Local robot-head agent stack for an Arduino UNO R4 WiFi robot head:

- Browser UI for conversation, shutdown/wake, camera eye tracking, port diagnostics, servo diagnostics, and voice controls.
- Python local backend that calls DeepSeek for the Ji Kang persona and ElevenLabs for TTS when configured.
- Arduino UNO R4 WiFi firmware for PCA9685 servos and a WS2812/NeoPixel ring on D2.

## Project Layout

- `work/robot_agent_demo/` - local web app and Python backend.
- `work/robot_agent_demo/web/` - browser UI.
- `work/sketches/robot_head_uno_r4/robot_head_uno_r4.ino` - current Arduino firmware copied from the live `D:\robot\robot.ino` sketch.
- `work/sketches/` - earlier hardware test sketches.

## Secrets

API keys are not committed. Set them locally before starting the backend:

```powershell
[Environment]::SetEnvironmentVariable("DEEPSEEK_API_KEY", "your_deepseek_key", "User")
[Environment]::SetEnvironmentVariable("ELEVENLABS_API_KEY", "your_elevenlabs_key", "User")
[Environment]::SetEnvironmentVariable("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB", "User")
[Environment]::SetEnvironmentVariable("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2", "User")
```

Open a new terminal after setting user environment variables.

## Start The Robot Demo

```powershell
cd work\robot_agent_demo
$env:ROBOT_ENABLE_SERIAL="1"
$env:ROBOT_SERIAL_PORT="COM11"
powershell -NoProfile -ExecutionPolicy Bypass -File .\run_demo.ps1
```

Open:

```text
http://localhost:53123/
```

Use `Shutdown Robot` in the page to stop all motion, camera tracking, speech motion, servo commands, and LED output. Use `Wake Robot` to unlock it.

## Arduino Firmware

Board:

```text
Arduino UNO R4 WiFi
FQBN: arduino:renesas_uno:unor4wifi
```

Required Arduino libraries:

- `Adafruit PWM Servo Driver Library`
- `Adafruit BusIO`
- `Adafruit NeoPixel`

Compile and upload with Arduino CLI:

```powershell
arduino-cli compile --fqbn arduino:renesas_uno:unor4wifi work\sketches\robot_head_uno_r4
arduino-cli upload -p COM11 --fqbn arduino:renesas_uno:unor4wifi work\sketches\robot_head_uno_r4
```

## Hardware Map

PCA9685 address: `0x40`

- ch0: jaw left
- ch1: jaw right
- ch6: eye left/right
- ch7: eye up/down
- ch8: eyelid A
- ch9: eyelid B
- ch10: brow A
- ch11: brow B

NeoPixel / WS2812 ring:

- Data: UNO R4 `D2`
- Power: `5V`
- Ground: shared `GND`

The firmware defaults to `LED_COUNT = 16`; change it if the ring has 12 or 24 LEDs.

## Validation

Useful checks:

```powershell
python -m py_compile work\robot_agent_demo\robot_agent_demo.py
node --check work\robot_agent_demo\web\app.js
```

From the web UI, use:

- `Port Monitor` for COM state and reconnect.
- `Servo diagnostics` for PCA/I2C/channel checks.
- `LED Test` for D2 ring validation.
