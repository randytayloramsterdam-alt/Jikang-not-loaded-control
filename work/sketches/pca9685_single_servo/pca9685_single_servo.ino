#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm = Adafruit_PWMServoDriver(0x40);

const uint8_t SERVO_CHANNEL = 0;

// Conservative pulse range for most hobby servos.
// We start narrow to avoid forcing the mechanical linkage.
const uint16_t SERVO_MIN_US = 1000;
const uint16_t SERVO_MAX_US = 2000;
const uint16_t SERVO_CENTER_US = 1500;

uint16_t microsecondsToTicks(uint16_t us) {
  // PCA9685 runs at 50 Hz: 20,000 us period split into 4096 ticks.
  return (uint32_t)us * 4096 / 20000;
}

void writeServoUs(uint8_t channel, uint16_t us) {
  pwm.setPWM(channel, 0, microsecondsToTicks(us));
}

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    ;
  }

  Wire.begin();
  pwm.begin();
  pwm.setPWMFreq(50);

  delay(10);
  writeServoUs(SERVO_CHANNEL, SERVO_CENTER_US);

  Serial.println("PCA9685 single-servo test.");
  Serial.println("Channel 0 is held at center first.");
  Serial.println("Send c=center, l=left-ish, r=right-ish, s=sweep.");
}

void loop() {
  if (Serial.available()) {
    char command = Serial.read();

    if (command == 'c') {
      writeServoUs(SERVO_CHANNEL, SERVO_CENTER_US);
      Serial.println("center: 1500 us");
    } else if (command == 'l') {
      writeServoUs(SERVO_CHANNEL, 1250);
      Serial.println("left-ish: 1250 us");
    } else if (command == 'r') {
      writeServoUs(SERVO_CHANNEL, 1750);
      Serial.println("right-ish: 1750 us");
    } else if (command == 's') {
      Serial.println("small sweep: 1250 -> 1750 -> 1500 us");
      for (uint16_t us = 1250; us <= 1750; us += 10) {
        writeServoUs(SERVO_CHANNEL, us);
        delay(20);
      }
      for (uint16_t us = 1750; us >= 1250; us -= 10) {
        writeServoUs(SERVO_CHANNEL, us);
        delay(20);
      }
      writeServoUs(SERVO_CHANNEL, SERVO_CENTER_US);
    }
  }
}
