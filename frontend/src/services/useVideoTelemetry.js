import { useState, useEffect, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export function useVideoTelemetry(enabled = true, pollIntervalMs = 800) {
  const [telemetry, setTelemetry] = useState(null);
  const [isBackendOnline, setIsBackendOnline] = useState(false);
  const [error, setError] = useState(null);

  const fetchTelemetry = useCallback(async () => {
    if (!enabled) return;
    try {
      const res = await fetch(`${API_BASE}/video/telemetry`);
      if (res.ok) {
        const data = await res.json();
        setTelemetry(data);
        setIsBackendOnline(true);
        setError(null);
      } else {
        setIsBackendOnline(false);
      }
    } catch (err) {
      setIsBackendOnline(false);
      setError(err.message);
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    fetchTelemetry();
    const interval = setInterval(fetchTelemetry, pollIntervalMs);
    return () => clearInterval(interval);
  }, [enabled, pollIntervalMs, fetchTelemetry]);

  const updateConfig = async (config) => {
    try {
      const res = await fetch(`${API_BASE}/video/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        const data = await res.json();
        if (data.telemetry) {
          setTelemetry(data.telemetry);
        }
        return true;
      }
    } catch (err) {
      console.warn("Failed to update video config:", err);
    }
    return false;
  };

  return {
    telemetry,
    isBackendOnline,
    error,
    updateConfig,
    refetch: fetchTelemetry
  };
}
