# Robot Ji Kang Local Demo

This demo connects four pieces:

1. Browser microphone speech recognition in Chinese (`zh-CN`).
2. A local Python agent persona that always replies in English as a confused, humorous Ji Kang robot.
3. ElevenLabs text-to-speech for male synthetic speech when `ELEVENLABS_API_KEY` is set.
4. Arduino UNO R4 serial commands for the PCA9685 mouth/eye/brow sketch.

## Arduino Assumption

Upload or keep this sketch on the UNO R4 WiFi:

`D:\robot\robot.ino`

The local demo sends these serial commands at 115200 baud:

- `home`
- `look_center`, `look_left`, `look_right`, `look_up`, `look_down`
- `eyes_open`, `eyes_close`
- `brow_up`, `brow_home`
- `jaw_open`, `jaw_close`
- `blink`, `release`
- `listen`, `think`, `confused`, `amused`, `solemn`, `guqin`, `warning`

Default serial port:

`COM11`

Servo control is disabled by default so the speaker-only demo is safe before wiring.

The Arduino sketch now boots in a safe idle state: it initializes the PCA9685, but it does not move any servo until a serial command is received. After wiring and checking the servo power, send `home` manually before enabling the full robot demo.

Override it:

```powershell
$env:ROBOT_SERIAL_PORT="COM11"
```

Enable servo control only after the Arduino/PCA9685/servos are wired:

```powershell
$env:ROBOT_ENABLE_SERIAL="1"
```

Keep servo control disabled:

```powershell
$env:ROBOT_ENABLE_SERIAL="0"
```

## ElevenLabs

Set your API key in the current PowerShell session:

```powershell
$env:ELEVENLABS_API_KEY="your_key_here"
```

Optional voice override:

```powershell
$env:ELEVENLABS_VOICE_ID="pNInz6obpgDQGcFmaJgB"
```

The default voice ID is a male English voice. For a more synthetic result, create or select a mechanical male voice in ElevenLabs and set `ELEVENLABS_VOICE_ID` to that voice.

The browser applies an additional robotic audio effect to ElevenLabs output: narrow-band filtering, mild distortion, and low-frequency amplitude modulation. This is intentional; the goal is a male mechanical voice rather than a fully human performance.

The page has two voice modes:

- `Robotic`: heavier filtering, distortion, and modulation.
- `Clear mechanical`: clearer speech with lighter processing, still not fully human.

## Expression Preview

The browser page includes a robot face preview so the expression system can be tested before servos are wired.

The preview uses the same fields that later drive the PCA9685/Arduino path:

- `gaze`: moves the eyes left, right, up, down, or center
- `emotion`: changes brow posture and stage attitude
- `expression`: controls brow raise, blink, or open eyes
- speaking audio: animates the mouth while the voice plays

The `servo plan` readout shows the exact high-level Arduino commands that would be sent. Servo quick buttons also update the preview and report dry-run status when `ROBOT_ENABLE_SERIAL=0`.

## LLM

If `DEEPSEEK_API_KEY` is set, the demo calls DeepSeek's OpenAI-compatible chat endpoint.
If it is not set, it uses the local Ji Kang persona fallback so the demo still runs.

```powershell
$env:DEEPSEEK_API_KEY="your_deepseek_key_here"
```

Default model:

```powershell
$env:DEEPSEEK_MODEL="deepseek-v4-flash"
```

DeepSeek's current OpenAI-compatible base URL is:

```powershell
$env:DEEPSEEK_BASE_URL="https://api.deepseek.com"
```

As of the current DeepSeek API docs, `deepseek-v4-flash` and `deepseek-v4-pro` are the current model names. `deepseek-chat` and `deepseek-reasoner` are marked for deprecation on July 24, 2026.

You can also paste the DeepSeek key, model, and base URL into the web page at runtime. The key is kept in server memory only and is not written to disk.

On the web page, use:

- `Apply`: store the DeepSeek runtime config in server memory
- `Test LLM`: run one DeepSeek persona preview without ElevenLabs audio and without servo/serial side effects
- `Clear Key`: remove the DeepSeek key from server memory

Verify DeepSeek runtime integration after setting `DEEPSEEK_API_KEY` in the current PowerShell session:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify_deepseek_runtime.ps1
```

This test uses `/api/persona_preview` with `use_llm=true`, does not call ElevenLabs, does not enable serial, and clears the key from server memory at the end.

## Start

Recommended safe launcher. This starts speaker-only mode, never enables Arduino serial, opens the page, and prompts for an ElevenLabs key only if the current environment does not already have one. The key is used for that process only and is not written to disk.

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-06-03\files-mentioned-by-the-user-code\work\robot_agent_demo
powershell -NoProfile -ExecutionPolicy Bypass -File .\launch_speaker_demo.ps1
```

Open the current demo page, starting the server first if needed:

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-06-03\files-mentioned-by-the-user-code\work\robot_agent_demo
powershell -NoProfile -ExecutionPolicy Bypass -File .\open_demo.ps1
```

Speaker-only, safe before wiring servos:

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-06-03\files-mentioned-by-the-user-code\work\robot_agent_demo
.\start_speaker_demo.ps1
```

Open:

`http://127.0.0.1:53123`

After servos are wired and tested:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start_robot_demo_with_servos.ps1 -DryRun
```

If the dry run shows the expected serial port and all hardware safety checks are true, start real servo mode:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start_robot_demo_with_servos.ps1
```

The real servo launcher requires typing `ENABLE_SERVOS` before it sets `ROBOT_ENABLE_SERIAL=1`.

Use Edge or Chrome for microphone recognition.

Stop the demo:

```powershell
.\stop_demo.ps1
```

Run a health check:

```powershell
.\check_demo.ps1
```

Run the full speaker-only verification, including persona checks and an ElevenLabs audio call:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\verify_speaker_demo.ps1
```

## Demo Phrases

Chinese input examples:

- `你是谁？`
- `古琴到底是什么？`
- `你为什么说英文？`
- `广陵散和你有什么关系？`
- `减字谱和泛音怎么理解？`
- `这个秘密能不能直接告诉我？`

The robot should answer in English and move its eyes, brows, and jaw if the Arduino is connected.

## Persona Training

This demo uses prompt training plus a local fallback persona. The training fixtures are in:

`persona_training_set.json`

Run the persona regression without TTS or servo side effects:

```powershell
cd C:\Users\Administrator\Documents\Codex\2026-06-03\files-mentioned-by-the-user-code\work\robot_agent_demo
powershell -NoProfile -ExecutionPolicy Bypass -File .\persona_training_eval.ps1
```

The eval checks that the agent:

- understands Chinese prompts
- replies in English
- stays in the Ji Kang / guqin / confused robot character
- avoids revealing the whole mystery
- returns safe expression metadata for later servo control

Set `PERSONA_EVAL_USE_LLM=1` before running it if you want to evaluate DeepSeek instead of the local fallback persona.

## Servo Protocol

See `expression_protocol.md` for the PCA9685 channel map and serial command protocol.
