#include "SmartPowerBle.h"
#include <Arduino.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLE2902.h>
#include <atomic>
#include <freertos/FreeRTOS.h>
#include <freertos/queue.h>
#include <freertos/task.h>

#if !defined(CONFIG_BLUEDROID_ENABLED)
#error "SmartPowerMonitor requires Arduino-ESP32 built-in Bluedroid BLE for ESP32 DevKit."
#endif

namespace {
constexpr char SERVICE[] = "b8541000-b5e6-4af4-9a44-6a0f78d40100";
constexpr char READING[] = "b8541001-b5e6-4af4-9a44-6a0f78d40100";
QueueHandle_t mailbox = nullptr;
BLECharacteristic* characteristic = nullptr;
BLE2902* subscription = nullptr;
std::atomic<bool> bleClientConnected{false};
std::atomic<bool> advertiseAgain{false};
bool initialized = false;
uint32_t sequence = 0;

class Callbacks final : public BLEServerCallbacks {
  void onConnect(BLEServer*) override {
    bleClientConnected.store(true);
    Serial.println("[BLE] Device connected");
  }
  void onDisconnect(BLEServer*) override {
    bleClientConnected.store(false);
    advertiseAgain.store(true);
    Serial.println("[BLE] Device disconnected");
  }
};

void notifyTask(void*) {
  SmartPowerBle::Packet packet;
  bool notificationsLogged = false;
  for (;;) {
    if (advertiseAgain.exchange(false)) {
      notificationsLogged = false;
      vTaskDelay(pdMS_TO_TICKS(300));
      if (!bleClientConnected.load()) {
        subscription->setNotifications(false);
        BLEDevice::startAdvertising();
      }
    }
    if (xQueueReceive(mailbox, &packet, pdMS_TO_TICKS(100)) != pdTRUE) continue;
    // READ exposes the most recent accepted snapshot, even before subscribing.
    characteristic->setValue(packet.bytes, sizeof(packet.bytes));
    if (!bleClientConnected.load() || !subscription->getNotifications()) continue;
    characteristic->notify();
    if (!notificationsLogged) {
      Serial.println("[BLE] Notifications active");
      notificationsLogged = true;
    }
  }
}
}

namespace SmartPowerBle {
bool begin() {
  if (initialized) return true;
  mailbox = xQueueCreate(1, sizeof(Packet));
  if (!mailbox) return false;
  BLEDevice::init("SmartPowerMonitor");
  auto* server = BLEDevice::createServer();
  server->setCallbacks(new Callbacks());
  auto* service = server->createService(SERVICE);
  characteristic = service->createCharacteristic(
    READING, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  subscription = new BLE2902();
  characteristic->addDescriptor(subscription);
  service->start();
  BLEAdvertisementData advertising, scanResponse;
  advertising.setFlags(0x06);
  advertising.setCompleteServices(BLEUUID(SERVICE));
  scanResponse.setName("SmartPowerMonitor");
  auto* advertiser = BLEDevice::getAdvertising();
  advertiser->setAdvertisementData(advertising);
  advertiser->setScanResponseData(scanResponse);
  advertiser->setScanResponse(true);
  if (xTaskCreate(notifyTask, "power-ble", 4096, nullptr, 1, nullptr) != pdPASS) {
    BLEDevice::deinit(true);
    vQueueDelete(mailbox);
    mailbox = nullptr;
    return false;
  }
  initialized = true;
  advertiser->start();
  Serial.println("[BLE] Service started");
  return true;
}

bool publish(const Reading& r) {
  if (!initialized || !mailbox) return false;
  Packet packet;
  if (!encode(r, sequence + 1, packet)) return false;
  ++sequence;
  return xQueueOverwrite(mailbox, &packet) == pdPASS;
}
}

