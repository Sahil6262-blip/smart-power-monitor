# Independent BLE verification

The supplied Arduino sketch is integrated in [../SmartPowerMonitor](../SmartPowerMonitor). Open `SmartPowerMonitor.ino` in that folder; Arduino also compiles the original named sketch alongside it. The transport is binary protocol v1: one 20-byte notification per accepted reading, not JSON.

Follow [the complete setup and verification guide](../../docs/OFFLINE_MODE.md) for board settings, secrets, packet layout, and cloud/PWA tests.

After uploading the firmware, run from the repository root:

~~~powershell
python -m http.server 8081 --bind 127.0.0.1 --directory firmware/ble
~~~

Open http://localhost:8081/verify.html in a supported Chrome/Edge browser with Bluetooth enabled. Click **Select SmartPowerMonitor**, then compare the sequence and six measurements with the existing serial/local dashboard. This page makes no cloud requests. Test load changes, internet loss, and reconnect before testing the PWA. Disconnect this tester before connecting another BLE client. Stop the server with Ctrl+C.

Physical sensor/radio verification must be performed on the actual ESP32. Browser mocks and packet tests do not establish radio reliability.

