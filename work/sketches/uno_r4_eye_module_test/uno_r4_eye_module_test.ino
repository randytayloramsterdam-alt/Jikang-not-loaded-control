#include <Servo.h>

struct Joint {
  const char *name;
  uint8_t pin;
  Servo servo;
  int current;
};

Joint joints[] = {
  {"LR", 9, Servo(), 90},   // eye left/right
  {"UD", 10, Servo(), 90},  // eye up/down
  {"TL", 3, Servo(), 90},   // top-left eyelid
  {"BL", 5, Servo(), 90},   // bottom-left eyelid
  {"TR", 6, Servo(), 90},   // top-right eyelid
  {"BR", 11, Servo(), 90},  // bottom-right eyelid
};

const int JOINT_COUNT = sizeof(joints) / sizeof(joints[0]);

bool autoMode = false;
unsigned long nextAutoMoveAt = 0;

Joint &joint(const char *name) {
  for (int i = 0; i < JOINT_COUNT; i++) {
    if (strcmp(joints[i].name, name) == 0) {
      return joints[i];
    }
  }
  return joints[0];
}

void moveJoint(const char *name, int target, int stepDelayMs = 12) {
  Joint &j = joint(name);
  target = constrain(target, 0, 180);

  while (j.current != target) {
    if (j.current < target) {
      j.current++;
    } else {
      j.current--;
    }
    j.servo.write(j.current);
    delay(stepDelayMs);
  }
}

void setJointFast(const char *name, int target) {
  Joint &j = joint(name);
  j.current = constrain(target, 0, 180);
  j.servo.write(j.current);
}

void centerEyes() {
  moveJoint("LR", 90);
  moveJoint("UD", 90);
}

void safeOpenLids() {
  // Conservative open values. Increase later only after mechanical calibration.
  moveJoint("TL", 125);
  moveJoint("BL", 65);
  moveJoint("TR", 65);
  moveJoint("BR", 115);
}

void closeLids() {
  moveJoint("TL", 90, 6);
  moveJoint("BL", 90, 6);
  moveJoint("TR", 90, 6);
  moveJoint("BR", 90, 6);
}

void neutralFace() {
  centerEyes();
  safeOpenLids();
}

void blinkOnce() {
  closeLids();
  delay(120);
  safeOpenLids();
}

void lookLeft() {
  moveJoint("LR", 75);
}

void lookRight() {
  moveJoint("LR", 105);
}

void lookUp() {
  moveJoint("UD", 78);
}

void lookDown() {
  moveJoint("UD", 108);
}

void smallScan() {
  lookLeft();
  delay(250);
  centerEyes();
  delay(250);
  lookRight();
  delay(250);
  centerEyes();
}

void autoEyeMove() {
  if (!autoMode || millis() < nextAutoMoveAt) {
    return;
  }

  int action = random(0, 5);
  if (action == 0) {
    blinkOnce();
  } else {
    moveJoint("LR", random(78, 103));
    moveJoint("UD", random(82, 103));
  }

  nextAutoMoveAt = millis() + random(600, 1400);
}

void printHelp() {
  Serial.println("UNO R4 eye module test");
  Serial.println("Pin map:");
  Serial.println("  LR D9, UD D10, TL D3, BL D5, TR D6, BR D11");
  Serial.println("Commands:");
  Serial.println("  n = neutral/open");
  Serial.println("  c = center eyes");
  Serial.println("  l = look left");
  Serial.println("  r = look right");
  Serial.println("  u = look up");
  Serial.println("  d = look down");
  Serial.println("  b = blink");
  Serial.println("  k = close lids");
  Serial.println("  o = open lids");
  Serial.println("  s = small left-right scan");
  Serial.println("  a = auto eye movement on");
  Serial.println("  x = auto off and center");
}

void setup() {
  Serial.begin(115200);

  for (int i = 0; i < JOINT_COUNT; i++) {
    joints[i].servo.attach(joints[i].pin);
    joints[i].current = 90;
    joints[i].servo.write(90);
  }

  randomSeed(analogRead(A0));
  delay(800);

  printHelp();
}

void loop() {
  autoEyeMove();

  if (!Serial.available()) {
    return;
  }

  char command = Serial.read();
  if (command == '\n' || command == '\r') {
    return;
  }

  if (command != 'a') {
    autoMode = false;
  }

  if (command == 'n') {
    neutralFace();
    Serial.println("neutral");
  } else if (command == 'c') {
    centerEyes();
    Serial.println("center eyes");
  } else if (command == 'l') {
    lookLeft();
    Serial.println("look left");
  } else if (command == 'r') {
    lookRight();
    Serial.println("look right");
  } else if (command == 'u') {
    lookUp();
    Serial.println("look up");
  } else if (command == 'd') {
    lookDown();
    Serial.println("look down");
  } else if (command == 'b') {
    blinkOnce();
    Serial.println("blink");
  } else if (command == 'k') {
    closeLids();
    Serial.println("close lids");
  } else if (command == 'o') {
    safeOpenLids();
    Serial.println("open lids");
  } else if (command == 's') {
    smallScan();
    Serial.println("small scan");
  } else if (command == 'a') {
    autoMode = true;
    nextAutoMoveAt = 0;
    Serial.println("auto on");
  } else if (command == 'x') {
    autoMode = false;
    centerEyes();
    Serial.println("auto off");
  } else if (command == '?') {
    printHelp();
  } else {
    Serial.println("unknown command");
  }
}
