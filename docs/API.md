# API reference

Base: `http://127.0.0.1:8000`. OpenAPI: `/docs`. JSON responses use snake_case. Timestamps are timezone-aware ISO 8601, usually UTC `Z`.

| Method | Path | Parameters / behavior |
| --- | --- | --- |
| GET | `/api/live` | Latest committed snapshot; 503 until a live sample arrives |
| POST | `/api/readings` | Hardware mode only; `X-Ingest-Key`; typed reading body; 201 on commit |
| GET | `/api/health` | Source/storage state, clients, uptime, active-source reading count |
| GET | `/api/consumption/today` | Summary + hourly buckets by default |
| GET | `/api/consumption/week` | Last 7 calendar days through now; daily buckets |
| GET | `/api/consumption/month` | Current calendar month through now; daily buckets |
| GET | `/api/consumption/30d` | Last 30 days; optional `granularity=hourly|daily|weekly|monthly` |
| GET | `/api/consumption/budget` | Current month target, used, remaining, percentage |
| GET | `/api/history` | `range`, optional `start`/`end`; `page>=1`, `page_size<=200` |
| GET | `/api/history/trend` | Same range plus `points=10..1000`; evenly sampled chronological points |
| GET | `/api/history/export` | Same range; streamed CSV attachment |
| GET | `/api/alerts` | `status=active|acknowledged|resolved|open`, `severity=info|warning|critical`, aware `start`/`end`, `limit<=500`, `offset` |
| GET | `/api/alerts/history` | Alias with identical filters |
| PATCH | `/api/alerts/{id}` | `{"status":"acknowledged"}` or `{"status":"resolved"}` |
| GET / PUT | `/api/settings` | Complete settings object; extra fields rejected; 422 for invalid limits |
| GET | `/api/reports` | Summary for the selected `range` |
| GET | `/api/reports/export` | Summary CSV, same range |
| GET | `/api/predictions` | `not_configured`, capabilities, empty predictions, no invented model outputs |

`range` is `today`, `yesterday`, `week`/`7d`, `month`, `30d`/`last30`, `1m`, `10m`, `1h`, or `custom`. Custom start/end must include timezone offsets, be ordered, and span no more than 93 days. End is exclusive. Exports use the same filters as the table/report.

## WebSocket `/ws/live`

One message per persisted reading, nominally once per second:

```json
{
  "type": "reading",
  "id": 123,
  "timestamp": "2026-09-29T15:00:00Z",
  "source": "demo",
  "voltage": 230.4,
  "current": 1.82,
  "power": 393.89,
  "energy": 4.8201,
  "frequency": 50.0,
  "power_factor": 0.94,
  "system_status": "normal",
  "alerts": [],
  "active_alert_count": 0,
  "storage_status": "connected",
  "health_score": {"score": 100, "label": "Excellent", "factors": [], "description": "Application heuristic, not an industry-certified metric."},
  "today": {"...": "See Summary schema in OpenAPI"},
  "budget": {"target": 250, "used": 100, "remaining": 150, "percentage": 40}
}
```

This abbreviated example omits Summary fields and score factors; live messages contain their full typed objects. `alerts` contains newly created events, while `active_alert_count` includes acknowledged unresolved events. Other event types are `settings_changed`, `alerts_changed`, `status`, and `pong`. The stream accepts text `ping`; other short inbound messages are ignored, and oversized messages close the connection with 1009. Device data must go through the authenticated HTTP ingestion endpoint, not this stream.

Client reconnection uses exponential delay and receives the latest snapshot. A snapshot can be stale: always use its measurement timestamp for freshness. Slow-client queues keep at most three pending messages, discarding the oldest snapshot. Authoritative alert history is available through REST.

The application currently has one meter. Source mode is selected server-side; callers cannot inject readings into the inactive source or mix hardware and demo queries.
