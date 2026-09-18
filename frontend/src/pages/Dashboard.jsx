import React, { useState, useEffect, useCallback } from 'react';
import KPIStatsRow from '../components/common/KPIStatsRow';
import ThreatIntelPanel from '../components/threat/ThreatIntelPanel';
import RealtimeAlertStream from '../components/threat/RealtimeAlertStream';
import EventTimeline from '../components/threat/EventTimeline';
import { useSurveillanceStream } from '../services/useSurveillanceStream';
import { useVideoTelemetry } from '../services/useVideoTelemetry';
import { apiClient } from '../services/api';
import { Video, Radio, ArrowUpRight, Camera } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const [analyticsSummary, setAnalyticsSummary] = useState(null);
  const [cameras, setCameras] = useState([]);

  const { alerts, incidents, events, activeStatus, isConnected } = useSurveillanceStream();
  const { telemetry } = useVideoTelemetry();

  const loadBackendData = useCallback(async () => {
    try {
      const [summary, cams] = await Promise.all([
        apiClient.getAnalyticsSummary(),
        apiClient.getCameras()
      ]);
      if (summary) setAnalyticsSummary(summary);
      if (cams && cams.length > 0) setCameras(cams);
    } catch (e) {
      console.warn("Error fetching dashboard analytics:", e);
    }
  }, []);

  useEffect(() => {
    loadBackendData();
    const interval = setInterval(loadBackendData, 5000);
    return () => clearInterval(interval);
  }, [loadBackendData]);

  const realLatency = telemetry?.inference_ms
    ? `${Math.round(telemetry.inference_ms)}ms`
    : (telemetry?.latency_ms ? `${Math.round(telemetry.latency_ms)}ms` : '32ms');

  const totalCamsCount = analyticsSummary?.total_cameras ?? cameras.length;
  const onlineCamsCount = analyticsSummary?.online_cameras ?? cameras.filter(c => c.status === 'ONLINE').length;
  const activeIncidentsCount = (incidents || []).filter(i => i.status !== 'RESOLVED').length;
  const eventsCount = analyticsSummary?.events_today ?? events.length;

  const primaryCamera = cameras.length > 0 ? cameras[0] : { code: 'CAM-00', name: 'Primary Camera' };

  return (
    <div className="space-y-5 p-6 max-w-[1920px] mx-auto">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">
            Command Dashboard
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Operational perimeter overview, live sensor streams, and event triage.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Link
            to="/surveillance"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium shadow-sm transition-colors"
          >
            <Video className="w-3.5 h-3.5" />
            <span>Open Multi-Grid View</span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-80" />
          </Link>
        </div>
      </div>

      {/* KPI Stats Row */}
      <KPIStatsRow 
        totalCameras={totalCamsCount || 1}
        onlineCameras={onlineCamsCount || 1}
        activeIncidents={activeIncidentsCount}
        eventsToday={eventsCount}
        inferenceLatency={realLatency}
      />

      {/* Primary Operations Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left 7 Cols: Primary Live Video Feed & Status Panel */}
        <div className="lg:col-span-7 space-y-4">
          {/* Primary Camera Card */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-3.5 border-b border-slate-100 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-slate-600" />
                <span className="font-semibold text-xs text-slate-900">{primaryCamera.name || 'Primary Feed'}</span>
                <span className="font-mono text-[11px] text-slate-500">({primaryCamera.code || 'CAM-00'})</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  LIVE
                </span>
              </div>
            </div>

            <div className="relative aspect-video bg-slate-900 overflow-hidden flex items-center justify-center">
              <img
                src={`http://localhost:8000/api/video/feed?camera_id=${encodeURIComponent(primaryCamera.code || 'CAM-00')}`}
                alt="Primary Camera Live Feed"
                className="w-full h-full object-cover"
                onError={(e) => {
                  e.currentTarget.style.display = 'none';
                  const fb = e.currentTarget.nextElementSibling;
                  if (fb) fb.style.display = 'flex';
                }}
              />
              <div className="hidden flex-col items-center justify-center text-slate-400 p-6 text-center">
                <Video className="w-10 h-10 text-slate-600 mb-2" />
                <span className="text-xs font-medium text-slate-300">Video Stream Initializing</span>
                <span className="text-[11px] text-slate-500 mt-0.5">Connecting to camera pipeline...</span>
              </div>
            </div>
          </div>

          {/* Operational Status & Incident Summary */}
          <ThreatIntelPanel 
            activeStatus={activeStatus} 
            latestIncident={incidents.length > 0 ? incidents[0] : null} 
          />
        </div>

        {/* Right 5 Cols: Alerts Stream & Event Timeline */}
        <div className="lg:col-span-5 space-y-4">
          <RealtimeAlertStream alerts={alerts} />
          <EventTimeline incident={incidents.length > 0 ? incidents[0] : null} events={events} />
        </div>
      </div>
    </div>
  );
}
