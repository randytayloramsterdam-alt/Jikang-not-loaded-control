# Expression And Servo Protocol

## Hardware Target

- Board: Arduino UNO R4 WiFi
- Servo driver: PCA9685 at I2C address `0x40`
- Baud rate: `115200`
- Serial port default: `COM11`
- Current hardware sketch: `D:\robot\robot.ino`

## PCA9685 Channel Map

| Channel | Name | Role |
|---:|---|---|
| 0 | `JL` | left jaw |
| 1 | `JR` | right jaw |
| 6 | `EYE_LR` | eyeball left/right |
| 7 | `EYE_UD` | eyeball up/down |
| 8 | `LID_A` | eyelid A |
| 9 | `LID_B` | eyelid B |
| 10 | `BROW_A` | brow A |
| 11 | `BROW_B` | brow B |

## Serial Commands From The Agent

| Command | Meaning |
|---|---|
| `home` | jaw closed, eyes center/open, brow home |
| `look_center` | eyes center |
| `look_left` | eyes left |
| `look_right` | eyes right |
| `look_up` | eyes up |
| `look_down` | eyes down |
| `eyes_open` | open eyelids |
| `eyes_close` | close eyelids |
| `blink` | close and reopen eyelids |
| `brow_up` | raise brows |
| `brow_home` | neutral brows |
| `jaw_open` | open jaw |
| `jaw_close` | close jaw |
| `release` | stop PWM output on active channels |
| `listen` | eyes open, center gaze, neutral brows |
| `think` / `confused` | eyes open, left gaze, raised brows |
| `amused` | eyes open, right gaze, raised brows |
| `solemn` | down gaze, blink, neutral brows |
| `guqin` | eyes open, center gaze, neutral brows |
| `warning` | eyes open, center gaze, raised brows |

Manual calibration format:

```text
channel angle
```

Example:

```text
6 120
```

## Agent Expression Mapping

The LLM or fallback persona returns:

```json
{
  "reply": "English response",
  "emotion": "neutral | amused | confused | solemn | guqin | warning",
  "gaze": "center | left | right | up | down",
  "expression": "neutral | brow_up | blink | eyes_open"
}
```

Mapping:

| Agent State | Servo Behavior |
|---|---|
| `gaze=center` | `look_center` |
| `gaze=left` | `look_left` |
| `gaze=right` | `look_right` |
| `gaze=up` | `look_up` |
| `gaze=down` | `look_down` |
| `emotion=amused` | side gaze plus `brow_up` |
| `emotion=confused` | side gaze plus `brow_up` |
| `emotion=solemn` | slow blink, brow home |
| `emotion=guqin` | centered gaze, brow home |
| speaking | alternating `jaw_open` / `jaw_close` |

## Dry-Run Planning API

Before servos are wired, keep `ROBOT_ENABLE_SERIAL=0`. The server still plans the exact motion commands and returns them without sending anything to the Arduino.

```http
POST /api/expression_plan
```

Example body:

```json
{
  "emotion": "confused",
  "gaze": "left",
  "expression": "brow_up",
  "duration_ms": 1200
}
```

Expected dry-run expression commands:

```json
["eyes_open", "look_left", "brow_up"]
```

`/api/chat` also returns a `motion_plan` block. The web page displays the expression command list as `servo plan`.

`/api/servo` accepts only known high-level commands from this protocol. When serial is disabled it returns `sent=false` and `reason="serial_disabled"`.

## Safe Bring-Up Order

1. Keep `ROBOT_ENABLE_SERIAL=0` and test speaker-only conversation.
2. Upload `D:\robot\robot.ino`.
3. Power PCA9685 with servo power and common ground.
4. Open Serial Monitor at `115200`; the sketch should report safe boot and no servo should move automatically.
5. Send `home` manually only after checking power and linkages.
6. Test one channel at a time with manual serial commands.
7. Run the servo-mode launcher dry run:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start_robot_demo_with_servos.ps1 -DryRun
```

8. Start real servo mode only after the dry run and manual channel tests pass:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\start_robot_demo_with_servos.ps1
```

The real launcher requires typing `ENABLE_SERVOS` before it sets `ROBOT_ENABLE_SERIAL=1`.
