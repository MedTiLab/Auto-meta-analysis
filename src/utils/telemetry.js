export const TELEMETRY_ENABLED_KEY = 'telemetry-enabled';
export const TELEMETRY_SETTINGS_EVENT = 'telemetrySettingsChanged';

export const isTelemetryEnabled = () => {
  if (typeof window === 'undefined') {
    return false;
  }

  return localStorage.getItem(TELEMETRY_ENABLED_KEY) === 'true';
};

export const setTelemetryEnabled = (enabled) => {
  if (typeof window === 'undefined') {
    return;
  }

  localStorage.setItem(TELEMETRY_ENABLED_KEY, enabled ? 'true' : 'false');
  window.dispatchEvent(new Event(TELEMETRY_SETTINGS_EVENT));
};
