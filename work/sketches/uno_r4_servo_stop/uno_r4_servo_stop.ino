#include <Servo.h>

Servo testServo;

const int SERVO_SIGNAL_PIN = 9;

void setup() {
  testServo.attach(SERVO_SIGNAL_PIN);
  testServo.write(90);
  delay(300);
  testServo.detach();
  pinMode(SERVO_SIGNAL_PIN, INPUT);
}

void loop() {
}
