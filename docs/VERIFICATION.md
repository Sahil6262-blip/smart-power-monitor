# Verification

Checked locally on Windows with Python 3.12.5, Node 25.3.0, SQLite, and Chromium through Playwright.

- Frontend TypeScript check and Vite production build passed.
- Backend coverage includes REST/export contracts, live cadence, multiple socket clients and reconnection, malformed socket messages, settings validation/persistence, alert creation/acknowledgement/resolution, all eight rule types, deduplication, rollups, timezone boundaries, pagination/range validation, nonfinite/invalid input, hardware authentication/order/meter resets, cumulative-vs-period energy, and recovery after an injected transient SQL failure.
- Three browser tests passed: all nine routes, changing live values and chart rendering, desktop collapse, mobile navigation and overflow checks at 390 px, raw CSV download, saving/reloading thresholds, actionable alerts, offline detection, and automatic reconnection.
- Desktop and mobile dashboard screenshots were visually inspected.

Hardware-mode follow-up: all 10 backend tests passed, including isolated end-to-end ingestion. The browser test checks hardware source labels, empty readings, connection-loss status, and responsive layout. A viewport-transition overflow issue discovered by this test was fixed. Demo browser tests are intentionally skipped against the real hardware workspace. No test readings are injected into the actual hardware database.

PostgreSQL/Supabase live connection, real ESP32/PZEM input, long-running storage load, and trained ML were not verified against external hardware or services. The database recovery test injects a transient SQL exception; it is not a live Supabase outage test.

`frontend/test-results/` contains browser-generated screenshots and failure traces if any. It is ignored by git. Browser tests create real demo alert events and restore the original settings.
