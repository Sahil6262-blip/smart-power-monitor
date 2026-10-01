# Smart Real-Time Power Monitoring and Analysis System

**Wattwise** is a complete, single-meter energy monitoring application: a React dashboard, a FastAPI ingestion pipeline, SQL storage, a WebSocket stream, configurable alerts, consumption analytics, historical readings, and exports. **This workspace is configured for real ESP32/PZEM hardware.** Simulation remains available only when explicitly enabled.

BLE offline mode is implemented in the same dashboard. See [the firmware, PWA, and hardware verification guide](docs/OFFLINE_MODE.md) before uploading the ESP32 or releasing the frontend. It includes the BLE packet format, Arduino partition setting, browser limitations, and exact change inventory.

## Start on this Windows machine

The dependencies have already been installed in this workspace. Open two PowerShell terminals.

**Terminal 1 — backend**

```powershell
cd "D:\Smart Power Monitoring System\backend"
.\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 — frontend**

```powershell
cd "D:\Smart Power Monitoring System\frontend"
npm run dev
```

Open **http://127.0.0.1:5173**. API documentation is at **http://127.0.0.1:8000/docs**.

Alternatively, from the project root, `powershell -ExecutionPolicy Bypass -File .\scripts\start.ps1` starts both processes and stops them when you press Ctrl+C. Do not start a second copy while the same ports are occupied. Logs are written to `logs/`.

`backend/.env` now sets **`DEMO_MODE=false`** and **`SEED_DEMO_HISTORY=false`** and contains a generated `INGEST_API_KEY`. Copy that key into your ESP32's `X-Ingest-Key` header. The key is not printed or exposed to React. The dashboard waits for real input and shows connection loss until readings arrive. Historical demo rows remain stored separately and are excluded from hardware views. SQLite tables are created automatically at `backend/data/power.db`; settings survive restarts.

## Install on a fresh machine

Use Python 3.12+ and a supported Node.js LTS version, such as Node 22.12+ or 24, with npm. This workspace was also tested with the installed Node 25.3.0. See [Vite's Node requirements](https://vite.dev/guide/).

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.lock.txt
# Optional: customize configuration. Do not overwrite an existing .env.
if (!(Test-Path .env)) { Copy-Item .env.example .env }

cd ..\frontend
npm ci
```

`requirements.txt` describes compatible dependency ranges; `requirements.lock.txt` records the exact versions tested here. The frontend has a committed `package-lock.json`. Python virtual-environment activation is optional because the commands address its Python executable directly. On Linux/macOS, replace `.venv\Scripts\python.exe` with `.venv/bin/python`.

On a new machine, set a random `INGEST_API_KEY` of at least 16 characters in the newly copied `.env` before starting. This workspace already has its own generated key. Do not copy real keys into `.env.example` or frontend code.

## What works

| Page | Functionality |
| --- | --- |
| Dashboard | Six live electrical measurements, last-60-reading graph, historical trend windows, today's summary, health score, system checks, energy budget, recent alerts |
| Live monitoring | Power, voltage, current, frequency, and power-factor charts; bounded 60/180/300-point views |
| Consumption | Hourly, daily, seven-day, and calendar-month energy buckets, cost estimates, peak demand, monthly budget |
| Alerts | Eight configurable rule types; info/warning/critical severity; open/history/resolved, severity and date filters; acknowledge/resolve; pagination |
| History | Today, yesterday, last 7/30 days, custom range; parameter charts; paginated readings; streamed CSV |
| Reports | Period energy/cost/average/peak, peak time, average PF, min/max voltage, alert and reading counts; summary and raw CSV |
| Device status | Source, backend, storage, socket clients, timestamps, uptime, record count, database size |
| Settings | Persisted tariff, budget, voltage/current/power/PF thresholds, sudden-load threshold and connection timeout |
| AI insights | Honest “not configured” states and typed model interfaces; no fabricated predictions, model scores, or accuracy |

The UI has collapsible desktop navigation, a mobile drawer, reduced-motion support, loading/empty/error states, and download error handling. Live cards and graphs use WebSocket messages rather than one-second REST polling.

## Configuration

Copy `backend/.env.example` to `backend/.env` only if you need different defaults. Restart the backend after environment changes.

| Variable | Default / purpose |
| --- | --- |
| `DATABASE_URL` | Absolute SQLite database path by default; PostgreSQL supported with the psycopg driver |
| `APP_ENV` | `development`; environment identification, not an authentication control |
| `CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173`; also validates browser WebSocket origins |
| `DEMO_MODE` | `false`; hardware push adapter, no sampled readings |
| `SEED_DEMO_HISTORY` | `false`; opt-in synthetic history only when both this and `DEMO_MODE` are true |
| `TIMEZONE` | `Asia/Kolkata`; report day/month boundaries and display timezone |
| `INGEST_API_KEY` | Required in hardware mode, at least 16 characters; never sent to the frontend |

An example relative SQLite URL resolves against the backend process working directory. Launch from `backend/` as shown above. The code's no-env default is an absolute path under `backend/data/`.

Frontend defaults use Vite's `/api` and `/ws` proxies. For separate hosting, copy `frontend/.env.example` to `.env` and set `VITE_API_URL=https://your-api-host` and `VITE_WS_URL=wss://your-api-host/ws/live` before building. Add the frontend origin to backend `CORS_ORIGINS`.

## PostgreSQL / Supabase

1. Create a Supabase project or PostgreSQL database. Obtain a **server-side PostgreSQL connection string** from its connection settings. Use a direct or session-pooler connection compatible with your network; a Supabase HTTP API URL is not a database URL.
2. Set the backend environment variable, with a URL-encoded password:

   ```dotenv
   DATABASE_URL=postgresql+psycopg://postgres.PROJECT:URL_ENCODED_PASSWORD@HOST:5432/postgres?sslmode=require
   ```

3. Restart the backend. SQLAlchemy creates the initial schema with the database role's permissions. It uses timezone-aware PostgreSQL timestamps, timestamp/source indexes, and connection pre-ping/recycling. The frontend never accesses the database directly.
4. Use `SEED_DEMO_HISTORY=false` before first startup if you do not want the synthetic history in that database. Demo and hardware rows are always separated by `source`, and analytics query only the active source.

No Supabase project credentials were provided, so the live PostgreSQL/Supabase connection has **not** been tested here. SQLite is fully tested. Startup schema creation is suitable for the initial prototype; add versioned migrations before changing an existing deployed schema. This app does not require Supabase browser keys. Keep these backend-owned tables out of an exposed Data API schema or configure appropriate database access policies.

## Connect ESP32 / PZEM hardware

This workspace already uses the following configuration in `backend/.env`, with an actual generated secret in place of the example below:

```dotenv
DEMO_MODE=false
SEED_DEMO_HISTORY=false
INGEST_API_KEY=replace-with-a-long-random-secret
```

Send a reading once per second to `POST /api/readings` with header `X-Ingest-Key`. The payload contract is the same one used by the simulator. Example in PowerShell:

```powershell
$reading = @{
    timestamp = [DateTimeOffset]::UtcNow.ToString('o')
    voltage = 230.4
    current = 1.82
    power = 393.89
    energy = 4.8201
    frequency = 50.0
    power_factor = 0.94
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:8000/api/readings' `
    -Headers @{ 'X-Ingest-Key' = 'replace-with-a-long-random-secret' } `
    -ContentType 'application/json' -Body $reading
```

Use V, A, W, **cumulative kWh**, Hz, and power factor 0–1. A timezone-aware timestamp within 60 seconds of server time is required. Duplicate/out-of-order readings return 409; invalid values return 422; invalid keys return 401. Hardware ingestion is disabled in demo mode. A first hardware reading establishes the energy baseline. An energy counter decrease starts a new meter segment and contributes the new post-reset counter value, never a negative delta.

The hardware launch command binds FastAPI to `0.0.0.0`. Point your ESP32 at `http://<COMPUTER_LAN_IP>:8000/api/readings`; `localhost` on the ESP32 refers to the ESP32 itself. Keep the device and computer on the same network, and allow inbound TCP 8000 in Windows Firewall if your network requires it. Actual ESP32 firmware, serial drivers, MQTT transport, and electrical wiring are outside this software prototype; add an adapter using `DataSource` / `Runtime.ingest` without changing the UI.

To explicitly return to simulation for a demonstration, set `DEMO_MODE=true` and optionally `SEED_DEMO_HISTORY=true`, then restart the backend. Hardware mode never calls a sampling function or seeds synthetic data, even if old demo records are present.

## Data and calculations

- **Active power in simulation:** `voltage × current × power_factor`. Values vary smoothly each second and energy integrates elapsed time. Hardware active power is accepted as a sensor measurement.
- **Period energy:** sum of positive cumulative-meter differences, with explicit meter-reset handling. Cumulative meter energy is labeled separately from today's consumption.
- **Estimated cost:** period kWh × current flat tariff. No taxes, fixed charges, or slab pricing. Editing the tariff recalculates historical estimates; it is not a historical tariff ledger.
- **Average power:** an interval-weighted mean of recorded power, avoiding a simple mixture of five-minute seeded samples and one-second live samples. PF and voltage means in rollups are sample-weighted.
- **Period boundaries:** IANA timezone configuration, stored and exchanged as UTC-aware timestamps. Queries use `[start, end)` and cap custom ranges at 93 days. Custom browser date inputs use the browser's timezone, explicitly labeled in the UI.
- **Interval attribution:** a meter delta belongs to the timestamp of the reading that closes that interval. Energy across a missing-data gap or a boundary is attributed to that closing period; the prototype does not interpolate gaps or split meter deltas across midnight. Historical seeded samples are five minutes apart; recent seed data and ongoing simulation are one second apart.
- **Health score:** starts at 100. Voltage outside limits subtracts 25; low PF subtracts up to 25; current/power overload subtracts 20; each open alert subtracts 5 up to 20; budget ≥85% subtracts 5, ≥100% subtracts 10. Clamp at zero. Exact factors are in `services/calculations.py` and visible below the gauge. This is an application heuristic, not an industry certification or AI result.
- **Alerts:** one open event per source/rule, including acknowledged events. Returning to normal auto-resolves the event. Manually resolving an ongoing fault allows a new event on the next reading. Sudden power increase compares adjacent readings. The watchdog records missing hardware data even without arriving readings.
- **Rollups:** each new live reading updates `minute_aggregates` transactionally with average V/A/W/PF, min/max voltage, peak current/power, energy difference, and new alert count. Seeded history is raw synthetic history; it is not backfilled into minute rollups. The prototype keeps raw readings; future retention/backfill jobs can use the aggregate table.
- **Chart history:** historical trends are representative samples, not min/max envelopes. Reports query full raw readings. Sampling may omit very brief spikes; peak figures come from the full dataset.

## Architecture

```text
Simulator (1 Hz)  ──┐
                   ├─> ReadingIn validation -> serialized ingest -> SQL transaction
Hardware POST API ─┘                                  │
                                            energy delta + alert rules
                                            minute rollup + summaries
                                                      │
                                 bounded per-client WebSocket queues
                                                      │
                                           React live-data context

REST -> settings, historical readings, consumption, alerts, reports, device health
```

The backend runs a single ingestion worker. Database work runs off the live event loop. Slow clients cannot block ingestion because each WebSocket client has a bounded queue and send timeout. Reconnecting clients receive the latest snapshot; **its original measurement timestamp is preserved**, so old readings are never counted as fresh. The UI waits after 3 seconds and shows connection loss after approximately 10 seconds, with exponential reconnect attempts capped at 10 seconds. The configurable backend alert timeout is separate from these visual thresholds.

SQL transactions commit before broadcast. Transient database failures emit a storage status, return HTTP 503 on affected API requests, and retry on subsequent ticks. Failed demo ticks are not silently represented as saved samples; the next saved counter difference can recover their energy. Hardware senders should retry failed requests with the same timestamp; only committed timestamps are rejected as duplicates.

```text
backend/
  main.py, config.py, database.py, models.py, schemas.py, websocket.py
  routes/       live, consumption, history, alerts, settings, reports, predictions
  services/     runtime, sources, seed, calculations, alert_engine, aggregation
  ai/           feature contract, anomaly / forecast / recommendation protocols
  tests/        isolated SQLite backend integration and domain tests
frontend/
  src/
    components/ charts, metrics, shell, range filters, shared UI
    context/    WebSocket lifecycle, bounded data buffer, source state
    hooks/      abortable REST resources
    pages/      all nine application pages
    services/   typed API calls and downloads
    utils/      formatting and display timezone
  tests/        Playwright browser tests
docs/           API details and verification notes
scripts/        Windows launcher
```

## REST and WebSocket

The [interactive OpenAPI documentation](http://127.0.0.1:8000/docs) contains request/response schemas. [docs/API.md](docs/API.md) gives a compact reference.

Core endpoints include `/api/live`, `/api/consumption/{today|week|month|30d}`, `/api/consumption/budget`, `/api/history`, `/api/history/trend`, `/api/history/export`, `/api/alerts`, `/api/alerts/history`, `/api/settings`, `/api/reports`, `/api/reports/export`, `/api/health`, `/api/predictions`, and `/ws/live`.

## Tests and production build

```powershell
cd backend
.\.venv\Scripts\python.exe -m pytest -q

cd ..\frontend
npm run build
npx playwright install chromium
# Start the backend and Vite dev server before running browser tests.
npm run test:e2e
```

Backend tests use a temporary SQLite database and never touch the workspace database. They include a hardware-mode integration test that authenticates input, checks persistence/calculations/alerts/socket broadcasts, and verifies neither source sampler is invoked. Browser tests detect the running mode: hardware mode tests the real-data waiting state and source labels; the three demo interaction tests are skipped unless an explicit demo server is running. In demo mode, those tests briefly lower the power threshold, restore settings in `finally`, and leave their resolved test alert in history. Test screenshots are in `frontend/test-results/`.

Frontend formatting: `npx prettier --write src vite.config.ts playwright.config.ts tests`. Backend formatting: install `requirements-dev.txt`, then run `.venv\Scripts\python.exe -m ruff format .`.

For frontend deployment, serve `frontend/dist` with an SPA fallback and proxy `/api` and `/ws` to FastAPI, or use the Vite API/WS environment variables. `npm run preview` previews static assets; it is not the configured development API proxy. Backend production command: `.venv\Scripts\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8000 --workers 1`.

This first version is designed for a local or trusted-network single meter. User login, roles, multi-device tenancy, TLS termination, automated retention, deployed schema migrations, trained ML, and a PDF renderer are future deployment work. Run **one backend worker**: multiple workers would create multiple simulators and isolated socket registries. At larger scale, move ingestion into a dedicated worker, use shared pub/sub, and query persisted rollups for long-term analytics.

## Troubleshooting

- **Waiting/offline:** ensure both processes run, port 8000 is reachable, and the frontend origin appears in `CORS_ORIGINS`. A custom frontend host needs a matching allowed origin.
- **Port occupied:** stop the previous server before launching again. The launcher checks both ports and reports which one is occupied.
- **No data in hardware mode:** set the ingestion key, send current timezone-aware timestamps, and synchronize the ESP32 clock.
- **SQLite unavailable:** check directory permissions and disk space. Keep the database out of synchronized/network folders. WAL mode and a 15-second busy timeout are configured.
- **PostgreSQL startup error:** verify hostname, port, URL-encoded password, SSL mode, network access, and the database role's schema permissions. Startup requires a reachable database; runtime connection failures are retried.
- **Environment changes seem ignored:** restart FastAPI; restart Vite for frontend environment changes.

Built around the official [FastAPI WebSocket lifecycle](https://fastapi.tiangolo.com/advanced/websockets/) and [Tailwind Vite integration](https://tailwindcss.com/docs/installation/using-vite).
