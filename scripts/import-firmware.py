"""Import the supplied sketch without ever printing or staging its credentials."""
from pathlib import Path
import re
import sys

source = Path(sys.argv[1]).resolve()
root = Path(__file__).resolve().parents[1]
target = root / 'firmware' / 'SmartPowerMonitor'
original = source.read_text(encoding='utf-8-sig')
names = ('WIFI_SSID', 'WIFI_PASSWORD', 'INGEST_API_KEY')
declarations = []
sanitized = original
for name in names:
    pattern = rf'^const char\* {name}\s*=\s*"(?:\\.|[^"\\])*";[^\n]*$'
    matches = re.findall(pattern, sanitized, re.MULTILINE)
    if len(matches) != 1:
        raise SystemExit(f'Expected one declaration for {name}; no files changed.')
    declarations.append(matches[0])
    sanitized = sanitized.replace(matches[0], f'// {name} is provided by secrets.h.')
sanitized = sanitized.replace('#include <time.h>', '#include <time.h>\n#include "secrets.h"\n#include "SmartPowerBle.h"', 1)
accepted = '  filterStatus = "Stable";'
assert sanitized.count(accepted) == 1
publish = '\n\n  // BLE gets exactly the values accepted by the existing filter. No extra sensor reads.\n  SmartPowerBle::publish({stableVoltage, stableCurrent, stablePower,\n                          stableEnergy, stableFrequency, stablePF});'
sanitized = sanitized.replace(accepted, accepted + publish, 1)
uart = '  PZEMSerial.begin(9600, SERIAL_8N1, PZEM_RX_PIN, PZEM_TX_PIN);'
assert sanitized.count(uart) == 1
startup = '\n\n  // Start BLE before the existing bounded Wi-Fi/NTP waits.\n  if (!SmartPowerBle::begin()) Serial.println("[BLE] Initialization failed; cloud operation continues.");'
sanitized = sanitized.replace(uart, uart + startup, 1)
target.mkdir(parents=True, exist_ok=True)
sketch = target / source.name
secrets = target / 'secrets.h'
if sketch.exists() or secrets.exists():
    raise SystemExit('Destination firmware or secrets already exists; refusing to overwrite.')
secrets.write_text('#pragma once\n// Private local values, deliberately excluded from Git.\n' + '\n'.join(declarations) + '\n', encoding='utf-8')
sketch.write_text(sanitized, encoding='utf-8')
# Removing the exact additive changes and restoring declarations reproduces the original.
restored = sanitized.replace(publish, '').replace(startup, '').replace('\n#include "secrets.h"\n#include "SmartPowerBle.h"', '')
for name, declaration in zip(names, declarations):
    restored = restored.replace(f'// {name} is provided by secrets.h.', declaration)
assert restored == original, 'Unexpected change to original firmware'
print('Firmware imported. Credentials extracted privately. Original code preservation check passed.')
