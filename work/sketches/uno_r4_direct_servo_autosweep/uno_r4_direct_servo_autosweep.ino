#include <Servo.h>

Servo testServo;

const int SERVO_SIGNAL_PIN = 9;
const int LEFT_TEST_ANGLE = 75;
const int RIGHT_TEST_ANGLE = 105;
const int STEP_DELAY_MS = 25;
const int END_PAUSE_MS = 400;

void setup() {
  testServo.attach(SERVO_SIGNAL_PIN);
  testServo.write(90);
  delay(1000);
}

void loop() {
  for (int angle = LEFT_TEST_ANGLE; angle <= RIGHT_TEST_ANGLE; angle++) {
    testServo.write(angle);
    delay(STEP_DELAY_MS);
  }

  delay(END_PAUSE_MS);

  for (int angle = RIGHT_TEST_ANGLE; angle >= LEFT_TEST_ANGLE; angle--) {
    testServo.write(angle);
    delay(STEP_DELAY_MS);
  }

  delay(END_PAUSE_MS);
}
