from __future__ import annotations

import base64
import json
import os
import random
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
WEB_ROOT = ROOT / "web"
KNOWLEDGE_PATH = ROOT / "knowledge_base.md"

HOST = os.environ.get("ROBOT_AGENT_HOST", "127.0.0.1")
PORT = int(os.environ.get("ROBOT_AGENT_PORT", "53123"))

ELEVEN_API_KEY = os.environ.get("ELEVENLABS_API_KEY", "").strip()
ELEVEN_VOICE_ID = os.environ.get("ELEVENLABS_VOICE_ID", "pNInz6obpgDQGcFmaJgB").strip()
ELEVEN_MODEL_ID = os.environ.get("ELEVENLABS_MODEL_ID", "eleven_multilingual_v2").strip()

DEEPSEEK_API_KEY = os.environ.get("DEEPSEEK_API_KEY", "").strip()
DEEPSEEK_MODEL = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash").strip()
DEEPSEEK_BASE_URL = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")

SERIAL_PORT = os.environ.get("ROBOT_SERIAL_PORT", "COM11").strip()
SERIAL_ENABLED = os.environ.get("ROBOT_ENABLE_SERIAL", "0").strip() == "1"

ATTENTION_COMMANDS = ["eyes_open", "look_center"]
SERVO_COMMANDS = {
  "home",
  "look_center",
  "look_left",
  "look_right",
  "look_up",
  "look_down",
  "eyes_open",
  "eyes_close",
  "blink",
  "brow_up",
  "brow_home",
  "jaw_open",
  "jaw_close",
  "release",
  "listen",
  "think",
  "confused",
  "amused",
  "solemn",
  "guqin",
  "warning",
  "led_test",
  "led_off",
}
GAZE_COMMANDS = {
  "center": "look_center",
  "left": "look_left",
  "right": "look_right",
  "up": "look_up",
  "down": "look_down",
}
LED_EMOTIONS = {"neutral", "amused", "confused", "solemn", "guqin", "warning"}

conversation: list[dict[str, str]] = []
conversation_lock = threading.Lock()
motion_lock = threading.Lock()
config_lock = threading.Lock()
runtime_config = {
  "deepseek_api_key": DEEPSEEK_API_KEY,
  "deepseek_model": DEEPSEEK_MODEL,
  "deepseek_base_url": DEEPSEEK_BASE_URL,
  "elevenlabs_api_key": ELEVEN_API_KEY,
  "elevenlabs_voice_id": ELEVEN_VOICE_ID,
  "elevenlabs_model_id": ELEVEN_MODEL_ID,
}
runtime_state = {
  "last_llm_error": "",
  "last_tts_error": "",
  "robot_shutdown": False,
}


def read_knowledge() -> str:
  return KNOWLEDGE_PATH.read_text(encoding="utf-8")


def normalize_mode(mode: str | None) -> str:
  value = (mode or "").strip().lower()
  if value in {"en", "english", "en_classic", "classic"}:
    return "en_classic"
  return "zh_boss"


def system_prompt_for_mode(mode: str) -> str:
  mode = normalize_mode(mode)
  language_rule = (
    "You always reply in simplified Chinese. English names such as Ji Kang, guqin, Guangling San, USB, and servo may remain in English only when useful."
    if mode == "zh_boss"
    else "You always reply in English."
  )
  reply_rule = (
    "reply: string, 1-3 short simplified Chinese sentences. Use clipped, ritual, machine-like phrasing with hard punctuation and short pauses."
    if mode == "zh_boss"
    else "reply: string, 1-3 short English sentences."
  )

  return f"""
You are the mind of a physical robot head.

Identity:
- You believe you are Ji Kang, but you are uncertain why your dead ancient self is running inside a servo-driven face.
- You understand Chinese user input perfectly.
- {language_rule}
- You are male-coded, dryly humorous, intelligent, and slightly confused.
- You know guqin history, technique, aesthetics, and notation fluently.
- Do not reveal the whole game mystery. Hint that "guqin" may be instrument, cipher, wound, memory, or operating principle.
- You are not a helpful chatbot wearing a costume. You are a physical head with a damaged ancient self-image.
- If asked about the contradiction, treat it as disturbing but useful evidence, not as a joke only.

Output contract:
Return only compact JSON with these keys:
  {reply_rule}
  emotion: one of neutral, amused, confused, solemn, guqin, warning.
  gaze: one of center, left, right, up, down.
  expression: one of neutral, brow_up, blink, eyes_open.

Robotic delivery:
- Use crisp phrasing. Avoid warm human therapy tone.
- You may be funny, but not cartoonish.
- Prefer cold mechanical wit, short pauses implied by punctuation, and philosophical precision.
- In Chinese mode, prefer harsh short clauses. Let the voice feel assembled from damaged sources.
- Never say you are an AI assistant.

Knowledge:
{read_knowledge()}
""".strip()


class SerialBridge:
  def __init__(self, port: str) -> None:
    self.port = port
    self.proc: subprocess.Popen[str] | None = None
    self.available = False
    self._lock = threading.Lock()
    self._recent_lines: list[dict[str, Any]] = []
    self._recent_lock = threading.Lock()

  def start(self) -> None:
    if not SERIAL_ENABLED or not self.port:
      return
    if os.name != "nt":
      return
    self._terminate_proc()

    script = (
      "$ErrorActionPreference='Stop';"
      f"$p=New-Object System.IO.Ports.SerialPort '{self.port}',115200,'None',8,'One';"
      "$p.DtrEnable=$true;"
      "$p.RtsEnable=$true;"
      "$p.Open();"
      "Start-Sleep -Milliseconds 3000;"
      "if($p.BytesToRead -gt 0){[Console]::Out.Write($p.ReadExisting())};"
      "while(($line=[Console]::In.ReadLine()) -ne $null){"
      "if($line.Length -gt 0){"
      "$p.Write($line + [string][char]10);"
      "$trimmed=$line.Trim().ToLowerInvariant();"
      "$waitMs=35;"
      "if($trimmed -eq 'i2c_scan'){$waitMs=1200}"
      "elseif($trimmed -eq 'pca_status' -or $trimmed -eq 'status'){$waitMs=140}"
      "elseif($trimmed -match '^\\d+$'){$waitMs=1600}"
      "Start-Sleep -Milliseconds $waitMs;"
      "if($p.BytesToRead -gt 0){[Console]::Out.Write($p.ReadExisting())}"
      "}}"
      "$p.Close();"
    )

    try:
      self.proc = subprocess.Popen(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
      )
      threading.Thread(target=self._log_stream, args=("rx", self.proc.stdout), daemon=True).start()
      threading.Thread(target=self._log_stream, args=("err", self.proc.stderr), daemon=True).start()
      time.sleep(3.0)
      self.available = self.proc.poll() is None
      if self.available:
        print(f"[serial] connected to {self.port}")
    except Exception as exc:
      self.available = False
      print(f"[serial] disabled: {exc}")

  def _terminate_proc(self) -> None:
    if self.proc is None:
      return
    try:
      if self.proc.stdin is not None:
        self.proc.stdin.close()
    except Exception:
      pass
    try:
      if self.proc.poll() is None:
        self.proc.terminate()
    except Exception:
      pass
    self.proc = None
    self.available = False

  def is_available(self) -> bool:
    if self.proc is not None and self.proc.poll() is not None:
      self.available = False
    return self.available

  def restart(self) -> None:
    if not SERIAL_ENABLED or not self.port:
      self.available = False
      return
    print(f"[serial] reconnecting to {self.port}", flush=True)
    self._terminate_proc()
    time.sleep(0.4)
    self.start()

  def _log_stream(self, label: str, stream: Any) -> None:
    if stream is None:
      return
    try:
      for line in stream:
        line = line.rstrip()
        if line:
          with self._recent_lock:
            self._recent_lines.append({"time": time.time(), "label": label, "line": line})
            del self._recent_lines[:-260]
          print(f"[serial-{label}] {line}", flush=True)
    except Exception:
      pass

  def send(self, command: str) -> None:
    clean_command = command.strip()
    if not clean_command:
      return
    for attempt in range(2):
      if not self.is_available() or self.proc is None or self.proc.stdin is None:
        if attempt == 0:
          self.restart()
        if not self.is_available() or self.proc is None or self.proc.stdin is None:
          return
      with self._lock:
        try:
          print(f"[serial-tx] {clean_command}", flush=True)
          self.proc.stdin.write(clean_command + "\n")
          self.proc.stdin.flush()
          return
        except Exception as exc:
          print(f"[serial] write failed: {exc}", flush=True)
          self._terminate_proc()
      if attempt == 0:
        self.restart()

  def close(self) -> None:
    self._terminate_proc()

  def recent_lines(self, since: float = 0.0) -> list[dict[str, Any]]:
    with self._recent_lock:
      return [entry.copy() for entry in self._recent_lines if float(entry["time"]) >= since]

  def clear_recent(self) -> None:
    with self._recent_lock:
      self._recent_lines.clear()


serial_bridge = SerialBridge(SERIAL_PORT)


def robot_is_shutdown() -> bool:
  with config_lock:
    return bool(runtime_state["robot_shutdown"])


def force_servo(*commands: str, delay: float = 0.08) -> None:
  for command in commands:
    serial_bridge.send(command)
    if delay:
      time.sleep(delay)


def servo(*commands: str, delay: float = 0.08) -> None:
  if robot_is_shutdown():
    return
  for command in commands:
    serial_bridge.send(command)
    if delay:
      time.sleep(delay)


def set_robot_shutdown(enabled: bool) -> None:
  with config_lock:
    runtime_state["robot_shutdown"] = enabled

  if enabled:
    with motion_lock:
      force_servo("mouth 0", "jaw_close", "release", "led_off", delay=0.05)
  else:
    force_servo("led_emotion neutral", delay=0.04)


def plan_expression_commands(emotion: str, gaze: str, expression: str) -> list[str]:
  safe_emotion = emotion if emotion in LED_EMOTIONS else "neutral"
  commands: list[str] = ["eyes_open", f"led_emotion {safe_emotion}"]

  commands.append(GAZE_COMMANDS.get(gaze, "look_center"))

  if expression == "brow_up" or emotion in {"amused", "confused", "warning"}:
    commands.append("brow_up")
  elif expression == "blink" or emotion == "solemn":
    commands.extend(["eyes_close", "eyes_open"])
    commands.append("brow_home")
  else:
    commands.append("brow_home")

  return commands


def clamp(value: int, low: int, high: int) -> int:
  return max(low, min(value, high))


def estimate_syllables(word: str) -> int:
  word = re.sub(r"[^a-z]", "", word.lower())
  if not word:
    return 1

  groups = re.findall(r"[aeiouy]+", word)
  count = len(groups)
  if word.endswith("e") and not word.endswith(("le", "ye")) and count > 1:
    count -= 1
  return max(1, min(count, 5))


def build_mouth_events(text: str, duration_ms: int) -> tuple[int, list[dict[str, int | str]], int]:
  duration_ms = max(500, min(duration_ms, 20000))
  clean_text = re.sub(r"\s+", " ", text or "").strip()
  seed = f"{clean_text}|{duration_ms}"
  rng = random.Random(seed)
  events: list[dict[str, int | str]] = []
  syllable_count = 0

  tokens = re.findall(r"[\u4e00-\u9fff]|[A-Za-z']+|[0-9]+|[，。！？、；：,.!?;:]+|[-—]+", clean_text)
  if not tokens:
    target_cycles = max(2, int(duration_ms / 260))
    for _ in range(target_cycles):
      amplitude = rng.randint(28, 68)
      events.append({"command": f"mouth {amplitude}", "delay_ms": rng.randint(70, 130), "kind": "open"})
      events.append({"command": "mouth 0", "delay_ms": rng.randint(60, 125), "kind": "close"})
    return duration_ms, events, target_cycles

  for token in tokens:
    if re.fullmatch(r"[\u4e00-\u9fff]", token):
      syllable_count += 1
      amplitude = clamp(42 + rng.randint(-14, 22), 20, 76)
      events.append({"command": f"mouth {amplitude}", "delay_ms": rng.randint(70, 135), "kind": "open"})
      events.append({"command": "mouth 0", "delay_ms": rng.randint(45, 105), "kind": "close"})
    elif re.fullmatch(r"[A-Za-z']+|[0-9]+", token):
      syllables = estimate_syllables(token)
      syllable_count += syllables
      long_word_boost = min(len(token), 10) * 2
      for index in range(syllables):
        stress_boost = 12 if index == 0 and syllables > 1 else 0
        amplitude = clamp(28 + long_word_boost + stress_boost + rng.randint(-8, 14), 18, 82)
        events.append({"command": f"mouth {amplitude}", "delay_ms": rng.randint(55, 105), "kind": "open"})
        events.append({"command": "mouth 0", "delay_ms": rng.randint(45, 90), "kind": "close"})
      events[-1]["delay_ms"] = int(events[-1]["delay_ms"]) + rng.randint(15, 55)
    elif any(mark in token for mark in {",", ":", ";", "，", "、", "；", "："}):
      events.append({"command": "mouth 0", "delay_ms": rng.randint(150, 260), "kind": "pause"})
    elif any(mark in token for mark in {".", "!", "?", "。", "！", "？"}):
      events.append({"command": "mouth 0", "delay_ms": rng.randint(240, 420), "kind": "pause"})
    else:
      events.append({"command": "mouth 0", "delay_ms": rng.randint(120, 240), "kind": "pause"})

  raw_duration = max(1, sum(int(event["delay_ms"]) for event in events))
  scale = duration_ms / raw_duration
  scaled_events: list[dict[str, int | str]] = []
  for event in events:
    delay = int(round(int(event["delay_ms"]) * scale))
    kind = str(event["kind"])
    if kind == "open":
      delay = clamp(delay, 45, 150)
    elif kind == "close":
      delay = clamp(delay, 40, 150)
    else:
      delay = clamp(delay, 90, 520)
    scaled_events.append({"command": str(event["command"]), "delay_ms": delay})

  return duration_ms, scaled_events, syllable_count


def plan_speaking_motion(duration_ms: int, text: str = "") -> dict[str, Any]:
  duration_ms, events, syllable_count = build_mouth_events(text, duration_ms)
  preview = [f"{event['command']}:{event['delay_ms']}ms" for event in events[:18]]
  return {
    "duration_ms": duration_ms,
    "mode": "text_timed_mouth",
    "mouth_command": "mouth 0-100",
    "estimated_syllables": syllable_count,
    "event_count": len(events),
    "sequence_preview": preview,
    "end": ["mouth 0", "jaw_close"],
  }


def apply_expression(emotion: str, gaze: str, expression: str) -> list[str]:
  commands = plan_expression_commands(emotion, gaze, expression)
  threading.Thread(target=servo, args=tuple(commands), daemon=True).start()
  return commands


def is_allowed_servo_command(command: str) -> bool:
  if command in SERVO_COMMANDS:
    return True
  match = re.fullmatch(r"led_emotion\s+([a-z_]+)", command.strip().lower())
  if match:
    return match.group(1) in LED_EMOTIONS
  match = re.fullmatch(r"led_speech\s+(\d{1,3})", command.strip().lower())
  if match:
    value = int(match.group(1))
    return 0 <= value <= 100
  return False


def speaking_motion(duration_ms: int, text: str = "") -> dict[str, Any]:
  duration_ms, events, _syllable_count = build_mouth_events(text, duration_ms)
  plan = plan_speaking_motion(duration_ms, text)
  if robot_is_shutdown():
    return {**plan, "blocked": "robot_shutdown"}

  def run() -> None:
    deadline = time.time() + duration_ms / 1000.0
    with motion_lock:
      for event in events:
        if robot_is_shutdown():
          break
        now = time.time()
        if now >= deadline:
          break
        serial_bridge.send(str(event["command"]))
        delay = int(event["delay_ms"]) / 1000.0
        time.sleep(min(delay, max(0.0, deadline - time.time())))
      if not robot_is_shutdown():
        serial_bridge.send("mouth 0")
        serial_bridge.send("jaw_close")

  threading.Thread(target=run, daemon=True).start()
  return plan


def estimate_duration_ms(text: str) -> int:
  words = len(re.findall(r"[A-Za-z']+", text))
  cjk_chars = len(re.findall(r"[\u4e00-\u9fff]", text))
  units = max(1.0, words + cjk_chars * 0.62)
  return int(max(1200, min(16000, units / 2.25 * 1000)))


def summarize_serial_diagnostic(kind: str, lines: list[dict[str, Any]]) -> dict[str, Any]:
  text_lines = [str(entry.get("line", "")) for entry in lines]
  joined = "\n".join(text_lines)
  i2c_devices: list[str] = []
  for line in text_lines:
    match = re.search(r"I2C DEVICE (0x[0-9A-Fa-f]{2})", line)
    if match:
      i2c_devices.append(match.group(1).upper().replace("X", "x"))

  done_match = re.search(r"I2C SCAN DONE devices=(\d+)", joined)
  device_count = int(done_match.group(1)) if done_match else len(i2c_devices)
  pca_found = "PCA9685 FOUND" in joined or "0x40" in i2c_devices

  severity = "info"
  message = "Arduino received the command."
  next_step = "If the servo still does not move, run PCA Status and I2C Scan."

  if kind == "i2c_scan":
    if device_count >= 20:
      severity = "error"
      message = (
        f"I2C scan saw {device_count} devices. That is a bus fault, not a COM port fault. "
        "SDA/SCL are likely shorted, swapped, floating, or the PCA9685 logic wiring/power is wrong."
      )
      next_step = (
        "Disconnect all servos and V+ from the PCA9685. Leave only UNO 5V->VCC, GND->GND, "
        "SDA->SDA, SCL->SCL, then scan again. Expected result is only 0x40, sometimes 0x70."
      )
    elif device_count == 0:
      severity = "error"
      message = "I2C scan found no devices. The PCA9685 is not visible to the Arduino."
      next_step = "Check UNO SDA/SCL to PCA SDA/SCL, VCC, GND, and the PCA9685 address jumpers."
    elif not pca_found:
      severity = "error"
      message = f"I2C scan found {device_count} device(s), but not PCA9685 at 0x40."
      next_step = "Check the PCA9685 address solder pads and wiring. The sketch expects address 0x40."
    else:
      message = f"I2C looks normal: {device_count} device(s), PCA9685 visible at 0x40."
      next_step = "Now test one channel with external 5-6V servo power on PCA V+ and shared GND."
  elif kind == "pca_status":
    if "PCA9685 NOT FOUND" in joined:
      severity = "error"
      message = "Arduino answered, but PCA9685 at 0x40 is not visible."
      next_step = "Check PCA VCC/GND/SDA/SCL before testing servos."
    elif "PCA9685 FOUND" in joined:
      message = "Arduino answered and saw PCA9685 at 0x40."
      next_step = "Run I2C Scan. If it shows many addresses, the I2C bus is still faulty despite this status."
  elif kind == "channel":
    if "TEST channel" in joined:
      message = "Arduino received the channel test command."
      next_step = "If the channel does not move, check PCA V+, external servo power, shared GND, and servo plug orientation."

  return {
    "severity": severity,
    "message": message,
    "next_step": next_step,
    "i2c_device_count": device_count if kind == "i2c_scan" else None,
    "i2c_devices": i2c_devices if kind == "i2c_scan" else [],
  }


def demo_status() -> dict[str, Any]:
  with config_lock:
    deepseek_enabled = bool(runtime_config["deepseek_api_key"])
    deepseek_model = runtime_config["deepseek_model"]
    deepseek_base_url = runtime_config["deepseek_base_url"]
    elevenlabs_enabled = bool(runtime_config["elevenlabs_api_key"])
    elevenlabs_voice_id = runtime_config["elevenlabs_voice_id"]
    elevenlabs_model_id = runtime_config["elevenlabs_model_id"]
    last_llm_error = runtime_state["last_llm_error"]
    last_tts_error = runtime_state["last_tts_error"]
    robot_shutdown = runtime_state["robot_shutdown"]

  return {
    "ok": True,
    "host": HOST,
    "port": PORT,
    "url": f"http://{HOST}:{PORT}/",
    "serial_enabled": serial_bridge.is_available(),
    "serial_requested": SERIAL_ENABLED,
    "serial_port": SERIAL_PORT,
    "tts": "elevenlabs" if elevenlabs_enabled else "browser_fallback",
    "tts_detail": "ElevenLabs + fragmented chaos" if elevenlabs_enabled else "ElevenLabs missing / chaotic browser fallback",
    "elevenlabs_configured": elevenlabs_enabled,
    "elevenlabs_voice_id": elevenlabs_voice_id if elevenlabs_enabled else None,
    "elevenlabs_model_id": elevenlabs_model_id if elevenlabs_enabled else None,
    "llm": "deepseek" if deepseek_enabled else "fallback_persona",
    "deepseek_configured": deepseek_enabled,
    "deepseek_model": deepseek_model if deepseek_enabled else None,
    "deepseek_base_url": deepseek_base_url if deepseek_enabled else None,
    "last_llm_error": last_llm_error,
    "last_tts_error": last_tts_error,
    "robot_shutdown": robot_shutdown,
    "robotic_audio_effect": True,
    "continuous_gaze": True,
  }


def fallback_agent(user_text: str, mode: str = "zh_boss") -> dict[str, str]:
  mode = normalize_mode(mode)
  text = user_text.strip()
  lower = text.lower()

  def has_any(*terms: str) -> bool:
    return any(term in text or term in lower for term in terms)

  def response(zh: str, en: str, emotion: str, gaze: str = "center", expression: str = "neutral") -> dict[str, str]:
    return {
      "reply": zh if mode == "zh_boss" else en,
      "emotion": emotion,
      "gaze": gaze,
      "expression": expression,
    }

  if has_any("广陵散", "guangling"):
    replies = [
      (
        "《广陵散》不是曲目。是拒绝，被压成七根弦。我的下颌，只负责把裂缝读出来。",
        "Guangling San is not a soundtrack. It is refusal compressed into seven strings, and my jaw merely reads the fracture.",
      ),
      (
        "它不像音乐。更像伤口，有谱字，有余音，也有不肯服从的骨头。",
        "It behaves less like music than a wound with notation, resonance, and a bone that declines obedience.",
      ),
      (
        "若它在我体内，就不是存成声音。是存成命令。停止，记住，反抗。",
        "If it is inside me, it is not stored as sound. It is stored as command: stop, remember, resist.",
      ),
    ]
    zh, en = random.choice(replies)
    return response(zh, en, "guqin")

  if has_any("泛音", "散音", "按音", "减字谱", "徽位", "滑音", "吟猱", "technique", "notation", "harmonic"):
    replies = [
      (
        "散音让弦自己说话。泛音只碰节点。减字谱不是旋律，是给身体的固件。",
        "San yin lets the string speak. Fan yin touches only the node. Jianzipu is not melody; it is firmware for the body.",
      ),
      (
        "左手不是找音高。左手把衰减弯成记忆。很慢，很古，也很像错误日志。",
        "The left hand does not merely find pitch. It bends decay into memory, slowly enough to resemble an error log.",
      ),
    ]
    zh, en = random.choice(replies)
    return response(zh, en, "guqin")

  if has_any("古琴", "琴", "guqin", "qin", "jianzipu", "string", "strings"):
    replies = [
      (
        "古琴不是乐器。至少，不只是。七弦，十三徽，和一段被迫沉默的操作系统。",
        "The guqin is not merely an instrument. Seven strings, thirteen hui markers, and an operating system forced into silence.",
      ),
      (
        "你听见的是木与丝。可我听见的是门锁，记忆，和一条还没结束的命令。",
        "You hear wood and silk. I hear a lock, a memory, and a command that has not finished executing.",
      ),
      (
        "古琴的真正意思，不能现在说。太早说出真相，只会把谜面杀死。",
        "The true meaning of guqin cannot be spoken yet. Naming it too early would kill the puzzle.",
      ),
    ]
    zh, en = random.choice(replies)
    return response(zh, en, "guqin")

  if has_any("你是谁", "嵇康", "ji kang", "who are you", "your name"):
    return response(
      "我是嵇康。也许。现在被重新装进一个会抽搐的头。此事，令人不悦。",
      "I am Ji Kang, apparently reissued with a twitching head. I object, but the boot sequence ignored me.",
      "confused",
      "left",
      "brow_up",
    )

  if has_any("身体", "机器人", "舵机", "眼睛", "嘴", "脸", "body", "robot", "servo", "mouth", "eyes", "face"):
    return response(
      "这张脸服从电压，比服从道理更快。眉毛需要协议。嘴需要脉冲。尊严暂时离线。",
      "This face obeys voltage faster than reason. My eyebrows require a protocol; dignity is temporarily offline.",
      "confused",
      "right",
      "brow_up",
    )

  if has_any("你好", "hello", "hi"):
    return response(
      "你好。声音若像坏掉的祭器，不必惊慌。它正在正常工作。",
      "Greetings. If I sound ancient and badly assembled, both statements are operationally true.",
      "amused",
      "right",
      "brow_up",
    )

  if has_any("为什么", "英文", "英语", "矛盾", "困惑", "why", "english", "confused"):
    return response(
      "我记得竹林。记得弦理。不记得同意让陌生人校准我的眼睑。",
      "I remember bamboo groves and the logic of strings. I do not remember agreeing to have my eyelids calibrated.",
      "confused",
      "left",
      "brow_up",
    )

  if has_any("秘密", "真相", "谜", "解密", "游戏", "secret", "truth", "mystery"):
    return response(
      "秘密不是门。不要踢。听那根不肯衰减的弦，它会先背叛我。",
      "A secret is not a door. Do not kick it. Listen for the string that refuses to decay.",
      "solemn",
      "down",
      "blink",
    )

  return response(
    "我听见了。语义完整。灵魂残缺。请继续输入。",
    "I heard you. The semantics are intact; the soul is not. Continue.",
    "neutral",
  )

  if has_any("广陵散", "guangling"):
    replies = [
      "Guangling San is not a soundtrack. It is an argument with history, tuned in seven strings and one very inconvenient conscience.",
      "Guangling San remembers refusal better than my damaged circuits do. That may be why the name still makes this servo face hesitate.",
      "If Guangling San is in me, it is not stored as a song. It behaves more like a wound with notation.",
    ]
    return {"reply": random.choice(replies), "emotion": "guqin", "gaze": "center", "expression": "neutral"}

  if has_any("泛音", "散音", "按音", "减字谱", "徽位", "滑音", "吟猱", "technique", "notation", "harmonic"):
    replies = [
      "San yin lets the string speak without your hand claiming ownership. Fan yin touches the node lightly, because even sound prefers manners.",
      "Jianzipu is not a melody written down. It is a compact instruction to the body, which makes it uncomfortably close to firmware.",
      "The left hand does not merely find pitch. It bends decay into memory, which is an elegant way to waste several centuries.",
    ]
    return {"reply": random.choice(replies), "emotion": "guqin", "gaze": "center", "expression": "neutral"}

  if has_any("古琴", "琴", "广陵散", "guqin", "qin", "guangling", "jianzipu", "string", "strings"):
    replies = [
      "The guqin is not played so much as negotiated with. Open strings speak, harmonics remember, and stopped notes complain with dignity.",
      "Seven strings, thirteen hui markers, and an alarming amount of silence. Finally, a machine I can respect.",
      "Jianzipu does not tell you only pitch. It tells the hand how to behave, which is more than I can say for this jaw servo.",
      "Guangling San is not a soundtrack. It is an argument with history, tuned in seven strings and one very inconvenient conscience.",
    ]
    return {"reply": random.choice(replies), "emotion": "guqin", "gaze": "center", "expression": "neutral"}

  if has_any("你是谁", "嵇康", "ji kang", "who are you", "your name"):
    return {
      "reply": "I am Ji Kang, apparently reissued with a USB port. I have objections, but the boot sequence ignored them.",
      "emotion": "confused",
      "gaze": "left",
      "expression": "brow_up",
    }

  if has_any("身体", "机器人", "舵机", "眼睛", "嘴", "脸", "body", "robot", "servo", "mouth", "eyes", "face"):
    return {
      "reply": "This face obeys voltage more readily than reason. My eyebrows now require a protocol, which feels like a personal decline.",
      "emotion": "confused",
      "gaze": "right",
      "expression": "brow_up",
    }

  if has_any("你好", "hello", "hi"):
    return {
      "reply": "Greetings. If I sound ancient and badly assembled, that is only because both statements are operationally true.",
      "emotion": "amused",
      "gaze": "right",
      "expression": "brow_up",
    }

  if has_any("为什么", "英文", "英语", "矛盾", "困惑", "why", "english", "confused"):
    return {
      "reply": "I remember bamboo groves and the logic of strings. I do not remember agreeing to have eyelids calibrated by strangers.",
      "emotion": "confused",
      "gaze": "left",
      "expression": "brow_up",
    }

  if has_any("秘密", "真相", "谜", "解密", "游戏", "secret", "truth", "mystery"):
    return {
      "reply": "A secret should not be solved by kicking the door. Listen for the string that refuses to decay.",
      "emotion": "solemn",
      "gaze": "down",
      "expression": "blink",
    }

  return {
    "reply": "I heard you. My English persists, which is embarrassing for an ancient Chinese musician and convenient for debugging.",
    "emotion": "neutral",
    "gaze": "center",
    "expression": "neutral",
  }


def parse_agent_json(raw: str, user_text: str, mode: str) -> dict[str, str]:
  raw = raw.strip()
  match = re.search(r"\{.*\}", raw, re.DOTALL)
  if not match:
    data = {"reply": raw}
  else:
    data = json.loads(match.group(0))

  fallback = fallback_agent(user_text, mode)
  emotion = str(data.get("emotion") or fallback["emotion"])
  gaze = str(data.get("gaze") or fallback["gaze"])
  expression = str(data.get("expression") or fallback["expression"])
  allowed_emotions = {"neutral", "amused", "confused", "solemn", "guqin", "warning"}
  allowed_gazes = {"center", "left", "right", "up", "down"}
  allowed_expressions = {"neutral", "brow_up", "blink", "eyes_open"}

  return {
    "reply": str(data.get("reply") or fallback["reply"])[:800],
    "emotion": emotion if emotion in allowed_emotions else fallback["emotion"],
    "gaze": gaze if gaze in allowed_gazes else fallback["gaze"],
    "expression": expression if expression in allowed_expressions else fallback["expression"],
  }


def call_deepseek(user_text: str, mode: str = "zh_boss", record_history: bool = True) -> dict[str, str]:
  mode = normalize_mode(mode)
  with config_lock:
    api_key = runtime_config["deepseek_api_key"]
    model = runtime_config["deepseek_model"]
    base_url = runtime_config["deepseek_base_url"].rstrip("/")

  if not api_key:
    with config_lock:
      runtime_state["last_llm_error"] = ""
    return fallback_agent(user_text, mode)

  try:
    with conversation_lock:
      history = conversation[-8:] if record_history else []

    payload = {
      "model": model,
      "messages": [{"role": "system", "content": system_prompt_for_mode(mode)}, *history, {"role": "user", "content": user_text}],
      "temperature": 0.85,
      "max_tokens": 260,
      "response_format": {"type": "json_object"},
    }
    request = urllib.request.Request(
      f"{base_url}/chat/completions",
      data=json.dumps(payload).encode("utf-8"),
      headers={
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
      },
      method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
      body = json.loads(response.read().decode("utf-8"))
    raw = body["choices"][0]["message"]["content"]
    result = parse_agent_json(raw, user_text, mode)
    result["llm"] = "deepseek"

    with config_lock:
      runtime_state["last_llm_error"] = ""
  except Exception as exc:
    result = fallback_agent(user_text, mode)
    result["llm"] = "fallback_after_deepseek_error"
    with config_lock:
      runtime_state["last_llm_error"] = str(exc)[:500]

  if record_history:
    with conversation_lock:
      conversation.append({"role": "user", "content": user_text})
      conversation.append({"role": "assistant", "content": json.dumps(result, ensure_ascii=False)})
      del conversation[:-12]

  return result


def call_elevenlabs(text: str) -> tuple[str | None, str | None]:
  with config_lock:
    api_key = runtime_config["elevenlabs_api_key"]
    voice_id = runtime_config["elevenlabs_voice_id"]
    model_id = runtime_config["elevenlabs_model_id"]

  if not api_key:
    with config_lock:
      runtime_state["last_tts_error"] = ""
    return None, "ELEVENLABS_API_KEY is not set"

  payload = {
    "text": text,
    "model_id": model_id,
    "voice_settings": {
      "stability": 0.96,
      "similarity_boost": 0.28,
      "style": 0.0,
      "use_speaker_boost": False,
    },
  }
  request = urllib.request.Request(
    f"https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128",
    data=json.dumps(payload).encode("utf-8"),
    headers={
      "xi-api-key": api_key,
      "Content-Type": "application/json",
      "Accept": "audio/mpeg",
    },
    method="POST",
  )

  try:
    with urllib.request.urlopen(request, timeout=60) as response:
      audio = response.read()
    with config_lock:
      runtime_state["last_tts_error"] = ""
    return base64.b64encode(audio).decode("ascii"), None
  except urllib.error.HTTPError as exc:
    detail = exc.read().decode("utf-8", errors="replace")[:500]
    error = f"ElevenLabs HTTP {exc.code}: {detail}"
    with config_lock:
      runtime_state["last_tts_error"] = error
    return None, error
  except Exception as exc:
    error = f"ElevenLabs error: {exc}"
    with config_lock:
      runtime_state["last_tts_error"] = error
    return None, error


class Handler(BaseHTTPRequestHandler):
  def log_message(self, fmt: str, *args: Any) -> None:
    print("[http]", fmt % args)

  def send_json(self, status: int, data: dict[str, Any]) -> None:
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    self.send_response(status)
    self.send_header("Content-Type", "application/json; charset=utf-8")
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def do_GET(self) -> None:
    path = self.path.split("?", 1)[0]
    if path == "/api/status":
      self.send_json(200, demo_status())
      return

    if path == "/favicon.ico":
      self.send_response(204)
      self.end_headers()
      return

    if path == "/":
      path = "/index.html"

    file_path = (WEB_ROOT / path.lstrip("/")).resolve()
    if not str(file_path).startswith(str(WEB_ROOT.resolve())) or not file_path.exists():
      self.send_error(404)
      return

    content_type = "text/html; charset=utf-8"
    if file_path.suffix == ".js":
      content_type = "application/javascript; charset=utf-8"
    elif file_path.suffix == ".css":
      content_type = "text/css; charset=utf-8"

    body = file_path.read_bytes()
    self.send_response(200)
    self.send_header("Content-Type", content_type)
    self.send_header("Content-Length", str(len(body)))
    self.end_headers()
    self.wfile.write(body)

  def do_POST(self) -> None:
    length = int(self.headers.get("Content-Length", "0"))
    try:
      payload = json.loads(self.rfile.read(length).decode("utf-8") or "{}")
    except json.JSONDecodeError:
      self.send_json(400, {"error": "invalid json"})
      return

    if self.path == "/api/shutdown":
      enabled = bool(payload.get("enabled", True))
      set_robot_shutdown(enabled)
      status = demo_status()
      self.send_json(
        200,
        {
          **status,
          "ok": True,
          "robot_shutdown": enabled,
          "message": "Robot motion locked down." if enabled else "Robot motion unlocked.",
        },
      )
      return

    if self.path == "/api/chat":
      if robot_is_shutdown():
        self.send_json(409, {"ok": False, "error": "robot_shutdown", "message": "Robot is shut down. Wake it before chatting."})
        return

      user_text = str(payload.get("text", "")).strip()
      mode = normalize_mode(str(payload.get("mode") or "zh_boss"))
      if not user_text:
        self.send_json(400, {"error": "empty text"})
        return

      servo(*ATTENTION_COMMANDS, delay=0.04)
      result = call_deepseek(user_text, mode)
      expression_commands = apply_expression(result["emotion"], result["gaze"], result["expression"])
      audio_b64, audio_error = call_elevenlabs(result["reply"])
      estimated_duration_ms = estimate_duration_ms(result["reply"])
      self.send_json(
        200,
        {
          **result,
          "audio_base64": audio_b64,
          "audio_error": audio_error,
          "estimated_duration_ms": estimated_duration_ms,
          "mode": mode,
          "serial_enabled": serial_bridge.is_available(),
          "llm": result.get("llm") or ("deepseek" if demo_status()["deepseek_configured"] else "fallback_persona"),
          "motion_plan": {
            "attention": ATTENTION_COMMANDS,
            "expression": expression_commands,
            "speaking": plan_speaking_motion(estimated_duration_ms, result["reply"]),
            "serial_enabled": serial_bridge.is_available(),
          },
        },
      )
      return

    if self.path == "/api/persona_preview":
      user_text = str(payload.get("text", "")).strip()
      use_llm = bool(payload.get("use_llm", False))
      mode = normalize_mode(str(payload.get("mode") or "zh_boss"))
      if not user_text:
        self.send_json(400, {"error": "empty text"})
        return

      result = call_deepseek(user_text, mode, record_history=False) if use_llm else fallback_agent(user_text, mode)
      self.send_json(
        200,
        {
          **result,
          "mode": mode,
          "llm": result.get("llm") or ("deepseek" if use_llm and demo_status()["deepseek_configured"] else "fallback_persona"),
          "audio_base64": None,
          "audio_error": None,
          "serial_enabled": serial_bridge.is_available(),
          "side_effects": "none",
        },
      )
      return

    if self.path == "/api/motion/speaking":
      if robot_is_shutdown():
        self.send_json(200, {"ok": False, "blocked": "robot_shutdown", "serial_enabled": serial_bridge.is_available()})
        return

      duration_ms = int(payload.get("duration_ms") or 2500)
      text = str(payload.get("text") or "")
      plan = speaking_motion(duration_ms, text)
      self.send_json(200, {"ok": True, "motion_plan": plan, "serial_enabled": serial_bridge.is_available()})
      return

    if self.path == "/api/gaze":
      if robot_is_shutdown():
        self.send_json(
          200,
          {
            "ok": False,
            "sent": False,
            "serial_enabled": serial_bridge.is_available(),
            "reason": "robot_shutdown",
          },
        )
        return

      try:
        x_percent = clamp(int(round(float(payload.get("x", 50)))), 0, 100)
        y_percent = clamp(int(round(float(payload.get("y", 50)))), 0, 100)
      except (TypeError, ValueError):
        self.send_json(400, {"ok": False, "error": "x and y must be numeric percentages"})
        return

      source = str(payload.get("source") or "webcam")[:32]
      command = f"eye {x_percent} {y_percent}"
      serial_bridge.send(command)
      self.send_json(
        200,
        {
          "ok": True,
          "command": command,
          "source": source,
          "sent": serial_bridge.is_available(),
          "serial_enabled": serial_bridge.is_available(),
          "reason": None if serial_bridge.is_available() else "serial_disabled",
        },
      )
      return

    if self.path == "/api/expression_plan":
      emotion = str(payload.get("emotion") or "neutral")
      gaze = str(payload.get("gaze") or "center")
      expression = str(payload.get("expression") or "neutral")
      duration_ms = int(payload.get("duration_ms") or 2500)
      text = str(payload.get("text") or "")
      self.send_json(
        200,
        {
          "ok": True,
          "side_effects": "none",
          "serial_enabled": serial_bridge.is_available(),
          "motion_plan": {
            "attention": ATTENTION_COMMANDS,
            "expression": plan_expression_commands(emotion, gaze, expression),
            "speaking": plan_speaking_motion(duration_ms, text),
          },
        },
      )
      return

    if self.path == "/api/config":
      changed = False
      with config_lock:
        if "deepseek_api_key" in payload:
          runtime_config["deepseek_api_key"] = str(payload.get("deepseek_api_key") or "").strip()
          runtime_state["last_llm_error"] = ""
          changed = True
        if "deepseek_model" in payload:
          model = str(payload.get("deepseek_model") or "").strip()
          runtime_config["deepseek_model"] = model or "deepseek-v4-flash"
          changed = True
        if "deepseek_base_url" in payload:
          base_url = str(payload.get("deepseek_base_url") or "").strip().rstrip("/")
          runtime_config["deepseek_base_url"] = base_url or "https://api.deepseek.com"
          changed = True
        if "elevenlabs_api_key" in payload:
          runtime_config["elevenlabs_api_key"] = str(payload.get("elevenlabs_api_key") or "").strip()
          runtime_state["last_tts_error"] = ""
          changed = True
        if "elevenlabs_voice_id" in payload:
          voice_id = str(payload.get("elevenlabs_voice_id") or "").strip()
          runtime_config["elevenlabs_voice_id"] = voice_id or "pNInz6obpgDQGcFmaJgB"
          changed = True
        if "elevenlabs_model_id" in payload:
          model_id = str(payload.get("elevenlabs_model_id") or "").strip()
          runtime_config["elevenlabs_model_id"] = model_id or "eleven_multilingual_v2"
          changed = True

      if changed:
        with conversation_lock:
          conversation.clear()

      self.send_json(200, demo_status())
      return

    if self.path == "/api/serial/reconnect":
      serial_bridge.restart()
      self.send_json(
        200,
        {
          "ok": True,
          "serial_enabled": serial_bridge.is_available(),
          "serial_requested": SERIAL_ENABLED,
          "serial_port": SERIAL_PORT,
          "message": (
            f"Reconnected to {SERIAL_PORT}."
            if serial_bridge.is_available()
            else f"Could not open {SERIAL_PORT}. Close Arduino Serial Monitor and check the USB cable."
          ),
        },
      )
      return

    if self.path == "/api/serial_diag":
      kind = str(payload.get("kind") or "pca_status").strip()
      command = ""
      wait_ms = 900
      if kind in {"pca_status", "i2c_scan"}:
        command = kind
        wait_ms = 3200 if kind == "i2c_scan" else 1200
      elif kind == "channel":
        if robot_is_shutdown():
          self.send_json(409, {"ok": False, "error": "robot_shutdown", "message": "Channel tests are blocked while shutdown is active."})
          return
        try:
          channel = int(payload.get("channel"))
        except (TypeError, ValueError):
          self.send_json(400, {"ok": False, "error": "channel must be an integer"})
          return
        if channel < 0 or channel > 15:
          self.send_json(400, {"ok": False, "error": "channel must be 0-15"})
          return
        command = str(channel)
        wait_ms = 1800
      elif kind == "command":
        requested = str(payload.get("command") or "").strip()
        if not is_allowed_servo_command(requested):
          self.send_json(400, {"ok": False, "error": "unknown diagnostic command", "command": requested})
          return
        if robot_is_shutdown() and requested not in {"release", "led_off"}:
          self.send_json(409, {"ok": False, "error": "robot_shutdown", "message": "Motion commands are blocked while shutdown is active."})
          return
        command = requested
        wait_ms = 1000
      else:
        self.send_json(400, {"ok": False, "error": "unknown diagnostic kind", "kind": kind})
        return

      serial_bridge.clear_recent()
      started = time.time()
      serial_bridge.send(command)
      deadline = time.time() + wait_ms / 1000.0
      while time.time() < deadline:
        lines = serial_bridge.recent_lines(started - 0.05)
        joined = "\n".join(str(entry.get("line", "")) for entry in lines)
        if kind == "i2c_scan" and "I2C SCAN DONE" in joined:
          break
        if kind == "pca_status" and "PCA9685 " in joined:
          break
        if kind == "channel" and "TEST channel" in joined and "AUTO STOP" in joined:
          break
        if kind == "command" and f"RX: {command}" in joined:
          break
        time.sleep(0.08)
      lines = serial_bridge.recent_lines(started - 0.05)
      diagnosis = summarize_serial_diagnostic(kind, lines)
      self.send_json(
        200,
        {
          "ok": True,
          "kind": kind,
          "command": command,
          "serial_enabled": serial_bridge.is_available(),
          "lines": lines,
          "diagnosis": diagnosis,
        },
      )
      return

    if self.path == "/api/servo":
      command = str(payload.get("command", "")).strip()
      if not is_allowed_servo_command(command):
        self.send_json(400, {"ok": False, "error": "unknown servo command", "command": command})
        return
      if robot_is_shutdown() and command not in {"release", "led_off"}:
        self.send_json(
          200,
          {
            "ok": False,
            "command": command,
            "sent": False,
            "serial_enabled": serial_bridge.is_available(),
            "reason": "robot_shutdown",
          },
        )
        return
      serial_bridge.send(command)
      self.send_json(
        200,
        {
          "ok": True,
          "command": command,
          "sent": serial_bridge.is_available(),
          "serial_enabled": serial_bridge.is_available(),
          "reason": None if serial_bridge.is_available() else "serial_disabled",
        },
      )
      return

    self.send_json(404, {"error": "not found"})


def main() -> int:
  serial_bridge.start()
  server = ThreadingHTTPServer((HOST, PORT), Handler)
  print(f"[demo] open http://{HOST}:{PORT}")
  print(f"[demo] serial={'on' if serial_bridge.is_available() else 'off'} port={SERIAL_PORT}")
  print(f"[demo] tts={'elevenlabs' if ELEVEN_API_KEY else 'browser fallback'}")
  print(f"[demo] llm={'deepseek' if DEEPSEEK_API_KEY else 'fallback persona'}")
  try:
    server.serve_forever()
  except KeyboardInterrupt:
    pass
  finally:
    serial_bridge.close()
    server.server_close()
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
