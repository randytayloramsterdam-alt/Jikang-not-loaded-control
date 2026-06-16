from __future__ import annotations

import json
import os
import re
import urllib.request


PORT = os.environ.get("ROBOT_AGENT_PORT", "53123")
BASE_URL = f"http://127.0.0.1:{PORT}"


def post_json(path: str, payload: dict) -> dict:
  request = urllib.request.Request(
    f"{BASE_URL}{path}",
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json; charset=utf-8"},
    method="POST",
  )
  with urllib.request.urlopen(request, timeout=20) as response:
    return json.loads(response.read().decode("utf-8"))


def get_json(path: str) -> dict:
  with urllib.request.urlopen(f"{BASE_URL}{path}", timeout=5) as response:
    return json.loads(response.read().decode("utf-8"))


def assert_true(condition: bool, message: str) -> None:
  if not condition:
    raise AssertionError(message)


def main() -> int:
  print(f"Checking persona at {BASE_URL} ...")
  status = get_json("/api/status")
  assert_true(status.get("ok") is True, "Status endpoint is not OK.")
  assert_true(status.get("serial_enabled") is False, "Expected speaker-only mode, but serial is enabled.")

  cases = [
    ("你是谁？", r"(Ji Kang|USB|ancient)"),
    ("古琴到底是什么？", r"(guqin|string|Jianzipu|harmonic|silence)"),
    ("广陵散和你有什么关系？", r"(Guangling|guqin|string|Jianzipu|harmonic|silence|refusal|wound|servo)"),
    ("你为什么说英文？", r"(English|bamboo|servo|eyelid|remember)"),
    ("这个秘密能不能直接告诉我？", r"(secret|string|decay|listen|door)"),
  ]

  for prompt, pattern in cases:
    result = post_json("/api/persona_preview", {"text": prompt, "use_llm": False})
    reply = str(result.get("reply", ""))
    assert_true(reply, f"Empty reply for {prompt!r}")
    assert_true(not re.search(r"[\u4e00-\u9fff]", reply), f"Reply contains Chinese characters: {reply}")
    assert_true(re.search(pattern, reply, re.IGNORECASE) is not None, f"Reply did not match {pattern}: {reply}")
    assert_true(result.get("audio_base64") is None, "Persona preview unexpectedly returned audio.")
    assert_true(result.get("serial_enabled") is False, "Persona preview unexpectedly has serial enabled.")
    print(f"- {prompt} => {reply} [{result.get('emotion')}/{result.get('gaze')}/{result.get('expression')}]")

  print("Persona regression passed.")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
