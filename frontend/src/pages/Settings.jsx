import React, { useState, useEffect } from 'react';
import { Sliders, Save, RotateCcw, Shield, Bell, CheckCircle2, UserCheck, Activity, Database } from 'lucide-react';
import { apiClient } from '../services/api';

export default function Settings() {
  const [trackingConfig, setTrackingConfig] = useState({
    similarity_threshold: 0.72,
    max_transit_seconds: 180
  });
  const [faceConfig, setFaceConfig] = useState({
    enabled: true,
    similarity_threshold: 0.40,
    min_quality_score: 0.35
  });
  const [audioAlerts, setAudioAlerts] = useState(true);
  const [loiterDwellSeconds, setLoiterDwellSeconds] = useState(10);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadAllConfigs = async () => {
    setLoading(true);
    try {
      const [trackRes, faceRes] = await Promise.all([
        apiClient.getTrackingConfig(),
        apiClient.getFaceConfig()
      ]);

      if (trackRes) {
        setTrackingConfig({
          similarity_threshold: trackRes.similarity_threshold ?? 0.72,
          max_transit_seconds: trackRes.max_transit_seconds ?? 180
        });
      }
      if (faceRes) {
        setFaceConfig({
          enabled: faceRes.enabled ?? true,
          similarity_threshold: faceRes.similarity_threshold ?? 0.40,
          min_quality_score: faceRes.min_quality_score ?? 0.35
        });
      }
    } catch (e) {
      console.warn("Failed to load settings configs:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAllConfigs();
  }, []);

  const handleSave = async () => {
    try {
      await Promise.all([
        apiClient.updateTrackingConfig(
          Number(trackingConfig.similarity_threshold),
          Number(trackingConfig.max_transit_seconds)
        ),
        apiClient.updateFaceConfig({
          enabled: faceConfig.enabled,
          similarity_threshold: Number(faceConfig.similarity_threshold),
          min_quality_score: Number(faceConfig.min_quality_score)
        })
      ]);
      setSavedSuccess(true);
      setTimeout(() => setSavedSuccess(false), 3000);
    } catch (e) {
      console.error("Failed to save system settings:", e);
      alert("Error saving settings: " + (e.message || "Failed"));
    }
  };

  const handleResetDefaults = () => {
    setTrackingConfig({ similarity_threshold: 0.72, max_transit_seconds: 180 });
    setFaceConfig({ enabled: true, similarity_threshold: 0.40, min_quality_score: 0.35 });
    setLoiterDwellSeconds(10);
    setAudioAlerts(true);
  };

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Sliders className="w-5 h-5 text-blue-600" />
            System Operational Calibration & Policies
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Calibrate inference thresholds, cross-camera Re-ID bounds, and operational alert triggers.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          {savedSuccess && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 text-emerald-700 border border-emerald-200 text-xs font-medium">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Settings Synchronized</span>
            </div>
          )}

          <button
            onClick={handleResetDefaults}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Defaults</span>
          </button>

          <button
            onClick={handleSave}
            className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <Save className="w-3.5 h-3.5" />
            <span>Save Configuration</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Tracking & Biometric Gating */}
        <div className="lg:col-span-7 space-y-4">
          {/* Multi-Camera Re-ID Hyperparameters */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Shield className="w-4 h-4 text-blue-600" />
              <span>Cross-Camera Re-ID Hyperparameters</span>
            </h2>

            <div className="space-y-4 text-xs">
              <div>
                <div className="flex justify-between text-slate-700 mb-1">
                  <span className="font-medium">Feature Vector Cosine Similarity Threshold:</span>
                  <span className="text-blue-600 font-bold font-mono">
                    {Math.round(trackingConfig.similarity_threshold * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.50"
                  max="0.95"
                  step="0.01"
                  value={trackingConfig.similarity_threshold}
                  onChange={(e) => setTrackingConfig({ ...trackingConfig, similarity_threshold: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-slate-200 rounded appearance-none accent-blue-600 cursor-pointer"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Cosine correlation cutoff for associating identical entities across non-overlapping camera fields of view.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <div className="flex justify-between text-slate-700 mb-1">
                  <span className="font-medium">Maximum Transit Temporal Window:</span>
                  <span className="text-amber-600 font-bold font-mono">{trackingConfig.max_transit_seconds} seconds</span>
                </div>
                <input
                  type="range"
                  min="30"
                  max="600"
                  step="10"
                  value={trackingConfig.max_transit_seconds}
                  onChange={(e) => setTrackingConfig({ ...trackingConfig, max_transit_seconds: parseInt(e.target.value, 10) })}
                  className="w-full h-1.5 bg-slate-200 rounded appearance-none accent-amber-600 cursor-pointer"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Maximum elapsed transit duration between camera sectors before identity continuity expires.
                </p>
              </div>
            </div>
          </div>

          {/* Biometric Recognition Policies */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-blue-600" />
              <span>Biometric Recognition Policies</span>
            </h2>

            <div className="space-y-4 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-800 font-medium block">Facial Recognition Gating</span>
                  <span className="text-[11px] text-slate-400">Extracts 128-D facial embeddings and checks watchlist registry</span>
                </div>
                <input
                  type="checkbox"
                  checked={faceConfig.enabled}
                  onChange={(e) => setFaceConfig({ ...faceConfig, enabled: e.target.checked })}
                  className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
                />
              </div>

              <div className="pt-3 border-t border-slate-100">
                <div className="flex justify-between text-slate-700 mb-1">
                  <span className="font-medium">Match Verification Threshold:</span>
                  <span className="text-blue-600 font-bold font-mono">{Math.round(faceConfig.similarity_threshold * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.25"
                  max="0.65"
                  step="0.01"
                  value={faceConfig.similarity_threshold}
                  onChange={(e) => setFaceConfig({ ...faceConfig, similarity_threshold: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-slate-200 rounded appearance-none accent-blue-600 cursor-pointer"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Cosine distance threshold on facial embeddings for positive watchlist identification.
                </p>
              </div>

              <div className="pt-3 border-t border-slate-100">
                <div className="flex justify-between text-slate-700 mb-1">
                  <span className="font-medium">Minimum Biometric Quality Gate:</span>
                  <span className="text-blue-600 font-bold font-mono">{Math.round(faceConfig.min_quality_score * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.15"
                  max="0.60"
                  step="0.01"
                  value={faceConfig.min_quality_score}
                  onChange={(e) => setFaceConfig({ ...faceConfig, min_quality_score: parseFloat(e.target.value) })}
                  className="w-full h-1.5 bg-slate-200 rounded appearance-none accent-blue-600 cursor-pointer"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Rejects blurry or low-resolution crops before classification to prevent false alarms.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Operational Alert Policies & Infrastructure */}
        <div className="lg:col-span-5 space-y-4">
          {/* Operational Alert Posture */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Bell className="w-4 h-4 text-blue-600" />
              <span>Operational Alert Policies</span>
            </h2>

            <div className="space-y-3 text-xs">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-slate-800 font-medium block">Acoustic Alert on Priority Events</span>
                  <span className="text-[11px] text-slate-400">Triggers operational sound notification on ALERT and PRIORITY</span>
                </div>
                <input
                  type="checkbox"
                  checked={audioAlerts}
                  onChange={(e) => setAudioAlerts(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 accent-blue-600 cursor-pointer"
                />
              </div>

              <div className="pt-3 border-t border-slate-100">
                <div className="flex justify-between text-slate-700 mb-1">
                  <span className="font-medium">Loitering Dwell Trigger Duration:</span>
                  <span className="text-blue-600 font-bold font-mono">{loiterDwellSeconds}s</span>
                </div>
                <input
                  type="range"
                  min="5"
                  max="60"
                  step="1"
                  value={loiterDwellSeconds}
                  onChange={(e) => setLoiterDwellSeconds(parseInt(e.target.value, 10))}
                  className="w-full h-1.5 bg-slate-200 rounded appearance-none accent-blue-600 cursor-pointer"
                />
                <p className="text-[11px] text-slate-400 mt-1">
                  Continuous residence time inside sensitive virtual boundaries before triggering a Loitering event.
                </p>
              </div>
            </div>
          </div>

          {/* Infrastructure & Persistence Status */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-3">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
              <Database className="w-4 h-4 text-blue-600" />
              <span>Data Architecture & Storage</span>
            </h2>

            <div className="divide-y divide-slate-100 text-xs">
              <div className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-800 block">Primary Database</span>
                  <span className="text-[11px] text-slate-400">PostgreSQL Relational Storage</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Connected
                </span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-800 block">Real-time Stream Delivery</span>
                  <span className="text-[11px] text-slate-400">Native WebSocket /ws/events</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                  Active
                </span>
              </div>

              <div className="py-2.5 flex items-center justify-between">
                <div>
                  <span className="font-medium text-slate-800 block">Inference Pipeline</span>
                  <span className="text-[11px] text-slate-400">YOLOv8 + ByteTrack + SFace + EasyOCR</span>
                </div>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                  Operational
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
