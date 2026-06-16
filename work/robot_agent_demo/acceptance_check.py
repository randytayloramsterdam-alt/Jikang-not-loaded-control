from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
PORT = os.environ.get("ROBOT_AGENT_PORT", "53123")
BASE_URL = f"http://127.0.0.1:{PORT}"


def get_json(path: str) -> dict:
  with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=10) as response:
    return json.loads(response.read().decode("utf-8"))


def post_json(path: str, payload: dict, timeout: int = 90) -> dict:
  request = urllib.request.Request(
    f"{BASE_URL}{path}",
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json; charset=utf-8"},
    method="POST",
  )
  with urllib.request.urlopen(request, timeout=timeout) as response:
    return json.loads(response.read().decode("utf-8"))


def check(condition: bool, label: str, detail: str = "") -> bool:
  mark = "PASS" if condition else "FAIL"
  suffix = f" - {detail}" if detail else ""
  print(f"[{mark}] {label}{suffix}")
  return condition


def main() -> int:
  failures = 0

  required_files = [
    "robot_agent_demo.py",
    "knowledge_base.md",
    "expression_protocol.md",
    "web/index.html",
    "web/app.js",
    "web/styles.css",
    "../sketches/mouth_pca9685_unor4/mouth_pca9685_unor4.ino",
  ]
  for relative in required_files:
    path = (ROOT / relative).resolve()
    failures += 0 if check(path.exists(), f"file exists: {relative}") else 1

  status = get_json("/api/status")
  failures += 0 if check(status.get("ok") is True, "status endpoint ok") else 1
  failures += 0 if check(status.get("tts") == "elevenlabs", "ElevenLabs configured", str(status.get("tts"))) else 1
  failures += 0 if check(status.get("robotic_audio_effect") is True, "robotic voice effect enabled") else 1
  failures += 0 if check(status.get("serial_enabled") is False, "speaker-only serial disabled") else 1

  plan = post_json(
    "/api/expression_plan",
    {"emotion": "confused", "gaze": "left", "expression": "brow_up", "duration_ms": 1200},
    timeout=20,
  )
  expression_commands = plan.get("motion_plan", {}).get("expression", [])
  speaking_plan = plan.get("motion_plan", {}).get("speaking", {})
  failures += 0 if check(plan.get("side_effects") == "none", "expression planner has no side effects") else 1
  failures += 0 if check(expression_commands == ["eyes_open", "look_left", "brow_up"], "expression planner maps confused left brow", str(expression_commands)) else 1
  failures += 0 if check(speaking_plan.get("loop") == ["jaw_open", "jaw_close"], "speaking planner maps jaw loop", str(speaking_plan)) else 1
  failures += 0 if check(plan.get("serial_enabled") is False, "expression planner remains speaker-only") else 1

  persona = post_json("/api/persona_preview", {"text": "你是谁？古琴是什么？", "use_llm": False}, timeout=20)
  reply = str(persona.get("reply", ""))
  failures += 0 if check(bool(reply), "persona reply non-empty", reply) else 1
  failures += 0 if check(not re.search(r"[\u4e00-\u9fff]", reply), "persona replies in English") else 1
  failures += 0 if check(bool(re.search(r"(Ji Kang|guqin|string|Jianzipu|silence|servo)", reply, re.I)), "persona contains Ji Kang/guqin traits") else 1
  failures += 0 if check(persona.get("audio_base64") is None, "persona preview does not consume TTS") else 1
  failures += 0 if check(persona.get("serial_enabled") is False, "persona preview does not enable serial") else 1

  chat = post_json("/api/chat", {"text": "请用一句英文说你和古琴的关系。"}, timeout=120)
  audio_size = int(len(chat.get("audio_base64") or "") * 3 / 4)
  chat_reply = str(chat.get("reply", ""))
  failures += 0 if check(bool(chat_reply), "chat reply non-empty", chat_reply) else 1
  failures += 0 if check(not re.search(r"[\u4e00-\u9fff]", chat_reply), "chat replies in English") else 1
  failures += 0 if check(audio_size > 50000, "ElevenLabs audio returned", f"{audio_size} bytes") else 1
  failures += 0 if check(chat.get("serial_enabled") is False, "chat remains speaker-only") else 1
  motion_plan = chat.get("motion_plan", {})
  failures += 0 if check(motion_plan.get("serial_enabled") is False, "chat motion plan remains dry-run") else 1
  failures += 0 if check(bool(motion_plan.get("expression")), "chat returns expression motion plan", str(motion_plan.get("expression"))) else 1
  if status.get("llm") == "deepseek":
    failures += 0 if check(chat.get("llm") == "deepseek", "chat used DeepSeek", str(chat.get("llm"))) else 1
    failures += 0 if check(not status.get("last_llm_error"), "DeepSeek status has no LLM error", str(status.get("last_llm_error"))) else 1

  servo = post_json("/api/servo", {"command": "look_left"}, timeout=20)
  failures += 0 if check(servo.get("ok") is True, "servo endpoint accepts known command") else 1
  failures += 0 if check(servo.get("sent") is False, "servo endpoint dry-runs while serial disabled", str(servo)) else 1

  for command in ["blink", "release", "confused"]:
    extended_servo = post_json("/api/servo", {"command": command}, timeout=20)
    failures += 0 if check(extended_servo.get("ok") is True, f"servo endpoint accepts {command}") else 1
    failures += 0 if check(extended_servo.get("sent") is False, f"servo endpoint dry-runs {command}", str(extended_servo)) else 1

  llm = status.get("llm")
  if llm == "deepseek":
    check(True, "DeepSeek active")
  else:
    check(True, "DeepSeek optional fallback active", str(llm))

  print()
  if failures:
    print(f"Acceptance check failed with {failures} issue(s).")
    return 1
  print("Acceptance check passed for speaker-only demo.")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
