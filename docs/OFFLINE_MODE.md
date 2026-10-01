# Same dashboard, cloud and Bluetooth

The existing Vercel React app now accepts either Render WebSocket readings or direct ESP32 BLE notifications. `LiveProvider` selects the source centrally; the existing cards, gauges, charts, history, and alerts consume that state. Cloud wins when the socket is connected, storage is healthy, and its reading is less than 10 seconds old. A socket alone is not enough.

No backend source, API routes, Supabase schema, Render settings, Vercel rewrites, or existing frontend environment variables were changed. Nothing has been flashed, committed, pushed, or deployed.

## 1. Firmware and Arduino setup

The supplied sketch is at `firmware/SmartPowerMonitor/Smart_Power_Monitor_ESP32_Render_SerialData_Final.ino`. Its only changes are:

- Include `secrets.h` and `SmartPowerBle.h`.
- Move the three credential declarations into the private header.
- Initialize BLE after existing UART initialization in `setup()`.
- Publish the six stable values at the end of `acceptReading(...)`.

Removing those additions and restoring the declarations reproduces the supplied sketch exactly. PZEM acquisition/filtering, `sendReadingToBackend()`, Wi-Fi/NTP, the main loop, UART pins, and embedded local dashboard remain intact. BLE copies accepted values into a one-item FreeRTOS queue; a separate task updates READ and sends notifications. Slow clients can skip snapshots without blocking the cloud uploader.

| Item | Configuration |
| --- | --- |
| Hardware | Original ESP32 DevKit with BLE; not ESP32-S2 |
| Sensor | PZEM-004T V3.0 100A |
| UART | `HardwareSerial(2)`, RX GPIO16, TX GPIO17 |
| PZEM library | `PZEM004Tv30` by Jakub Mandula/jbenz; tested **1.2.1** |
| Board package | `esp32` by Espressif Systems; reference build **2.0.17** |
| BLE | Built-in **ESP32 BLE Arduino / Bluedroid**; no separate BLE library |
| Existing libraries | WiFi, HTTPClient, WiFiClientSecure, WebServer, ESPmDNS, time |

Your previously used ESP32 package version remains unconfirmed. The reference build used an isolated installation without changing Arduino IDE configuration. A 3.x build is not claimed.

Compile/upload in Arduino IDE:

1. Open **`firmware/SmartPowerMonitor/SmartPowerMonitor.ino`**. Arduino requires this folder-named entry file and also compiles the supplied long-named sketch in the same folder. Do not move the original sketch away from its headers/module.
2. Private `secrets.h` already contains the original values on this machine. On another machine, copy `secrets.example.h` to `secrets.h` and privately fill in Wi-Fi details and the existing Render ingest key. Never put these values in React or Git.
3. Install/select Espressif's ESP32 package in Boards Manager and the PZEM library in Library Manager. Select the matching DevKit board, or **ESP32 Dev Module** for the reference configuration.
4. Check your physical flash capacity. The tested configuration uses **4 MB flash** and **Partition Scheme: Huge APP (3MB No OTA/1MB SPIFFS)**. The default 1.25 MB app partition is too small with BLE. This partition has no OTA application slot; the existing sketch does not implement OTA. For a different flash capacity, select a suitable partition before uploading.
5. Click Verify, connect USB, select the actual port, then Upload. Open Serial Monitor at **115200 baud**. Expect `[BLE] Service started`, connection/disconnection logs, and `[BLE] Notifications active` once per subscribed connection.

Equivalent CLI commands, after installing the board package and libraries (replace `COM_PORT` with the actual port):

~~~powershell
arduino-cli compile --fqbn esp32:esp32:esp32:PartitionScheme=huge_app firmware/SmartPowerMonitor
arduino-cli upload --port COM_PORT --fqbn esp32:esp32:esp32:PartitionScheme=huge_app firmware/SmartPowerMonitor
~~~

Existing timing behavior is preserved: startup waits up to 20 seconds for Wi-Fi and optionally 8 seconds for NTP. BLE advertises before these waits, but acquisition begins afterwards. Synchronous HTTPS/DNS/TLS work can delay the next acquisition. BLE publication does not wait for HTTP, but cannot invent a reading before the existing loop accepts it. A strict one-second cadence during every network failure is not claimed; measure this on the board before considering a separate scheduling change.

## 2. BLE contract: protocol v1

- Name: **`SmartPowerMonitor`**
- Service: **`b8541000-b5e6-4af4-9a44-6a0f78d40100`**
- Characteristic: **`b8541001-b5e6-4af4-9a44-6a0f78d40100`**
- Properties: **READ + NOTIFY**, BLE2902 subscription descriptor.
- One **20-byte little-endian** notification per accepted reading. No JSON fragmentation or custom MTU is required.

| Offset | Width | Field | Frontend conversion |
| --- | --- | --- | --- |
| 0 | uint32 | Sequence | Order/deduplication |
| 4 | uint16 | Voltage x10 | /10 → V |
| 6 | uint24 | Current x1000 | /1000 → A |
| 9 | uint24 | Power x10 | /10 → W |
| 12 | uint32 | Energy Wh | /1000 → cumulative kWh |
| 16 | uint16 | Frequency x10 | /10 → Hz |
| 18 | uint16 | Power factor x1000 | /1000 → ratio |

`uint24` is three explicitly packed bytes. A uint16 current field at 0.001A precision would stop at 65.535A, below this sensor's 100A range. Three bytes each for current and power retain precision and fit 20 bytes. Encoder and decoder check identical finite/nonnegative serialization bounds without modifying the PZEM filter.

Sequence increments per accepted serialized reading, resets at boot, and wraps at uint32 capacity. The decoder rejects duplicate/old packets, handles rollover, and resets on reconnect. Browser receipt time is added locally; BLE needs no NTP. READ exposes the last accepted snapshot and may be stale, so the dashboard waits for new notifications. Before the first accepted reading, no valid snapshot exists.

One central/browser is intended at a time. Advertising restarts after disconnect; the primary advertisement includes the service UUID and the scan response includes the full name. No credentials travel over BLE. No BLE PIN/encryption pairing was added; browser permission authorizes site access to the selected device.

## 3. Verify BLE independently first

1. Upload the firmware with the existing bulb/PZEM setup. Confirm the local dashboard and Render ingestion still work online.
2. From the repository root run:

   ~~~powershell
   python -m http.server 8081 --bind 127.0.0.1 --directory firmware/ble
   ~~~

3. Open **http://localhost:8081/verify.html** on that computer in supported Chrome/Edge. Click **Select SmartPowerMonitor**. Compare the sequence and all six decoded measurements with serial/local-dashboard accepted values, allowing for wire precision. This tester makes no cloud requests.
4. Change bulb load normally. Verify accepted values reach both BLE and cloud; rejected/noisy readings must not generate new notifications.
5. Remove the ESP32 access point/internet path while keeping the sensor powered. Confirm BLE continues after the existing network waits. Test disconnect/reconnect and resumed advertising. Alternatively, subscribe in a BLE inspector to the same characteristic and inspect 20-byte packets.
6. Disconnect the tester/inspector before connecting the PWA; stop the local server with Ctrl+C.

Record actual board, core version, partition, and observations. These radio/sensor tests remain physical verification tasks.

## 4. Build/release the same Vercel PWA

New development dependencies: **`vite-plugin-pwa` ^1.3.0**, **`@types/web-bluetooth` ^0.0.21**. No backend or runtime Bluetooth library is added. Transitive service-worker dependencies are locked in `package-lock.json`.

~~~powershell
cd frontend
npm ci
npm run build
~~~

The build generates `dist/manifest.webmanifest`, `dist/sw.js`, a Workbox runtime, and precached assets. Release through the existing Vercel project/workflow with its existing environment, build command, and `dist` output. The deployed site only gains this feature after that frontend release. Render and Supabase need no changes.

The service worker precaches the shell, all route JS/CSS, icons, and fonts. Navigation falls back to the cached shell, including unvisited nested routes. It does not cache APIs, WebSockets, settings writes, or alert mutations. Updates prompt before reloading because reload ends the in-memory Bluetooth session. PWA caching is enabled in production builds, not `npm run dev`.

Local production preview, if needed:

~~~powershell
npm run preview -- --port 4179 --strictPort
~~~

Open http://localhost:4179 and stop with Ctrl+C. Localhost is a secure-context exception. Existing frontend environment variables determine the cloud target; automated tests mock it.

## 5. Test Vercel offline

1. After the new release, visit **https://smart-power-monitor-eta.vercel.app/** online on the browser/device that will receive BLE. Wait for **App ready offline**, reload once, and optionally install using the browser's install/Add to Home Screen action.
2. Enable Bluetooth. Click **Connect Offline Device**, select **SmartPowerMonitor**, and grant permission. With healthy cloud readings the badge remains **CLOUD MODE / Live · Synced**, with Bluetooth in standby.
3. Turn off Wi-Fi and mobile data on the browser device while leaving Bluetooth on. Airplane mode may also turn Bluetooth off; re-enable it. Close/reopen the cached PWA or reload the same origin in the same profile. The shell and charts must open without internet.
4. Connect/reconnect the authorized ESP32. Expect **OFFLINE DEVICE MODE / Live via Bluetooth · Cloud unavailable**. Change load and inspect the same cards, charts, History, and Alerts.
5. Disconnect/power off the ESP32. Readings stop being live, **Device disconnected** appears, and reconnect is available. Already-authorized devices retry every 5 seconds while cloud is unavailable where browser support permits. The picker never opens automatically. **Choose another device** opens it explicitly. Manual **Disconnect Bluetooth** disables automatic retry until Connect or a new page load.

An offline first-ever visit cannot work. Browser cache eviction, clearing site data, private browsing, a different origin/profile, or missing permissions may require another online visit. Installing a PWA does not itself grant Bluetooth permission.

## 6. Test Cloud → BLE → Cloud

Keep Bluetooth connected as standby; first verify changing cloud readings.

| Condition | Expected behavior |
| --- | --- |
| Browser device loses internet | Cached shell opens; BLE feeds live state |
| ESP32 loses Wi-Fi but browser remains online | After cloud readings become 10 seconds old, use BLE even if the socket stays open |
| Render connection fails | Retry WebSocket; use BLE |
| Supabase fails, backend reports storage failure/stale data | Cloud is unhealthy; use BLE |
| BLE disconnects during cloud outage | Device-disconnected state and reconnect control; retained values are not live |
| Internet/Render returns with fresh readings | Reconnect WebSocket and return to CLOUD MODE |
| Both sources are live | Cloud feeds visible dashboard; BLE remains standby |
| Manual Bluetooth disconnect | Do not automatically reconnect until Connect or a new page load |

Use browser DevTools to block Render WebSocket/API requests for a browser-only outage test without stopping the deployed backend. Physical ESP32/Supabase failure tests should also inspect serial/backend diagnostics. Automated tests mock these failures; they did not cause production outages.

## 7. Meaning of offline data

BLE normalizes into the existing six measurement fields with `source: 'ble'`. Browser receipt time and timezone label local plots.

- **Total energy** is still the meter's cumulative counter. **Bluetooth session energy** is the observed counter delta during this tab's session, not a cloud daily total. Gaps of at least 10 seconds/disconnects establish a new baseline, excluding unseen usage. Counter resets use the same nonnegative reset convention as cloud calculations.
- Keep up to 3,600 readings and 250 alerts in tab memory, with the existing 300-point live chart window. Another selected meter resets the local session. Reload/close clears local history.
- Six electrical threshold rules run locally using last-fetched settings/tariff, or backend defaults when unavailable. Local acknowledge/resolve affects local alerts only. Settings are read-only offline; cloud controls resume on recovery.
- Session cost and health are labeled local estimates. Health excludes monthly budget. Cloud monthly budget, consumption reports, exports, and cloud predictions are not fabricated; views explain when cloud history is needed.
- **No BLE replay/upload to Supabase** and no offline write queue. Cloud history remains what the ESP32 uploaded through its existing HTTPS path. Source switching does not merge duplicate BLE/cloud points or claim local readings were synchronized.

## 8. Browser limitations

Use a secure context and a browser/platform exposing `navigator.bluetooth`: commonly Chrome on Android and Chrome/Edge on supported desktop systems with a BLE adapter. Safari/iOS and Firefox do not provide this Web Bluetooth path; installing a PWA does not add it. Unsupported browsers retain normal cloud monitoring. Device enumeration/reconnection support varies; without `getDevices()`, use Connect after reopening.

Keep the app in the foreground for reliable notifications. OS suspension, screen locking, tab throttling, radio permissions, and distance may interrupt BLE. No background-monitoring or exact radio-latency guarantee is made. Close the independent BLE inspector before connecting the dashboard.

References: [Chrome Web Bluetooth](https://developer.chrome.com/docs/capabilities/bluetooth), [MDN compatibility](https://developer.mozilla.org/en-US/docs/Web/API/Web_Bluetooth_API), [Vite PWA precaching](https://vite-pwa-org.netlify.app/guide/service-worker-precache), [update prompts](https://vite-pwa-org.netlify.app/guide/prompt-for-update.html).

## 9. Verification performed

- Full firmware compile **passed** with Arduino-ESP32 **2.0.17**, PZEM004Tv30 **1.2.1**, ESP32 Dev Module, Huge APP partition: **1,795,629 / 3,145,728 bytes (57%)** flash; **62,724 / 327,680 bytes (19%)** static RAM. This measures build/static allocation, not runtime heap or radio stability.
- Production TypeScript/Vite/PWA build passed; precache includes 33 static assets, fonts, and lazy routes.
- **12 Playwright tests passed** against production preview: offline reload/direct/unvisited routes, switching/recovery, stale open sockets, authorized/manual reconnect, unsupported/cancelled selection, malformed packets, local controls, binary protocol/100A/rollover, energy gaps/resets, existing desktop/tablet/mobile navigation and cloud interactions.
- C++ packet test passed with matching frontend golden bytes, 100A current, invalid/nonfinite values.
- Reconstructed-original source check passed for preservation of supplied firmware.
- Actual flashing, PZEM/radio notifications, and released Vercel/Render behavior remain hardware/release checks. Tests mock GATT and cloud transports; service-worker caching is real.

Reproduce frontend checks:

~~~powershell
cd frontend
npm ci
npx playwright install chromium
npm run test:offline
~~~

The suite owns preview port 4179 and stops it afterwards. It does not start the backend or change production data. `firmware/tests/packet_test.cpp` can be compiled/run independently with a C++11 compiler.

## 10. Exact file inventory

Modified:

~~~text
.gitignore
README.md
frontend/index.html
frontend/package.json
frontend/package-lock.json
frontend/vite.config.ts
frontend/src/vite-env.d.ts
frontend/src/main.tsx
frontend/src/context/LiveContext.tsx
frontend/src/hooks/useResource.ts
frontend/src/components/EnergyHero.tsx
frontend/src/components/Metrics.tsx
frontend/src/components/Shell.tsx
frontend/src/components/UI.tsx
frontend/src/pages/Alerts.tsx
frontend/src/pages/Dashboard.tsx
frontend/src/pages/DeviceStatus.tsx
frontend/src/pages/History.tsx
frontend/src/pages/LiveMonitoring.tsx
frontend/src/pages/Settings.tsx
frontend/tests/redesign.spec.ts
~~~

Added:

~~~text
docs/OFFLINE_MODE.md
firmware/SmartPowerMonitor/SmartPowerMonitor.ino
firmware/SmartPowerMonitor/Smart_Power_Monitor_ESP32_Render_SerialData_Final.ino
firmware/SmartPowerMonitor/SmartPowerBle.h
firmware/SmartPowerMonitor/SmartPowerBle.cpp
firmware/SmartPowerMonitor/SmartPowerPacket.h
firmware/SmartPowerMonitor/secrets.example.h
firmware/ble/README.md
firmware/ble/verify.html
firmware/tests/packet_test.cpp
scripts/import-firmware.py
frontend/playwright.offline.config.ts
frontend/public/icons/pwa-source.svg
frontend/public/icons/pwa-192.png
frontend/public/icons/pwa-512.png
frontend/public/icons/pwa-maskable-512.png
frontend/src/components/ConnectionControls.tsx
frontend/src/offline.css
frontend/src/services/ble.ts
frontend/src/services/offlineSession.ts
frontend/src/services/offlineResources.ts
frontend/src/services/offlineSettings.ts
frontend/tests/helpers/cloud.ts
frontend/tests/helpers/bluetooth.ts
frontend/tests/offline-unit.spec.ts
frontend/tests/offline.spec.ts
~~~

Private/ignored: `firmware/SmartPowerMonitor/secrets.h`, isolated tools/builds in `firmware/.build/`, frontend `dist/` and test output. These do not belong in Git. The import script refuses to overwrite firmware/secrets; do not rerun it on this integrated folder.
