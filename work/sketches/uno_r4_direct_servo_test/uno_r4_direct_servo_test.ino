#include <Servo.h>

Servo testServo;

const int SERVO_SIGNAL_PIN = 9;

// Start with a narrow safe range. Do not use 0/180 while the servo is mounted.
const int CENTER_ANGLE = 90;
const int LEFT_TEST_ANGLE = 75;
const int RIGHT_TEST_ANGLE = 105;

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    ;
  }

  testServo.attach(SERVO_SIGNAL_PIN);
  testServo.write(CENTER_ANGLE);

  Serial.println("UNO R4 direct servo test");
  Serial.println("Signal pin: D9");
  Serial.println("Commands:");
  Serial.println("  c = center 90");
  Serial.println("  l = 75 degrees");
  Serial.println("  r = 105 degrees");
  Serial.println("  s = small sweep 75-105-90");
}

void loop() {
  if (!Serial.available()) {
    return;
  }

  char command = Serial.read();

  if (command == 'c') {
    testServo.write(CENTER_ANGLE);
    Serial.println("center: 90");
  } else if (command == 'l') {
    testServo.write(LEFT_TEST_ANGLE);
    Serial.println("left test: 75");
  } else if (command == 'r') {
    testServo.write(RIGHT_TEST_ANGLE);
    Serial.println("right test: 105");
  } else if (command == 's') {
    Serial.println("small sweep");
    for (int angle = LEFT_TEST_ANGLE; angle <= RIGHT_TEST_ANGLE; angle++) {
      testServo.write(angle);
      delay(25);
    }
    for (int angle = RIGHT_TEST_ANGLE; angle >= LEFT_TEST_ANGLE; angle--) {
      testServo.write(angle);
      delay(25);
    }
    testServo.write(CENTER_ANGLE);
    Serial.println("center: 90");
  }
}
