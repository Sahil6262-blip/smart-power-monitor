#include "../SmartPowerMonitor/SmartPowerPacket.h"
#include <assert.h>
#include <stdio.h>

int main() {
  SmartPowerBle::Packet packet;
  assert(SmartPowerBle::encode({231.8, 0.42, 93.2, 0.023, 50, 0.96}, 1, packet));
  const uint8_t expected[] = {1,0,0,0,14,9,164,1,0,164,3,0,23,0,0,0,244,1,192,3};
  for (unsigned i = 0; i < 20; ++i) assert(packet.bytes[i] == expected[i]);
  assert(SmartPowerBle::encode({230, 100, 23000, 4000000, 50, 1}, 0xffffffff, packet));
  assert(packet.bytes[6] == 0xa0 && packet.bytes[7] == 0x86 && packet.bytes[8] == 1);
  assert(!SmartPowerBle::encode({230, -1, 1, 1, 50, 1}, 2, packet));
  assert(!SmartPowerBle::encode({230, 1, 1, 1, 50, 1.1}, 2, packet));
  assert(!SmartPowerBle::encode({NAN, 1, 1, 1, 50, 1}, 2, packet));
  puts("20-byte packet golden vector and 100 A range checks passed.");
}

