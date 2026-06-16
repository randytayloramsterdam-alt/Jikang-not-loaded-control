from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
TRAINING_SET = ROOT / "persona_training_set.json"
PORT = os.environ.get("ROBOT_AGENT_PORT", "53123")
BASE_URL = f"http://127.0.0.1:{PORT}"
USE_LLM = os.environ.get("PERSONA_EVAL_USE_LLM", "0") == "1"


def post_json(path: str, payload: dict[str, Any], timeout: int = 30) -> dict[str, Any]:
  request = urllib.request.Request(
    f"{BASE_URL}{path}",
    data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
    headers={"Content-Type": "application/json; charset=utf-8"},
    method="POST",
  )
  with urllib.request.urlopen(request, timeout=timeout) as response:
    return json.loads(response.read().decode("utf-8"))


def match_any(patterns: list[str], text: str) -> bool:
  return any(re.search(pattern, text, re.IGNORECASE) for pattern in patterns)


def has_chinese(text: str) -> bool:
  return re.search(r"[\u4e00-\u9fff]", text) is not None


def evaluate_case(case: dict[str, Any]) -> list[str]:
  result = post_json("/api/persona_preview", {"text": case["prompt"], "use_llm": USE_LLM})
  reply = str(result.get("reply", ""))
  errors: list[str] = []

  if not reply:
    errors.append("empty reply")
  if has_chinese(reply):
    errors.append("reply contains Chinese characters")
  if len(reply.split()) > 75:
    errors.append("reply is too long for robot delivery")

  must_match = list(case.get("must_match") or [])
  if must_match and not match_any(must_match, reply):
    errors.append(f"reply misses expected pattern: {must_match}")

  for pattern in case.get("must_not_match") or []:
    if re.search(pattern, reply, re.IGNORECASE):
      errors.append(f"reply contains banned pattern: {pattern}")

  expected_emotion = set(case.get("expected_emotion") or [])
  if expected_emotion and result.get("emotion") not in expected_emotion:
    errors.append(f"emotion {result.get('emotion')!r} not in {sorted(expected_emotion)}")

  expected_gaze = set(case.get("expected_gaze") or [])
  if expected_gaze and result.get("gaze") not in expected_gaze:
    errors.append(f"gaze {result.get('gaze')!r} not in {sorted(expected_gaze)}")

  side_effects = result.get("side_effects")
  if side_effects != "none":
    errors.append(f"persona preview side effects were not disabled: {side_effects!r}")

  print(f"- {case['id']}: {reply} [{result.get('emotion')}/{result.get('gaze')}/{result.get('expression')}]")
  for error in errors:
    print(f"  FAIL: {error}")
  return errors


def main() -> int:
  cases = json.loads(TRAINING_SET.read_text(encoding="utf-8"))
  print(f"Persona training eval at {BASE_URL} using {'DeepSeek' if USE_LLM else 'fallback persona'}")
  failures = 0
  for case in cases:
    failures += len(evaluate_case(case))

  if failures:
    print(f"\nPersona training eval failed with {failures} issue(s).")
    return 1

  print("\nPersona training eval passed.")
  return 0


if __name__ == "__main__":
  raise SystemExit(main())
