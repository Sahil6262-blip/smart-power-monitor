#pragma once
#include <stdint.h>
#include <math.h>

namespace SmartPowerBle {
struct Reading { double voltage, current, power, energy, frequency, powerFactor; };
struct Packet { uint8_t bytes[20]; };
static_assert(sizeof(Packet) == 20, "BLE packet must fit the default MTU");

inline void putLE(uint8_t* out, uint32_t value, unsigned bytes) {
  for (unsigned i = 0; i < bytes; ++i) out[i] = static_cast<uint8_t>(value >> (8 * i));
}
inline bool encode(const Reading& r, uint32_t sequence, Packet& packet) {
  // This checks serialization range only, without altering the working sensor filter.
  const double values[] = {r.voltage, r.current, r.power, r.energy, r.frequency, r.powerFactor};
  const double maxima[] = {1000, 1000, 1000000, 4294967.295, 100, 1};
  for (unsigned i = 0; i < 6; ++i) if (!isfinite(values[i]) || values[i] < 0 || values[i] > maxima[i]) return false;
  putLE(packet.bytes, sequence, 4);
  putLE(packet.bytes + 4, static_cast<uint32_t>(llround(r.voltage * 10)), 2);
  // uint24 preserves 0.001 A resolution beyond 65.535 A, including the full 100 A CT.
  putLE(packet.bytes + 6, static_cast<uint32_t>(llround(r.current * 1000)), 3);
  putLE(packet.bytes + 9, static_cast<uint32_t>(llround(r.power * 10)), 3);
  putLE(packet.bytes + 12, static_cast<uint32_t>(llround(r.energy * 1000)), 4);
  putLE(packet.bytes + 16, static_cast<uint32_t>(llround(r.frequency * 10)), 2);
  putLE(packet.bytes + 18, static_cast<uint32_t>(llround(r.powerFactor * 1000)), 2);
  return true;
}
}

