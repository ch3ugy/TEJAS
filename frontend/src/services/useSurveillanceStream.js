/**
 * TEJAS Real Surveillance Stream Hook — Phase 2
 * Consumes real backend WebSocket events (OPERATIONAL_EVENT).
 * No threat scores. Uses alert_level: INFO | NOTICE | ALERT | PRIORITY.
 */
import { useState, useEffect, useCallback } from 'react';
import { wsService } from './websocket';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

// Map alert_level to display metadata
const ALERT_LEVEL_META = {
  PRIORITY: { color: '#EF4444', badge: 'bg-red-500/10 text-red-400 border-red-500/30', label: 'PRIORITY' },
  ALERT:    { color: '#F97316', badge: 'bg-orange-500/10 text-orange-400 border-orange-500/30', label: 'ALERT' },
  NOTICE:   { color: '#F59E0B', badge: 'bg-amber-500/10 text-amber-400 border-amber-500/30', label: 'NOTICE' },
  INFO:     { color: '#10B981', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30', label: 'MONITORING' },
};

function getAlertMeta(alertLevel) {
  return ALERT_LEVEL_META[alertLevel] || ALERT_LEVEL_META.INFO;
}

export function useSurveillanceStream() {
  const [alerts, setAlerts] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [events, setEvents] = useState([]);
  const [activeStatus, setActiveStatus] = useState({
    alert_level: 'INFO',
    alert_reason: 'MONITORING IDLE',
    entity: 'MONITORING IDLE',
    authorization_state: 'UNKNOWN',
    ...getAlertMeta('INFO'),
  });
  const [isConnected, setIsConnected] = useState(false);
  const [newAlertCount, setNewAlertCount] = useState(0);
  const [lastAnprDetection, setLastAnprDetection] = useState(null);
  const [cameraStatuses, setCameraStatuses] = useState({});

  const fetchInitialData = useCallback(async () => {
    try {
      const [alertsRes, incRes, evtRes] = await Promise.all([
        fetch(`${API_BASE}/alerts`),
        fetch(`${API_BASE}/incidents`),
        fetch(`${API_BASE}/events?limit=30`),
      ]);

      if (alertsRes.ok) setAlerts(await alertsRes.json());
      if (incRes.ok) {
        const data = await incRes.json();
        setIncidents(data);
        if (data.length > 0) {
          const latest = data[0];
          const level = latest.severity || 'INFO'; // severity repurposed as alert_level in Phase 2
          const meta = getAlertMeta(level);
          setActiveStatus({
            alert_level: level,
            alert_reason: latest.title || '',
            entity: latest.target_entity || 'TRACKED ENTITY',
            authorization_state: latest.threat_factors?.[0]?.authorization_state || 'UNKNOWN',
            ...meta,
          });
        }
      }
      if (evtRes.ok) setEvents(await evtRes.json());
    } catch (err) {
      console.warn('Surveillance REST sync warning:', err);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
    wsService.connect();

    const unsubscribe = wsService.subscribe((msg) => {
      setIsConnected(true);

      // Phase 2 event type
      if (msg.type === 'OPERATIONAL_EVENT') {
        const { event, alert, incident } = msg;

        if (event) {
          setEvents(prev => [event, ...prev.slice(0, 49)]);
          const meta = getAlertMeta(event.alert_level || 'INFO');
          setActiveStatus({
            alert_level: event.alert_level || 'INFO',
            alert_reason: event.alert_reason || '',
            entity: event.entity_id || 'TRACKED ENTITY',
            authorization_state: event.authorization_state || 'UNKNOWN',
            ...meta,
          });
        }

        if (alert) {
          setAlerts(prev => {
            if (prev.some(a => a.id === alert.id)) return prev;
            setNewAlertCount(c => c + 1);
            return [alert, ...prev];
          });
        }

        if (incident) {
          setIncidents(prev => {
            const idx = prev.findIndex(i => i.id === incident.id);
            if (idx >= 0) {
              const updated = [...prev];
              updated[idx] = incident;
              return updated;
            }
            return [incident, ...prev];
          });
        }
      }

      // Phase 1 legacy type (still handled for backward compatibility)
      if (msg.type === 'CORRELATED_EVENT') {
        const { event, alert, incident } = msg;
        if (event) setEvents(prev => [event, ...prev.slice(0, 49)]);
        if (alert) {
          setAlerts(prev => {
            if (prev.some(a => a.id === alert.id)) return prev;
            return [alert, ...prev];
          });
        }
        if (incident) {
          setIncidents(prev => {
            const idx = prev.findIndex(i => i.id === incident.id);
            if (idx >= 0) {
              const u = [...prev];
              u[idx] = incident;
              return u;
            }
            return [incident, ...prev];
          });
        }
      }

      if (msg.type === 'ANPR_DETECTION' && msg.data) {
        setLastAnprDetection(msg.data);
      }

      if (msg.type === 'NEW_INCIDENT' && msg.incident) {
        setIncidents(prev => {
          if (prev.some(i => i.id === msg.incident.id)) return prev;
          return [msg.incident, ...prev];
        });
      }

      if (msg.type === 'CAMERA_OFFLINE' || msg.type === 'CAMERA_ONLINE') {
        setCameraStatuses(prev => ({
          ...prev,
          [msg.camera_id]: msg.type === 'CAMERA_ONLINE' ? 'ONLINE' : 'OFFLINE',
        }));
      }
    });

    return () => unsubscribe();
  }, [fetchInitialData]);

  // Backward-compatible activeThreat shape (for components that still use old field names)
  const activeThreat = {
    ...activeStatus,
    score: 0,                           // Deprecated — always 0 in Phase 2
    severity: activeStatus.alert_level, // Repurposed
    severityColor: activeStatus.color,
    badgeClass: activeStatus.badge,
    factors: [],
  };

  return {
    alerts,
    incidents,
    events,
    activeThreat,
    activeStatus,
    isConnected,
    newAlertCount,
    lastAnprDetection,
    cameraStatuses,
    refetch: fetchInitialData,
  };
}
