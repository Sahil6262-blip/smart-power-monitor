/*
  SMART REAL-TIME POWER MONITORING SYSTEM
  ESP32 + PZEM-004T V3.0 (100A CT)

  FINAL ESP32 SKETCH

  Wiring used for this project:
    PZEM TX -> 2 x 1k series (2k) -> ESP32 GPIO16 RX
    GPIO16 junction -> 3 x 1k series (3k) -> GND
    ESP32 GPIO17 TX -> 1k series -> PZEM RX
    PZEM GND -> ESP32 GND
    PZEM 5V -> regulated 5V supply

  Wi-Fi:
    Station mode (DHCP). The router/hotspot assigns the ESP32 IP.
    The dashboard prints the real IP in Serial Monitor and shows it on-page.

  Filtering:
    - first 2 seconds ignored
    - voltage must be 80...260 V
    - sudden voltage change > 15 V rejected
    - 2 consecutive readings within 5 V required before acceptance
    - rejected readings are NOT shown and NOT counted in statistics

  Cost / environmental calculations:
    - tariff is configurable below
    - CO2e is an ESTIMATE = energy x configurable emission factor
    - 10% reduction figures are a SCENARIO, not measured savings

  Dashboard history:
    - short windows preserve accepted 2-second samples in the browser
    - 7-day view uses 5-minute browser-side aggregates
    - graph Y-axis adapts to the actual min/max range to reveal small changes

  Required libraries:
    1) PZEM004Tv30 by jbenz
    2) ESP32 board package
*/

#include <WiFi.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <WebServer.h>
#include <PZEM004Tv30.h>
#include <math.h>
#include <ESPmDNS.h>
#include <time.h>
#include "secrets.h"
#include "SmartPowerBle.h"

// ========================= WIFI ==========================
// WIFI_SSID is provided by secrets.h.
// WIFI_PASSWORD is provided by secrets.h.

// ========================= UART ==========================
#define PZEM_RX_PIN 16
#define PZEM_TX_PIN 17

HardwareSerial PZEMSerial(2);
PZEM004Tv30 pzem(PZEMSerial, PZEM_RX_PIN, PZEM_TX_PIN);
WebServer server(80);

// ========================= TIMING ========================
const unsigned long STARTUP_DELAY = 2000UL;
const unsigned long READ_INTERVAL = 1000UL;
const unsigned long BACKEND_SEND_INTERVAL = 1000UL;
const unsigned long WIFI_RETRY_INTERVAL = 10000UL;
const unsigned long NTP_RETRY_INTERVAL = 30000UL;
const unsigned long HTTPS_TIMEOUT_MS = 1800UL;

// ========================= FILTER ========================
const float MIN_VALID_VOLTAGE = 80.0f;
const float MAX_VALID_VOLTAGE = 260.0f;
const float VOLTAGE_SPIKE_THRESHOLD = 15.0f;
const float VOLTAGE_STABILITY_TOLERANCE = 5.0f;
const int REQUIRED_STABLE_READINGS = 2;

// ========================= USER CONFIG ===================
const float ELECTRICITY_TARIFF = 8.0f;       // INR / kWh
const float GRID_EMISSION_FACTOR = 0.70f;    // kg CO2e / kWh - project/demo setting; replace with cited factor
const float TARGET_REDUCTION_PERCENT = 10.0f; // scenario only

// ========================= CLOUD BACKEND ==================
const char* BACKEND_URL = "https://smart-power-monitor.onrender.com/api/readings";
// INGEST_API_KEY is provided by secrets.h.

// For immediate prototype deployment this uses TLS without certificate
// verification. For production, replace the empty string with the server
// root CA certificate and the code will use certificate validation.
const char* BACKEND_ROOT_CA = "";

// ========================= NTP =============================
const char* NTP_SERVER_1 = "pool.ntp.org";
const char* NTP_SERVER_2 = "time.nist.gov";
const char* NTP_SERVER_3 = "time.google.com";

// ========================= STABLE DATA ===================
float stableVoltage = NAN;
float stableCurrent = NAN;
float stablePower = NAN;
float stableEnergy = NAN;
float stableFrequency = NAN;
float stablePF = NAN;

float lastRawVoltage = NAN;
float candidateVoltage = NAN;
int stableReadingCount = 0;

unsigned long validReadingCount = 0;
double totalCurrent = 0.0;
double totalPower = 0.0;
float peakCurrent = 0.0f;
float peakPower = 0.0f;
float sessionStartEnergy = NAN;

unsigned long systemStartMillis = 0;
unsigned long lastReadMillis = 0;
unsigned long lastWifiRetryMillis = 0;
unsigned long lastBackendSendMillis = 0;
unsigned long lastNtpAttemptMillis = 0;
unsigned long backendSuccessCount = 0;
unsigned long backendFailCount = 0;
int lastBackendStatus = 0;
String lastBackendMessage = "Not sent yet";
String lastBackendTimestamp = "--";

bool filtering = true;
String filterStatus = "Startup stabilization";
bool pzemConnected = false;
unsigned long lastAcceptedMillis = 0;

// Forward declaration because the page is embedded below.
extern const char MAIN_PAGE[] PROGMEM;

// ========================= HELPERS =======================
String currentIP() {
  if (WiFi.status() == WL_CONNECTED) return WiFi.localIP().toString();
  return "Not connected";
}

void sendNoCacheHeader() {
  server.sendHeader("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
  server.sendHeader("Pragma", "no-cache");
  server.sendHeader("Expires", "0");
}

String jsonNumber(float value, int decimals) {
  if (isnan(value) || isinf(value)) return "null";
  return String(value, decimals);
}

String uptimeText() {
  unsigned long sec = (millis() - systemStartMillis) / 1000UL;
  unsigned long h = sec / 3600UL;
  unsigned long m = (sec % 3600UL) / 60UL;
  unsigned long s = sec % 60UL;

  if (h > 0) return String(h) + " h " + String(m) + " min";
  return String(m) + " min " + String(s) + " s";
}

String pfQuality(float pf) {
  if (isnan(pf)) return "--";
  if (pf >= 0.90f) return "Good";
  if (pf >= 0.80f) return "Fair";
  return "Low";
}

float sessionEnergyKWh() {
  if (isnan(sessionStartEnergy) || isnan(stableEnergy)) return NAN;
  float x = stableEnergy - sessionStartEnergy;
  return x < 0 ? 0.0f : x;
}

void clearDisplayedReading() {
  stableVoltage = NAN;
  stableCurrent = NAN;
  stablePower = NAN;
  stableEnergy = NAN;
  stableFrequency = NAN;
  stablePF = NAN;
}

void printDashboardLink(const char* prefix = "Dashboard") {
  Serial.print(prefix);
  Serial.print(" : http://");
  Serial.println(currentIP());
}

void filterLog(const String& reason, float rawV) {
  filtering = true;
  filterStatus = reason;

  Serial.print("[FILTERED] ");
  if (isnan(rawV)) Serial.print("V=NaN");
  else {
    Serial.print("V=");
    Serial.print(rawV, 1);
    Serial.print(" V");
  }
  Serial.print(" | ");
  Serial.print(reason);
  Serial.print(" | Dashboard: http://");
  Serial.println(currentIP());
}

void acceptReading(float voltage, float current, float power,
                   float energy, float frequency, float pf) {
  stableVoltage = voltage;
  stableCurrent = current;
  stablePower = power;
  stableEnergy = energy;
  stableFrequency = frequency;
  stablePF = pf;

  if (isnan(sessionStartEnergy)) sessionStartEnergy = energy;

  totalCurrent += current;
  totalPower += power;

  if (current > peakCurrent) peakCurrent = current;
  if (power > peakPower) peakPower = power;

  validReadingCount++;
  lastAcceptedMillis = millis();
  pzemConnected = true;
  filtering = false;
  filterStatus = "Stable";

  // BLE gets exactly the values accepted by the existing filter. No extra sensor reads.
  SmartPowerBle::publish({stableVoltage, stableCurrent, stablePower,
                          stableEnergy, stableFrequency, stablePF});

  Serial.print("[ACCEPTED] V=");
  Serial.print(voltage, 1);
  Serial.print(" V | I=");
  Serial.print(current, 3);
  Serial.print(" A | P=");
  Serial.print(power, 1);
  Serial.print(" W | E=");
  Serial.print(energy, 3);
  Serial.print(" kWh | F=");
  Serial.print(frequency, 1);
  Serial.print(" Hz | PF=");
  Serial.print(pf, 2);
  Serial.print(" | Dashboard: http://");
  Serial.println(currentIP());

  float sessionEnergy = sessionEnergyKWh();
  Serial.print("TOTAL ENERGY SINCE START: ");
  if (isnan(sessionEnergy)) {
    Serial.println("--");
  } else if (sessionEnergy < 1.0f) {
    Serial.print(sessionEnergy * 1000.0f, 1);
    Serial.println(" Wh");
  } else {
    Serial.print(sessionEnergy, 3);
    Serial.println(" kWh");
  }
}

// ========================= TIME ===========================
bool timeIsSynchronized() {
  time_t now = time(nullptr);
  return now >= 1704067200; // 2024-01-01 UTC
}

void startNtpSync() {
  configTime(0, 0, NTP_SERVER_1, NTP_SERVER_2, NTP_SERVER_3);
  lastNtpAttemptMillis = millis();
  Serial.println("NTP sync requested (UTC)...");
}

bool getUtcTimestamp(char* buffer, size_t bufferSize) {
  if (!timeIsSynchronized()) return false;

  time_t now = time(nullptr);
  struct tm utc;
  gmtime_r(&now, &utc);
  strftime(buffer, bufferSize, "%Y-%m-%dT%H:%M:%SZ", &utc);
  return true;
}

// ========================= BACKEND ========================
void sendReadingToBackend() {
  if (filtering) return;
  if (!pzemConnected) return;
  if (WiFi.status() != WL_CONNECTED) return;
  if (millis() - lastBackendSendMillis < BACKEND_SEND_INTERVAL) return;

  Serial.println();
  Serial.println("============================================");
  Serial.println(" BACKEND UPLOAD ATTEMPT");
  Serial.println("============================================");

  char timestamp[32];
  if (!getUtcTimestamp(timestamp, sizeof(timestamp))) {
    lastBackendMessage = "NTP time not synchronized";
    lastBackendStatus = 0;
    Serial.println("[BACKEND] Skipped - UTC time not synchronized yet.");
    printDashboardLink("Dashboard");
    return;
  }

  // Copy the currently accepted/stable reading values.
  float voltage = stableVoltage;
  float current = stableCurrent;
  float power = stablePower;
  float energy = stableEnergy;
  float frequency = stableFrequency;
  float powerFactor = stablePF;

  if (isnan(voltage) || isnan(current) || isnan(power) ||
      isnan(energy) || isnan(frequency) || isnan(powerFactor)) {
    lastBackendMessage = "Invalid stable reading";
    lastBackendStatus = 0;
    return;
  }

  String payload;
  payload.reserve(280);
  payload += "{";
  payload += "\"timestamp\":\"";
  payload += timestamp;
  payload += "\",";
  payload += "\"voltage\":";
  payload += String(voltage, 1);
  payload += ",\"current\":";
  payload += String(current, 3);
  payload += ",\"power\":";
  payload += String(power, 1);
  payload += ",\"energy\":";
  payload += String(energy, 3);
  payload += ",\"frequency\":";
  payload += String(frequency, 1);
  payload += ",\"power_factor\":";
  payload += String(powerFactor, 3);
  payload += "}";

  WiFiClientSecure client;
  if (strlen(BACKEND_ROOT_CA) > 0) {
    client.setCACert(BACKEND_ROOT_CA);
  } else {
    // Prototype fallback. Use BACKEND_ROOT_CA for certificate validation in production.
    client.setInsecure();
  }
  client.setTimeout(HTTPS_TIMEOUT_MS);

  HTTPClient https;
  https.setConnectTimeout(HTTPS_TIMEOUT_MS);
  https.setTimeout(HTTPS_TIMEOUT_MS);

  lastBackendSendMillis = millis();
  int httpCode = -1;

  if (https.begin(client, BACKEND_URL)) {
    https.addHeader("Content-Type", "application/json");
    https.addHeader("X-Ingest-Key", INGEST_API_KEY);
    https.addHeader("Accept", "application/json");

    httpCode = https.POST(payload);
    lastBackendStatus = httpCode;
    lastBackendTimestamp = String(timestamp);

    // Print the exact measurement payload being sent to Render.
    Serial.println();
    Serial.println("----------- DATA SENT TO BACKEND -----------");
    Serial.print("Timestamp    : "); Serial.println(timestamp);
    Serial.print("Voltage      : "); Serial.print(voltage, 1); Serial.println(" V");
    Serial.print("Current      : "); Serial.print(current, 3); Serial.println(" A");
    Serial.print("Power        : "); Serial.print(power, 1); Serial.println(" W");
    Serial.print("Energy       : "); Serial.print(energy, 3); Serial.println(" kWh");
    Serial.print("Frequency    : "); Serial.print(frequency, 1); Serial.println(" Hz");
    Serial.print("Power Factor : "); Serial.println(powerFactor, 3);
    Serial.print("JSON         : "); Serial.println(payload);
    Serial.println("--------------------------------------------");

    String responseBody = https.getString();
    responseBody.replace("\n", " ");
    responseBody.replace("\r", " ");
    if (responseBody.length() > 160) responseBody = responseBody.substring(0, 160);

    if (httpCode >= 200 && httpCode < 300) {
      backendSuccessCount++;
      if (httpCode == 201) {
        lastBackendMessage = "Created / received (201)";
      } else {
        lastBackendMessage = "Success (HTTP " + String(httpCode) + ")";
      }
    } else {
      backendFailCount++;
      switch (httpCode) {
        case 401: lastBackendMessage = "Unauthorized - check X-Ingest-Key"; break;
        case 409: lastBackendMessage = "Conflict - duplicate/old timestamp"; break;
        case 422: lastBackendMessage = "Unprocessable - invalid JSON/value/timestamp"; break;
        case 503: lastBackendMessage = "Service unavailable"; break;
        default:
          if (httpCode > 0) lastBackendMessage = "HTTP " + String(httpCode);
          else lastBackendMessage = "HTTPS request failed";
          break;
      }
    }

    Serial.print("[BACKEND] HTTP ");
    Serial.print(httpCode);
    Serial.print(" | ");
    Serial.print(lastBackendMessage);
    Serial.print(" | Success="); Serial.print(backendSuccessCount);
    Serial.print(" | Failed="); Serial.print(backendFailCount);
    if (responseBody.length() > 0) {
      Serial.print(" | Response: ");
      Serial.print(responseBody);
    }
    Serial.print(" | Dashboard: http://");
    Serial.println(currentIP());

    https.end();
  } else {
    lastBackendStatus = -1;
    lastBackendMessage = "HTTPS begin() failed";
    backendFailCount++;
    Serial.print("[BACKEND] HTTPS begin failed | Dashboard: http://");
    Serial.println(currentIP());
  }
}

// ========================= PZEM ==========================
void processPZEMReading() {
  float voltage = pzem.voltage();
  float current = pzem.current();
  float power = pzem.power();
  float energy = pzem.energy();
  float frequency = pzem.frequency();
  float pf = pzem.pf();

  // Communication / invalid-value protection.
  if (isnan(voltage) || isnan(current) || isnan(power) ||
      isnan(energy) || isnan(frequency) || isnan(pf)) {
    stableReadingCount = 0;
    candidateVoltage = NAN;
    clearDisplayedReading();
    pzemConnected = false;
    filterLog("PZEM read invalid / communication error", voltage);
    return;
  }

  // PZEM's documented voltage measurement window for this model.
  if (voltage < MIN_VALID_VOLTAGE || voltage > MAX_VALID_VOLTAGE) {
    stableReadingCount = 0;
    candidateVoltage = NAN;
    clearDisplayedReading();
    filterLog("Voltage outside 80-260 V range", voltage);
    return;
  }

  // Reject a large sudden change before it can reach the UI/statistics.
  if (!isnan(lastRawVoltage)) {
    float delta = fabsf(voltage - lastRawVoltage);
    if (delta > VOLTAGE_SPIKE_THRESHOLD) {
      stableReadingCount = 0;
      candidateVoltage = voltage;
      clearDisplayedReading();
      filterLog("Voltage spike rejected (change > 15 V)", voltage);
      lastRawVoltage = voltage;
      return;
    }
  }

  lastRawVoltage = voltage;
  pzemConnected = true;

  // First candidate after startup / after a reset.
  if (isnan(candidateVoltage)) {
    candidateVoltage = voltage;
    stableReadingCount = 1;
    clearDisplayedReading();
    filterLog("Waiting for stable voltage", voltage);
    return;
  }

  // Require consecutive voltage agreement.
  if (fabsf(voltage - candidateVoltage) <= VOLTAGE_STABILITY_TOLERANCE) {
    if (stableReadingCount < REQUIRED_STABLE_READINGS) stableReadingCount++;
  } else {
    candidateVoltage = voltage;
    stableReadingCount = 1;
    clearDisplayedReading();
    filterLog("Voltage changed - re-stabilizing", voltage);
    return;
  }

  if (stableReadingCount < REQUIRED_STABLE_READINGS) {
    clearDisplayedReading();
    filterLog("Stable confirmation " + String(stableReadingCount) + "/" + String(REQUIRED_STABLE_READINGS), voltage);
    return;
  }

  acceptReading(voltage, current, power, energy, frequency, pf);
}

// ========================= API ===========================
void handleRoot();
void handleData();
void handleHealth();

void handleRoot() {
  sendNoCacheHeader();
  server.send_P(200, "text/html", MAIN_PAGE);
}


void handleHealth() {
  bool wifiConnected = (WiFi.status() == WL_CONNECTED);
  String json = "{";
  json += "\"wifi\":" + String(wifiConnected ? "true" : "false") + ",";
  json += "\"pzem\":" + String(pzemConnected ? "true" : "false") + ",";
  json += "\"ip\":\"" + (wifiConnected ? WiFi.localIP().toString() : String("Not connected")) + "\",";
  json += "\"backendStatus\":" + String(lastBackendStatus) + ",";
  json += "\"backendSuccess\":" + String(backendSuccessCount) + ",";
  json += "\"backendFail\":" + String(backendFailCount) + ",";
  json += "\"backendMessage\":\"" + lastBackendMessage + "\",";
  json += "\"uptimeMs\":" + String(millis() - systemStartMillis);
  json += "}";
  sendNoCacheHeader();
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

void handleData() {
  bool wifiConnected = (WiFi.status() == WL_CONNECTED);
  String json;
  json.reserve(2400);
  json += "{";

  json += "\"ip\":\"";
  json += wifiConnected ? WiFi.localIP().toString() : "Not connected";
  json += "\",";

  json += "\"wifi\":";
  json += wifiConnected ? "true" : "false";
  json += ",";

  json += "\"pzemConnected\":";
  json += pzemConnected ? "true" : "false";
  json += ",";

  json += "\"lastAcceptedMillis\":" + String(lastAcceptedMillis) + ",";

  json += "\"filtering\":";
  json += filtering ? "true" : "false";
  json += ",";

  json += "\"filterStatus\":\"";
  json += filterStatus;
  json += "\",";

  json += "\"readingValid\":";
  json += filtering ? "false" : "true";
  json += ",";

  json += "\"tariff\":";
  json += jsonNumber(ELECTRICITY_TARIFF, 2);
  json += ",";
  json += "\"gridEmissionFactor\":";
  json += jsonNumber(GRID_EMISSION_FACTOR, 3);
  json += ",";
  json += "\"targetReductionPercent\":";
  json += jsonNumber(TARGET_REDUCTION_PERCENT, 1);
  json += ",";

  if (!filtering) {
    double avgCurrent = validReadingCount ? totalCurrent / validReadingCount : NAN;
    double avgPower = validReadingCount ? totalPower / validReadingCount : NAN;

    float sessionEnergy = sessionEnergyKWh();
    float sessionCost = sessionEnergy * ELECTRICITY_TARIFF;
    float sessionCO2e = sessionEnergy * GRID_EMISSION_FACTOR;

    float scenarioSavedEnergy = sessionEnergy * TARGET_REDUCTION_PERCENT / 100.0f;
    float scenarioSavedCost = scenarioSavedEnergy * ELECTRICITY_TARIFF;
    float scenarioAvoidedCO2e = scenarioSavedEnergy * GRID_EMISSION_FACTOR;

    float projectedMonthlyKWh = ((float)avgPower * 24.0f * 30.0f) / 1000.0f;
    float projectedMonthlyCost = projectedMonthlyKWh * ELECTRICITY_TARIFF;

    json += "\"voltage\":" + jsonNumber(stableVoltage, 1) + ",";
    json += "\"current\":" + jsonNumber(stableCurrent, 3) + ",";
    json += "\"power\":" + jsonNumber(stablePower, 1) + ",";
    json += "\"totalActivePower\":" + jsonNumber(stablePower, 1) + ",";
    json += "\"energy\":" + jsonNumber(stableEnergy, 3) + ",";
    json += "\"frequency\":" + jsonNumber(stableFrequency, 1) + ",";
    json += "\"pf\":" + jsonNumber(stablePF, 2) + ",";

    json += "\"avgCurrent\":" + jsonNumber((float)avgCurrent, 3) + ",";
    json += "\"avgPower\":" + jsonNumber((float)avgPower, 1) + ",";
    json += "\"peakCurrent\":" + jsonNumber(peakCurrent, 3) + ",";
    json += "\"peakPower\":" + jsonNumber(peakPower, 1) + ",";

    json += "\"sessionEnergy\":" + jsonNumber(sessionEnergy, 3) + ",";
    json += "\"totalEnergySinceStartKWh\":" + jsonNumber(sessionEnergy, 3) + ",";
    json += "\"totalEnergySinceStartWh\":" + jsonNumber(sessionEnergy * 1000.0f, 1) + ",";
    json += "\"estimatedCost\":" + jsonNumber(sessionCost, 2) + ",";
    json += "\"co2e\":" + jsonNumber(sessionCO2e, 3) + ",";
    json += "\"scenarioSavedEnergy\":" + jsonNumber(scenarioSavedEnergy, 3) + ",";
    json += "\"scenarioSavedCost\":" + jsonNumber(scenarioSavedCost, 2) + ",";
    json += "\"scenarioAvoidedCO2e\":" + jsonNumber(scenarioAvoidedCO2e, 3) + ",";
    json += "\"monthlyProjectionKWh\":" + jsonNumber(projectedMonthlyKWh, 1) + ",";
    json += "\"monthlyProjectionCost\":" + jsonNumber(projectedMonthlyCost, 2) + ",";
    json += "\"pfQuality\":\"" + pfQuality(stablePF) + "\",";
  } else {
    json += "\"voltage\":null,\"current\":null,\"power\":null,\"totalActivePower\":null,\"energy\":null,";
    json += "\"frequency\":null,\"pf\":null,";
    json += "\"avgCurrent\":null,\"avgPower\":null,\"peakCurrent\":null,\"peakPower\":null,";
    json += "\"sessionEnergy\":null,\"totalEnergySinceStartKWh\":null,\"totalEnergySinceStartWh\":null,\"estimatedCost\":null,\"co2e\":null,";
    json += "\"scenarioSavedEnergy\":null,\"scenarioSavedCost\":null,\"scenarioAvoidedCO2e\":null,";
    json += "\"monthlyProjectionKWh\":null,\"monthlyProjectionCost\":null,";
    json += "\"pfQuality\":\"--\",";
  }

  json += "\"validReadings\":" + String(validReadingCount) + ",";
  json += "\"uptime\":\"" + uptimeText() + "\",";
  json += "\"timestamp\":" + String(millis());
  json += "}";

  sendNoCacheHeader();
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.send(200, "application/json", json);
}

// ========================= DASHBOARD =====================
const char MAIN_PAGE[] PROGMEM = R"rawliteral(
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="theme-color" content="#07182e">
<title>Smart Power — Real-Time Energy Intelligence</title>
<style>
:root{
  --bg:#061426;--bg2:#091f39;--panel:#0d2747;--panel2:#102f51;
  --line:rgba(151,203,255,.18);--text:#f4f8ff;--muted:#9eb8d4;
  --blue:#45a6ff;--cyan:#32d9e9;--green:#37df9c;--amber:#ffb038;
  --red:#ff6473;--purple:#a981ff;--shadow:0 16px 42px rgba(0,0,0,.24)
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;color:var(--text);font-family:Inter,Segoe UI,Arial,sans-serif;background:
 radial-gradient(circle at 84% 8%,rgba(32,122,255,.22),transparent 27%),
 radial-gradient(circle at 20% 92%,rgba(28,213,165,.10),transparent 23%),
 linear-gradient(145deg,#041020,#0a2342 48%,#06182f);min-height:100vh;overflow-x:hidden}
body:before{content:"";position:fixed;inset:0;pointer-events:none;opacity:.15;background-image:
 linear-gradient(rgba(255,255,255,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.05) 1px,transparent 1px);background-size:36px 36px}
*{scrollbar-width:thin;scrollbar-color:#244b70 transparent}
.app{display:flex;min-height:100vh;position:relative;z-index:1}
.sidebar{width:238px;flex:0 0 238px;min-height:100vh;padding:24px 14px;background:rgba(2,15,30,.72);border-right:1px solid rgba(255,255,255,.07);backdrop-filter:blur(15px);display:flex;flex-direction:column;position:sticky;top:0;height:100vh}
.brand{display:flex;align-items:center;gap:11px;padding:8px 10px 22px;border-bottom:1px solid rgba(255,255,255,.08)}
.logo{width:43px;height:43px;border-radius:13px;display:grid;place-items:center;background:linear-gradient(145deg,#35e4aa,#2e91ff);box-shadow:0 0 24px rgba(49,208,180,.24);font-size:23px}
.brand b{display:block;font-size:15px}.brand span{display:block;font-size:10px;color:var(--muted);margin-top:3px}
.nav{padding-top:20px}.nav a{display:flex;align-items:center;gap:13px;color:#bdd0e5;text-decoration:none;padding:12px 13px;border-radius:11px;margin:5px 0;font-size:13px;transition:.2s}
.nav a:hover{background:rgba(69,166,255,.08);color:#fff}.nav a.active{background:linear-gradient(90deg,#1b7ff1,#1466cc);color:#fff;box-shadow:0 9px 20px rgba(20,110,225,.23)}
.navIcon{width:20px;text-align:center;font-size:17px}.sideFoot{margin-top:auto;padding:16px 10px 6px;color:#7595b5;font-size:10px;line-height:1.6}
.main{flex:1;min-width:0;padding:25px 28px 34px}.top{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;margin-bottom:20px}.title h1{margin:0;font-size:28px;line-height:1.1;letter-spacing:.1px}.title p{margin:7px 0 0;color:#9fbad7;font-size:12px}.title p b{color:#64e2ee}
.statuses{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}.pill{padding:8px 11px;border-radius:999px;font-size:11px;border:1px solid rgba(255,255,255,.11);background:rgba(2,20,38,.58);color:#cfe1f4}.pill.good{color:#75efbd;background:rgba(55,223,156,.10);border-color:rgba(55,223,156,.24)}.pill.bad{color:#ff8790;background:rgba(255,75,95,.10);border-color:rgba(255,75,95,.26)}.pill.warn{color:#ffc66f;background:rgba(255,176,56,.10);border-color:rgba(255,176,56,.25)}
.ip{margin-top:8px;text-align:right;color:#8fb0d1;font-size:10px}.ip strong{color:#eaf5ff;font-size:11px}
.section{scroll-margin-top:18px;margin-top:17px}.sectionHead{display:flex;align-items:end;justify-content:space-between;gap:12px;margin-bottom:10px}.sectionTitle{font-size:16px;font-weight:750}.sectionSub{font-size:10px;color:#7998b8}
.metrics{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:11px}.metric{padding:15px 14px;min-width:0;border:1px solid var(--line);border-radius:16px;background:linear-gradient(145deg,rgba(18,60,101,.82),rgba(7,30,57,.86));box-shadow:var(--shadow);position:relative;overflow:hidden}.metric:after{content:"";position:absolute;right:-28px;bottom:-30px;width:100px;height:100px;border-radius:50%;background:rgba(255,255,255,.04)}
.metric .mLabel{font-size:10px;color:#b4cae0}.metric .mValue{margin-top:7px;font-size:25px;font-weight:800;white-space:nowrap}.metric .unit{font-size:10px;color:#bdd1e4;margin-left:2px}.mStatus{margin-top:7px;font-size:9px;color:#87a8c7}.metric.blue{background:linear-gradient(145deg,rgba(28,116,226,.76),rgba(7,48,99,.9))}.metric.green{background:linear-gradient(145deg,rgba(20,148,109,.74),rgba(5,76,62,.92))}.metric.amber{background:linear-gradient(145deg,rgba(185,112,20,.82),rgba(87,52,8,.94))}.metric.purple{background:linear-gradient(145deg,rgba(100,67,186,.78),rgba(52,31,111,.94))}.metric.red{background:linear-gradient(145deg,rgba(180,60,78,.77),rgba(88,25,39,.94))}.metric.cyan{background:linear-gradient(145deg,rgba(8,137,153,.78),rgba(3,63,78,.94))}.totalStart{margin-top:11px;padding:14px 16px;border-radius:15px;border:1px solid rgba(74,225,194,.18);background:linear-gradient(100deg,rgba(19,111,100,.28),rgba(13,65,96,.27));display:flex;align-items:center;justify-content:space-between;gap:15px;flex-wrap:wrap}.totalStartMain{display:flex;align-items:center;gap:12px;min-width:0}.totalStartIcon{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:rgba(55,223,156,.12);border:1px solid rgba(55,223,156,.18);font-size:18px}.totalStartLabel{font-size:9px;color:#8fb5cf;text-transform:uppercase;letter-spacing:1.1px}.totalStartTitle{font-size:12px;font-weight:760;margin-top:3px}.totalStartSub{font-size:9px;color:#7ea1bd;margin-top:3px}.totalStartValue{display:flex;align-items:baseline;gap:6px;white-space:nowrap}.totalStartValue strong{font-size:25px}.totalStartValue span{font-size:11px;color:#b9d3e5}.startBadge{padding:6px 9px;border-radius:999px;font-size:9px;color:#72efbe;background:rgba(55,223,156,.10);border:1px solid rgba(55,223,156,.2)}
.grid2{display:grid;grid-template-columns:1.45fr .95fr;gap:13px}.grid3{display:grid;grid-template-columns:1.15fr .92fr .92fr;gap:13px}.panel{min-width:0;border:1px solid var(--line);border-radius:17px;background:linear-gradient(145deg,rgba(13,48,84,.76),rgba(5,26,51,.87));box-shadow:var(--shadow);padding:16px}.panelHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:11px}.panelTitle{font-size:15px;font-weight:760}.panelSub{font-size:10px;color:#7899b9;margin-top:3px}
select{border:1px solid rgba(164,214,255,.21);background:rgba(5,25,48,.58);color:#dceeff;border-radius:8px;padding:7px 9px;font-size:10px}
#chart{width:100%;height:275px;display:block;min-height:210px;box-sizing:border-box}.loadNow{padding:7px 9px;border-radius:8px;background:rgba(255,176,56,.10);border:1px solid rgba(255,176,56,.22);color:#ffd791;font-size:9px;white-space:nowrap}.loadNow strong{color:#fff;font-size:11px;margin-left:3px}.chartNote{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:7px;color:#6f90b0;font-size:8px;line-height:1.4}.stats{display:grid;grid-template-columns:1fr 1fr;gap:10px}.stat{padding:13px;border-radius:12px;background:rgba(29,78,123,.34);border:1px solid rgba(165,211,255,.12)}.statName{font-size:9px;color:#adc4dc}.statVal{margin-top:5px;font-size:20px;font-weight:800}.statUnit{font-size:9px;color:#b9cee3;margin-left:2px}
.energyWrap{display:grid;grid-template-columns:145px 1fr;gap:16px;align-items:center}.donut{width:130px;height:130px;border-radius:50%;position:relative;display:grid;place-items:center;background:conic-gradient(var(--blue) 0 40%,var(--green) 40% 83%,rgba(255,255,255,.08) 83% 100%)}.donut:after{content:"";position:absolute;width:91px;height:91px;border-radius:50%;background:#0b294b;box-shadow:inset 0 0 18px rgba(0,0,0,.28)}.donutCenter{position:relative;z-index:2;text-align:center}.donutCenter b{display:block;font-size:21px}.donutCenter span{font-size:9px;color:#b7cee5}.usage{padding:9px 0;border-bottom:1px solid rgba(255,255,255,.08)}.usage:last-child{border-bottom:0}.uLabel{font-size:9px;color:#8faecc}.uValue{margin-top:3px;font-size:18px;font-weight:780}.uHint{font-size:9px;color:#708ead;margin-top:3px}
.impactGrid{display:grid;grid-template-columns:1.25fr 1fr;gap:13px}.impactHero{display:grid;grid-template-columns:160px 1fr;gap:18px;align-items:center}.impactRing{width:145px;height:145px;border-radius:50%;display:grid;place-items:center;position:relative;background:conic-gradient(var(--green) 0 68%,rgba(255,255,255,.08) 68% 100%);box-shadow:0 0 30px rgba(55,223,156,.10)}.impactRing:after{content:"";position:absolute;width:102px;height:102px;border-radius:50%;background:#0b294b}.impactCenter{position:relative;z-index:2;text-align:center}.impactCenter b{display:block;font-size:22px}.impactCenter span{font-size:9px;color:#b7cee5}.eyebrow{font-size:9px;color:#78dbe7;text-transform:uppercase;letter-spacing:1.5px}.impactCopy{font-size:12px;color:#dbeaf7;line-height:1.5;margin-top:5px}.impactMetrics{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px}.impactMetric{padding:10px;border-radius:12px;background:rgba(14,87,81,.22);border:1px solid rgba(100,238,191,.13)}.impactMetric small{display:block;font-size:8px;color:#9cc1bf}.impactMetric b{display:block;font-size:16px;margin-top:3px}.insight{padding:11px;border-radius:12px;background:rgba(23,66,106,.33);border:1px solid rgba(160,209,255,.12);margin-bottom:9px}.insight:last-child{margin-bottom:0}.iHead{display:flex;align-items:center;gap:7px}.iDot{width:8px;height:8px;border-radius:50%;background:var(--cyan);box-shadow:0 0 12px rgba(50,217,233,.42)}.iTitle{font-size:10px;font-weight:760}.iText{font-size:9px;color:#aec6dd;line-height:1.45;margin-top:5px}
.infoList{display:grid;gap:8px}.infoRow{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:10px 11px;background:rgba(23,66,106,.30);border:1px solid rgba(160,209,255,.10);border-radius:11px}.infoName{font-size:9px;color:#aac1d8}.infoValue{font-size:10px;font-weight:750}.footer{text-align:center;margin-top:14px;color:#6283a5;font-size:9px}
.banner{display:flex;gap:10px;align-items:center;padding:11px 13px;border-radius:13px;margin-top:13px;border:1px solid rgba(50,217,233,.16);background:linear-gradient(90deg,rgba(25,114,155,.24),rgba(10,64,91,.22))}.bannerIcon{font-size:18px}.banner b{font-size:11px}.banner span{display:block;font-size:9px;color:#9fc0d7;margin-top:2px}
@media(max-width:1250px){.metrics{grid-template-columns:repeat(3,1fr)}.grid3{grid-template-columns:1fr 1fr}.impactGrid{grid-template-columns:1fr}}
@media(max-width:900px){.sidebar{width:74px;flex-basis:74px;padding:18px 7px}.brand{justify-content:center;padding:8px 4px 18px}.brandText,.nav a span,.sideFoot{display:none}.nav a{justify-content:center;padding:12px 7px}.main{padding:17px}.top{flex-direction:column}.statuses{justify-content:flex-start}.ip{text-align:left}.grid2,.grid3{grid-template-columns:1fr}.impactHero{grid-template-columns:1fr}.impactRing{margin:auto}}
@media(max-width:600px){.metrics{grid-template-columns:1fr 1fr}.metric .mValue{font-size:21px}.energyWrap{grid-template-columns:1fr}.donut{margin:auto}.title h1{font-size:23px}.main{padding:14px}.panel{padding:13px}#chart{height:235px}.loadNow{font-size:8px}.loadNow strong{font-size:10px}.totalStart{padding:12px}.totalStartValue strong{font-size:21px}}
</style>
</head>
<body>
<div class="app">
  <aside class="sidebar">
    <div class="brand"><div class="logo">⚡</div><div class="brandText"><b>SMART POWER</b><span>Real-Time Energy Intelligence</span></div></div>
    <nav class="nav">
      <a class="active" href="#top"><div class="navIcon">⌂</div><span>Dashboard</span></a>
      <a href="#live"><div class="navIcon">∿</div><span>Live Monitoring</span></a>
      <a href="#usage"><div class="navIcon">▥</div><span>Energy Usage</span></a>
      <a href="#impact"><div class="navIcon">♻</div><span>Environmental</span></a>
      <a href="#system"><div class="navIcon">⚙</div><span>System</span></a>
    </nav>
    <div class="sideFoot">ESP32 + PZEM-004T V3.0<br>Local-first monitoring<br>No cloud required</div>
  </aside>

  <main class="main" id="top">
    <div class="top">
      <div class="title">
        <h1>Smart Real-Time Power Monitoring System</h1>
        <p>ESP32 + PZEM-004T V3.0 <b>• Local Energy Intelligence</b></p>
      </div>
      <div>
        <div class="statuses"><div id="pzemPill" class="pill good">● PZEM Connected</div><div id="filterPill" class="pill good">● Stable</div><div id="wifiPill" class="pill good">● Wi-Fi Connected</div><div id="backendPill" class="pill warn">● Backend Waiting</div></div>
        <div class="ip">Dashboard IP: <strong id="ipAddress">Checking...</strong><br><span style="color:#6283a5">Optional: http://smartpower.local</span></div>
      </div>
    </div>

    <section class="section" id="live">
      <div class="sectionHead"><div><div class="sectionTitle">⚡ Live Electrical Data</div><div class="sectionSub">Only accepted and stable measurements are displayed</div></div><div class="sectionSub">Updates every ~2 seconds</div></div>
      <div class="metrics">
        <div class="metric blue"><div class="mLabel">Voltage</div><div class="mValue"><span id="voltage">--</span><span class="unit">V</span></div><div class="mStatus">AC supply</div></div>
        <div class="metric green"><div class="mLabel">Current</div><div class="mValue"><span id="current">--</span><span class="unit">A</span></div><div class="mStatus">Live load</div></div>
        <div class="metric amber"><div class="mLabel">Total Active Power</div><div class="mValue"><span id="power">--</span><span class="unit" id="powerUnit">W</span></div><div class="mStatus">Combined monitored load</div></div>
        <div class="metric purple"><div class="mLabel">Meter Energy</div><div class="mValue"><span id="energy">--</span><span class="unit">kWh</span></div><div class="mStatus">PZEM cumulative meter value</div></div>
        <div class="metric red"><div class="mLabel">Frequency</div><div class="mValue"><span id="frequency">--</span><span class="unit">Hz</span></div><div class="mStatus">AC frequency</div></div>
        <div class="metric cyan"><div class="mLabel">Power Factor</div><div class="mValue"><span id="pf">--</span></div><div class="mStatus" id="pfBadge">--</div></div>
      </div>

      <div class="totalStart">
        <div class="totalStartMain">
          <div class="totalStartIcon">∑</div>
          <div>
            <div class="totalStartLabel">Cumulative Consumption</div>
            <div class="totalStartTitle">Total Energy Consumed Since Monitoring Started</div>
            <div class="totalStartSub">Combined monitored load • measured from the PZEM energy delta • filtered readings excluded</div>
          </div>
        </div>
        <div class="totalStartValue"><strong id="totalEnergySinceStart">--</strong><span id="totalEnergySinceStartUnit">Wh</span><span class="startBadge">SINCE START</span></div>
      </div>

      <div class="grid2" style="margin-top:13px">
        <section class="panel">
          <div class="panelHead"><div><div class="panelTitle">Power Consumption</div><div class="panelSub">Total active power • adaptive scale • accepted readings only</div></div><div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end"><div class="loadNow">Total Load <strong id="totalLoad">-- W</strong></div><select id="timeWindow"><option value="1m">1 min</option><option value="5m">5 min</option><option value="10m" selected>10 min</option><option value="30m">30 min</option><option value="1h">1 hour</option><option value="7d">7 days</option></select></div></div>
          <canvas id="chart"></canvas>
          <div class="chartNote"><span>Adaptive scale + automatic W/kW units keep minor power changes visible.</span><span id="historyNote">Short windows: 1-second accepted samples • 7 days: 5-minute aggregates</span></div>
        </section>
        <section class="panel">
          <div class="panelHead"><div><div class="panelTitle">Session Analytics</div><div class="panelSub">Filtered readings excluded</div></div></div>
          <div class="stats">
            <div class="stat"><div class="statName">Average Current</div><div class="statVal"><span id="avgCurrent">--</span><span class="statUnit">A</span></div></div>
            <div class="stat"><div class="statName">Average Power</div><div class="statVal"><span id="avgPower">--</span><span class="statUnit">W</span></div></div>
            <div class="stat"><div class="statName">Peak Current</div><div class="statVal"><span id="peakCurrent">--</span><span class="statUnit">A</span></div></div>
            <div class="stat"><div class="statName">Peak Power</div><div class="statVal"><span id="peakPower">--</span><span class="statUnit">W</span></div></div>
          </div>
        </section>
      </div>
    </section>

    <section class="section" id="usage">
      <div class="sectionHead"><div><div class="sectionTitle">▥ Energy Usage & Cost</div><div class="sectionSub">Consumption translated into practical cost information</div></div></div>
      <div class="grid3">
        <section class="panel">
          <div class="panelHead"><div><div class="panelTitle">Session Energy</div><div class="panelSub">Since this monitoring session started</div></div></div>
          <div class="energyWrap"><div class="donut"><div class="donutCenter"><b id="sessionEnergy">--</b><span id="sessionEnergyUnit">Wh</span></div></div><div>
            <div class="usage"><div class="uLabel">Total Since Start</div><div class="uValue"><span id="sessionEnergy2">--</span></div><div class="uHint">Combined monitored energy since the first valid reading</div></div>
            <div class="usage"><div class="uLabel">Estimated Cost</div><div class="uValue">₹<span id="estimatedCost">--</span></div><div class="uHint">Configured tariff: ₹<span id="tariffText">8.00</span> / kWh</div></div>
            <div class="usage"><div class="uLabel">Monthly Projection</div><div class="uValue"><span id="monthlyProjectionKWh">--</span> kWh</div><div class="uHint">Based on current average power</div></div>
          </div></div>
        </section>

        <section class="panel">
          <div class="panelHead"><div><div class="panelTitle">Cost Projection</div><div class="panelSub">Simple projection, not an official utility bill</div></div></div>
          <div class="usage"><div class="uLabel">Projected 30-Day Energy</div><div class="uValue"><span id="monthlyEnergy2">--</span> kWh</div></div>
          <div class="usage"><div class="uLabel">Projected 30-Day Cost</div><div class="uValue">₹<span id="monthlyCost">--</span></div></div>
          <div class="usage"><div class="uLabel">Valid Readings</div><div class="uValue" id="validReadings">0</div><div class="uHint">Only stable readings counted</div></div>
        </section>

        <section class="panel">
          <div class="panelHead"><div><div class="panelTitle">Energy Flow</div><div class="panelSub">Measurement → money</div></div></div>
          <div class="usage"><div class="uLabel">POWER NOW</div><div class="uValue"><span id="flowPower">--</span> <span id="flowPowerUnit">W</span></div></div>
          <div class="usage"><div class="uLabel">ENERGY THIS SESSION</div><div class="uValue"><span id="flowEnergy">--</span> <span id="flowEnergyUnit">Wh</span></div></div>
          <div class="usage"><div class="uLabel">ESTIMATED COST</div><div class="uValue">₹<span id="flowCost">--</span></div></div>
          <div class="uHint">One CT/PZEM measures the combined monitored load. Individual appliance values require separate sensing points.</div>
        </section>
      </div>
    </section>

    <div class="banner"><div class="bannerIcon">◎</div><div><b>Local-first monitoring</b><span>Your phone/laptop only needs to be on the same Wi-Fi network as the ESP32. No cloud service is required for the live dashboard.</span></div></div>

    <section class="section" id="impact">
      <div class="sectionHead"><div><div class="sectionTitle">♻ Environmental Impact & Efficiency</div><div class="sectionSub">Calculated estimates — not direct carbon measurements</div></div></div>
      <div class="impactGrid">
        <section class="panel">
          <div class="panelHead"><div><div class="panelTitle">Your Electricity Impact</div><div class="panelSub">Estimated from session energy and a configurable grid factor</div></div><div class="pill good">Impact Estimate</div></div>
          <div class="impactHero">
            <div class="impactRing" id="impactRing"><div class="impactCenter"><b id="co2e">--</b><span>kg CO2e</span></div></div>
            <div>
              <div class="eyebrow">ENERGY → CO2e</div>
              <div class="impactCopy">Every unit of electricity used has an associated emissions factor. Monitoring makes energy use visible and creates opportunities to reduce unnecessary consumption.</div>
              <div class="impactMetrics">
                <div class="impactMetric"><small>Energy Used</small><b><span id="impactEnergy">--</span> kWh</b></div>
                <div class="impactMetric"><small>Session Cost</small><b>₹<span id="impactCost">--</span></b></div>
                <div class="impactMetric"><small>10% Reduction Scenario</small><b><span id="scenarioEnergy">--</span> kWh</b></div>
                <div class="impactMetric"><small>Potential CO2e Avoided</small><b><span id="scenarioCO2">--</span> kg</b></div>
              </div>
            </div>
          </div>
          <div class="uHint" style="margin-top:12px">CO2e estimate = energy consumed × configured emission factor. The 10% figures are a scenario, not measured savings. Update the factor in the ESP32 code using your documented regional source/year.</div>
        </section>

        <section class="panel">
          <div class="panelHead"><div><div class="panelTitle">💡 Smart Energy Insights</div><div class="panelSub">Simple, transparent calculations from accepted data</div></div></div>
          <div class="insight"><div class="iHead"><span class="iDot"></span><span class="iTitle">Consumption → Cost</span></div><div class="iText" id="costInsight">Waiting for stable readings...</div></div>
          <div class="insight"><div class="iHead"><span class="iDot" style="background:var(--green)"></span><span class="iTitle">Efficiency Scenario</span></div><div class="iText" id="savingInsight">A 10% reduction scenario will be shown after valid energy data is available.</div></div>
          <div class="insight"><div class="iHead"><span class="iDot" style="background:var(--amber)"></span><span class="iTitle">Peak Load</span></div><div class="iText" id="peakInsight">Waiting for peak-power data...</div></div>
          <div class="insight"><div class="iHead"><span class="iDot" style="background:var(--purple)"></span><span class="iTitle">Monthly Projection</span></div><div class="iText" id="projectionInsight">Building a projection from current average power...</div></div>
        </section>
      </div>
    </section>

    <section class="section" id="system">
      <div class="sectionHead"><div><div class="sectionTitle">⚙ System Information</div><div class="sectionSub">Controller, sensor and network health</div></div></div>
      <div class="grid3">
        <section class="panel">
          <div class="infoList">
            <div class="infoRow"><span class="infoName">ESP32</span><span class="infoValue" id="espStatus">Online</span></div>
            <div class="infoRow"><span class="infoName">PZEM</span><span class="infoValue" id="systemPzem">Connected</span></div>
            <div class="infoRow"><span class="infoName">Wi-Fi</span><span class="infoValue" id="systemWifi">Connected</span></div>
            <div class="infoRow"><span class="infoName">Network IP</span><span class="infoValue" id="networkIp">--</span></div>
            <div class="infoRow"><span class="infoName">Backend</span><span class="infoValue" id="backendInfo">Waiting</span></div>
            <div class="infoRow"><span class="infoName">Last Sync</span><span class="infoValue" id="backendLastSync">--</span></div>
          </div>
        </section>
        <section class="panel">
          <div class="infoList">
            <div class="infoRow"><span class="infoName">Uptime</span><span class="infoValue" id="uptime">--</span></div>
            <div class="infoRow"><span class="infoName">Sampling Interval</span><span class="infoValue">1 sec</span></div>
            <div class="infoRow"><span class="infoName">Valid Readings</span><span class="infoValue" id="validReadings2">0</span></div>
            <div class="infoRow"><span class="infoName">Filter State</span><span class="infoValue" id="filterState2">Stable</span></div>
          </div>
        </section>
        <section class="panel">
          <div class="panelHead"><div><div class="panelTitle">Measurement Quality</div><div class="panelSub">Transient protection active</div></div></div>
          <div class="insight"><div class="iHead"><span class="iDot" style="background:var(--green)"></span><span class="iTitle">Stable readings only</span></div><div class="iText">Sudden voltage changes and invalid PZEM readings are rejected before they reach the dashboard statistics.</div></div>
          <div class="insight"><div class="iHead"><span class="iDot" style="background:var(--cyan)"></span><span class="iTitle">Hardware flow</span></div><div class="iText">230 V AC + external CT → PZEM → UART → ESP32 → local web dashboard.</div></div>
        </section>
      </div>
    </section>

    <div class="footer">SMART POWER • ESP32 local web server • Real-time electrical monitoring • Adaptive multi-window history is retained in this browser</div>
  </main>
</div>

<script>
const HISTORY_KEY = 'smartPowerHistoryV3';
const WINDOW_MS = {
  '1m': 60 * 1000,
  '5m': 5 * 60 * 1000,
  '10m': 10 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

let selectedWindow = '10m';
let lastSampleKey = '';
let lastPersistMs = 0;
let lastSuccessfulFetch = 0;
let historyStore = loadHistoryStore();

function loadHistoryStore(){
  try{
    const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || '{}');
    return {
      raw: Array.isArray(parsed.raw) ? parsed.raw : [],
      minute: Array.isArray(parsed.minute) ? parsed.minute : [],
      fiveMinute: Array.isArray(parsed.fiveMinute) ? parsed.fiveMinute : []
    };
  }catch(e){
    return {raw:[], minute:[], fiveMinute:[]};
  }
}

function persistHistory(){
  try{
    localStorage.setItem(HISTORY_KEY, JSON.stringify(historyStore));
    lastPersistMs = Date.now();
  }catch(e){
    // Keep the live dashboard working even if browser storage is unavailable/full.
  }
}

function pruneHistory(now){
  const rawCutoff = now - WINDOW_MS['1h'];
  const minuteCutoff = now - 24 * 60 * 60 * 1000;
  const fiveMinuteCutoff = now - WINDOW_MS['7d'];

  historyStore.raw = historyStore.raw.filter(p => p.t >= rawCutoff);
  historyStore.minute = historyStore.minute.filter(p => p.t >= minuteCutoff);
  historyStore.fiveMinute = historyStore.fiveMinute.filter(p => p.t >= fiveMinuteCutoff);
}

function addAggregate(target, point, binMs){
  const binStart = Math.floor(point.t / binMs) * binMs;
  const last = target[target.length - 1];

  if(!last || last.t !== binStart){
    target.push({t:binStart, sum:point.power, count:1, min:point.power, max:point.power});
    return;
  }

  last.sum += point.power;
  last.count += 1;
  last.min = Math.min(last.min, point.power);
  last.max = Math.max(last.max, point.power);
}

function recordHistory(powerValue){
  if(powerValue === null || powerValue === undefined || Number.isNaN(Number(powerValue))) return;

  const now = Date.now();
  const point = {t:now, power:Number(powerValue)};

  historyStore.raw.push(point);
  addAggregate(historyStore.minute, point, 60 * 1000);
  addAggregate(historyStore.fiveMinute, point, 5 * 60 * 1000);
  pruneHistory(now);

  // Avoid writing the full 7-day dataset to flash/storage on every 2-second sample.
  if(now - lastPersistMs >= 10000){
    persistHistory();
    lastPersistMs = now;
  }

  drawChart();
}

function pointsForWindow(windowKey){
  const now=Date.now();
  const cutoff=now-WINDOW_MS[windowKey];
  let source;

  if(windowKey==='7d'){
    source=historyStore.fiveMinute;
  }else{
    source=historyStore.raw;
  }

  return source
    .filter(p=>Number.isFinite(Number(p.t)) && Number(p.t)>=cutoff && Number.isFinite(Number(p.power ?? p.sum)))
    .map(p=>{
      if(windowKey==='7d'){
        return {t:Number(p.t),power:p.count?Number(p.sum)/Number(p.count):0,min:Number(p.min),max:Number(p.max)};
      }
      return {t:Number(p.t),power:Number(p.power)};
    })
    .sort((a,b)=>a.t-b.t);
}

function formatPowerValue(watts){
  const n=Number(watts);
  if(!Number.isFinite(n)) return {value:'--',unit:'W'};
  if(Math.abs(n)>=1000) return {value:(n/1000).toFixed(2),unit:'kW'};
  if(Math.abs(n)>=100) return {value:n.toFixed(1),unit:'W'};
  return {value:n.toFixed(2),unit:'W'};
}

function setPowerDisplay(valueId,unitId,watts){
  const f=formatPowerValue(watts);
  const valueEl=document.getElementById(valueId);
  const unitEl=document.getElementById(unitId);
  if(valueEl) valueEl.textContent=f.value;
  if(unitEl) unitEl.textContent=f.unit;
}

function formatEnergyValue(kWh){
  const n=Number(kWh);
  if(!Number.isFinite(n)) return {value:'--',unit:'Wh'};
  const wh=n*1000;
  if(Math.abs(wh)>=1000) return {value:n.toFixed(3),unit:'kWh'};
  if(Math.abs(wh)>=100) return {value:wh.toFixed(0),unit:'Wh'};
  if(Math.abs(wh)>=10) return {value:wh.toFixed(1),unit:'Wh'};
  return {value:wh.toFixed(2),unit:'Wh'};
}

function setEnergyDisplay(valueId,unitId,kWh){
  const f=formatEnergyValue(kWh);
  const valueEl=document.getElementById(valueId);
  const unitEl=document.getElementById(unitId);
  if(valueEl) valueEl.textContent=f.value;
  if(unitEl) unitEl.textContent=f.unit;
}

function setText(id,value,digits){
  const e=document.getElementById(id);
  if(!e)return;
  if(value===null||value===undefined||Number.isNaN(Number(value))) e.textContent='--';
  else e.textContent=Number(value).toFixed(digits);
}

function updatePills(d){
  const pzem=document.getElementById('pzemPill');
  const filter=document.getElementById('filterPill');
  const wifi=document.getElementById('wifiPill');
  const systemPzem=document.getElementById('systemPzem');
  const systemWifi=document.getElementById('systemWifi');
  const filterState=document.getElementById('filterState2');
  const backend=document.getElementById('backendPill');
  const backendInfo=document.getElementById('backendInfo');

  wifi.textContent=d.wifi?'● Wi-Fi Connected':'○ Wi-Fi Disconnected';
  wifi.className=d.wifi?'pill good':'pill warn';
  systemWifi.textContent=d.wifi?'Connected':'Disconnected';

  if(!d.pzemConnected){
    pzem.textContent='● PZEM Not Responding';
    pzem.className='pill bad';
    systemPzem.textContent='Not responding';
  }else if(d.filtering){
    pzem.textContent='● PZEM Connected • Filtering';
    pzem.className='pill warn';
    systemPzem.textContent='Connected / filtering';
  }else{
    pzem.textContent='● PZEM Connected';
    pzem.className='pill good';
    systemPzem.textContent='Connected';
  }

  if(d.filtering){
    filter.textContent='● '+d.filterStatus;
    filter.className='pill warn';
    filterState.textContent=d.filterStatus;
  }else{
    filter.textContent='● Stable';
    filter.className='pill good';
    filterState.textContent='Stable';
  }

  if(d.backendStatus===201){
    backend.textContent='● Backend Synced';
    backend.className='pill good';
    backendInfo.textContent='Synced (201)';
  }else if(d.backendStatus>=200 && d.backendStatus<300){
    backend.textContent='● Backend OK ('+d.backendStatus+')';
    backend.className='pill good';
    backendInfo.textContent='OK ('+d.backendStatus+')';
  }else if(d.backendStatus===401){
    backend.textContent='● Backend Key Error';
    backend.className='pill bad';
    backendInfo.textContent='401 Key error';
  }else if(d.backendStatus===409){
    backend.textContent='● Duplicate Timestamp';
    backend.className='pill warn';
    backendInfo.textContent='409 Duplicate';
  }else if(d.backendStatus===422){
    backend.textContent='● Backend Rejected Data';
    backend.className='pill bad';
    backendInfo.textContent='422 Invalid data';
  }else if(d.backendStatus===503){
    backend.textContent='● Backend Unavailable';
    backend.className='pill warn';
    backendInfo.textContent='503 Unavailable';
  }else{
    backend.textContent='● Backend Waiting';
    backend.className='pill warn';
    backendInfo.textContent=d.wifi?'Waiting':'Wi-Fi offline';
  }
}

function niceNumber(value){
  const abs=Math.abs(value);
  if(abs>=1000) return value.toFixed(0);
  if(abs>=100) return value.toFixed(1);
  if(abs>=10) return value.toFixed(1);
  return value.toFixed(2);
}

function adaptiveScale(values){
  let min=Math.min(...values);
  let max=Math.max(...values);

  if(!Number.isFinite(min) || !Number.isFinite(max)) return {min:0,max:1};

  const range=max-min;
  // Force a small but meaningful range when the load is nearly constant.
  const minimumRange=Math.max(Math.abs(max)*0.04, 1.0);
  const workingRange=Math.max(range, minimumRange);
  const padding=workingRange*0.22;

  let lower=min-padding;
  let upper=max+padding;

  // Active power should not go below zero on the graph.
  lower=Math.max(0, lower);

  if(upper-lower < minimumRange){
    upper=lower+minimumRange;
  }

  return {min:lower,max:upper};
}

function formatTime(ts, windowKey){
  const d=new Date(ts);
  if(windowKey==='7d'){
    return d.toLocaleDateString([], {month:'short',day:'numeric'});
  }
  return d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:windowKey==='1m'?'2-digit':undefined});
}

function drawChart(){
  const c=document.getElementById('chart');
  if(!c)return;

  const rect=c.getBoundingClientRect();
  const dpr=Math.max(1,Math.min(2,window.devicePixelRatio||1));
  const w=Math.max(320,Math.floor(rect.width||320));
  const h=Math.max(210,Math.floor(rect.height||275));

  if(c.width!==Math.floor(w*dpr)) c.width=Math.floor(w*dpr);
  if(c.height!==Math.floor(h*dpr)) c.height=Math.floor(h*dpr);

  const ctx=c.getContext('2d');
  if(!ctx)return;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);

  const pad={l:54,r:16,t:16,b:36};
  const cw=Math.max(40,w-pad.l-pad.r);
  const ch=Math.max(40,h-pad.t-pad.b);
  const points=pointsForWindow(selectedWindow);
  const values=points.map(p=>Number(p.power)).filter(Number.isFinite);

  // Background grid always renders, even before data arrives.
  ctx.strokeStyle='rgba(182,220,255,.12)';
  ctx.lineWidth=1;
  for(let i=0;i<5;i++){
    const y=pad.t+ch*i/4;
    ctx.beginPath();
    ctx.moveTo(pad.l,y);
    ctx.lineTo(w-pad.r,y);
    ctx.stroke();
  }

  if(points.length===0 || values.length===0){
    ctx.fillStyle='rgba(190,214,236,.72)';
    ctx.font='12px Segoe UI';
    ctx.fillText('Waiting for stable power readings...',pad.l+8,pad.t+25);
    ctx.fillStyle='rgba(126,162,194,.62)';
    ctx.font='9px Segoe UI';
    ctx.fillText('Keep this dashboard open to build local history.',pad.l+8,pad.t+42);
    return;
  }

  const powerUnit=Math.max(...values)>=1000?'kW':'W';
  const divisor=powerUnit==='kW'?1000:1;
  const scaledPoints=points.map(p=>({...p,displayPower:Number(p.power)/divisor}));
  const scaledValues=scaledPoints.map(p=>p.displayPower);
  const scale=adaptiveScale(scaledValues);
  const yRange=Math.max(0.000001,scale.max-scale.min);
  const xAt=i=>scaledPoints.length===1?pad.l+cw/2:pad.l+(cw*i/(scaledPoints.length-1));
  const yAt=v=>pad.t+ch-((v-scale.min)/yRange)*ch;

  ctx.fillStyle='rgba(182,214,236,.70)';
  ctx.font='10px Segoe UI';
  for(let i=0;i<5;i++){
    const v=scale.max-(scale.max-scale.min)*i/4;
    ctx.fillText(niceNumber(v)+' '+powerUnit,4,pad.t+ch*i/4+3);
  }

  if(scaledPoints.length>=2){
    // Area.
    ctx.beginPath();
    ctx.moveTo(xAt(0),yAt(scaledPoints[0].displayPower));
    for(let i=1;i<scaledPoints.length;i++) ctx.lineTo(xAt(i),yAt(scaledPoints[i].displayPower));
    ctx.lineTo(xAt(scaledPoints.length-1),pad.t+ch);
    ctx.lineTo(xAt(0),pad.t+ch);
    ctx.closePath();
    const g=ctx.createLinearGradient(0,pad.t,0,pad.t+ch);
    g.addColorStop(0,'rgba(255,176,56,.30)');
    g.addColorStop(1,'rgba(255,176,56,0)');
    ctx.fillStyle=g;
    ctx.fill();

    // Line.
    ctx.beginPath();
    ctx.moveTo(xAt(0),yAt(scaledPoints[0].displayPower));
    for(let i=1;i<scaledPoints.length;i++) ctx.lineTo(xAt(i),yAt(scaledPoints[i].displayPower));
    ctx.strokeStyle='#ffb038';
    ctx.lineWidth=2.6;
    ctx.lineJoin='round';
    ctx.lineCap='round';
    ctx.stroke();
  }

  const li=scaledPoints.length-1;
  ctx.beginPath();
  ctx.arc(xAt(li),yAt(scaledPoints[li].displayPower),4.5,0,Math.PI*2);
  ctx.fillStyle='#ffe09c';
  ctx.fill();

  ctx.fillStyle='rgba(150,181,209,.72)';
  ctx.font='9px Segoe UI';
  const labelIndexes=scaledPoints.length===1?[0]:[0,Math.floor((scaledPoints.length-1)/2),scaledPoints.length-1];
  labelIndexes.forEach((idx,pos)=>{
    const label=formatTime(scaledPoints[idx].t,selectedWindow);
    const x=xAt(idx);
    const width=ctx.measureText(label).width;
    const drawX=pos===0?x:pos===labelIndexes.length-1?x-width:x-width/2;
    ctx.fillText(label,Math.max(pad.l,Math.min(w-pad.r-width,drawX)),h-9);
  });
}

function resetHistory(){
  historyStore={raw:[],minute:[],fiveMinute:[]};
  persistHistory();
  drawChart();
}

async function updateDashboard(){
  try{
    const controller=new AbortController();
    const timeoutId=setTimeout(()=>controller.abort(),2500);
    const res=await fetch('/data',{cache:'no-store',signal:controller.signal});
    clearTimeout(timeoutId);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const d=await res.json();
    if(!d || typeof d!=='object') throw new Error('Invalid /data response');
    lastSuccessfulFetch=Date.now();

    document.getElementById('ipAddress').textContent=d.ip;
    document.getElementById('networkIp').textContent=d.ip;
    document.getElementById('tariffText').textContent=Number(d.tariff||0).toFixed(2);
    document.getElementById('backendLastSync').textContent=d.backendLastTimestamp||'--';
    updatePills(d);

    if(!d.readingValid){
      ['voltage','current','power','energy','frequency','pf','avgCurrent','avgPower','peakCurrent','peakPower','sessionEnergy','totalEnergySinceStart','co2e','impactEnergy','impactCost','scenarioEnergy','scenarioCO2','monthlyProjectionKWh','monthlyEnergy2'].forEach(id=>setText(id,null,3));
      document.getElementById('powerUnit').textContent='W';
      document.getElementById('totalEnergySinceStartUnit').textContent='Wh';
      document.getElementById('sessionEnergyUnit').textContent='Wh';
      ['estimatedCost','flowCost','monthlyCost'].forEach(id=>document.getElementById(id).textContent='--');
      document.getElementById('flowPower').textContent='--';
      document.getElementById('flowPowerUnit').textContent='W';
      document.getElementById('flowEnergy').textContent='--';
      document.getElementById('flowEnergyUnit').textContent='Wh';
      document.getElementById('totalLoad').textContent='--';
      document.getElementById('costInsight').textContent='Waiting for a valid/stable reading before calculating cost.';
      document.getElementById('savingInsight').textContent='Waiting for enough valid data to calculate the 10% reduction scenario.';
      document.getElementById('peakInsight').textContent='Waiting for peak-power data...';
      document.getElementById('projectionInsight').textContent='Building a projection from current average power...';
    }else{
      setText('voltage',d.voltage,1);
      setText('current',d.current,3);
      setPowerDisplay('power','powerUnit',d.totalActivePower ?? d.power);
      setText('energy',d.energy,3);
      setText('frequency',d.frequency,1);
      setText('pf',d.pf,2);
      setText('avgCurrent',d.avgCurrent,3);
      setText('avgPower',d.avgPower,1);
      setText('peakCurrent',d.peakCurrent,3);
      setText('peakPower',d.peakPower,1);

      document.getElementById('pfBadge').textContent=d.pfQuality;
      const currentPower=Number(d.totalActivePower ?? d.power);
      const currentPowerFormatted=formatPowerValue(currentPower);
      document.getElementById('totalLoad').textContent=currentPowerFormatted.value+' '+currentPowerFormatted.unit;

      setEnergyDisplay('sessionEnergy','sessionEnergyUnit',d.sessionEnergy);
      setEnergyDisplay('totalEnergySinceStart','totalEnergySinceStartUnit',d.totalEnergySinceStartKWh ?? d.sessionEnergy);
      const sessionEnergyFormatted=formatEnergyValue(d.sessionEnergy);
      document.getElementById('sessionEnergy2').textContent=sessionEnergyFormatted.value+' '+sessionEnergyFormatted.unit;
      document.getElementById('estimatedCost').textContent=Number(d.estimatedCost).toFixed(2);
      setText('monthlyProjectionKWh',d.monthlyProjectionKWh,1);
      setText('monthlyEnergy2',d.monthlyProjectionKWh,1);
      document.getElementById('monthlyCost').textContent=Number(d.monthlyProjectionCost).toFixed(2);
      const flowPowerFormatted=formatPowerValue(currentPower);
      document.getElementById('flowPower').textContent=flowPowerFormatted.value;
      document.getElementById('flowPowerUnit').textContent=flowPowerFormatted.unit;
      const flowEnergyFormatted=formatEnergyValue(d.sessionEnergy);
      document.getElementById('flowEnergy').textContent=flowEnergyFormatted.value;
      document.getElementById('flowEnergyUnit').textContent=flowEnergyFormatted.unit;
      document.getElementById('flowCost').textContent=Number(d.estimatedCost).toFixed(2);
      setText('co2e',d.co2e,3);
      setText('impactEnergy',d.sessionEnergy,3);
      setText('impactCost',d.estimatedCost,2);
      setText('scenarioEnergy',d.scenarioSavedEnergy,3);
      setText('scenarioCO2',d.scenarioAvoidedCO2e,3);

      const pct=d.scenarioAvoidedCO2e>0?68:10;
      document.getElementById('impactRing').style.background='conic-gradient(var(--green) 0 '+pct+'%,rgba(255,255,255,.08) '+pct+'% 100%)';
      document.getElementById('costInsight').textContent='This session used '+Number(d.sessionEnergy).toFixed(3)+' kWh, costing an estimated ₹'+Number(d.estimatedCost).toFixed(2)+' at ₹'+Number(d.tariff).toFixed(2)+' / kWh.';
      document.getElementById('savingInsight').textContent='A '+Number(d.targetReductionPercent).toFixed(0)+'% lower-use scenario would avoid about '+Number(d.scenarioSavedEnergy).toFixed(3)+' kWh, ₹'+Number(d.scenarioSavedCost).toFixed(2)+' and '+Number(d.scenarioAvoidedCO2e).toFixed(3)+' kg CO2e for the same period.';
      document.getElementById('peakInsight').textContent='Peak power is '+Number(d.peakPower).toFixed(1)+' W and peak current is '+Number(d.peakCurrent).toFixed(3)+' A.';
      document.getElementById('projectionInsight').textContent='At the current average power, a simple 30-day projection is about '+Number(d.monthlyProjectionKWh).toFixed(1)+' kWh and ₹'+Number(d.monthlyProjectionCost).toFixed(2)+'.';

      const sampleKey=String(d.timestamp)+':'+String(d.validReadings);
      if(sampleKey!==lastSampleKey){
        lastSampleKey=sampleKey;
        try{ recordHistory(Number(d.totalActivePower ?? d.power)); }catch(chartError){ console.error('History/chart error:',chartError); }
      }
    }

    document.getElementById('validReadings').textContent=d.validReadings;
    document.getElementById('validReadings2').textContent=d.validReadings;
    document.getElementById('uptime').textContent=d.uptime;
    document.getElementById('espStatus').textContent=d.wifi?'Online':'Wi-Fi unavailable';
    document.getElementById('networkIp').title='http://smartpower.local or the IP shown here';
  }catch(e){
    document.getElementById('pzemPill').textContent='● Local dashboard connection lost';
    document.getElementById('pzemPill').className='pill bad';
    document.getElementById('wifiPill').textContent='○ ESP32 unreachable';
    document.getElementById('wifiPill').className='pill bad';
    document.getElementById('backendPill').textContent='● Backend status unknown';
    document.getElementById('backendPill').className='pill warn';
    document.getElementById('systemWifi').textContent='Dashboard unreachable';
  }
}

document.getElementById('timeWindow').addEventListener('change',function(e){
  selectedWindow=e.target.value;
  drawChart();
});

window.addEventListener('resize',()=>{ requestAnimationFrame(drawChart); });
document.addEventListener('visibilitychange',()=>{ if(!document.hidden){ setTimeout(drawChart,50); } });
window.addEventListener('beforeunload',persistHistory);
setInterval(()=>{ pruneHistory(Date.now()); drawChart(); }, 30000);

drawChart();
updateDashboard();
setInterval(updateDashboard,1000);
</script>
</body>
</html>
)rawliteral";

// ========================= WIFI STATUS ===================
void printWiFiStatus() {
  Serial.println();
  Serial.println("========================================");
  Serial.println(" Smart Real-Time Power Monitoring");
  Serial.println("========================================");
  Serial.print("SSID       : ");
  Serial.println(WIFI_SSID);

  if (WiFi.status() == WL_CONNECTED) {
    Serial.print("IP Address : ");
    Serial.println(WiFi.localIP());
    printDashboardLink();
  } else {
    Serial.println("Wi-Fi      : NOT CONNECTED");
    printDashboardLink();
  }
  Serial.println("========================================");
}

// ========================= SETUP =========================
void setup() {
  Serial.begin(115200);
  delay(300);

  systemStartMillis = millis();
  PZEMSerial.begin(9600, SERIAL_8N1, PZEM_RX_PIN, PZEM_TX_PIN);

  // Start BLE before the existing bounded Wi-Fi/NTP waits.
  if (!SmartPowerBle::begin()) Serial.println("[BLE] Initialization failed; cloud operation continues.");

  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.setSleep(false);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  startNtpSync();
  Serial.println("Connecting to Wi-Fi...");
  unsigned long wifiStart = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStart < 20000UL) {
    delay(500);
    Serial.print('.');
  }
  Serial.println();
  printWiFiStatus();

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("Waiting briefly for UTC time from NTP...");
    unsigned long ntpStart = millis();
    while (!timeIsSynchronized() && millis() - ntpStart < 8000UL) {
      delay(250);
      Serial.print(".");
    }
    Serial.println();
    if (timeIsSynchronized()) Serial.println("NTP      : UTC synchronized");
    else Serial.println("NTP      : not synchronized yet; backend sends will wait");
  }

  server.on("/", HTTP_GET, handleRoot);
  server.on("/data", HTTP_GET, handleData);
  server.on("/health", HTTP_GET, handleHealth);
  server.onNotFound([](){
    server.sendHeader("Location", "/");
    server.send(302, "text/plain", "Redirecting...");
  });
  server.begin();

  if (WiFi.status() == WL_CONNECTED) {
    if (MDNS.begin("smartpower")) {
      MDNS.addService("http", "tcp", 80);
      Serial.println("mDNS      : http://smartpower.local");
    } else {
      Serial.println("mDNS      : unavailable");
    }
  }

  Serial.println("Web server started.");
  printDashboardLink();

  Serial.println();
  Serial.println("Serial monitor output:");
  Serial.println("  - Accepted PZEM measurements");
  Serial.println("  - Total energy consumed since monitoring start");
  Serial.println("  - Exact JSON sent to Render");
  Serial.println("  - Backend HTTP response code and message");
  Serial.println("  - Dashboard URL / current DHCP IP");
  Serial.println();
}

// ========================= LOOP ==========================
void loop() {
  server.handleClient();

  if (WiFi.status() != WL_CONNECTED && millis() - lastWifiRetryMillis >= WIFI_RETRY_INTERVAL) {
    lastWifiRetryMillis = millis();
    WiFi.reconnect();
    Serial.println("Wi-Fi reconnect requested.");
    printDashboardLink("Dashboard");
  }

  if (WiFi.status() == WL_CONNECTED && !timeIsSynchronized() &&
      millis() - lastNtpAttemptMillis >= NTP_RETRY_INTERVAL) {
    startNtpSync();
  }

  if (millis() - lastReadMillis < READ_INTERVAL) return;
  lastReadMillis = millis();

  if (millis() - systemStartMillis < STARTUP_DELAY) {
    clearDisplayedReading();
    filtering = true;
    filterStatus = "Startup stabilization";
    Serial.print("[FILTERED] Startup stabilization | Dashboard: http://");
    Serial.println(currentIP());
    return;
  }

  processPZEMReading();

  // Send the latest accepted/stable reading to the backend once per second.
  if (!filtering && pzemConnected) {
    sendReadingToBackend();
  }
}
