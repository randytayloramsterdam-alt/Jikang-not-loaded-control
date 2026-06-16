# Copy values from this example into your current PowerShell session before starting the demo.
# Do not commit or share your real API keys.

# Required for ElevenLabs audio.
$env:ELEVENLABS_API_KEY = "paste_your_elevenlabs_key_here"

# Optional. Default is a male English voice.
$env:ELEVENLABS_VOICE_ID = "pNInz6obpgDQGcFmaJgB"
$env:ELEVENLABS_MODEL_ID = "eleven_multilingual_v2"

# Optional. If unset, the demo uses the built-in Ji Kang persona fallback.
$env:DEEPSEEK_API_KEY = "paste_your_deepseek_key_here"

# Current DeepSeek API docs list deepseek-v4-flash and deepseek-v4-pro.
# Older names deepseek-chat and deepseek-reasoner are marked for deprecation on 2026-07-24.
$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
$env:DEEPSEEK_BASE_URL = "https://api.deepseek.com"

# Local server and Arduino serial.
$env:ROBOT_AGENT_PORT = "53123"
$env:ROBOT_SERIAL_PORT = "COM11"

# Keep this disabled until PCA9685 and servos are wired.
$env:ROBOT_ENABLE_SERIAL = "0"
