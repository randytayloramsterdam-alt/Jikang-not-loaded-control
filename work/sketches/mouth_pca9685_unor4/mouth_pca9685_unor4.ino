#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

const int SERVOMIN = 120;
const int SERVOMAX = 600;

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

  if (applyChannelAngleCommand(command)) {
    return;
  } else if (command == "k") {
    startAutoMove();
  } else if (command == "t") {
    stopAutoMove();
  } else if (command == "home" || command == "close") {
    stopAutoMove();
    allHome();
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
  } else if (command == "brow_up") {
    stopAutoMove();
    browUp();
  } else if (command == "brow_home") {
    stopAutoMove();
    browHome();
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
  Serial.println("Safe boot: no servo motion sent. Send 'home' after checking power and linkages.");
  Serial.println("Jaw: ch0 120-60, ch1 60-120");
  Serial.println("Eye LR: ch6 home 90, left 120, right 60");
  Serial.println("Eye UD: ch7 home 60, up 90, down 30");
  Serial.println("Lids: open ch8 120 / ch9 60, close ch8 80 / ch9 110");
  Serial.println("Brows: home ch10 90 / ch11 90, up ch10 60 / ch11 150");
  Serial.println("Commands: k, t, home, jaw_open, jaw_close");
  Serial.println("Commands: look_center, look_left, look_right, look_up, look_down");
  Serial.println("Commands: eyes_open, eyes_close, brow_up, brow_home");
  Serial.println("Manual: channel angle, example: 6 120");
}

void loop() {
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    applyCommand(command);
  }

  handleAutoMove();
}
