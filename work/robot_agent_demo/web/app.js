const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const listenBtn = document.getElementById("listenBtn");
const stopBtn = document.getElementById("stopBtn");
const micCheckBtn = document.getElementById("micCheckBtn");
const cameraStartBtn = document.getElementById("cameraStartBtn");
const cameraCheckBtn = document.getElementById("cameraCheckBtn");
const cameraStopBtn = document.getElementById("cameraStopBtn");
const blinkToggleBtn = document.getElementById("blinkToggleBtn");
const speakerTestBtn = document.getElementById("speakerTestBtn");
const sendBtn = document.getElementById("sendBtn");
const selfTestBtn = document.getElementById("selfTestBtn");
const shutdownBtn = document.getElementById("shutdownBtn");
const textInput = document.getElementById("textInput");
const llmStatus = document.getElementById("llmStatus");
const ttsStatus = document.getElementById("ttsStatus");
const serialStatus = document.getElementById("serialStatus");
const fxStatus = document.getElementById("fxStatus");
const eyeTrackStatus = document.getElementById("eyeTrackStatus");
const portDot = document.getElementById("portDot");
const portName = document.getElementById("portName");
const portState = document.getElementById("portState");
const portRequested = document.getElementById("portRequested");
const portBridge = document.getElementById("portBridge");
const portGaze = document.getElementById("portGaze");
const portUpdated = document.getElementById("portUpdated");
const portMessage = document.getElementById("portMessage");
const refreshPortBtn = document.getElementById("refreshPortBtn");
const reconnectPortBtn = document.getElementById("reconnectPortBtn");
const portPingBtn = document.getElementById("portPingBtn");
const errorPanel = document.getElementById("errorPanel");
const errorText = document.getElementById("errorText");
const deepseekKey = document.getElementById("deepseekKey");
const deepseekModel = document.getElementById("deepseekModel");
const deepseekBaseUrl = document.getElementById("deepseekBaseUrl");
const applyConfigBtn = document.getElementById("applyConfigBtn");
const testDeepseekBtn = document.getElementById("testDeepseekBtn");
const clearConfigBtn = document.getElementById("clearConfigBtn");
const elevenlabsKey = document.getElementById("elevenlabsKey");
const elevenlabsVoiceId = document.getElementById("elevenlabsVoiceId");
const elevenlabsModelId = document.getElementById("elevenlabsModelId");
const applyVoiceConfigBtn = document.getElementById("applyVoiceConfigBtn");
const clearVoiceConfigBtn = document.getElementById("clearVoiceConfigBtn");
const voiceModeButtons = document.querySelectorAll("[data-voice-mode]");
const robotHead = document.getElementById("robotHead");
const faceEmotion = document.getElementById("faceEmotion");
const faceGaze = document.getElementById("faceGaze");
const faceExpression = document.getElementById("faceExpression");
const servoPlan = document.getElementById("servoPlan");
const trackingVideo = document.getElementById("trackingVideo");
const trackingCanvas = document.getElementById("trackingCanvas");
const trackingDot = document.getElementById("trackingDot");
const trackingMode = document.getElementById("trackingMode");
const invertEyeX = document.getElementById("invertEyeX");
const invertEyeY = document.getElementById("invertEyeY");
const trackingReadout = document.getElementById("trackingReadout");
const servoDiagLog = document.getElementById("servoDiagLog");

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

let recognition = null;
let voiceMode = localStorage.getItem("robotVoiceMode") || "zh_boss";
let faceState = {
  emotion: "neutral",
  gaze: "center",
  expression: "neutral",
  listening: false,
  thinking: false,
  speaking: false,
};
let speakingTimer = null;
let blinkTimer = null;
let naturalBlinkTimer = null;
let blinkInFlight = false;
let autoBlinkEnabled = localStorage.getItem("robotAutoBlink") !== "0";
let faceMesh = null;
let cameraStream = null;
let trackingActive = false;
let trackingLoopBusy = false;
let trackingRaf = null;
let gazeSendInFlight = false;
let lastGazeSendAt = 0;
let lastGazeSent = { x: 50, y: 50 };
let smoothedGaze = { x: 50, y: 50 };
let robotShutdown = false;
const activeAudioElements = new Set();
const activeAudioContexts = new Set();

function setStatus(text) {
  statusEl.textContent = text;
}

function setServoPlan(commands) {
  if (!servoPlan) return;
  if (!commands || !commands.length) {
    servoPlan.textContent = "idle";
    return;
  }
  servoPlan.textContent = commands.join(" > ");
}

function updateShutdownUi() {
  document.body.classList.toggle("shutdown", robotShutdown);
  if (shutdownBtn) {
    shutdownBtn.textContent = robotShutdown ? "Wake Robot" : "Shutdown Robot";
    shutdownBtn.classList.toggle("active", robotShutdown);
  }
  if (robotShutdown) {
    setStatus("Shutdown / motion locked");
    setServoPlan(["release", "led_off"]);
  }
}

function registerAudioElement(audio) {
  activeAudioElements.add(audio);
  const remove = () => activeAudioElements.delete(audio);
  audio.addEventListener("ended", remove, { once: true });
  audio.addEventListener("pause", remove, { once: true });
  return audio;
}

function registerAudioContext(ctx) {
  activeAudioContexts.add(ctx);
  return ctx;
}

function stopAllAudio() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  activeAudioElements.forEach((audio) => {
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (error) {
      console.warn("Audio stop failed.", error);
    }
  });
  activeAudioElements.clear();
  activeAudioContexts.forEach((ctx) => {
    try {
      if (ctx.state !== "closed") ctx.close();
    } catch (error) {
      console.warn("Audio context close failed.", error);
    }
  });
  activeAudioContexts.clear();
}

function haltLocalMotion() {
  autoBlinkEnabled = false;
  localStorage.setItem("robotAutoBlink", "0");
  updateAutoBlinkButton();
  if (naturalBlinkTimer) clearTimeout(naturalBlinkTimer);
  naturalBlinkTimer = null;
  if (blinkTimer) clearTimeout(blinkTimer);
  blinkTimer = null;
  if (speakingTimer) clearTimeout(speakingTimer);
  speakingTimer = null;
  blinkInFlight = false;
  stopAllAudio();
  if (recognition) {
    try {
      recognition.stop();
    } catch (error) {
      console.warn("Recognition stop failed.", error);
    }
  }
  stopEyeTracking({ skipGazeCenter: true });
  setFaceState({
    emotion: "neutral",
    gaze: "center",
    expression: "neutral",
    listening: false,
    thinking: false,
    speaking: false,
  });
  clearRobotEyePreview();
}

async function setRobotShutdown(enabled) {
  robotShutdown = enabled;
  if (enabled) {
    haltLocalMotion();
    updateShutdownUi();
  }
  const result = await postJson("/api/shutdown", { enabled });
  robotShutdown = Boolean(result.robot_shutdown);
  if (!robotShutdown) {
    autoBlinkEnabled = localStorage.getItem("robotAutoBlink") !== "0";
    setFaceState({ emotion: "neutral", gaze: "center", expression: "eyes_open" });
  }
  updateAutoBlinkButton();
  updateShutdownUi();
  await refreshStatus({ silent: true });
  setStatus(robotShutdown ? "Shutdown / motion locked" : "Ready / serial online");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeVoiceMode(mode) {
  return mode === "en_classic" || mode === "clear" || mode === "english"
    ? "en_classic"
    : "zh_boss";
}

function isChineseBossMode() {
  return voiceMode === "zh_boss";
}

function normalize(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function setFaceState(nextState = {}) {
  faceState = { ...faceState, ...nextState };
  faceState.emotion = normalize(
    faceState.emotion,
    ["neutral", "amused", "confused", "solemn", "guqin", "warning"],
    "neutral"
  );
  faceState.gaze = normalize(
    faceState.gaze,
    ["center", "left", "right", "up", "down"],
    "center"
  );
  faceState.expression = normalize(
    faceState.expression,
    ["neutral", "brow_up", "blink", "eyes_open"],
    "neutral"
  );

  if (robotHead) {
    const classes = [
      "robot-head",
      `emotion-${faceState.emotion}`,
      `gaze-${faceState.gaze}`,
      `expression-${faceState.expression}`,
    ];
    if (faceState.listening) classes.push("listening");
    if (faceState.thinking) classes.push("thinking");
    if (faceState.speaking) classes.push("speaking");
    robotHead.className = classes.join(" ");
  }

  if (faceEmotion) faceEmotion.textContent = faceState.emotion;
  if (faceGaze) faceGaze.textContent = faceState.gaze;
  if (faceExpression) faceExpression.textContent = faceState.expression;

  if (nextState.expression === "blink") {
    if (blinkTimer) clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      setFaceState({ expression: "neutral" });
      blinkTimer = null;
    }, 360);
  }

  if (
    Object.prototype.hasOwnProperty.call(nextState, "speaking") ||
    Object.prototype.hasOwnProperty.call(nextState, "listening") ||
    Object.prototype.hasOwnProperty.call(nextState, "thinking")
  ) {
    scheduleNaturalBlink();
  }
}

function startFaceSpeaking(durationMs) {
  if (robotShutdown) return Promise.resolve();
  const safeDuration = Math.max(500, Math.min(durationMs || 2500, 20000));
  if (speakingTimer) clearTimeout(speakingTimer);
  setFaceState({ speaking: true, listening: false, thinking: false });
  speakingTimer = setTimeout(() => {
    setFaceState({ speaking: false });
    speakingTimer = null;
  }, safeDuration);
  return sleep(safeDuration);
}

function previewServoCommand(command) {
  const map = {
    home: { emotion: "neutral", gaze: "center", expression: "neutral" },
    look_left: { gaze: "left" },
    look_right: { gaze: "right" },
    look_up: { gaze: "up" },
    look_down: { gaze: "down" },
    eyes_close: { expression: "blink" },
    eyes_open: { expression: "eyes_open" },
    blink: { expression: "blink" },
    brow_up: { expression: "brow_up", emotion: "confused" },
    brow_home: { expression: "neutral", emotion: "neutral" },
    jaw_open: { speaking: true },
    jaw_close: { speaking: false },
    release: { speaking: false },
    listen: { emotion: "neutral", gaze: "center", expression: "eyes_open" },
    think: { emotion: "confused", gaze: "left", expression: "brow_up" },
    confused: { emotion: "confused", gaze: "left", expression: "brow_up" },
    amused: { emotion: "amused", gaze: "right", expression: "brow_up" },
    solemn: { emotion: "solemn", gaze: "down", expression: "blink" },
    guqin: { emotion: "guqin", gaze: "center", expression: "neutral" },
    warning: { emotion: "warning", gaze: "center", expression: "brow_up" },
  };
  setFaceState(map[command] || {});
}

function addMessage(kind, text, meta = "") {
  const item = document.createElement("div");
  item.className = `message ${kind}`;

  const metaEl = document.createElement("div");
  metaEl.className = "meta";
  metaEl.textContent = meta || (kind === "user" ? "You" : "Ji Kang");

  const body = document.createElement("div");
  body.textContent = text;

  item.append(metaEl, body);
  messagesEl.prepend(item);
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status}: ${text}`);
  }

  return response.json();
}

function setEyeTrackStatus(text) {
  if (eyeTrackStatus) eyeTrackStatus.textContent = text;
}

function formatLocalTime(date = new Date()) {
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function renderPortStatus(data, error = null) {
  if (!portName || !portState) return;

  if (error) {
    portName.textContent = "backend unreachable";
    portState.textContent = "offline";
    portRequested.textContent = "unknown";
    portBridge.textContent = "lost";
    portGaze.textContent = "unknown";
    portUpdated.textContent = formatLocalTime();
    portMessage.textContent = `Cannot read /api/status: ${error.message || error}`;
    portDot.className = "port-dot offline";
    return;
  }

  const requested = Boolean(data.serial_requested);
  const online = Boolean(data.serial_enabled);
  const port = data.serial_port || "not set";
  const gaze = Boolean(data.continuous_gaze);

  portName.textContent = port;
  portState.textContent = online ? "online" : requested ? "requested / not open" : "disabled";
  portRequested.textContent = requested ? "yes" : "no";
  portBridge.textContent = online ? "connected" : "not connected";
  portGaze.textContent = gaze ? "enabled" : "legacy only";
  portUpdated.textContent = formatLocalTime();
  portDot.className = `port-dot ${online ? "online" : requested ? "warning" : "offline"}`;

  if (online) {
    portMessage.textContent = `Serial bridge is open on ${port}. If all servos still do not move, the fault is after Arduino: PCA9685 I2C wiring, servo V+, shared GND, or servo plug orientation.`;
  } else if (requested) {
    portMessage.textContent = `Backend wants ${port}, but the serial bridge is not open. Close Arduino Serial Monitor, check USB, then reconnect.`;
  } else {
    portMessage.textContent = "Real serial control is disabled. The page can speak and preview motion, but it will not move servos.";
  }
}

function updateAutoBlinkButton() {
  if (!blinkToggleBtn) return;
  blinkToggleBtn.textContent = autoBlinkEnabled ? "Auto Blink On" : "Auto Blink Off";
  blinkToggleBtn.classList.toggle("active", autoBlinkEnabled);
}

function nextNaturalBlinkDelay() {
  const randomCurve = Math.pow(Math.random(), 1.7);
  let low = 2800;
  let high = 9200;
  if (faceState.speaking) {
    low = 1200;
    high = 5200;
  } else if (faceState.listening) {
    low = 1800;
    high = 6200;
  } else if (faceState.thinking) {
    low = 4200;
    high = 11000;
  }
  return Math.round(low + (high - low) * randomCurve);
}

function scheduleNaturalBlink() {
  if (naturalBlinkTimer) {
    clearTimeout(naturalBlinkTimer);
    naturalBlinkTimer = null;
  }
  if (!autoBlinkEnabled) return;
  naturalBlinkTimer = setTimeout(() => {
    runNaturalBlink();
  }, nextNaturalBlinkDelay());
}

async function runNaturalBlink() {
  if (robotShutdown) return;
  try {
    await sendNaturalBlink();
  } finally {
    scheduleNaturalBlink();
  }
}

async function sendNaturalBlink() {
  if (robotShutdown) return;
  if (blinkInFlight) return;
  blinkInFlight = true;
  const previousExpression = faceState.expression === "blink" ? "neutral" : faceState.expression;

  try {
    setFaceState({ expression: "blink" });
    await postJson("/api/servo", { command: "blink" });

    const doubleBlinkChance = faceState.speaking ? 0.05 : faceState.listening ? 0.1 : 0.14;
    if (Math.random() < doubleBlinkChance) {
      await sleep(150 + Math.random() * 160);
      setFaceState({ expression: "blink" });
      await postJson("/api/servo", { command: "blink" });
    }
  } catch (error) {
    console.warn("Natural blink failed.", error);
  } finally {
    setTimeout(() => {
      if (faceState.expression === "blink") {
        setFaceState({ expression: previousExpression });
      }
      blinkInFlight = false;
    }, 260);
  }
}

function pointAverage(landmarks, indices) {
  const points = indices.map((index) => landmarks[index]).filter(Boolean);
  if (!points.length) return null;
  const sum = points.reduce(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
    }),
    { x: 0, y: 0 }
  );
  return { x: sum.x / points.length, y: sum.y / points.length };
}

function estimateFaceTarget(landmarks) {
  const eyes = pointAverage(landmarks, [33, 133, 362, 263]);
  const nose = landmarks[1] || eyes;
  if (!nose) return null;

  return {
    x: 0.5 + (nose.x - 0.5) * 1.35,
    y: eyes ? 0.5 + (eyes.y - 0.42) * 1.55 : 0.5 + (nose.y - 0.5) * 1.25,
    source: "face",
  };
}

function estimateEyeRatio(landmarks, cornerA, cornerB, topIndex, bottomIndex, irisIndices) {
  const a = landmarks[cornerA];
  const b = landmarks[cornerB];
  const top = landmarks[topIndex];
  const bottom = landmarks[bottomIndex];
  const iris = pointAverage(landmarks, irisIndices);
  if (!a || !b || !top || !bottom || !iris) return null;

  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(top.y, bottom.y);
  const maxY = Math.max(top.y, bottom.y);
  if (maxX - minX < 0.01 || maxY - minY < 0.004) return null;

  return {
    x: (iris.x - minX) / (maxX - minX),
    y: (iris.y - minY) / (maxY - minY),
  };
}

function estimateIrisTarget(landmarks) {
  if (!landmarks || landmarks.length < 478) return null;

  const left = estimateEyeRatio(landmarks, 33, 133, 159, 145, [468, 469, 470, 471, 472]);
  const right = estimateEyeRatio(landmarks, 362, 263, 386, 374, [473, 474, 475, 476, 477]);
  const ratios = [left, right].filter(Boolean);
  if (!ratios.length) return null;

  const gaze = ratios.reduce(
    (acc, ratio) => ({
      x: acc.x + ratio.x,
      y: acc.y + ratio.y,
    }),
    { x: 0, y: 0 }
  );
  gaze.x /= ratios.length;
  gaze.y /= ratios.length;

  return {
    x: 0.5 + (gaze.x - 0.5) * 1.85,
    y: 0.5 + (gaze.y - 0.5) * 1.55,
    source: "iris",
  };
}

function targetToServoPercent(target) {
  let x = clampNumber(50 + (target.x - 0.5) * 100, 0, 100);
  let y = clampNumber(50 + (target.y - 0.5) * 100, 0, 100);

  if (invertEyeX && invertEyeX.checked) x = 100 - x;
  if (invertEyeY && invertEyeY.checked) y = 100 - y;

  return {
    x: Math.round(x),
    y: Math.round(y),
  };
}

function updateRobotEyePreview(xPercent, yPercent) {
  if (!robotHead) return;
  const xPx = ((xPercent - 50) / 50) * 14;
  const yPx = ((yPercent - 50) / 50) * 10;
  robotHead.style.setProperty("--eye-x", `${xPx.toFixed(1)}px`);
  robotHead.style.setProperty("--eye-y", `${yPx.toFixed(1)}px`);
  if (faceGaze) faceGaze.textContent = `track ${xPercent},${yPercent}`;
}

function clearRobotEyePreview() {
  if (!robotHead) return;
  robotHead.style.removeProperty("--eye-x");
  robotHead.style.removeProperty("--eye-y");
  if (faceGaze) faceGaze.textContent = faceState.gaze;
}

function drawTrackingResults(results, target) {
  if (!trackingCanvas) return;
  const ctx = trackingCanvas.getContext("2d");
  if (!ctx) return;
  const width = trackingCanvas.width;
  const height = trackingCanvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(211, 179, 106, 0.45)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.moveTo(0, height / 2);
  ctx.lineTo(width, height / 2);
  ctx.stroke();

  const landmarks = results.multiFaceLandmarks?.[0];
  if (landmarks) {
    ctx.fillStyle = "rgba(232, 236, 239, 0.7)";
    for (const index of [33, 133, 159, 145, 362, 263, 386, 374, 468, 473]) {
      const point = landmarks[index];
      if (!point) continue;
      ctx.beginPath();
      ctx.arc(width - point.x * width, point.y * height, 2.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (target) {
    ctx.fillStyle = "#d3b36a";
    ctx.beginPath();
    ctx.arc(width - target.x * width, target.y * height, 5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function updateTrackingDot(target) {
  if (!trackingDot || !target) return;
  trackingDot.style.left = `${clampNumber((1 - target.x) * 100, 0, 100)}%`;
  trackingDot.style.top = `${clampNumber(target.y * 100, 0, 100)}%`;
}

async function sendContinuousGaze(x, y, source) {
  if (robotShutdown) return;
  const now = performance.now();
  const moved = Math.abs(x - lastGazeSent.x) + Math.abs(y - lastGazeSent.y);
  if (gazeSendInFlight || (now - lastGazeSendAt < 120 && moved < 8)) return;
  if (moved < 3 && now - lastGazeSendAt < 650) return;

  gazeSendInFlight = true;
  lastGazeSendAt = now;
  lastGazeSent = { x, y };
  try {
    const result = await postJson("/api/gaze", { x, y, source });
    setEyeTrackStatus(result.sent ? `on ${x},${y}` : "serial off");
  } catch (error) {
    console.warn("Gaze send failed.", error);
    await sendDiscreteGazeFallback(x, y);
  } finally {
    gazeSendInFlight = false;
  }
}

async function sendDiscreteGazeFallback(x, y) {
  if (robotShutdown) return;
  let command = "look_center";
  const dx = x - 50;
  const dy = y - 50;
  if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 18) {
    command = dx < 0 ? "look_left" : "look_right";
  } else if (Math.abs(dy) > 16) {
    command = dy < 0 ? "look_up" : "look_down";
  }

  try {
    await postJson("/api/servo", { command });
    setEyeTrackStatus(`fallback ${command}`);
  } catch (fallbackError) {
    console.warn("Discrete gaze fallback failed.", fallbackError);
    setEyeTrackStatus("send error");
  }
}

function handleTrackingResults(results) {
  if (!trackingActive) return;
  const landmarks = results.multiFaceLandmarks?.[0];
  if (!landmarks) {
    drawTrackingResults(results, null);
    if (trackingReadout) trackingReadout.textContent = "No face detected.";
    setEyeTrackStatus("no face");
    return;
  }

  const mode = trackingMode ? trackingMode.value : "face";
  const irisTarget = mode === "iris" ? estimateIrisTarget(landmarks) : null;
  const target = irisTarget || estimateFaceTarget(landmarks);
  if (!target) return;

  target.x = clampNumber(target.x, 0.05, 0.95);
  target.y = clampNumber(target.y, 0.05, 0.95);
  const servoTarget = targetToServoPercent(target);
  const smoothing = faceState.speaking ? 0.18 : 0.28;
  smoothedGaze.x += (servoTarget.x - smoothedGaze.x) * smoothing;
  smoothedGaze.y += (servoTarget.y - smoothedGaze.y) * smoothing;
  const x = Math.round(smoothedGaze.x);
  const y = Math.round(smoothedGaze.y);

  updateRobotEyePreview(x, y);
  updateTrackingDot(target);
  drawTrackingResults(results, target);
  if (trackingReadout) {
    trackingReadout.textContent = `${target.source}: eye ${x}, ${y}. ${irisTarget ? "Iris landmarks active." : "Using face position fallback."}`;
  }
  sendContinuousGaze(x, y, `webcam_${target.source}`);
}

async function ensureFaceMesh() {
  if (faceMesh) return faceMesh;
  if (!window.FaceMesh) {
    throw new Error("MediaPipe FaceMesh failed to load. Check internet access or CDN blocking.");
  }

  faceMesh = new window.FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh@0.4/${file}`,
  });
  faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.55,
    minTrackingConfidence: 0.55,
  });
  faceMesh.onResults(handleTrackingResults);
  return faceMesh;
}

function describeCameraError(error) {
  const name = error?.name || "CameraError";
  const rawMessage = error?.message ? ` ${error.message}` : "";
  const origin = window.location.origin;
  const hints = {
    NotAllowedError: `Camera permission is blocked for ${origin}. Use the browser address-bar camera/site settings and set Camera to Allow, then reload this page. Also check Windows Settings > Privacy & security > Camera.`,
    SecurityError: `Camera is blocked by browser security. Open this page from http://localhost:53123 or http://127.0.0.1:53123, then allow camera access.`,
    NotFoundError: "No camera device was found. Check that the laptop camera or USB camera is connected and enabled.",
    NotReadableError: "The camera exists but cannot be opened. Close Camera, OBS, WeChat, Zoom, Teams, browser tabs, or any app using the camera, then try again.",
    OverconstrainedError: "The camera rejected the requested resolution/facing mode. The app will retry with simpler camera settings.",
    AbortError: "The browser aborted camera startup. Unplug/replug the camera or restart the browser if it repeats.",
  };
  return `${name}:${rawMessage} ${hints[name] || "Camera startup failed. Check browser permission, Windows privacy settings, and whether another app is using the camera."}`;
}

async function inspectCameraAccess() {
  const lines = [];
  lines.push(`origin: ${window.location.origin}`);
  lines.push(`secure context: ${window.isSecureContext ? "yes" : "no"}`);

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    lines.push("camera API: unavailable in this browser");
    setEyeTrackStatus("no camera API");
    if (trackingReadout) trackingReadout.textContent = lines.join("\n");
    return;
  }

  lines.push("camera API: available");

  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: "camera" });
      lines.push(`browser permission: ${permission.state}`);
    } catch (error) {
      lines.push(`browser permission: cannot query (${error.name || error})`);
    }
  } else {
    lines.push("browser permission: cannot query");
  }

  if (navigator.mediaDevices.enumerateDevices) {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const cameras = devices.filter((device) => device.kind === "videoinput");
      lines.push(`video inputs: ${cameras.length}`);
      cameras.slice(0, 3).forEach((camera, index) => {
        lines.push(`camera ${index + 1}: ${camera.label || "label hidden until permission is allowed"}`);
      });
    } catch (error) {
      lines.push(`device list failed: ${error.name || error}`);
    }
  }

  lines.push("If permission is denied, change the site camera permission to Allow and reload.");
  setEyeTrackStatus("checked");
  setStatus("Camera check complete");
  if (trackingReadout) trackingReadout.textContent = lines.join("\n");
}

async function getCameraStreamWithFallbacks() {
  const attempts = [
    {
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    },
    {
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    },
    {
      audio: false,
      video: true,
    },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
      if (error?.name === "NotAllowedError" || error?.name === "SecurityError" || error?.name === "NotFoundError") {
        break;
      }
    }
  }

  throw lastError || new Error("Camera startup failed.");
}

async function trackingLoop() {
  if (!trackingActive || !faceMesh || !trackingVideo) return;
  if (!trackingLoopBusy && trackingVideo.readyState >= 2) {
    trackingLoopBusy = true;
    try {
      await faceMesh.send({ image: trackingVideo });
    } catch (error) {
      console.warn("Face tracking frame failed.", error);
      setEyeTrackStatus("camera error");
    } finally {
      trackingLoopBusy = false;
    }
  }
  trackingRaf = requestAnimationFrame(trackingLoop);
}

async function startEyeTracking() {
  if (robotShutdown) {
    setEyeTrackStatus("shutdown");
    if (trackingReadout) trackingReadout.textContent = "Robot is shut down. Wake it before starting camera tracking.";
    return;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setEyeTrackStatus("no camera API");
    if (trackingReadout) trackingReadout.textContent = "This browser cannot expose a camera API.";
    return;
  }

  setEyeTrackStatus("requesting permission");
  setStatus("Starting camera");
  let stream = null;
  try {
    stream = await getCameraStreamWithFallbacks();
    cameraStream = stream;
    trackingVideo.srcObject = cameraStream;
    await trackingVideo.play();
    setEyeTrackStatus("loading face model");
    await ensureFaceMesh();
    trackingActive = true;
    smoothedGaze = { ...lastGazeSent };
    if (trackingVideo.parentElement) trackingVideo.parentElement.classList.add("tracking");
    setEyeTrackStatus("on");
    setStatus("Camera tracking");
    if (trackingReadout) trackingReadout.textContent = "Tracking active. Move slowly for calibration.";
    trackingLoop();
  } catch (error) {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (cameraStream) {
      cameraStream.getTracks().forEach((track) => track.stop());
      cameraStream = null;
    }
    if (trackingVideo) trackingVideo.srcObject = null;
    throw error;
  }
}

function stopEyeTracking(options = {}) {
  const skipGazeCenter = Boolean(options.skipGazeCenter);
  trackingActive = false;
  if (trackingRaf) cancelAnimationFrame(trackingRaf);
  trackingRaf = null;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  if (trackingVideo) trackingVideo.srcObject = null;
  if (trackingVideo?.parentElement) trackingVideo.parentElement.classList.remove("tracking");
  if (trackingCanvas) trackingCanvas.getContext("2d")?.clearRect(0, 0, trackingCanvas.width, trackingCanvas.height);
  clearRobotEyePreview();
  setEyeTrackStatus("off");
  if (trackingReadout) trackingReadout.textContent = "Camera off.";
  if (!skipGazeCenter && !robotShutdown) {
    postJson("/api/gaze", { x: 50, y: 50, source: "webcam_stop" }).catch(() => {});
  }
}

function loadTrackingPreferences() {
  if (trackingMode) trackingMode.value = localStorage.getItem("robotTrackingMode") || "face";
  if (invertEyeX) invertEyeX.checked = localStorage.getItem("robotInvertEyeX") === "1";
  if (invertEyeY) invertEyeY.checked = localStorage.getItem("robotInvertEyeY") === "1";
}

async function refreshStatus(options = {}) {
  const silent = Boolean(options.silent);
  try {
    const response = await fetch("/api/status");
    const data = await response.json();
    const previousShutdown = robotShutdown;
    robotShutdown = Boolean(data.robot_shutdown);
    if (robotShutdown && !previousShutdown) {
      haltLocalMotion();
    }
    updateShutdownUi();
    llmStatus.textContent = data.llm;
    ttsStatus.textContent = data.tts_detail || data.tts;
    serialStatus.textContent = data.serial_enabled
      ? `online ${data.serial_port}`
      : data.serial_requested
        ? `requested ${data.serial_port}`
        : "off";
    fxStatus.textContent = isChineseBossMode() ? "中文裂变" : "english classic";
    if (data.deepseek_model) deepseekModel.value = data.deepseek_model;
    if (data.deepseek_base_url) deepseekBaseUrl.value = data.deepseek_base_url;
    if (data.elevenlabs_voice_id && elevenlabsVoiceId) {
      elevenlabsVoiceId.value = data.elevenlabs_voice_id;
    }
    if (data.elevenlabs_model_id && elevenlabsModelId) {
      elevenlabsModelId.value = data.elevenlabs_model_id;
    }
    renderPortStatus(data);
    const errors = [data.last_llm_error, data.last_tts_error].filter(Boolean);
    if (errors.length) {
      errorPanel.classList.add("active");
      errorText.textContent = errors.join(" | ");
    } else {
      errorPanel.classList.remove("active");
      errorText.textContent = "No runtime errors.";
    }
    if (!silent) {
      setStatus(robotShutdown ? "Shutdown / motion locked" : data.serial_enabled ? "Ready / serial online" : "Ready / speaker-only");
    }
  } catch (error) {
    console.error(error);
    renderPortStatus(null, error);
    if (!silent) setStatus("Status check failed");
  }
}

async function pingPort() {
  if (!portPingBtn) return;
  const previousText = portPingBtn.textContent;
  portPingBtn.disabled = true;
  portPingBtn.textContent = "Pinging";
  if (portMessage) portMessage.textContent = "Sending safe center command: eye 50 50.";

  try {
    const result = await postJson("/api/gaze", {
      x: 50,
      y: 50,
      source: "port_monitor",
    });
    await refreshStatus({ silent: true });
    if (portMessage) {
      portMessage.textContent = result.sent
        ? `Ping OK. Backend sent "${result.command}" to ${serialStatus.textContent}.`
        : `Ping returned but serial is not open: ${result.reason || "serial_disabled"}.`;
    }
  } catch (error) {
    console.error(error);
    await refreshStatus({ silent: true });
    if (portMessage) portMessage.textContent = `Ping failed: ${error.message || error}`;
  } finally {
    portPingBtn.disabled = false;
    portPingBtn.textContent = previousText;
  }
}

async function reconnectPort() {
  if (!reconnectPortBtn) return;
  const previousText = reconnectPortBtn.textContent;
  reconnectPortBtn.disabled = true;
  reconnectPortBtn.textContent = "Reconnecting";
  if (portMessage) portMessage.textContent = "Closing and reopening the serial bridge. UNO R4 may reset once.";

  try {
    const result = await postJson("/api/serial/reconnect", {});
    await refreshStatus({ silent: true });
    if (portMessage) {
      portMessage.textContent = result.message || (result.serial_enabled ? "Serial reconnected." : "Serial reconnect failed.");
    }
    setStatus(result.serial_enabled ? "Serial reconnected" : "Serial reconnect failed");
  } catch (error) {
    console.error(error);
    await refreshStatus({ silent: true });
    if (portMessage) portMessage.textContent = `Reconnect failed: ${error.message || error}`;
    setStatus("Serial reconnect failed");
  } finally {
    reconnectPortBtn.disabled = false;
    reconnectPortBtn.textContent = previousText;
  }
}

async function applyRuntimeConfig(clearKey = false) {
  setStatus("Applying config");
  const payload = {
    deepseek_model: deepseekModel.value.trim() || "deepseek-v4-flash",
    deepseek_base_url: deepseekBaseUrl.value.trim() || "https://api.deepseek.com",
  };

  if (clearKey) {
    payload.deepseek_api_key = "";
  } else if (deepseekKey.value.trim()) {
    payload.deepseek_api_key = deepseekKey.value.trim();
  }

  await postJson("/api/config", payload);
  deepseekKey.value = "";
  await refreshStatus();
}

async function applyVoiceRuntimeConfig(clearKey = false) {
  setStatus("Applying voice config");
  const payload = {
    elevenlabs_voice_id: elevenlabsVoiceId.value.trim() || "pNInz6obpgDQGcFmaJgB",
    elevenlabs_model_id: elevenlabsModelId.value.trim() || "eleven_multilingual_v2",
  };

  if (clearKey) {
    payload.elevenlabs_api_key = "";
  } else if (elevenlabsKey.value.trim()) {
    payload.elevenlabs_api_key = elevenlabsKey.value.trim();
  }

  const status = await postJson("/api/config", payload);
  elevenlabsKey.value = "";
  await refreshStatus();
  setStatus(status.tts === "elevenlabs" ? "ElevenLabs voice enabled" : "Voice fallback active");
}

function renderServoDiag(result) {
  if (!servoDiagLog) return;
  const lines = result.lines || [];
  const diagnosis = result.diagnosis || {};
  const renderedLines = lines.map((entry) => {
    const label = String(entry.label || "rx").toUpperCase();
    return `[${label}] ${entry.line}`;
  });
  servoDiagLog.textContent = [
    `command: ${result.command}`,
    `serial: ${result.serial_enabled ? "online" : "offline"}`,
    diagnosis.message ? `diagnosis: ${diagnosis.severity || "info"} - ${diagnosis.message}` : "",
    diagnosis.next_step ? `next: ${diagnosis.next_step}` : "",
    ...renderedLines,
  ].filter(Boolean).join("\n");
}

async function runServoDiagnostic(payload) {
  if (!servoDiagLog) return;
  servoDiagLog.textContent = "Running diagnostic...";
  setStatus("Running servo diagnostic");
  try {
    const result = await postJson("/api/serial_diag", payload);
    renderServoDiag(result);
    await refreshStatus({ silent: true });
    setStatus(result.serial_enabled ? "Diagnostic complete" : "Serial offline");
  } catch (error) {
    console.error(error);
    servoDiagLog.textContent = `Diagnostic failed: ${error.message || error}`;
    setStatus("Diagnostic failed");
  }
}

async function testDeepseekRuntime() {
  setStatus("Testing DeepSeek");
  await applyRuntimeConfig(false);
  const result = await postJson("/api/persona_preview", {
    text: isChineseBossMode()
      ? "你是谁？请用一句话说古琴和你的关系。"
      : "Who are you? Say one sentence about the guqin and you.",
    use_llm: true,
    mode: voiceMode,
  });

  addMessage(
    "robot",
    result.reply,
    `DeepSeek test / ${result.emotion}, ${result.gaze}, ${result.llm}`
  );
  setFaceState({
    emotion: result.emotion,
    gaze: result.gaze,
    expression: result.expression,
    listening: false,
    thinking: false,
    speaking: false,
  });
  setServoPlan([]);
  await refreshStatus();
  setStatus(result.llm === "deepseek" ? "DeepSeek OK / no audio" : "DeepSeek fallback");
}

function browserSpeakFallback(text) {
  if (!("speechSynthesis" in window)) {
    playSyntheticChaos(text, estimateFallbackDuration(text));
    return;
  }

  window.speechSynthesis.cancel();
  if (isChineseBossMode()) {
    browserSpeakChaoticFallback(text);
    return;
  }

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.pitch = 0.45;
  utterance.rate = 0.78;
  utterance.volume = 1.0;
  window.speechSynthesis.speak(utterance);
}

function estimateFallbackDuration(text) {
  const units = Math.max(6, textTokens(text).length);
  return clampNumber(units * 210, 1200, 12000);
}

function chooseFallbackVoice(voices, profileIndex) {
  if (!voices.length) return null;
  const zhVoices = voices.filter((voice) => /zh|cmn|yue/i.test(voice.lang || voice.name));
  const enVoices = voices.filter((voice) => /en/i.test(voice.lang || voice.name));
  const mixed = profileIndex % 3 === 0 ? zhVoices : profileIndex % 3 === 1 ? enVoices : voices;
  const pool = mixed.length ? mixed : voices;
  return pool[profileIndex % pool.length];
}

function browserSpeakChaoticFallback(text) {
  const voices = window.speechSynthesis.getVoices();
  const tokens = textTokens(text).filter((token) => token.trim());
  const chunks = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (/^[，。！？、；：,.!?;:]+$/.test(token)) {
      continue;
    }

    const punctuation = tokens[index + 1] && /^[，。！？、；：,.!?;:]+$/.test(tokens[index + 1])
      ? tokens[index + 1]
      : "";
    chunks.push(token + punctuation);
  }

  const usableChunks = chunks.length ? chunks : [text];
  const profiles = [
    { lang: "zh-CN", pitch: 0.22, rate: 0.54, volume: 0.95 },
    { lang: "zh-CN", pitch: 1.65, rate: 0.92, volume: 0.58 },
    { lang: "en-US", pitch: 0.38, rate: 0.62, volume: 0.72 },
    { lang: "zh-CN", pitch: 1.18, rate: 1.22, volume: 0.5 },
    { lang: "en-US", pitch: 0.72, rate: 0.78, volume: 0.62 },
  ];

  let offset = 0;
  usableChunks.slice(0, 72).forEach((chunk, index) => {
    const profile = profiles[index % profiles.length];
    const utterance = new SpeechSynthesisUtterance(chunk);
    utterance.lang = profile.lang;
    utterance.pitch = profile.pitch;
    utterance.rate = profile.rate;
    utterance.volume = profile.volume;
    utterance.voice = chooseFallbackVoice(voices, index);

    const overlap = index % 4 === 2 ? -55 : index % 5 === 0 ? 35 : 95;
    const delay = Math.max(0, offset + overlap);
    setTimeout(() => window.speechSynthesis.speak(utterance), delay);
    offset += clampNumber(chunk.length * 95, 120, 520);
  });

  playSyntheticChaos(text, estimateFallbackDuration(text));
}

function playSyntheticChaos(text, durationMs) {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  const ctx = registerAudioContext(new AudioContextClass());
  const seed = hashText(`${text}|fallback-chaos`);
  const random = seededRandom(seed);
  const now = ctx.currentTime + 0.03;
  const output = ctx.createGain();
  output.gain.setValueAtTime(0.001, now);
  output.gain.linearRampToValueAtTime(0.09, now + 0.06);
  output.gain.linearRampToValueAtTime(0.001, now + durationMs / 1000);
  output.connect(ctx.destination);

  const frequencies = [54, 81, 123, 188, 277, 421];
  for (let index = 0; index < frequencies.length; index += 1) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const tremolo = ctx.createOscillator();
    const tremoloGain = ctx.createGain();
    const startAt = now + index * 0.025;
    const stopAt = now + durationMs / 1000 + 0.08;

    osc.type = index % 2 === 0 ? "sawtooth" : "square";
    osc.frequency.setValueAtTime(frequencies[index] * (0.94 + random() * 0.16), startAt);
    tremolo.frequency.setValueAtTime(7 + random() * 31, startAt);
    tremoloGain.gain.setValueAtTime(0.025 + random() * 0.055, startAt);
    gain.gain.setValueAtTime(0.025 + random() * 0.04, startAt);

    tremolo.connect(tremoloGain);
    tremoloGain.connect(gain.gain);
    osc.connect(gain);
    gain.connect(output);
    osc.start(startAt);
    tremolo.start(startAt);
    osc.stop(stopAt);
    tremolo.stop(stopAt);
  }

  setTimeout(() => {
    activeAudioContexts.delete(ctx);
    if (ctx.state !== "closed") ctx.close();
  }, durationMs + 800);
}

async function checkMicrophonePermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    setStatus("Mic API unavailable");
    addMessage("robot", "The browser cannot expose a microphone API here.", "Mic Check");
    return;
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop());
    setStatus("Microphone available");
    addMessage("robot", "Microphone permission is available. The machine may now listen, regrettably.", "Mic Check");
  } catch (error) {
    setStatus("Mic permission failed");
    addMessage("robot", String(error), "Mic Check");
  }
}

async function playSpeakerTest() {
  if (robotShutdown) {
    setStatus("Shutdown / speaker locked");
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    browserSpeakFallback("Speaker test. Seven strings. One reluctant machine.");
    return;
  }

  const ctx = registerAudioContext(new AudioContextClass());
  const now = ctx.currentTime;
  const output = ctx.createGain();
  output.gain.setValueAtTime(0.001, now);
  output.gain.exponentialRampToValueAtTime(0.2, now + 0.03);
  output.gain.exponentialRampToValueAtTime(0.001, now + 0.8);
  output.connect(ctx.destination);

  for (const frequency of [140, 280, 560]) {
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(frequency, now);
    osc.frequency.setValueAtTime(frequency * 0.97, now + 0.4);
    osc.connect(output);
    osc.start(now);
    osc.stop(now + 0.8);
  }

  setStatus("Speaker test");
  addMessage("robot", "Local speaker test played. No ElevenLabs quota was harmed.", "Speaker Test");
  startFaceSpeaking(850);
  setTimeout(() => {
    activeAudioContexts.delete(ctx);
    if (ctx.state !== "closed") ctx.close();
  }, 1100);
}

function setVoiceMode(nextMode) {
  voiceMode = normalizeVoiceMode(nextMode);
  localStorage.setItem("robotVoiceMode", voiceMode);
  voiceModeButtons.forEach((button) => {
    button.classList.toggle(
      "active",
      button.getAttribute("data-voice-mode") === voiceMode
    );
  });
  if (listenBtn) {
    listenBtn.textContent = isChineseBossMode() ? "Listen Chinese" : "Listen English";
  }
  if (textInput) {
    textInput.placeholder = isChineseBossMode()
      ? "说中文，例如：古琴到底是什么？"
      : "Type English, e.g. what is the guqin?";
  }
  if (recognition) {
    recognition.lang = isChineseBossMode() ? "zh-CN" : "en-US";
  }
  if (fxStatus) {
    fxStatus.textContent = isChineseBossMode() ? "中文裂变" : "english classic";
  }
}

function makeDistortionCurve(amount = 18) {
  const samples = 44100;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

function decodeAudioBytes(audioBase64) {
  const binary = atob(audioBase64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function clampNumber(value, low, high) {
  return Math.max(low, Math.min(value, high));
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value = Math.imul(value ^ (value >>> 15), 2246822507);
    value = Math.imul(value ^ (value >>> 13), 3266489909);
    return ((value ^= value >>> 16) >>> 0) / 4294967296;
  };
}

function textTokens(text) {
  return (
    text.match(/[\u4e00-\u9fff]|[A-Za-z']+|[0-9]+|[，。！？、；：,.!?;:]+/g) || []
  );
}

function connectVoiceFragment(ctx, source, profile, startAt, stopAt) {
  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.setValueAtTime(profile.highpass, startAt);

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.setValueAtTime(profile.bandpass, startAt);
  bandpass.Q.setValueAtTime(profile.q, startAt);

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.setValueAtTime(profile.lowpass, startAt);

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve(profile.distortion);
  shaper.oversample = "2x";

  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.001, startAt);
  gain.gain.linearRampToValueAtTime(profile.gain, startAt + 0.012);
  gain.gain.setValueAtTime(profile.gain, Math.max(startAt + 0.014, stopAt - 0.024));
  gain.gain.linearRampToValueAtTime(0.001, stopAt);

  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  if (pan) pan.pan.setValueAtTime(profile.pan, startAt);

  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(lowpass);
  lowpass.connect(shaper);
  if (pan) {
    shaper.connect(pan);
    pan.connect(gain);
  } else {
    shaper.connect(gain);
  }
  gain.connect(ctx.destination);
}

function playClassicMechanicalBuffer(ctx, buffer) {
  const source = ctx.createBufferSource();
  source.buffer = buffer;

  const settings = {
    highpass: 130,
    bandpass: 1450,
    bandpassQ: 0.85,
    lowpass: 3900,
    distortion: 14,
    tremoloRate: 32,
    tremoloDepth: 0.16,
    gain: 0.92,
  };

  const highpass = ctx.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = settings.highpass;

  const bandpass = ctx.createBiquadFilter();
  bandpass.type = "bandpass";
  bandpass.frequency.value = settings.bandpass;
  bandpass.Q.value = settings.bandpassQ;

  const lowpass = ctx.createBiquadFilter();
  lowpass.type = "lowpass";
  lowpass.frequency.value = settings.lowpass;

  const shaper = ctx.createWaveShaper();
  shaper.curve = makeDistortionCurve(settings.distortion);
  shaper.oversample = "2x";

  const tremolo = ctx.createGain();
  tremolo.gain.value = 0.82;

  const osc = ctx.createOscillator();
  const depth = ctx.createGain();
  osc.frequency.value = settings.tremoloRate;
  depth.gain.value = settings.tremoloDepth;
  osc.connect(depth);
  depth.connect(tremolo.gain);

  const output = ctx.createGain();
  output.gain.value = settings.gain;

  source.connect(highpass);
  highpass.connect(bandpass);
  bandpass.connect(lowpass);
  lowpass.connect(shaper);
  shaper.connect(tremolo);
  tremolo.connect(output);
  output.connect(ctx.destination);

  source.start();
  osc.start();
  source.onended = () => {
    osc.stop();
    setTimeout(() => {
      activeAudioContexts.delete(ctx);
      if (ctx.state !== "closed") ctx.close();
    }, 250);
  };

  return buffer.duration * 1000;
}

function playFragmentedBossBuffer(ctx, buffer, text) {
  const profiles = [
    { rate: 0.66, highpass: 55, bandpass: 520, q: 1.1, lowpass: 1450, distortion: 28, gain: 0.92, pan: -0.18 },
    { rate: 0.78, highpass: 80, bandpass: 880, q: 1.6, lowpass: 2100, distortion: 24, gain: 0.86, pan: 0.16 },
    { rate: 1.16, highpass: 260, bandpass: 2100, q: 2.2, lowpass: 3600, distortion: 18, gain: 0.72, pan: -0.08 },
    { rate: 1.34, highpass: 420, bandpass: 3100, q: 2.8, lowpass: 5200, distortion: 14, gain: 0.62, pan: 0.2 },
    { rate: 0.92, highpass: 180, bandpass: 1180, q: 3.0, lowpass: 2500, distortion: 34, gain: 0.78, pan: 0 },
    { rate: 1.02, highpass: 360, bandpass: 1520, q: 4.4, lowpass: 2300, distortion: 30, gain: 0.68, pan: -0.22 },
  ];

  const tokens = textTokens(text);
  const seed = hashText(`${text}|${buffer.duration}`);
  const random = seededRandom(seed);
  const fragmentCount = clampNumber(
    tokens.filter((token) => !/[，。！？、；：,.!?;:]+/.test(token)).length || Math.ceil(buffer.duration * 7),
    8,
    72
  );
  const baseSlice = buffer.duration / fragmentCount;
  const startBase = ctx.currentTime + 0.05;
  let sourceOffset = 0;
  let playCursor = startBase;

  for (let i = 0; i < fragmentCount && sourceOffset < buffer.duration - 0.03; i++) {
    const token = tokens[i % Math.max(1, tokens.length)] || "";
    const tokenHash = hashText(`${token}|${i}`);
    const profile = profiles[tokenHash % profiles.length];
    const sourceDuration = Math.min(
      clampNumber(baseSlice * (0.7 + random() * 0.75), 0.055, 0.26),
      buffer.duration - sourceOffset
    );
    const rate = clampNumber(profile.rate * (0.94 + random() * 0.14), 0.58, 1.45);
    const playedDuration = sourceDuration / rate;
    const stopAt = playCursor + playedDuration;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(rate, playCursor);
    connectVoiceFragment(ctx, source, profile, playCursor, stopAt);
    source.start(playCursor, sourceOffset, sourceDuration);
    source.stop(stopAt + 0.015);

    const hardGap = /[。！？.!?]+/.test(token) ? 0.16 : /[，、；：,;:]+/.test(token) ? 0.075 : 0.018 + random() * 0.035;
    sourceOffset += sourceDuration;
    playCursor = stopAt + hardGap;
  }

  const totalMs = Math.max(500, (playCursor - startBase) * 1000);
  setTimeout(() => {
    activeAudioContexts.delete(ctx);
    if (ctx.state !== "closed") ctx.close();
  }, totalMs + 700);
  return totalMs;
}

async function playProcessedAudio(audioBase64, text = "") {
  const bytes = decodeAudioBytes(audioBase64);
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) {
    const audio = registerAudioElement(new Audio(`data:audio/mpeg;base64,${audioBase64}`));
    await audio.play();
    return Number.isFinite(audio.duration) ? audio.duration * 1000 : 2500;
  }

  const ctx = registerAudioContext(new AudioContextClass());
  const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
  return isChineseBossMode()
    ? playFragmentedBossBuffer(ctx, buffer, text)
    : playClassicMechanicalBuffer(ctx, buffer);
}

async function playRawAudio(audioBase64, estimatedDurationMs) {
  const audio = registerAudioElement(new Audio(`data:audio/mpeg;base64,${audioBase64}`));
  await audio.play();

  return new Promise((resolve) => {
    const fallbackDuration = estimatedDurationMs || 2500;
    const resolveDuration = () => {
      if (Number.isFinite(audio.duration) && audio.duration > 0) {
        resolve(audio.duration * 1000);
      } else {
        resolve(fallbackDuration);
      }
    };
    audio.onloadedmetadata = resolveDuration;
    setTimeout(resolveDuration, 500);
  });
}

async function playAudioOrFallback(audioBase64, reply, estimatedDurationMs) {
  if (robotShutdown) return;

  if (!audioBase64) {
    await postJson("/api/motion/speaking", {
      duration_ms: estimatedDurationMs,
      text: reply,
    });
    browserSpeakFallback(reply);
    await startFaceSpeaking(estimatedDurationMs);
    return;
  }

  let durationMs = estimatedDurationMs;
  try {
    durationMs = await playProcessedAudio(audioBase64, reply);
  } catch (error) {
    console.warn("Processed audio failed, playing raw audio.", error);
    try {
      durationMs = await playRawAudio(audioBase64, estimatedDurationMs);
      addMessage("robot", "Mechanical voice processing failed; raw ElevenLabs audio played.", "Audio fallback");
    } catch (rawError) {
      console.warn("Raw audio failed, using browser speech fallback.", rawError);
      browserSpeakFallback(reply);
      addMessage("robot", String(rawError), "Audio playback error");
    }
  }
  const safeDuration = Math.ceil(durationMs || estimatedDurationMs);
  await postJson("/api/motion/speaking", {
    duration_ms: safeDuration,
    text: reply,
  });
  await startFaceSpeaking(safeDuration);
}

async function sendText(text) {
  if (robotShutdown) {
    setStatus("Shutdown / wake robot first");
    return;
  }

  const trimmed = text.trim();
  if (!trimmed) return;

  addMessage("user", trimmed, isChineseBossMode() ? "You / Chinese input" : "You / English input");
  textInput.value = "";
  setStatus("Thinking");
  setFaceState({
    emotion: "confused",
    gaze: "left",
    expression: "brow_up",
    listening: false,
    thinking: true,
    speaking: false,
  });

  try {
    const result = await postJson("/api/chat", { text: trimmed, mode: voiceMode });
    const meta = `${result.emotion}, ${result.gaze}, ${result.llm}, ${result.mode || voiceMode}`;
    addMessage("robot", result.reply, meta);
    setServoPlan(result.motion_plan?.expression || []);
    setFaceState({
      emotion: result.emotion,
      gaze: result.gaze,
      expression: result.expression,
      thinking: false,
      listening: false,
    });
    if (result.audio_error) {
      console.warn(result.audio_error);
      setStatus("TTS fallback");
    } else {
      setStatus("Speaking");
    }
    await playAudioOrFallback(
      result.audio_base64,
      result.reply,
      result.estimated_duration_ms
    );
    await refreshStatus();
    setStatus(result.serial_enabled ? "Ready / serial online" : "Ready / speaker-only");
  } catch (error) {
    console.error(error);
    setStatus("Error");
    setFaceState({
      emotion: "warning",
      gaze: "down",
      expression: "brow_up",
      listening: false,
      thinking: false,
      speaking: false,
    });
    addMessage("robot", String(error), "Local demo error");
    await refreshStatus();
  }
}

function setupSpeechRecognition() {
  if (!SpeechRecognition) {
    listenBtn.disabled = true;
    listenBtn.textContent = "No Web Speech";
    setStatus("Type text; browser speech recognition unavailable");
    return;
  }

  recognition = new SpeechRecognition();
  recognition.lang = isChineseBossMode() ? "zh-CN" : "en-US";
  recognition.continuous = false;
  recognition.interimResults = true;

  recognition.onstart = () => {
    setStatus(isChineseBossMode() ? "Listening in Chinese" : "Listening in English");
    setFaceState({
      emotion: "neutral",
      gaze: "center",
      expression: "eyes_open",
      listening: true,
      thinking: false,
      speaking: false,
    });
  };
  recognition.onerror = (event) => setStatus(`Mic error: ${event.error}`);
  recognition.onend = () => {
    if (!faceState.thinking && !faceState.speaking) setStatus("Ready");
    setFaceState({ listening: false });
  };
  recognition.onresult = (event) => {
    let finalText = "";
    let interimText = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalText += transcript;
      else interimText += transcript;
    }
    if (interimText) setStatus(`Heard: ${interimText}`);
    if (finalText) sendText(finalText);
  };
}

listenBtn.addEventListener("click", () => {
  if (robotShutdown) {
    setStatus("Shutdown / wake robot first");
    return;
  }
  if (recognition) recognition.start();
});

stopBtn.addEventListener("click", () => {
  if (recognition) recognition.stop();
});

micCheckBtn.addEventListener("click", () => checkMicrophonePermission());
refreshPortBtn.addEventListener("click", () => refreshStatus({ silent: true }));
if (reconnectPortBtn) reconnectPortBtn.addEventListener("click", () => reconnectPort());
portPingBtn.addEventListener("click", () => pingPort());
cameraStartBtn.addEventListener("click", async () => {
  try {
    await startEyeTracking();
  } catch (error) {
    console.error(error);
    const message = describeCameraError(error);
    setEyeTrackStatus("camera error");
    setStatus("Camera error");
    if (trackingReadout) trackingReadout.textContent = message;
  }
});
if (cameraCheckBtn) cameraCheckBtn.addEventListener("click", () => inspectCameraAccess());
cameraStopBtn.addEventListener("click", () => stopEyeTracking());
blinkToggleBtn.addEventListener("click", () => {
  if (robotShutdown) {
    setStatus("Shutdown / auto blink locked");
    return;
  }
  autoBlinkEnabled = !autoBlinkEnabled;
  localStorage.setItem("robotAutoBlink", autoBlinkEnabled ? "1" : "0");
  updateAutoBlinkButton();
  scheduleNaturalBlink();
});
speakerTestBtn.addEventListener("click", () => playSpeakerTest());
if (shutdownBtn) {
  shutdownBtn.addEventListener("click", async () => {
    try {
      shutdownBtn.disabled = true;
      await setRobotShutdown(!robotShutdown);
    } catch (error) {
      console.error(error);
      setStatus("Shutdown toggle failed");
    } finally {
      shutdownBtn.disabled = false;
    }
  });
}

sendBtn.addEventListener("click", () => sendText(textInput.value));
selfTestBtn.addEventListener("click", () =>
  sendText(
    isChineseBossMode()
      ? "你是谁？用一句话解释古琴。"
      : "Who are you? Explain the guqin in one sentence."
  )
);
applyConfigBtn.addEventListener("click", async () => {
  try {
    await applyRuntimeConfig(false);
  } catch (error) {
    console.error(error);
    setStatus("Config error");
  }
});
testDeepseekBtn.addEventListener("click", async () => {
  try {
    await testDeepseekRuntime();
  } catch (error) {
    console.error(error);
    setStatus("DeepSeek test error");
    addMessage("robot", String(error), "DeepSeek test error");
    await refreshStatus();
  }
});
clearConfigBtn.addEventListener("click", async () => {
  try {
    await applyRuntimeConfig(true);
  } catch (error) {
    console.error(error);
    setStatus("Config error");
  }
});
applyVoiceConfigBtn.addEventListener("click", async () => {
  try {
    await applyVoiceRuntimeConfig(false);
  } catch (error) {
    console.error(error);
    setStatus("Voice config error");
  }
});
clearVoiceConfigBtn.addEventListener("click", async () => {
  try {
    await applyVoiceRuntimeConfig(true);
  } catch (error) {
    console.error(error);
    setStatus("Voice config error");
  }
});
voiceModeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setVoiceMode(button.getAttribute("data-voice-mode"));
  });
});
trackingMode.addEventListener("change", () => {
  localStorage.setItem("robotTrackingMode", trackingMode.value);
});
invertEyeX.addEventListener("change", () => {
  localStorage.setItem("robotInvertEyeX", invertEyeX.checked ? "1" : "0");
});
invertEyeY.addEventListener("change", () => {
  localStorage.setItem("robotInvertEyeY", invertEyeY.checked ? "1" : "0");
});
textInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") sendText(textInput.value);
});

document.querySelectorAll("[data-servo]").forEach((button) => {
  button.addEventListener("click", async () => {
    const command = button.getAttribute("data-servo");
    if (robotShutdown && !["release", "led_off"].includes(command)) {
      setStatus("Shutdown / servo locked");
      setServoPlan(["shutdown"]);
      return;
    }
    const result = await postJson("/api/servo", { command });
    previewServoCommand(command);
    setServoPlan([command]);
    setStatus(result.sent ? `Servo sent: ${command}` : `Servo blocked: ${result.reason || command}`);
  });
});

document.querySelectorAll("[data-diag]").forEach((button) => {
  button.addEventListener("click", () => {
    runServoDiagnostic({ kind: button.getAttribute("data-diag") });
  });
});

document.querySelectorAll("[data-channel]").forEach((button) => {
  button.addEventListener("click", () => {
    if (robotShutdown) {
      setStatus("Shutdown / channel test locked");
      return;
    }
    runServoDiagnostic({
      kind: "channel",
      channel: Number(button.getAttribute("data-channel")),
    });
  });
});

document.querySelectorAll("[data-prompt]").forEach((button) => {
  button.addEventListener("click", () => {
    const prompt = button.getAttribute("data-prompt");
    if (prompt) sendText(prompt);
  });
});

setupSpeechRecognition();
loadTrackingPreferences();
setVoiceMode(voiceMode);
setFaceState();
updateAutoBlinkButton();
scheduleNaturalBlink();
setServoPlan([]);
refreshStatus();
setInterval(() => refreshStatus({ silent: true }), 3000);
addMessage(
  "robot",
  isChineseBossMode()
    ? "我已醒来。声音源正在分裂。请继续。"
    : "I am awake. This is already more than several dynasties managed.",
  "System"
);

