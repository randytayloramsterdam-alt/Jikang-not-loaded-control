#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>
#include <Adafruit_NeoPixel.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

const int SERVOMIN = 120;
const int SERVOMAX = 600;

// WS2812 / NeoPixel ring on D2.
// Change LED_COUNT to match your ring: common rings are 12, 16, or 24 LEDs.
const int LED_PIN = 2;
const int LED_COUNT = 16;
const int LED_IDLE_BRIGHTNESS = 14;
const int LED_SPEAK_MIN_BRIGHTNESS = 22;
const int LED_SPEAK_MAX_BRIGHTNESS = 145;

Adafruit_NeoPixel ring(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

// Active PCA9685 channels.
const int JL = 0;       // jaw channel 0
const int JR = 1;       // jaw channel 1
const int EYE_LR = 6;   // eyeball left/right
const int EYE_UD = 7;   // eyeball up/down
const int LID_A = 8;    // eyelid channel 8
const int LID_B = 9;    // eyelid channel 9
const int BROW_A = 10;  // brow channel 10
const int BROW_B = 11;  // brow channel 11

// Jaw angles.
const int JL_CLOSED = 120;
const int JL_OPEN = 60;
const int JR_CLOSED = 60;
const int JR_OPEN = 120;

// Eye left/right on channel 6.
const int EYE_LR_HOME = 90;
const int EYE_LR_LEFT = 120;
const int EYE_LR_RIGHT = 60;

// Eye up/down on channel 7.
const int EYE_UD_HOME = 60;
const int EYE_UD_UP = 90;
const int EYE_UD_DOWN = 30;

// Eyelids on channels 8 and 9.
const int LID_A_OPEN = 120;
const int LID_B_OPEN = 60;
const int LID_A_CLOSED = 80;
const int LID_B_CLOSED = 110;

// Brows on channels 10 and 11.
const int BROW_A_HOME = 90;
const int BROW_B_HOME = 90;
const int BROW_A_UP = 60;
const int BROW_B_UP = 150;

const unsigned long AUTO_MOVE_INTERVAL_MS = 350;

bool autoMoveEnabled = false;
int autoMoveStep = 0;
unsigned long lastAutoMoveMillis = 0;

String ledEmotion = "neutral";
uint32_t ledBaseColor = 0;
int ledCurrentLevel = 0;
unsigned long lastLedSpeechMillis = 0;

uint32_t colorForEmotion(String emotion) {
  emotion.toLowerCase();

  if (emotion == "amused") {
    return ring.Color(255, 145, 25);
  } else if (emotion == "confused") {
    return ring.Color(120, 90, 255);
  } else if (emotion == "solemn") {
    return ring.Color(35, 80, 255);
  } else if (emotion == "guqin") {
    return ring.Color(30, 190, 130);
  } else if (emotion == "warning") {
    return ring.Color(255, 20, 8);
  }

  return ring.Color(170, 175, 185);
}

void showRing(uint32_t color, int brightness) {
  brightness = constrain(brightness, 0, 255);
  ring.setBrightness(brightness);
  for (int i = 0; i < LED_COUNT; i++) {
    ring.setPixelColor(i, color);
  }
  ring.show();
}

void showLedIdle() {
  ledBaseColor = colorForEmotion(ledEmotion);
  showRing(ledBaseColor, LED_IDLE_BRIGHTNESS);
}

void setLedEmotion(String emotion) {
  emotion.trim();
  emotion.toLowerCase();
  if (
    emotion != "neutral" &&
    emotion != "amused" &&
    emotion != "confused" &&
    emotion != "solemn" &&
    emotion != "guqin" &&
    emotion != "warning"
  ) {
    Serial.println("ERR led_emotion needs neutral/amused/confused/solemn/guqin/warning");
    return;
  }

  ledEmotion = emotion;
  ledCurrentLevel = 0;
  showLedIdle();
  Serial.print("OK led_emotion ");
  Serial.println(ledEmotion);
}

void setLedSpeech(int percent) {
  percent = constrain(percent, 0, 100);
  ledCurrentLevel = percent;
  lastLedSpeechMillis = millis();

  int brightness = map(percent, 0, 100, LED_SPEAK_MIN_BRIGHTNESS, LED_SPEAK_MAX_BRIGHTNESS);
  uint32_t color = ledBaseColor;
  if (ledEmotion == "warning" && percent > 55) {
    color = ring.Color(255, 0, 0);
    brightness = min(220, brightness + 50);
  } else if (ledEmotion == "guqin" && percent > 45) {
    color = ring.Color(70, 255, 180);
  }
  showRing(color, brightness);
}

void handleLedDecay() {
  if (ledCurrentLevel <= 0) {
    return;
  }

  unsigned long now = millis();
  if (now - lastLedSpeechMillis < 140) {
    return;
  }

  ledCurrentLevel = max(0, ledCurrentLevel - 12);
  if (ledCurrentLevel == 0) {
    showLedIdle();
  } else {
    int brightness = map(ledCurrentLevel, 0, 100, LED_IDLE_BRIGHTNESS, LED_SPEAK_MAX_BRIGHTNESS);
    showRing(ledBaseColor, brightness);
  }
  lastLedSpeechMillis = now;
}

void runLedTest() {
  Serial.println("LED TEST");
  uint32_t colors[] = {
    ring.Color(255, 0, 0),
    ring.Color(0, 255, 0),
    ring.Color(0, 0, 255),
    ring.Color(255, 180, 20),
    ring.Color(80, 255, 180),
  };

  for (unsigned int c = 0; c < sizeof(colors) / sizeof(colors[0]); c++) {
    showRing(colors[c], 90);
    delay(220);
  }
  showLedIdle();
}

int angleToPulse(int angle) {
  angle = constrain(angle, 0, 180);
  return map(angle, 0, 180, SERVOMIN, SERVOMAX);
}

void writeServo(int channel, int angle) {
  pwm.setPWM(channel, 0, angleToPulse(angle));
}

bool pca9685Found() {
  Wire.beginTransmission(0x40);
  return Wire.endTransmission() == 0;
}

void printPcaStatus() {
  if (pca9685Found()) {
    Serial.println("PCA9685 FOUND at 0x40");
  } else {
    Serial.println("PCA9685 NOT FOUND. Check SDA/SCL, VCC, and GND.");
  }
}

void scanI2C() {
  int found = 0;
  Serial.println("I2C SCAN START");
  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    if (Wire.endTransmission() == 0) {
      Serial.print("I2C DEVICE 0x");
      if (address < 16) {
        Serial.print("0");
      }
      Serial.println(address, HEX);
      found++;
      delay(2);
    }
  }
  Serial.print("I2C SCAN DONE devices=");
  Serial.println(found);
}

bool isNumber(String text) {
  text.trim();
  if (text.length() == 0) {
    return false;
  }

  for (unsigned int i = 0; i < text.length(); i++) {
    if (!isDigit(text.charAt(i))) {
      return false;
    }
  }
  return true;
}

void jawClosed() {
  writeServo(JL, JL_CLOSED);
  writeServo(JR, JR_CLOSED);
}

void jawOpen() {
  writeServo(JL, JL_OPEN);
  writeServo(JR, JR_OPEN);
}

void jawPercent(int percent) {
  percent = constrain(percent, 0, 100);
  setLedSpeech(percent);
  int leftAngle = map(percent, 0, 100, JL_CLOSED, JL_OPEN);
  int rightAngle = map(percent, 0, 100, JR_CLOSED, JR_OPEN);
  writeServo(JL, leftAngle);
  writeServo(JR, rightAngle);
}

void lookCenter() {
  writeServo(EYE_LR, EYE_LR_HOME);
  writeServo(EYE_UD, EYE_UD_HOME);
}

void lookLeft() {
  writeServo(EYE_LR, EYE_LR_LEFT);
}

void lookRight() {
  writeServo(EYE_LR, EYE_LR_RIGHT);
}

void lookUp() {
  writeServo(EYE_UD, EYE_UD_UP);
}

void lookDown() {
  writeServo(EYE_UD, EYE_UD_DOWN);
}

void eyePercent(int xPercent, int yPercent) {
  xPercent = constrain(xPercent, 0, 100);
  yPercent = constrain(yPercent, 0, 100);

  int lrAngle = map(xPercent, 0, 100, EYE_LR_LEFT, EYE_LR_RIGHT);
  int udAngle = map(yPercent, 0, 100, EYE_UD_UP, EYE_UD_DOWN);
  writeServo(EYE_LR, lrAngle);
  writeServo(EYE_UD, udAngle);
}

void eyesOpen() {
  writeServo(LID_A, LID_A_OPEN);
  writeServo(LID_B, LID_B_OPEN);
}

void eyesClose() {
  writeServo(LID_A, LID_A_CLOSED);
  writeServo(LID_B, LID_B_CLOSED);
}

void browHome() {
  writeServo(BROW_A, BROW_A_HOME);
  writeServo(BROW_B, BROW_B_HOME);
}

void browUp() {
  writeServo(BROW_A, BROW_A_UP);
  writeServo(BROW_B, BROW_B_UP);
}

void blinkEyes() {
  eyesClose();
  delay(180);
  eyesOpen();
}

void releaseActiveServos() {
  const int channels[] = {JL, JR, EYE_LR, EYE_UD, LID_A, LID_B, BROW_A, BROW_B};
  for (unsigned int i = 0; i < sizeof(channels) / sizeof(channels[0]); i++) {
    pwm.setPWM(channels[i], 0, 0);
  }
}

void allHome() {
  jawClosed();
  lookCenter();
  eyesOpen();
  browHome();
}

void stopAutoMove() {
  autoMoveEnabled = false;
  Serial.println("AUTO STOP");
}

void stopAutoMoveQuiet() {
  autoMoveEnabled = false;
}

void startAutoMove() {
  autoMoveEnabled = true;
  autoMoveStep = 0;
  lastAutoMoveMillis = 0;
  Serial.println("AUTO START");
}

bool applyChannelAngleCommand(String command) {
  command.trim();

  String normalized = command;
  normalized.replace(",", " ");
  normalized.replace("\t", " ");

  int channel = -1;
  int angle = -1;
  int parsed = sscanf(normalized.c_str(), "%d %d", &channel, &angle);
  if (parsed != 2) {
    return false;
  }

  if (channel < 0 || channel > 15) {
    Serial.println("ERR channel must be 0-15");
    return true;
  }

  if (angle < 0 || angle > 180) {
    Serial.println("ERR angle must be 0-180");
    return true;
  }

  stopAutoMove();
  writeServo(channel, angle);
  Serial.print("OK channel ");
  Serial.print(channel);
  Serial.print(" angle ");
  Serial.println(angle);
  return true;
}

bool applyMouthCommand(String command) {
  command.trim();

  String normalized = command;
  normalized.toLowerCase();
  normalized.replace(",", " ");
  normalized.replace("\t", " ");

  if (!normalized.startsWith("mouth ") && !normalized.startsWith("jaw ")) {
    return false;
  }

  int separator = normalized.indexOf(' ');
  String valueText = normalized.substring(separator + 1);
  valueText.trim();

  if (valueText.length() == 0) {
    Serial.println("ERR mouth needs 0-100");
    return true;
  }

  for (unsigned int i = 0; i < valueText.length(); i++) {
    if (!isDigit(valueText.charAt(i))) {
      Serial.println("ERR mouth needs 0-100");
      return true;
    }
  }

  stopAutoMoveQuiet();
  jawPercent(valueText.toInt());
  return true;
}

bool applyEyeCommand(String command) {
  command.trim();

  String normalized = command;
  normalized.toLowerCase();
  normalized.replace(",", " ");
  normalized.replace("\t", " ");

  if (!normalized.startsWith("eye ") && !normalized.startsWith("gaze ")) {
    return false;
  }

  int separator = normalized.indexOf(' ');
  String valueText = normalized.substring(separator + 1);
  valueText.trim();

  int xPercent = -1;
  int yPercent = -1;
  int parsed = sscanf(valueText.c_str(), "%d %d", &xPercent, &yPercent);
  if (parsed != 2) {
    Serial.println("ERR eye needs x y, each 0-100");
    return true;
  }

  if (xPercent < 0 || xPercent > 100 || yPercent < 0 || yPercent > 100) {
    Serial.println("ERR eye values must be 0-100");
    return true;
  }

  stopAutoMoveQuiet();
  eyePercent(xPercent, yPercent);
  return true;
}

bool applyLedCommand(String command) {
  command.trim();

  String normalized = command;
  normalized.toLowerCase();
  normalized.replace(",", " ");
  normalized.replace("\t", " ");

  if (normalized == "led_off" || normalized == "light_off") {
    ledCurrentLevel = 0;
    ring.clear();
    ring.show();
    Serial.println("OK led_off");
    return true;
  }

  if (normalized == "led_test" || normalized == "light_test") {
    runLedTest();
    return true;
  }

  if (normalized.startsWith("led_emotion ") || normalized.startsWith("light_emotion ")) {
    int separator = normalized.indexOf(' ');
    String emotion = normalized.substring(separator + 1);
    setLedEmotion(emotion);
    return true;
  }

  if (normalized.startsWith("led_speech ") || normalized.startsWith("light ")) {
    int separator = normalized.indexOf(' ');
    String valueText = normalized.substring(separator + 1);
    valueText.trim();

    if (valueText.length() == 0) {
      Serial.println("ERR led_speech needs 0-100");
      return true;
    }

    for (unsigned int i = 0; i < valueText.length(); i++) {
      if (!isDigit(valueText.charAt(i))) {
        Serial.println("ERR led_speech needs 0-100");
        return true;
      }
    }

    setLedSpeech(valueText.toInt());
    return true;
  }

  return false;
}

void testChannel(int channel) {
  if (channel < 0 || channel > 15) {
    Serial.println("ERR channel must be 0-15");
    return;
  }

  stopAutoMove();
  Serial.print("TEST channel ");
  Serial.println(channel);

  if (channel == JL) {
    writeServo(channel, JL_CLOSED);
    delay(350);
    writeServo(channel, JL_OPEN);
    delay(350);
    writeServo(channel, JL_CLOSED);
  } else if (channel == JR) {
    writeServo(channel, JR_CLOSED);
    delay(350);
    writeServo(channel, JR_OPEN);
    delay(350);
    writeServo(channel, JR_CLOSED);
  } else if (channel == EYE_LR) {
    writeServo(channel, EYE_LR_HOME);
    delay(350);
    writeServo(channel, EYE_LR_LEFT);
    delay(350);
    writeServo(channel, EYE_LR_RIGHT);
    delay(350);
    writeServo(channel, EYE_LR_HOME);
  } else if (channel == EYE_UD) {
    writeServo(channel, EYE_UD_HOME);
    delay(350);
    writeServo(channel, EYE_UD_UP);
    delay(350);
    writeServo(channel, EYE_UD_DOWN);
    delay(350);
    writeServo(channel, EYE_UD_HOME);
  } else if (channel == LID_A) {
    writeServo(channel, LID_A_OPEN);
    delay(350);
    writeServo(channel, LID_A_CLOSED);
    delay(350);
    writeServo(channel, LID_A_OPEN);
  } else if (channel == LID_B) {
    writeServo(channel, LID_B_OPEN);
    delay(350);
    writeServo(channel, LID_B_CLOSED);
    delay(350);
    writeServo(channel, LID_B_OPEN);
  } else if (channel == BROW_A) {
    writeServo(channel, BROW_A_HOME);
    delay(350);
    writeServo(channel, BROW_A_UP);
    delay(350);
    writeServo(channel, BROW_A_HOME);
  } else if (channel == BROW_B) {
    writeServo(channel, BROW_B_HOME);
    delay(350);
    writeServo(channel, BROW_B_UP);
    delay(350);
    writeServo(channel, BROW_B_HOME);
  } else {
    writeServo(channel, 70);
    delay(350);
    writeServo(channel, 110);
    delay(350);
    writeServo(channel, 90);
  }
}

void applyAutoMoveStep() {
  switch (autoMoveStep) {
    case 0:
      allHome();
      break;
    case 1:
      lookLeft();
      break;
    case 2:
      lookRight();
      break;
    case 3:
      lookCenter();
      break;
    case 4:
      lookUp();
      break;
    case 5:
      lookDown();
      break;
    case 6:
      lookCenter();
      break;
    case 7:
      eyesClose();
      break;
    case 8:
      eyesOpen();
      break;
    case 9:
      browUp();
      break;
    case 10:
      browHome();
      break;
    case 11:
      jawOpen();
      break;
    case 12:
      jawClosed();
      break;
  }

  autoMoveStep = (autoMoveStep + 1) % 13;
}

void handleAutoMove() {
  if (!autoMoveEnabled) {
    return;
  }

  unsigned long now = millis();
  if (lastAutoMoveMillis == 0 || now - lastAutoMoveMillis >= AUTO_MOVE_INTERVAL_MS) {
    applyAutoMoveStep();
    lastAutoMoveMillis = now;
  }
}

void applyCommand(String command) {
  command.trim();

  Serial.print("RX: ");
  Serial.println(command);

  if (applyMouthCommand(command)) {
    return;
  } else if (applyLedCommand(command)) {
    return;
  } else if (applyEyeCommand(command)) {
    return;
  } else if (applyChannelAngleCommand(command)) {
    return;
  } else if (command == "pca_status" || command == "status") {
    printPcaStatus();
  } else if (command == "i2c_scan") {
    scanI2C();
  } else if (command == "k") {
    startAutoMove();
  } else if (command == "t") {
    stopAutoMove();
  } else if (command == "home" || command == "close") {
    stopAutoMove();
    allHome();
    setLedEmotion("neutral");
  } else if (command == "release" || command == "off") {
    stopAutoMove();
    releaseActiveServos();
    ring.clear();
    ring.show();
    Serial.println("OK release");
  } else if (command == "jaw_open") {
    stopAutoMove();
    jawOpen();
  } else if (command == "jaw_close") {
    stopAutoMove();
    jawClosed();
  } else if (command == "look_center") {
    stopAutoMove();
    lookCenter();
  } else if (command == "look_left") {
    stopAutoMove();
    lookLeft();
  } else if (command == "look_right") {
    stopAutoMove();
    lookRight();
  } else if (command == "look_up") {
    stopAutoMove();
    lookUp();
  } else if (command == "look_down") {
    stopAutoMove();
    lookDown();
  } else if (command == "eyes_open" || command == "open") {
    stopAutoMove();
    eyesOpen();
  } else if (command == "eyes_close") {
    stopAutoMove();
    eyesClose();
  } else if (command == "blink") {
    stopAutoMove();
    blinkEyes();
  } else if (command == "brow_up") {
    stopAutoMove();
    browUp();
  } else if (command == "brow_home") {
    stopAutoMove();
    browHome();
  } else if (command == "listen") {
    stopAutoMove();
    eyesOpen();
    lookCenter();
    browHome();
    setLedEmotion("neutral");
  } else if (command == "think" || command == "confused") {
    stopAutoMove();
    eyesOpen();
    lookLeft();
    browUp();
    setLedEmotion("confused");
  } else if (command == "amused") {
    stopAutoMove();
    eyesOpen();
    lookRight();
    browUp();
    setLedEmotion("amused");
  } else if (command == "solemn") {
    stopAutoMove();
    lookDown();
    blinkEyes();
    browHome();
    setLedEmotion("solemn");
  } else if (command == "guqin") {
    stopAutoMove();
    eyesOpen();
    lookCenter();
    browHome();
    setLedEmotion("guqin");
  } else if (command == "warning") {
    stopAutoMove();
    eyesOpen();
    lookCenter();
    browUp();
    setLedEmotion("warning");
  } else if (isNumber(command)) {
    testChannel(command.toInt());
  } else if (command.length() > 0) {
    Serial.print("UNKNOWN: ");
    Serial.println(command);
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin();
  ring.begin();
  ring.clear();
  ring.show();
  setLedEmotion("neutral");

  delay(300);
  if (pca9685Found()) {
    Serial.println("PCA9685 FOUND at 0x40");
  } else {
    Serial.println("PCA9685 NOT FOUND. Check wiring.");
  }

  pwm.begin();
  pwm.setPWMFreq(50);
  delay(500);

  Serial.println("Jaw + eye + eyelid controller ready");
  Serial.println("Safe boot: no servo motion sent. Send 'home' only after checking power and linkages.");
  Serial.println("Jaw: ch0 120-60, ch1 60-120");
  Serial.println("Eye LR: ch6 home 90, left 120, right 60");
  Serial.println("Eye UD: ch7 home 60, up 90, down 30");
  Serial.println("Lids: open ch8 120 / ch9 60, close ch8 80 / ch9 110");
  Serial.println("Brows: home ch10 90 / ch11 90, up ch10 60 / ch11 150");
  Serial.println("Commands: k, t, home, release, jaw_open, jaw_close");
  Serial.println("Commands: pca_status, i2c_scan");
  Serial.println("Commands: led_test, led_off, led_emotion neutral/amused/confused/solemn/guqin/warning");
  Serial.println("Commands: led_speech 0-100, example: led_speech 70");
  Serial.println("Commands: mouth 0-100, example: mouth 45");
  Serial.println("Commands: eye x y, example: eye 50 50");
  Serial.println("Commands: look_center, look_left, look_right, look_up, look_down");
  Serial.println("Commands: eyes_open, eyes_close, blink, brow_up, brow_home");
  Serial.println("Agent expressions: listen, think, confused, amused, solemn, guqin, warning");
  Serial.println("Manual: channel angle, example: 6 120");
}

void loop() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    applyCommand(command);
  }

  handleAutoMove();
  handleLedDecay();
}
