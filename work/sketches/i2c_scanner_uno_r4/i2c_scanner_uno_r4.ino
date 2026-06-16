#include <Wire.h>

void setup() {
  Serial.begin(115200);
  while (!Serial) {
    ;
  }

  Wire.begin();
  Serial.println("I2C scanner started.");
}

void loop() {
  byte found = 0;

  Serial.println("Scanning...");

  for (byte address = 1; address < 127; address++) {
    Wire.beginTransmission(address);
    byte error = Wire.endTransmission();

    if (error == 0) {
      Serial.print("I2C device found at 0x");
      if (address < 16) {
        Serial.print("0");
      }
      Serial.println(address, HEX);
      found++;
    }
  }

  if (found == 0) {
    Serial.println("No I2C devices found.");
  } else {
    Serial.print("Found ");
    Serial.print(found);
    Serial.println(" device(s).");
  }

  delay(3000);
}
