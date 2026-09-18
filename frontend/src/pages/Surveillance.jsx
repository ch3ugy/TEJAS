import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Video, 
  ZoomIn, 
  ZoomOut, 
  Sun, 
  Moon, 
  Camera, 
  Plus, 
  Users, 
  Cpu, 
  Activity,
  Shield,
  Volume2,
  VolumeX,
  BellRing,
} from 'lucide-react';
import { useVideoTelemetry } from '../services/useVideoTelemetry';
import { useSurveillanceStream } from '../services/useSurveillanceStream';
import { apiClient } from '../services/api';
import { Link } from 'react-router-dom';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

/* ── Event type → display config ───────────── */
const EVENT_DISPLAY = {
  PERSON_DETECTED:            { label: 'DETECTION',       icon: '👤', bg: 'bg-slate-50 border-slate-200 text-slate-600' },
  VEHICLE_DETECTED:           { label: 'DETECTION',       icon: '🚗', bg: 'bg-slate-50 border-slate-200 text-slate-600' },
  ZONE_ENTRY:                 { label: 'ZONE ENTRY',      icon: '📍', bg: 'bg-blue-50 border-blue-200 text-blue-700' },
  ZONE_EXIT:                  { label: 'ZONE EXIT',       icon: '🚪', bg: 'bg-slate-50 border-slate-200 text-slate-500' },
  LOITERING:                  { label: 'LOITERING',       icon: '⏱', bg: 'bg-amber-50 border-amber-200 text-amber-700' },
  WATCHLIST_FACE_MATCH:       { label: 'WATCHLIST MATCH', icon: '⚠️', bg: 'bg-red-50 border-red-200 text-red-700' },
  WATCHLIST_PLATE_MATCH:      { label: 'WATCHLIST MATCH', icon: '⚠️', bg: 'bg-red-50 border-red-200 text-red-700' },
  AUTHORIZED_FACE_VERIFIED:   { label: 'AUTHORIZED',      icon: '✅', bg: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
  PLATE_DETECTED:             { label: 'ANPR',            icon: '🔤', bg: 'bg-blue-50 border-blue-200 text-blue-700' },
  NIGHT_MOVEMENT:             { label: 'NIGHT MOVEMENT',  icon: '🌙', bg: 'bg-purple-50 border-purple-200 text-purple-700' },
  UNAUTHORIZED_ZONE_ACTIVITY: { label: 'INTRUSION',       icon: '🚨', bg: 'bg-red-50 border-red-200 text-red-700' },
  CROSS_CAMERA_CANDIDATE:     { label: 'CROSS-CAM',       icon: '🔗', bg: 'bg-indigo-50 border-indigo-200 text-indigo-700' },
  PATROL_ACTIVITY:            { label: 'PATROL',          icon: '🛡', bg: 'bg-emerald-50 border-emerald-200 text-emerald-600' },
  CAMERA_OFFLINE:             { label: 'CAM OFFLINE',     icon: '📵', bg: 'bg-orange-50 border-orange-200 text-orange-700' },
  CAMERA_ONLINE:              { label: 'CAM ONLINE',      icon: '📡', bg: 'bg-emerald-50 border-emerald-200 text-emerald-600' },
};

// Event types that represent an actual virtual-fence breach and should sound
// the laptop alarm (debounced server-side to one event per real entry).
const INTRUSION_EVENT_TYPES = new Set(['ZONE_ENTRY', 'UNAUTHORIZED_ZONE_ACTIVITY']);

/**
 * Laptop audible alarm for virtual-fence intrusions.
 * Browsers block audio autoplay until a user gesture, so the operator must
 * press "Arm Alarm" once; after that, real intrusion events play a tone
 * through the Web Audio API (no extra audio asset / dependency required).
 * De-duplicates by event id so the same backend event never re-fires the
 * alarm, while independent events (including from other cameras) each play.
 */
function useIntrusionAlarm(events) {
  const [armed, setArmed] = useState(false);
  const audioCtxRef = useRef(null);
  const seenIdsRef = useRef(new Set());
  const [lastIntrusion, setLastIntrusion] = useState(null);

  const arm = useCallback(() => {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!audioCtxRef.current) audioCtxRef.current = new Ctx();
      if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume();
      setArmed(true);
    } catch (err) {
      console.warn('Unable to arm alarm audio:', err);
    }
  }, []);

  const disarm = useCallback(() => setArmed(false), []);

  const playSiren = useCallback(() => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'square';
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
    // Two-tone rising/falling sweep, ~900ms total — clearly audible "alarm" cadence.
    osc.frequency.setValueAtTime(660, now);
    osc.frequency.linearRampToValueAtTime(990, now + 0.28);
    osc.frequency.linearRampToValueAtTime(660, now + 0.56);
    osc.frequency.linearRampToValueAtTime(990, now + 0.84);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    osc.start(now);
    osc.stop(now + 0.92);
  }, []);

  useEffect(() => {
    if (!events || events.length === 0) return;
    const newest = events[0];
    const et = newest.event_type || '';
    const id = newest.id;
    if (!id || seenIdsRef.current.has(id)) return;
    if (!INTRUSION_EVENT_TYPES.has(et)) return;

    seenIdsRef.current.add(id);
    // Keep the de-dup set bounded
    if (seenIdsRef.current.size > 300) {
      seenIdsRef.current = new Set(Array.from(seenIdsRef.current).slice(-150));
    }
    setLastIntrusion(newest);
    if (armed) playSiren();
  }, [events, armed, playSiren]);

  return { armed, arm, disarm, lastIntrusion };
}

function getED(et) {
  return EVENT_DISPLAY[et] || { label: (et || 'EVENT').replace(/_/g, ' '), icon: '📋', bg: 'bg-slate-50 border-slate-200 text-slate-600' };
}

const LEVEL_BADGE = {
  PRIORITY: 'bg-red-100 text-red-700 border-red-300',
  ALERT:    'bg-orange-100 text-orange-700 border-orange-300',
  NOTICE:   'bg-amber-100 text-amber-700 border-amber-300',
  INFO:     'bg-slate-100 text-slate-600 border-slate-200',
};

function EventRow({ evt }) {
  const et = evt.event_type || evt._event_type || '';
  const d = getED(et);
  const level = evt.alert_level || evt.metadata_json?.alert_level || evt.severity || 'INFO';
  const cam = evt.camera_id || evt.camera || '—';
  const entity = evt.entity_id || '—';
  const loc = evt.location || '';
  const ts = evt.timestamp || '';
  return (
    <div className={`p-2.5 rounded-md border text-xs ${d.bg} flex gap-2 items-start`}>
      <span className="text-sm leading-none mt-0.5 shrink-0">{d.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1 mb-0.5">
          <span className="font-bold text-[10px] uppercase tracking-wide">{d.label}</span>
          <span className={`px-1.5 py-px rounded text-[9px] font-bold border ${LEVEL_BADGE[level] || LEVEL_BADGE.INFO}`}>{level}</span>
        </div>
        <div className="font-mono text-[10px] opacity-75 truncate">{cam}</div>
        <div className="truncate opacity-90 text-[11px]">{entity}</div>
        {loc && <div className="truncate text-[10px] opacity-55 mt-0.5">{loc}</div>}
        {ts && <div className="text-[10px] opacity-40 font-mono mt-0.5">{ts}</div>}
      </div>
    </div>
  );
}

export default function Surveillance() {
  const [dbCameras, setDbCameras] = useState([]);
  const [selectedCam, setSelectedCam] = useState(null);
  const [nightVision, setNightVision] = useState(false);
  const [ptzZoom, setPtzZoom] = useState(1.0);

  const { telemetry } = useVideoTelemetry(true, 800);
  const { alerts, events, isConnected } = useSurveillanceStream();
  const alarm = useIntrusionAlarm(events);

  useEffect(() => {
    async function loadCams() {
      try {
        const cams = await apiClient.getCameras();
        if (cams && cams.length > 0) {
          setDbCameras(cams);
          setSelectedCam(cams[0]);
        } else {
          const fallback = { id: 'CAM-00', code: 'CAM-00', name: 'Primary Camera', location: 'Main Terminal' };
          setDbCameras([fallback]);
          setSelectedCam(fallback);
        }
      } catch (err) {
        console.warn("Failed to load cameras in Surveillance:", err);
      }
    }
    loadCams();
  }, []);

  const activeTracks = Array.isArray(telemetry?.active_tracks) ? telemetry.active_tracks : [];
  const currentCamCode = selectedCam?.code || selectedCam?.id || 'CAM-00';
  const liveUrl = `${API_BASE}/video/feed?camera_id=${encodeURIComponent(currentCamCode)}`;

  // Build deduplicated event log (events + alerts merged, newest first, max 60)
  const seenIds = new Set();
  const eventLog = [];
  for (const evt of (events || [])) {
    const key = evt.id || JSON.stringify(evt);
    if (!seenIds.has(key)) { seenIds.add(key); eventLog.push(evt); }
  }
  for (const alt of (alerts || [])) {
    if (alt.id && !seenIds.has(alt.id)) {
      seenIds.add(alt.id);
      eventLog.push({
        id: alt.id,
        event_type: 'ZONE_ENTRY',
        camera_id: alt.camera,
        entity_id: alt.message || alt.title,
        timestamp: alt.timestamp,
        alert_level: alt.severity || 'ALERT',
        location: '',
      });
    }
  }
  const sortedLog = eventLog.slice(0, 60);

  return (
    <div className="space-y-5 p-6 max-w-[1920px] mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Surveillance Console</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time multi-camera video feed, spatial bounding boxes, and ByteTrack entity correlation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold border ${
            isConnected ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-50 text-slate-500 border-slate-200'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'}`} />
            {isConnected ? 'WS LIVE' : 'CONNECTING'}
          </span>
          <button
            onClick={alarm.armed ? alarm.disarm : alarm.arm}
            title={alarm.armed ? 'Alarm audio armed — click to mute' : 'Enable laptop alarm audio for intrusion alerts'}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-semibold border shadow-sm transition-colors ${
              alarm.armed
                ? 'bg-emerald-50 border-emerald-300 text-emerald-700'
                : 'bg-red-50 border-red-300 text-red-700 animate-pulse'
            }`}
          >
            {alarm.armed ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
            {alarm.armed ? 'Alarm Armed' : 'Arm Alarm'}
          </button>
          <Link
            to="/cameras"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-300 text-slate-700 hover:bg-slate-50 text-xs font-medium shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5 text-slate-500" />
            <span>Manage Ingestion Nodes</span>
          </Link>
        </div>
      </div>

      {/* Intrusion banner — visible confirmation the fence was breached */}
      {alarm.lastIntrusion && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-md bg-red-600 text-white shadow-sm animate-pulse">
          <BellRing className="w-4 h-4 shrink-0" />
          <div className="text-xs leading-tight">
            <span className="font-bold uppercase tracking-wide">Intrusion Detected</span>
            {'  '}
            <span className="opacity-90">
              Camera: {alarm.lastIntrusion.camera_id || '—'} · Zone: {alarm.lastIntrusion.location || alarm.lastIntrusion.metadata?.zone_name || '—'} ·
              {' '}Person: {alarm.lastIntrusion.metadata?.global_person_id || alarm.lastIntrusion.entity_id || 'UNIDENTIFIED'} ·
              {' '}Time: {alarm.lastIntrusion.timestamp || '—'}
            </span>
          </div>
          {!alarm.armed && (
            <span className="ml-auto text-[10px] font-semibold bg-black/25 px-2 py-1 rounded shrink-0">
              Audio muted — click "Arm Alarm"
            </span>
          )}
        </div>
      )}

      {/* Camera Pills */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1">
        {dbCameras.map((cam) => {
          const isSelected = (selectedCam?.code || selectedCam?.id) === (cam.code || cam.id);
          return (
            <button
              key={cam.code || cam.id}
              onClick={() => setSelectedCam(cam)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                isSelected ? 'bg-blue-600 text-white shadow-sm' : 'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <Camera className="w-3.5 h-3.5 shrink-0" />
              <span>{cam.name || cam.code}</span>
              <span className={`text-[10px] font-mono px-1.5 rounded ${isSelected ? 'bg-blue-700 text-blue-100' : 'bg-slate-100 text-slate-500'}`}>
                {cam.code}
              </span>
            </button>
          );
        })}
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 8: video + entity tracks */}
        <div className="lg:col-span-8 space-y-3">
          {/* Video panel */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-pulse" />
                  LIVE
                </span>
                <span className="font-semibold text-xs text-slate-900">{selectedCam?.name || 'Primary Feed'}</span>
                <span className="text-slate-400 text-xs">•</span>
                <span className="text-xs text-slate-500">{selectedCam?.location || 'Sector Perimeter'}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setNightVision(!nightVision)}
                  title="Toggle Low-Light Enhancement"
                  className={`p-1.5 rounded border transition-colors ${nightVision ? 'bg-amber-50 border-amber-300 text-amber-800' : 'bg-slate-50 border-slate-200 hover:bg-slate-100'}`}
                >
                  {nightVision ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
                </button>
                <button onClick={() => setPtzZoom(p => Math.min(2.0, p + 0.25))} className="p-1.5 rounded bg-slate-50 border border-slate-200 hover:bg-slate-100">
                  <ZoomIn className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => setPtzZoom(p => Math.max(1.0, p - 0.25))} className="p-1.5 rounded bg-slate-50 border border-slate-200 hover:bg-slate-100">
                  <ZoomOut className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
            <div className="relative aspect-video bg-slate-950 w-full overflow-hidden flex items-center justify-center">
              <div className="w-full h-full flex items-center justify-center transition-transform duration-200"
                style={{ transform: `scale(${ptzZoom})`, filter: nightVision ? 'contrast(130%) brightness(120%) saturate(60%)' : 'none' }}>
                <img
                  src={liveUrl}
                  alt={`Live Stream: ${currentCamCode}`}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                    const fb = e.currentTarget.nextElementSibling;
                    if (fb) fb.style.display = 'flex';
                  }}
                />
                <div className="hidden flex-col items-center justify-center text-slate-400 p-8 text-center">
                  <Video className="w-10 h-10 text-slate-600 mb-2" />
                  <span className="text-xs font-semibold text-slate-300">Stream Initializing or Offline</span>
                  <p className="text-[11px] text-slate-500 max-w-sm mt-1">Waiting for video frames on pipeline {currentCamCode}.</p>
                </div>
              </div>
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between pointer-events-none">
                <span className="px-2.5 py-1 rounded bg-black/60 text-white text-[11px] font-mono backdrop-blur-sm">
                  {currentCamCode} • {telemetry?.resolution || '1280x720'}
                </span>
                <span className="px-2.5 py-1 rounded bg-black/60 text-white text-[11px] font-mono backdrop-blur-sm">
                  {telemetry?.fps ? `${Math.round(telemetry.fps)} FPS` : '15 FPS'}
                </span>
              </div>
            </div>
          </div>

          {/* Active entity tracks — under the video on left */}
          <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-600" />
                <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">Active Entity Tracks</h3>
              </div>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">
                {activeTracks.length}
              </span>
            </div>
            {activeTracks.length > 0 ? (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                {activeTracks.map((trk, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-900 capitalize text-[11px]">{trk.class_name || 'Entity'}</span>
                      <span className="font-mono text-[9px] font-bold px-1 rounded bg-blue-50 text-blue-700 border border-blue-200">#{trk.track_id ?? i}</span>
                    </div>
                    <div className="flex justify-between text-[10px] text-slate-500">
                      <span>Conf:</span>
                      <span className="font-semibold text-slate-700">{trk.confidence ? `${Math.round(trk.confidence * 100)}%` : '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-slate-400">
                <p className="text-xs text-slate-500">No entities in view — YOLOv8 & ByteTrack active</p>
              </div>
            )}
          </div>
        </div>

        {/* Right 4: inference telemetry + OPERATIONAL EVENTS */}
        <div className="lg:col-span-4 flex flex-col gap-4">
          {/* Pipeline telemetry — compact */}
          <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-sm text-xs shrink-0">
            <div className="flex items-center gap-2 mb-2">
              <Cpu className="w-3.5 h-3.5 text-slate-500" />
              <h4 className="font-semibold text-slate-700 uppercase text-[10px] tracking-wider">Pipeline Telemetry</h4>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-slate-600">
              <span>Device:</span><span className="font-semibold text-slate-900 text-right">{telemetry?.device?.toUpperCase() || 'CPU'}</span>
              <span>Latency:</span><span className="font-semibold text-slate-900 text-right">{telemetry?.inference_ms ? `${Math.round(telemetry.inference_ms)}ms` : '—'}</span>
              <span>Protocol:</span><span className="font-semibold text-slate-900 text-right truncate">{selectedCam?.stream_type || 'HARDWARE'}</span>
              <span>Calibration:</span><span className="font-semibold text-emerald-700 text-right">Active</span>
            </div>
          </div>

          {/* ─── Operational Event Log ─── */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col flex-1 min-h-[400px]">
            <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-slate-600" />
                <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">Operational Events</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-700">{sortedLog.length}</span>
                {isConnected && <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" title="WebSocket live" />}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-3 space-y-2">
              {sortedLog.length > 0 ? (
                sortedLog.map((evt, idx) => <EventRow key={evt.id || idx} evt={evt} />)
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-slate-400 text-center py-8">
                  <Shield className="w-8 h-8 text-slate-300 mb-2" />
                  <p className="text-xs font-medium text-slate-500">No operational events yet</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Events populate when the AI pipeline detects activity in a configured zone.
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1 font-mono">Perimeter monitoring active</p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
