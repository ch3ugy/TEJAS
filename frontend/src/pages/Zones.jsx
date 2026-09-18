import React, { useState, useEffect, useRef } from 'react';
import { MapPin, Plus, Trash2, Layers, Save, Video, CheckCircle, AlertTriangle } from 'lucide-react';
import { apiClient } from '../services/api';
import { normalizeZoneEntry, buildZonePayload } from '../utils/zoneModel';

const ZONE_TYPE_METRICS = {
  RESTRICTED: { level: 'ALERT', color: '#DC2626', desc: 'Immediate intrusion alert generated', badgeBg: 'bg-red-50 text-red-700 border-red-200' },
  SENSITIVE: { level: 'NOTICE', color: '#D97706', desc: 'Tactical advisory on unauthorized dwell', badgeBg: 'bg-amber-50 text-amber-700 border-amber-200' },
  BORDER: { level: 'PRIORITY', color: '#7C3AED', desc: 'High-priority perimeter breach alarm', badgeBg: 'bg-purple-50 text-purple-700 border-purple-200' },
  ENTRY: { level: 'INFO', color: '#059669', desc: 'Standard checkpoint access logging', badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  EXIT: { level: 'INFO', color: '#2563EB', desc: 'Egress monitoring', badgeBg: 'bg-blue-50 text-blue-700 border-blue-200' },
  CUSTOM: { level: 'NOTICE', color: '#4B5563', desc: 'Custom ruleset evaluation', badgeBg: 'bg-slate-100 text-slate-700 border-slate-200' }
};

export default function Zones() {
  const [zones, setZones] = useState([]);
  const [cameras, setCameras] = useState([]);
  const [selectedZone, setSelectedZone] = useState(null);
  const [selectedCamera, setSelectedCamera] = useState('CAM-00');
  const [isAddingZone, setIsAddingZone] = useState(false);
  const [newZoneName, setNewZoneName] = useState('');
  const [newZoneType, setNewZoneType] = useState('RESTRICTED');
  const [newFenceType, setNewFenceType] = useState('2D');
  const [newFenceDepth, setNewFenceDepth] = useState(2.5);
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showLiveFeed, setShowLiveFeed] = useState(true);

  // SVG interaction
  const svgRef = useRef(null);
  const [draggingNode, setDraggingNode] = useState(null);

  const fetchZonesAndCameras = async () => {
    try {
      const [zData, cData] = await Promise.all([
        apiClient.getZones(),
        apiClient.getCameras()
      ]);

      const loadedZones = (zData || []).map((z) => {
        const normalized = normalizeZoneEntry(z);
        return {
          ...normalized,
          color: z.color || ZONE_TYPE_METRICS[z.type]?.color || '#DC2626',
        };
      });

      setZones(loadedZones);
      if (loadedZones.length > 0) {
        setSelectedZone(loadedZones[0]);
      }

      const loadedCams = (cData || []);
      const hasCam00 = loadedCams.some(c => c.code === 'CAM-00');
      const allCams = hasCam00 ? loadedCams : [{ id: 'CAM-00', code: 'CAM-00', name: 'Primary Camera' }, ...loadedCams];
      setCameras(allCams);
    } catch (err) {
      console.warn("Error fetching zones/cameras:", err);
    }
  };

  useEffect(() => {
    fetchZonesAndCameras();
  }, []);

  const handlePointerDown = (pIdx, e) => {
    e.stopPropagation();
    setDraggingNode(pIdx);
  };

  const handlePointerMove = (e) => {
    if (draggingNode === null || !selectedZone || !svgRef.current) return;
    
    const rect = svgRef.current.getBoundingClientRect();
    const clientX = e.clientX ?? (e.touches && e.touches[0]?.clientX);
    const clientY = e.clientY ?? (e.touches && e.touches[0]?.clientY);
    if (clientX === undefined || clientY === undefined) return;

    const rawX = ((clientX - rect.left) / rect.width) * 100;
    const rawY = ((clientY - rect.top) / rect.height) * 100;

    const clampedX = Math.round(Math.max(0, Math.min(100, rawX)));
    const clampedY = Math.round(Math.max(0, Math.min(100, rawY)));

    setSelectedZone(prev => {
      if (!prev) return prev;
      const updatedPts = prev.points.map((pt, idx) => 
        idx === draggingNode ? { x: clampedX, y: clampedY } : pt
      );
      return { ...prev, points: updatedPts };
    });

    setZones(prev => prev.map(z => {
      if (z.id !== selectedZone.id) return z;
      const updatedPts = z.points.map((pt, idx) => 
        idx === draggingNode ? { x: clampedX, y: clampedY } : pt
      );
      return { ...z, points: updatedPts };
    }));

    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  };

  const handlePointerUp = () => {
    setDraggingNode(null);
  };

  const handleSaveCoordinates = async () => {
    if (!selectedZone) return;
    setIsSaving(true);
    try {
      await apiClient.updateZone(selectedZone.id, {
        ...buildZonePayload(selectedZone),
        points_json: selectedZone.points,
      });
      setHasUnsavedChanges(false);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Failed to update zone polygon:", err);
      alert("Error saving zone coordinates: " + (err.message || "Failed"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddZone = async (e) => {
    e.preventDefault();
    if (!newZoneName.trim()) return;

    const meta = ZONE_TYPE_METRICS[newZoneType] || ZONE_TYPE_METRICS.RESTRICTED;

    const zonePayload = {
      name: newZoneName.trim(),
      type: newZoneType,
      color: meta.color,
      camera_code: selectedCamera,
      threat_weight: 0,
      points_json: [
        { x: 20, y: 20 },
        { x: 80, y: 20 },
        { x: 80, y: 80 },
        { x: 20, y: 80 }
      ],
      rule_triggers: [`${newZoneType} Perimeter Violation`],
      fence_type: newFenceType,
      fence_depth: newFenceType === '3D' ? Number(newFenceDepth) : 0.0,
    };

    setIsSaving(true);
    try {
      const created = await apiClient.createZone(zonePayload);
      const mapped = {
        ...normalizeZoneEntry(created),
        color: created.color || meta.color,
      };
      setZones(prev => [...prev, mapped]);
      setSelectedZone(mapped);
      setIsAddingZone(false);
      setNewZoneName('');
    } catch (err) {
      console.error("Error creating zone:", err);
      alert("Failed to create zone: " + (err.message || "Error"));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteZone = async (zoneId) => {
    if (!confirm("Are you sure you want to delete this security zone?")) return;
    try {
      await apiClient.deleteZone(zoneId);
      const updated = zones.filter(z => z.id !== zoneId);
      setZones(updated);
      if (selectedZone?.id === zoneId) {
        setSelectedZone(updated.length > 0 ? updated[0] : null);
      }
    } catch (err) {
      console.error("Error deleting zone:", err);
      alert("Failed to delete zone: " + (err.message || "Error"));
    }
  };

  return (
    <div 
      className="space-y-5 select-none"
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <MapPin className="w-5 h-5 text-blue-600" />
            Security Zones & Virtual Boundaries
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Configure polygonal surveillance perimeters. Coordinate boundaries synchronize with the real-time detection pipeline.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => setShowLiveFeed(!showLiveFeed)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
              showLiveFeed 
                ? 'bg-blue-50 border-blue-200 text-blue-700' 
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Video className="w-3.5 h-3.5" />
            <span>{showLiveFeed ? 'Video Background: On' : 'Video Background: Off'}</span>
          </button>

          <button
            onClick={() => setIsAddingZone(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Zone</span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Zone List & Add Form */}
        <div className="lg:col-span-4 space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Configured Zones ({zones.length})
              </h2>
            </div>

            {zones.length === 0 ? (
              <div className="text-center py-8 text-slate-500 text-xs">
                <MapPin className="w-7 h-7 text-slate-300 mx-auto mb-2" />
                <p>No perimeter zones defined yet.</p>
                <button
                  onClick={() => setIsAddingZone(true)}
                  className="mt-2 text-blue-600 hover:text-blue-700 font-medium"
                >
                  Create your first zone
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {zones.map((zone) => {
                  const isSelected = selectedZone?.id === zone.id;
                  const meta = ZONE_TYPE_METRICS[zone.type] || ZONE_TYPE_METRICS.RESTRICTED;

                  return (
                    <div
                      key={zone.id}
                      onClick={() => {
                        setSelectedZone(zone);
                        setHasUnsavedChanges(false);
                      }}
                      className={`p-3 rounded-lg border cursor-pointer transition-all ${
                        isSelected
                          ? 'bg-blue-50/60 border-blue-400 shadow-sm'
                          : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <span 
                            className="w-2.5 h-2.5 rounded-full" 
                            style={{ backgroundColor: zone.color }} 
                          />
                          <span className="font-semibold text-xs text-slate-900">{zone.name}</span>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded border ${meta.badgeBg}`}>
                          {zone.type}
                        </span>
                      </div>

                      <div className="flex items-center justify-between text-xs text-slate-500">
                        <span>Camera: <strong className="text-slate-700 font-medium">{zone.cameraCode}</strong></span>
                        <span className="text-[11px] font-medium" style={{ color: zone.color }}>
                          {meta.level}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Add Zone Panel */}
          {isAddingZone && (
            <div className="bg-white rounded-lg border border-blue-200 shadow-sm p-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-3">
                Create Perimeter Zone
              </h3>
              <form onSubmit={handleAddZone} className="space-y-3 text-xs">
                <div>
                  <label className="block text-slate-600 font-medium mb-1">Zone Name</label>
                  <input
                    type="text"
                    required
                    value={newZoneName}
                    onChange={(e) => setNewZoneName(e.target.value)}
                    placeholder="e.g. Storage Area Perimeter"
                    className="input-clean w-full text-xs"
                  />
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Zone Type</label>
                    <select
                      value={newZoneType}
                      onChange={(e) => setNewZoneType(e.target.value)}
                      className="input-clean w-full text-xs"
                    >
                      <option value="RESTRICTED">Restricted (ALERT)</option>
                      <option value="SENSITIVE">Sensitive (NOTICE)</option>
                      <option value="BORDER">Border (PRIORITY)</option>
                      <option value="ENTRY">Entry (INFO)</option>
                      <option value="EXIT">Exit (INFO)</option>
                      <option value="CUSTOM">Custom (NOTICE)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Target Camera</label>
                    <select
                      value={selectedCamera}
                      onChange={(e) => setSelectedCamera(e.target.value)}
                      className="input-clean w-full text-xs"
                    >
                      {cameras.map(c => (
                        <option key={c.id || c.code} value={c.code}>{c.code} — {c.name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Fence Type Selection */}
                <div>
                  <label className="block text-slate-600 font-medium mb-1.5">Fence Type</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setNewFenceType('2D')}
                      className={`flex-1 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                        newFenceType === '2D'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      2D Virtual Fence
                    </button>
                    <button
                      type="button"
                      onClick={() => setNewFenceType('3D')}
                      className={`flex-1 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                        newFenceType === '3D'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      3D Fence
                    </button>
                  </div>
                </div>

                {newFenceType === '3D' && (
                  <div className="p-3 rounded-lg bg-indigo-50 border border-indigo-200 space-y-2">
                    <p className="text-[10px] text-indigo-700 font-medium uppercase tracking-wide">3D Fence Configuration</p>
                    <p className="text-[10px] text-indigo-600">
                      Trace the ground footprint over the live camera image. The fence depth is stored with the zone so the perimeter remains remembered and reusable.
                    </p>
                    <div>
                      <label className="block text-slate-600 font-medium mb-1">Depth (m)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="0.1" max="20" step="0.1"
                          value={newFenceDepth}
                          onChange={(e) => setNewFenceDepth(e.target.value)}
                          className="input-clean w-28 text-xs"
                        />
                        <span className="text-slate-500 text-xs">m</span>
                      </div>
                    </div>
                    <p className="text-[10px] text-indigo-500">
                      The polygon below is saved to the selected camera and reloaded the next time you open this boundary.
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold shadow-sm transition-colors"
                  >
                    {isSaving ? 'Creating...' : 'Save Zone'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddingZone(false)}
                    className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* Right Column: Interactive Polygon Zone Canvas */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <div className="flex items-center gap-2">
                <Layers className="w-4 h-4 text-blue-600" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Polygon Boundary Calibration: {selectedZone ? selectedZone.name : 'Select Zone'}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                {hasUnsavedChanges && (
                  <button
                    onClick={handleSaveCoordinates}
                    disabled={isSaving}
                    className="inline-flex items-center gap-1.5 px-3 py-1 text-xs rounded-md bg-emerald-600 hover:bg-emerald-700 text-white font-semibold shadow-sm transition-colors"
                  >
                    <Save className="w-3.5 h-3.5" />
                    <span>{isSaving ? 'Saving...' : 'Save Coordinates'}</span>
                  </button>
                )}

                {saveSuccess && (
                  <div className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 px-2 py-1 bg-emerald-50 border border-emerald-200 rounded-md">
                    <CheckCircle className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Saved</span>
                  </div>
                )}

                {selectedZone && (
                  <button
                    onClick={() => handleDeleteZone(selectedZone.id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 text-xs rounded-md bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 transition-colors font-medium"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>Delete</span>
                  </button>
                )}
              </div>
            </div>

            {/* Virtual Zone Visualizer Viewport */}
            <div className="relative aspect-video bg-slate-900 rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center">
              {/* Optional Camera Feed Background */}
              {showLiveFeed && selectedZone && (
                <>
                  <img
                    src={`http://localhost:8000/api/video/feed?camera_id=${encodeURIComponent(selectedZone.cameraCode)}`}
                    alt="Camera Calibration Feed"
                    className="absolute inset-0 w-full h-full object-cover opacity-70 pointer-events-none"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                  <div className="absolute inset-x-0 top-0 z-10 flex justify-center pointer-events-none">
                    <div className="mt-3 rounded-full border border-white/30 bg-slate-900/65 px-2.5 py-1 text-[10px] font-medium text-slate-100 backdrop-blur-sm">
                      Live calibration view · {selectedZone.cameraCode}
                    </div>
                  </div>
                </>
              )}

              {/* Camera reference label */}
              <div className="absolute top-3 left-3 text-[11px] font-mono text-slate-200 bg-slate-900/90 px-2.5 py-1 rounded border border-slate-700 z-10">
                CAMERA: {selectedZone?.cameraCode || 'N/A'} (CALIBRATED COORDINATES)
              </div>

              {/* SVG Interactive Canvas */}
              <svg 
                ref={svgRef}
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                onPointerMove={handlePointerMove}
                className="absolute inset-0 w-full h-full cursor-crosshair z-10"
              >
                {zones
                  .filter(z => z.cameraCode === selectedZone?.cameraCode)
                  .map((z) => {
                    const pointsStr = z.points.map(p => `${p.x},${p.y}`).join(' ');
                    const isSelected = z.id === selectedZone?.id;
                    const is3D = (z.fence_type || '2D') === '3D';

                    return (
                      <g key={z.id}>
                        {/* Polygon Fill & Outline */}
                        <polygon
                          points={pointsStr}
                          fill={z.color}
                          fillOpacity={isSelected ? 0.30 : 0.12}
                          stroke={z.color}
                          strokeWidth={isSelected ? 0.8 : 0.4}
                          strokeDasharray={isSelected ? "2 1" : "none"}
                          opacity={is3D ? 0.95 : 1}
                        />

                        {is3D && (
                          <polygon
                            points={pointsStr}
                            fill="none"
                            stroke="#4F46E5"
                            strokeWidth={0.45}
                            strokeDasharray="1 1"
                            opacity={0.9}
                            transform="translate(0.8, 0.8)"
                          />
                        )}

                        {/* Interactive Drag Handles */}
                        {isSelected && z.points.map((pt, pIdx) => (
                          <g key={pIdx}>
                            <circle
                              cx={pt.x}
                              cy={pt.y}
                              r={2.2}
                              fill="#FFFFFF"
                              stroke={z.color}
                              strokeWidth={0.7}
                              onPointerDown={(e) => handlePointerDown(pIdx, e)}
                              className="cursor-move transition-transform hover:scale-125"
                            />
                            <text
                              x={pt.x + 2.5}
                              y={pt.y - 2.5}
                              fill="#FFFFFF"
                              fontSize="3"
                              fontFamily="sans-serif"
                              className="pointer-events-none select-none font-semibold shadow"
                            >
                              {pIdx + 1} {z.fence_type === '3D' ? `(${pt.x}%, ${pt.y}%) [3D ${z.fence_depth || 0}m]` : `(${pt.x}%, ${pt.y}%)`}
                            </text>
                          </g>
                        ))}
                      </g>
                    );
                  })}
              </svg>

              <div className="absolute bottom-3 right-3 text-[11px] text-slate-300 bg-slate-900/90 px-2.5 py-1 rounded border border-slate-700 z-10">
                Drag handles to reposition zone boundary
              </div>
            </div>

            {/* Zone parameters */}
            {selectedZone && (
              <div className="mt-4 p-3 rounded-lg bg-slate-50 border border-slate-200 grid grid-cols-1 md:grid-cols-4 gap-3 text-xs">
                <div>
                  <span className="text-slate-500 block text-[11px] font-medium">ZONE TYPE:</span>
                  <span className="font-semibold text-slate-800">{selectedZone.type}</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px] font-medium">FENCE TYPE:</span>
                  <span className={`font-semibold ${
                    selectedZone.fence_type === '3D' ? 'text-indigo-700' : 'text-slate-800'
                  }`}>
                    {selectedZone.fence_type || '2D'}
                    {selectedZone.fence_type === '3D' && selectedZone.fence_depth > 0 && (
                      <span className="ml-1 text-indigo-500">({selectedZone.fence_depth}m)</span>
                    )}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px] font-medium">OPERATIONAL RULE:</span>
                  <span className="font-semibold text-blue-600">
                    {ZONE_TYPE_METRICS[selectedZone.type]?.desc || 'Perimeter evaluation'}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[11px] font-medium">POLYGON VERTICES:</span>
                  <span className="text-slate-800 font-semibold">
                    {selectedZone.points.length} nodes calibrated
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
