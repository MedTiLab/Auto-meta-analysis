/**
 * Remote telemetry HTTP export was removed.
 * enqueue* helpers are no-ops; POST /api/telemetry/events responds 202 with accepted: 0.
 */

export function isTelemetryEnabled() {
  return false;
}

export function enqueueTelemetryEvent() {
  return false;
}

export function enqueueTelemetryEvents() {
  return 0;
}
