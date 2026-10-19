# Pin Row Recovery — Stage 2 requirements (DOCUMENT ONLY, NOT IMPLEMENTED)

Status: requirements for future iOS/Android work on standalone pins. Nothing here is built.
Stage 2 needs separate owner acceptance and Rork ownership of the shared contract.
Stage 1 (Portal, System Admin, Stockman's Ridge, read-only review) is the only active stage.

## Capture record per pin (immutable once written, offline-safe)
1. **Raw GPS**: latitude, longitude, horizontal accuracy (m), fix timestamp. Never overwritten by snapping.
2. **Snapped coordinate**: stored separately from raw, with the snapping method/version.
3. **Travel bearing** (movement, not phone facing): bearing, source
   (`gps_sequence` | `trip_track_segment` | `manual_confirmation`), qualification metrics
   (sample count, speed, accuracy, spread, displacement/straightness) and timestamp.
   The phone compass/device heading may be stored as orientation, never as travel direction.
4. **Manual direction fallback**: when the device is stationary or moving too little,
   the operator confirms direction (or aisle) explicitly; store who/when.
5. **Pressed Left/Right** with its timestamp, relative to the confirmed travel direction.
6. **Geometry version**: identity/hash of the block rows used at capture.
7. **Derived driving aisle** and **chosen physical vine row**.
8. **Decision confidence** and an explicit **hold reason** when the row is not chosen
   (e.g. `no_travel_direction`, `side_missing`, `gps_crosses_aisle`, `outside_block`, `headland`).

## Rules
- Never silently guess a row; hold with a reason instead.
- Offline capture queues the full record and resolves only when inputs qualify.
- Nearest physical row is never treated as the selected row.
- No per-block row offsets as workarounds.
