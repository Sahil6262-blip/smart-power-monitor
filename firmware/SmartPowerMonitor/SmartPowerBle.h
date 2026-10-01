#pragma once
#include "SmartPowerPacket.h"

namespace SmartPowerBle {
bool begin();
// Called only by acceptReading(). Non-blocking mailbox, never reads PZEM or uses Wi-Fi.
bool publish(const Reading& validatedReading);
}

