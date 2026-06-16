from __future__ import annotations

import json
import os
import re
import sys
import urllib.request


PORT = os.environ.get("ROBOT_AGENT_PORT", "53123")
BASE_URL = f"http://127.0.0.1:{PORT}"


def post_json(path: str, payload: dict, timeout: int = 60) -> dict:
  request = urllib.request.Request(
    f"{BASE_URL}{path}",
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json; charset=utf-8"},
    method="POST",
  )
  with urllib.request.urlopen(request, timeout=timeout) as response:
    return json.loads(response.read().decode("utf-8"))


def get_json(path: str, timeout: int = 10) -> dict:
  with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=timeout) as response:
    return json.loads(response.read().decode("utf-8"))


def check(condition: bool, label: str, detail: str = "") -> bool:
  mark = "PASS" if condition else "FAIL"
  suffix = f" - {detail}" if detail else ""
  print(f"[{mark}] {label}{suffix}")
  return condition


def main() -> int:
  api_key = os.environ.get("DEEPSEEK_API_KEY", "").strip()
  model = os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash").strip()
  base_url = os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com").strip()

  if not api_key:
    print("SKIP: DEEPSEEK_API_KEY is not set in this process.")
    return 0

  failures = 0
  print(f"Configuring DeepSeek runtime at {BASE_URL} with model {model!r}.")
  post_json(
    "/api/config",
    {
      "deepseek_api_key": api_key,
      "deepseek_model": model,
      "deepseek_base_url": base_url,
    },
    timeout=20,
  )

  try:
    status = get_json("/api/status")
    failures += 0 if check(status.get("deepseek_configured") is True, "DeepSeek configured in server memory") else 1
    failures += 0 if check(status.get("llm") == "deepseek", "status reports DeepSeek", str(status.get("llm"))) else 1
    failures += 0 if check(status.get("serial_enabled") is False, "DeepSeek test keeps serial disabled") else 1

    result = post_json(
      "/api/persona_preview",
      {"text": "你是谁？请用英文说一句古琴和你的关系。", "use_llm": True},
      timeout=80,
    )
    reply = str(result.get("reply", ""))
    failures += 0 if check(result.get("llm") == "deepseek", "persona preview used DeepSeek", str(result.get("llm"))) else 1
    failures += 0 if check(bool(reply), "DeepSeek reply non-empty", reply) else 1
    failures += 0 if check(re.search(r"[\u4e00-\u9fff]", reply) is None, "DeepSeek reply is English") else 1
    failures += 0 if check(result.get("audio_base64") is None, "DeepSeek preview does not consume TTS") else 1
    failures += 0 if check(result.get("serial_enabled") is False, "DeepSeek preview does not enable serial") else 1
    failures += 0 if check(result.get("side_effects") == "none", "DeepSeek preview has no side effects") else 1

    if failures:
      print(f"DeepSeek runtime verification failed with {failures} issue(s).")
      return 1

    print("DeepSeek runtime verification passed.")
    return 0
  finally:
    post_json("/api/config", {"deepseek_api_key": ""}, timeout=20)


if __name__ == "__main__":
  raise SystemExit(main())
