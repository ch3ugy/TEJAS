import React, { useState, useEffect } from 'react';
import { 
  GitFork, 
  Clock, 
  MapPin, 
  ShieldAlert, 
  ArrowRight, 
  Eye, 
  User, 
  CheckCircle2, 
  AlertTriangle,
  Play, 
  Sliders, 
  Shield, 
  Zap, 
  Camera, 
  Activity, 
  Layers, 
  RefreshCw 
} from 'lucide-react';
import { apiClient } from '../services/api';
import { wsService } from '../services/websocket';

export default function Tracking() {
  // Global tracks state
  const [globalTracks, setGlobalTracks] = useState([]);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [trackDossier, setTrackDossier] = useState(null);
  const [isLoadingTracks, setIsLoadingTracks] = useState(false);

  // Engine config state
  const [config, setConfig] = useState({ similarity_threshold: 0.72, max_transit_seconds: 180.0 });
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [configFeedback, setConfigFeedback] = useState(null);

  // Load global tracks and config on mount
  useEffect(() => {
    fetchGlobalTracks();
    fetchConfig();

    const unsubscribe = wsService.subscribe((msg) => {
      if (msg.type === 'MULTI_CAMERA_HANDOFF' || msg.type === 'CROSS_CAMERA_HANDOFF') {
        fetchGlobalTracks();
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (selectedTrackId) {
      fetchTrackDossier(selectedTrackId);
    } else {
      setTrackDossier(null);
    }
  }, [selectedTrackId]);

  const fetchGlobalTracks = async () => {
    setIsLoadingTracks(true);
    try {
      const tracks = await apiClient.getGlobalTracks();
      if (tracks && tracks.length > 0) {
        setGlobalTracks(tracks);
        if (!selectedTrackId) {
          setSelectedTrackId(tracks[0].id);
        }
      } else {
        setGlobalTracks([]);
      }
    } catch (err) {
      console.error("Failed to load global tracks:", err);
    } finally {
      setIsLoadingTracks(false);
    }
  };

  const fetchTrackDossier = async (trackId) => {
    try {
      const dossier = await apiClient.getGlobalTrackDetail(trackId);
      setTrackDossier(dossier);
    } catch (err) {
      console.error("Failed to fetch track dossier:", err);
    }
  };

  const fetchConfig = async () => {
    try {
      const cfg = await apiClient.getTrackingConfig();
      if (cfg) setConfig(cfg);
    } catch (err) {
      console.error("Failed to load tracking config:", err);
    }
  };

  const handleSaveConfig = async () => {
    setIsSavingConfig(true);
    try {
      const updated = await apiClient.updateTrackingConfig(
        config.similarity_threshold,
        config.max_transit_seconds
      );
      if (updated) {
        setConfigFeedback("Parameters updated successfully");
        setTimeout(() => setConfigFeedback(null), 3500);
      }
    } catch (err) {
      console.error("Failed to save config:", err);
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Convert numerical score to operational alert level without 0-100 scores
  const getOperationalLevel = (trk) => {
    const raw = trk?.threat_score || 0;
    if (raw >= 60 || trk?.status === 'RESTRICTED_BREACH') return { label: 'PRIORITY', style: 'bg-red-50 text-red-700 border-red-200' };
    if (raw >= 30 || trk?.total_handoffs > 1) return { label: 'ALERT', style: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'INFO', style: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <GitFork className="w-5 h-5 text-blue-600" />
            Cross-Camera Tracking & Re-Identification
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Associates visual appearances across non-overlapping surveillance nodes using appearance descriptors and spatio-temporal constraints.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200 text-xs font-medium text-emerald-700">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>Re-ID Engine: Online</span>
          </div>
          <button
            onClick={fetchGlobalTracks}
            disabled={isLoadingTracks}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoadingTracks ? 'animate-spin' : ''}`} />
            <span>Refresh Tracks</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Track Registry & Settings */}
        <div className="lg:col-span-4 space-y-4">
          {/* Active Global Identifiers Card */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Global Unified Tracks ({globalTracks.length})
                </h2>
              </div>
              <span className="text-[10px] font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded">
                Live Registry
              </span>
            </div>

            {globalTracks.length === 0 ? (
              <div className="text-center py-10 text-slate-500 text-xs space-y-2">
                <Activity className="w-8 h-8 text-slate-300 mx-auto" />
                <p>No active global tracks recorded.</p>
                <p className="text-[11px] text-slate-400">
                  Execute the transit simulation below or ingest camera feeds to record cross-node entities.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {globalTracks.map((trk) => {
                  const isSelected = selectedTrackId === trk.id;
                  const op = getOperationalLevel(trk);

                  return (
                    <div
                      key={trk.id}
                      onClick={() => setSelectedTrackId(trk.id)}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-blue-50/70 border-blue-400 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-xs text-slate-900 font-mono">
                          {trk.id}
                        </span>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${op.style}`}>
                          {op.label}
                        </span>
                      </div>

                      <div className="mt-2 flex items-center justify-between text-xs text-slate-600">
                        <span className="flex items-center gap-1">
                          <Camera className="w-3.5 h-3.5 text-slate-400" />
                          {trk.current_camera}
                        </span>
                        <span className="text-[11px] text-blue-600 font-medium">
                          {trk.total_handoffs} node handoff{trk.total_handoffs !== 1 ? 's' : ''}
                        </span>
                      </div>

                      <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-400">
                        <span>First: {trk.first_seen_camera}</span>
                        <span className="capitalize">{trk.status?.toLowerCase().replace('_', ' ')}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Re-ID Engine Sensitivity & Threshold Controls */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Re-ID Sensitivity & Constraints
                </h3>
              </div>
              <span className="text-[10px] text-slate-500">Cosine Metric</span>
            </div>

            <div className="space-y-3 text-xs">
              <div>
                <div className="flex justify-between text-slate-700 mb-1">
                  <span className="font-medium">Cosine Similarity Threshold:</span>
                  <span className="text-blue-600 font-bold font-mono">{(config.similarity_threshold * 100).toFixed(1)}%</span>
                </div>
                <input
                  type="range"
                  min="0.50"
                  max="0.95"
                  step="0.01"
                  value={config.similarity_threshold}
                  onChange={(e) => setConfig({ ...config, similarity_threshold: parseFloat(e.target.value) })}
                  className="w-full accent-blue-600 bg-slate-200 h-1.5 rounded cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>Permissive (50%)</span>
                  <span>Default (72%)</span>
                  <span>Strict (95%)</span>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-slate-700 mb-1">
                  <span className="font-medium">Max Transit Window:</span>
                  <span className="text-amber-600 font-bold font-mono">{config.max_transit_seconds}s</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="300"
                  step="5"
                  value={config.max_transit_seconds}
                  onChange={(e) => setConfig({ ...config, max_transit_seconds: parseFloat(e.target.value) })}
                  className="w-full accent-amber-600 bg-slate-200 h-1.5 rounded cursor-pointer"
                />
                <div className="flex justify-between text-[10px] text-slate-400 mt-0.5">
                  <span>Fast (10s)</span>
                  <span>Nominal (180s)</span>
                  <span>Extended (300s)</span>
                </div>
              </div>

              {configFeedback && (
                <div className="p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                  <span>{configFeedback}</span>
                </div>
              )}

              <button
                onClick={handleSaveConfig}
                disabled={isSavingConfig}
                className="w-full py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5"
              >
                <Shield className="w-3.5 h-3.5" />
                <span>{isSavingConfig ? 'Saving...' : 'Update Hyperparameters'}</span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Column: Track Dossier & Cross-Camera Handoff Timeline */}
        <div className="lg:col-span-8 space-y-4">
          {trackDossier ? (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 space-y-4">
              {/* Dossier Header */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-slate-100 gap-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
                    <User className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-base font-bold text-slate-900 font-mono">{trackDossier.id}</h2>
                      <span className="text-[11px] font-medium px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                        {trackDossier.entity_type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      First Origin: <strong className="text-slate-700">{trackDossier.first_seen_camera}</strong> • Current Node: <strong className="text-blue-600">{trackDossier.current_camera}</strong>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 font-medium">TOTAL HANDOFFS</div>
                    <div className="text-sm font-bold text-emerald-600">{trackDossier.total_handoffs} Nodes</div>
                  </div>
                  <div className="h-8 w-[1px] bg-slate-200" />
                  <div className="text-right">
                    <div className="text-[10px] text-slate-500 font-medium">POSTURE</div>
                    <div className="text-xs font-bold text-slate-700 uppercase">
                      {trackDossier.status || 'Active Tracking'}
                    </div>
                  </div>
                </div>
              </div>

              {/* Camera Progression Breadcrumb */}
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1.5">
                  <GitFork className="w-3.5 h-3.5 text-blue-600" />
                  <span>Transit Progression:</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs">
                  {trackDossier.movement_path && trackDossier.movement_path.length > 0 ? (
                    trackDossier.movement_path.map((node, idx) => (
                      <React.Fragment key={idx}>
                        <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white border border-slate-300 text-slate-800 shadow-sm font-mono text-[11px]">
                          <Camera className="w-3.5 h-3.5 text-blue-600" />
                          <span className="font-semibold text-slate-900">{node.camera_id}</span>
                          <span className="text-slate-400">({node.timestamp})</span>
                        </div>
                        {idx < trackDossier.movement_path.length - 1 && (
                          <ArrowRight className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        )}
                      </React.Fragment>
                    ))
                  ) : (
                    <div className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-white border border-slate-300 text-slate-800 shadow-sm font-mono text-[11px]">
                      <Camera className="w-3.5 h-3.5 text-blue-600" />
                      <span className="font-semibold text-slate-900">{trackDossier.current_camera}</span>
                      <span className="text-slate-400">(Initial sighting)</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Handoff History Records */}
              <div>
                <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-slate-500" />
                    <span>Cross-Camera Transitions & Sensor Evidence:</span>
                  </span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    {trackDossier.handoffs?.length || 0} transition{trackDossier.handoffs?.length !== 1 ? 's' : ''} logged
                  </span>
                </div>

                {trackDossier.handoffs && trackDossier.handoffs.length > 0 ? (
                  <div className="space-y-2.5">
                    {trackDossier.handoffs.map((h, i) => (
                      <div 
                        key={h.id || i}
                        className="p-3.5 rounded-lg bg-slate-50 border border-slate-200 hover:border-slate-300 transition-colors"
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 pb-2 border-b border-slate-200/80">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-bold font-mono">
                              TRANSIT #{i + 1}
                            </span>
                            <span className="text-slate-800 font-semibold text-xs flex items-center gap-1.5 font-mono">
                              {h.from_camera} <ArrowRight className="w-3.5 h-3.5 text-blue-500" /> {h.to_camera}
                            </span>
                          </div>
                          <div className="flex items-center gap-3 text-xs text-slate-600 font-mono">
                            <span>Transit Delay: <strong className="text-slate-800">{h.transition_time_seconds}s</strong></span>
                            <span>Similarity: <strong className="text-emerald-600 font-bold">{(h.similarity_score * 100).toFixed(1)}%</strong></span>
                          </div>
                        </div>

                        {/* Snapshot Display if available */}
                        {h.snapshot_base64 && (
                          <div className="mt-2 flex items-center gap-3">
                            <img 
                              src={`data:image/jpeg;base64,${h.snapshot_base64}`} 
                              alt="Handoff Subject Evidence" 
                              className="w-14 h-28 object-cover rounded border border-slate-300 bg-slate-100"
                            />
                            <div className="text-xs text-slate-600 space-y-1">
                              <div className="text-slate-800 font-medium">Optical Sensor Evidence Captured</div>
                              <div className="text-slate-500">Resolution: Normalized 160x80 crop</div>
                              <div className="text-slate-500">Descriptor: 3-Stripe Color/Texture Vector</div>
                              <div className="text-emerald-700 font-medium">Cross-camera correlation verified</div>
                            </div>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-slate-50 border border-slate-200 text-slate-500 text-xs text-center">
                    Single-node sighting so far. A cross-camera transition will appear here once the entity enters another node's field of view.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-10 text-center text-slate-500 space-y-2">
              <Eye className="w-8 h-8 text-slate-300 mx-auto" />
              <div className="text-sm font-semibold text-slate-700">No Track Selected</div>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Select an entity from the unified registry or run the cross-camera testbench below.
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
