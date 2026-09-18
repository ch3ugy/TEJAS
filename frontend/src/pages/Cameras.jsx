import React, { useState, useEffect } from 'react';
import { Camera, Plus, CheckCircle2, AlertCircle, RefreshCw, Trash2, Search, X, Smartphone, Pencil } from 'lucide-react';
import { Link } from 'react-router-dom';
import { apiClient } from '../services/api';
import { authService } from '../services/auth';

const EMPTY_FORM = {
  code: '',
  name: '',
  location: '',
  stream_type: 'RTSP',
  stream_url: 'rtsp://192.168.1.104:554/live/ch0',
  fps: 15,
  resolution: '1280x720',
  lat: 32.7300,
  lng: 74.8600,
  // Fence/zone configuration
  fence_type: '2D',
  fence_depth: 2.5,
};

export default function Cameras() {
  const [camerasList, setCamerasList] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [editingCam, setEditingCam] = useState(null); // camera object being edited
  const [testResult, setTestResult] = useState(null);
  const [isTesting, setIsTesting] = useState(false);
  const [probeResult, setProbeResult] = useState(null);
  const [isProbing, setIsProbing] = useState(false);
  const [editProbeResult, setEditProbeResult] = useState(null);
  const [isEditProbing, setIsEditProbing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  // Per-camera zone fence editing in the edit modal
  const [editCamZones, setEditCamZones] = useState([]);
  const [editZoneSaving, setEditZoneSaving] = useState(false);
  const isOperatorOrAdmin = authService.hasRole('ADMIN', 'OPERATOR');

  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [editForm, setEditForm] = useState({});

  const loadCameras = async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.getCameras();
      if (data) setCamerasList(data);
    } catch (e) {
      console.warn("Failed to load cameras:", e);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadCameras();
  }, []);

  // ── Probe for Add form ──────────────────────────────────────
  const handleProbeStream = async () => {
    if (!formData.stream_url) return;
    setIsProbing(true);
    setProbeResult(null);
    try {
      const res = await apiClient.probeCamera(formData.stream_url, formData.stream_type === 'PHONE_STREAM' ? 'RTSP' : formData.stream_type);
      setProbeResult(res);
      if (res.reachable && res.fps && res.resolution) {
        setFormData(prev => ({
          ...prev,
          fps: Math.round(res.fps) || prev.fps,
          resolution: res.resolution || prev.resolution
        }));
      }
    } catch (err) {
      setProbeResult({ reachable: false, error: err.message || "Probe failed" });
    } finally {
      setIsProbing(false);
    }
  };

  // ── Probe for Edit form ─────────────────────────────────────
  const handleEditProbeStream = async () => {
    if (!editForm.stream_url) return;
    setIsEditProbing(true);
    setEditProbeResult(null);
    try {
      const res = await apiClient.probeCamera(editForm.stream_url, editForm.stream_type === 'PHONE_STREAM' ? 'RTSP' : editForm.stream_type);
      setEditProbeResult(res);
      if (res.reachable && res.fps && res.resolution) {
        setEditForm(prev => ({
          ...prev,
          fps: Math.round(res.fps) || prev.fps,
          resolution: res.resolution || prev.resolution
        }));
      }
    } catch (err) {
      setEditProbeResult({ reachable: false, error: err.message || "Probe failed" });
    } finally {
      setIsEditProbing(false);
    }
  };

  // ── Test existing camera using /test endpoint ───────────────
  const handleTestExisting = async (cam) => {
    setIsTesting(true);
    setTestResult(null);
    try {
      const probe = await apiClient.testCamera(cam.id || cam.code);
      setTestResult({
        cameraCode: cam.code,
        reachable: probe.reachable,
        fps: probe.fps,
        resolution: probe.resolution,
        message: probe.message || probe.error
      });
    } catch (err) {
      setTestResult({
        cameraCode: cam.code,
        reachable: false,
        message: err.message || "Connection refused"
      });
    } finally {
      setIsTesting(false);
    }
  };

  const handleRestart = async (camId) => {
    try {
      await apiClient.restartCamera(camId);
      await loadCameras();
    } catch (err) {
      alert("Restart failed: " + (err.message || "Error"));
    }
  };

  const handleDelete = async (camId) => {
    if (!confirm("Are you sure you want to delete this camera node?")) return;
    try {
      await apiClient.deleteCamera(camId);
      await loadCameras();
    } catch (err) {
      alert("Delete failed: " + (err.message || "Error"));
    }
  };

  const handleAddCamera = async (e) => {
    e.preventDefault();
    try {
      await apiClient.createCamera({
        code: formData.code.toUpperCase(),
        name: formData.name,
        location: formData.location,
        stream_type: formData.stream_type === 'PHONE_STREAM' ? 'RTSP' : formData.stream_type,
        stream_url: formData.stream_url,
        fps: Number(formData.fps) || 15,
        resolution: formData.resolution,
        lat: Number(formData.lat) || 32.7300,
        lng: Number(formData.lng) || 74.8600,
        ai_enabled: true
      });
      await loadCameras();
      setIsAdding(false);
      setProbeResult(null);
      setFormData({ ...EMPTY_FORM });
    } catch (err) {
      alert("Failed to add camera: " + (err.message || "Error"));
    }
  };

  // ── Open edit modal ────────────────────────────────────────
  const openEdit = async (cam) => {
    setEditingCam(cam);
    setEditForm({
      name: cam.name || '',
      location: cam.location || '',
      stream_type: cam.stream_type || cam.streamType || 'RTSP',
      stream_url: cam.stream_url || cam.streamUrl || '',
      fps: cam.fps || 30,
      resolution: cam.resolution || '1920x1080',
      lat: cam.lat || 32.7300,
      lng: cam.lng || 74.8600,
      status: cam.status || 'ONLINE',
      ai_enabled: cam.ai_enabled !== undefined ? cam.ai_enabled : true,
    });
    setEditProbeResult(null);
    // Load zones for this camera
    try {
      const zones = await apiClient.getZonesByCamera(cam.code);
      setEditCamZones(zones || []);
    } catch (e) {
      setEditCamZones([]);
    }
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    setSavingEdit(true);
    try {
      await apiClient.updateCamera(editingCam.id || editingCam.code, {
        name: editForm.name,
        location: editForm.location,
        stream_type: editForm.stream_type === 'PHONE_STREAM' ? 'RTSP' : editForm.stream_type,
        stream_url: editForm.stream_url,
        fps: Number(editForm.fps),
        resolution: editForm.resolution,
        lat: Number(editForm.lat),
        lng: Number(editForm.lng),
        status: editForm.status,
        ai_enabled: editForm.ai_enabled,
      });
      await loadCameras();
      setEditingCam(null);
      setEditProbeResult(null);
      setEditCamZones([]);
    } catch (err) {
      alert("Failed to update camera: " + (err.message || "Error"));
    } finally {
      setSavingEdit(false);
    }
  };

  // ── Save zone fence settings inline in edit modal ──────────
  const handleSaveZoneFence = async (zone) => {
    setEditZoneSaving(true);
    try {
      await apiClient.updateZone(zone.id, {
        fence_type: zone.fence_type,
        fence_depth: zone.fence_type === '3D' ? Number(zone.fence_depth) : 0.0,
      });
      // Refresh zones list
      const zones = await apiClient.getZonesByCamera(editingCam.code);
      setEditCamZones(zones || []);
    } catch (err) {
      alert("Failed to update zone fence: " + (err.message || "Error"));
    } finally {
      setEditZoneSaving(false);
    }
  };


  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-slate-200">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Camera className="w-5 h-5 text-blue-600" />
            Camera Nodes &amp; Surveillance Ingestion
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage physical CCTV nodes, mobile phone camera streams, and RTSP video endpoints.
          </p>
        </div>

        {isOperatorOrAdmin && (
          <button
            onClick={() => { setIsAdding(true); setProbeResult(null); setFormData({ ...EMPTY_FORM }); }}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>Add Ingestion Node</span>
          </button>
        )}
      </div>

      {/* Test result banner */}
      {testResult && (
        <div className={`p-3 rounded-lg flex items-center justify-between text-xs border ${
          testResult.reachable
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          <div className="flex items-center gap-2">
            {testResult.reachable ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            )}
            <span>
              <strong>{testResult.cameraCode}:</strong>{' '}
              {testResult.reachable
                ? `Node reachable (${testResult.resolution} @ ${testResult.fps} FPS)`
                : `Offline or unreachable (${testResult.message || 'Connection timed out'})`}
            </span>
          </div>
          <button onClick={() => setTestResult(null)} className="text-slate-400 hover:text-slate-600 p-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ── Add Camera Form ───────────────────────────────────── */}
      {isAdding && (
        <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Register New Camera Node</h2>
              <p className="text-xs text-slate-500">Add an RTSP network camera, smartphone stream, or local hardware capture.</p>
            </div>
            <button onClick={() => setIsAdding(false)} className="text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>

          <form onSubmit={handleAddCamera} className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block text-slate-700 font-medium mb-1">Camera Code / Identifier</label>
              <input
                type="text" required
                value={formData.code}
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                placeholder="e.g. CAM-02, PHONE-01"
                className="input-clean w-full font-mono uppercase"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Camera Name</label>
              <input
                type="text" required
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g. North Gate Entryway"
                className="input-clean w-full"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Location Sector</label>
              <input
                type="text" required
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="e.g. Sector B Perimeter"
                className="input-clean w-full"
              />
            </div>

            <div>
              <label className="block text-slate-700 font-medium mb-1">Source Type</label>
              <select
                value={formData.stream_type}
                onChange={(e) => setFormData({ ...formData, stream_type: e.target.value })}
                className="input-clean w-full bg-white"
              >
                <option value="RTSP">RTSP / Network IP Camera</option>
                <option value="PHONE_STREAM">Mobile Phone Stream (IP Webcam / RTSP App)</option>
                <option value="HARDWARE">Local Hardware Webcam (Device Index 0, 1)</option>
                <option value="DEMO_MP4">Local Video File (MP4)</option>
              </select>
            </div>

            <div className="md:col-span-2">
              <label className="block text-slate-700 font-medium mb-1">Stream Endpoint URL / Index</label>
              <div className="flex gap-2">
                <input
                  type="text" required
                  value={formData.stream_url}
                  onChange={(e) => setFormData({ ...formData, stream_url: e.target.value })}
                  placeholder={
                    formData.stream_type === 'HARDWARE'
                      ? '0 (Device Index)'
                      : formData.stream_type === 'PHONE_STREAM'
                      ? 'rtsp://192.168.1.x:8554/live'
                      : 'rtsp://192.168.1.100:554/live'
                  }
                  className="input-clean w-full font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={handleProbeStream}
                  disabled={isProbing}
                  className="px-3.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium border border-slate-300 whitespace-nowrap flex items-center gap-1 transition-colors disabled:opacity-60"
                >
                  <Search className="w-3.5 h-3.5" />
                  <span>{isProbing ? 'Testing...' : 'Test Connection'}</span>
                </button>
              </div>
            </div>

            {formData.stream_type === 'PHONE_STREAM' && (
              <div className="md:col-span-3 p-3 rounded-md bg-blue-50 border border-blue-200 text-blue-800 text-xs flex items-start gap-2">
                <Smartphone className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  <strong>Smartphone Camera Source:</strong>
                  <p className="text-[11px] text-blue-700 mt-0.5">
                    Run an RTSP/IP camera app on the phone connected to the same Wi-Fi network and enter the stream URL above.
                  </p>
                </div>
              </div>
            )}

            {probeResult && (
              <div className={`md:col-span-3 p-3 rounded-md text-xs border ${
                probeResult.reachable
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-red-50 border-red-200 text-red-800'
              }`}>
                {probeResult.reachable ? (
                  <div className="flex items-center justify-between">
                    <span>✓ Source reachable: {probeResult.resolution} @ {probeResult.fps} FPS</span>
                    <span className="font-semibold text-emerald-700">Verified</span>
                  </div>
                ) : (
                  <span>✗ Stream unreachable: {probeResult.error || 'Connection timed out'}</span>
                )}
              </div>
            )}

            {/* ── Fence / Zone Configuration ── */}
            <div className="md:col-span-3 pt-3 border-t border-slate-100">
              <h3 className="text-xs font-semibold text-slate-800 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                <span>🗺</span> Initial Fence / Zone Configuration
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="md:col-span-2">
                  <label className="block text-slate-600 font-medium mb-1.5">Fence Type</label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, fence_type: '2D' })}
                      className={`flex-1 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                        formData.fence_type === '2D'
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      2D Virtual Fence
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, fence_type: '3D' })}
                      className={`flex-1 py-1.5 rounded-md border text-xs font-semibold transition-colors ${
                        formData.fence_type === '3D'
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white border-slate-300 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      3D Fence
                    </button>
                  </div>
                </div>
                {formData.fence_type === '3D' && (
                  <div>
                    <label className="block text-slate-600 font-medium mb-1">Depth (m)</label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="number" min="0.1" max="20" step="0.1"
                        value={formData.fence_depth}
                        onChange={(e) => setFormData({ ...formData, fence_depth: e.target.value })}
                        className="input-clean w-20 text-xs"
                      />
                      <span className="text-slate-400 text-xs">m</span>
                    </div>
                  </div>
                )}
              </div>
              {formData.fence_type === '3D' && (
                <p className="mt-2 text-[10px] text-indigo-600 bg-indigo-50 border border-indigo-100 rounded px-2 py-1">
                  After saving, go to <strong>Zones</strong> to draw the ground footprint polygon for this camera.
                  The depth you set here will be stored with the zone.
                </p>
              )}
            </div>

            <div className="md:col-span-3 flex items-center gap-2 pt-2 border-t border-slate-100">
              <button
                type="submit"
                className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-sm transition-colors"
              >
                Save Camera Node
              </button>
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-4 py-2 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Edit Camera Modal ─────────────────────────────────── */}
      {editingCam && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between p-5 border-b border-slate-100">
              <div>
                <h2 className="text-sm font-bold text-slate-900">Edit Camera Node</h2>
                <p className="text-xs text-slate-500 font-mono">{editingCam.code} · {editingCam.id}</p>
              </div>
              <button onClick={() => { setEditingCam(null); setEditProbeResult(null); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Camera Name</label>
                <input
                  type="text" required
                  value={editForm.name}
                  onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                  className="input-clean w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Location Sector</label>
                <input
                  type="text" required
                  value={editForm.location}
                  onChange={(e) => setEditForm({ ...editForm, location: e.target.value })}
                  className="input-clean w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Source Type</label>
                <select
                  value={editForm.stream_type}
                  onChange={(e) => setEditForm({ ...editForm, stream_type: e.target.value })}
                  className="input-clean w-full bg-white"
                >
                  <option value="RTSP">RTSP / Network IP Camera</option>
                  <option value="PHONE_STREAM">Mobile Phone Stream</option>
                  <option value="HARDWARE">Local Hardware Webcam</option>
                  <option value="DEMO_MP4">Local Video File (MP4)</option>
                </select>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Status</label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
                  className="input-clean w-full bg-white"
                >
                  <option value="ONLINE">ONLINE</option>
                  <option value="OFFLINE">OFFLINE</option>
                  <option value="MAINTENANCE">MAINTENANCE</option>
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="block text-slate-700 font-medium mb-1">Stream Endpoint URL / Index</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={editForm.stream_url}
                    onChange={(e) => setEditForm({ ...editForm, stream_url: e.target.value })}
                    className="input-clean w-full font-mono text-xs"
                  />
                  <button
                    type="button"
                    onClick={handleEditProbeStream}
                    disabled={isEditProbing}
                    className="px-3.5 py-1.5 rounded-md bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium border border-slate-300 whitespace-nowrap flex items-center gap-1 transition-colors disabled:opacity-60"
                  >
                    <Search className="w-3.5 h-3.5" />
                    <span>{isEditProbing ? 'Testing...' : 'Test'}</span>
                  </button>
                </div>
              </div>

              {editProbeResult && (
                <div className={`md:col-span-2 p-3 rounded-md text-xs border ${
                  editProbeResult.reachable
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                    : 'bg-red-50 border-red-200 text-red-800'
                }`}>
                  {editProbeResult.reachable
                    ? `✓ Reachable: ${editProbeResult.resolution} @ ${editProbeResult.fps} FPS`
                    : `✗ Unreachable: ${editProbeResult.error || 'Connection failed'}`}
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-medium mb-1">FPS</label>
                <input
                  type="number" min="1" max="60"
                  value={editForm.fps}
                  onChange={(e) => setEditForm({ ...editForm, fps: e.target.value })}
                  className="input-clean w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Resolution</label>
                <input
                  type="text"
                  value={editForm.resolution}
                  onChange={(e) => setEditForm({ ...editForm, resolution: e.target.value })}
                  placeholder="e.g. 1920x1080"
                  className="input-clean w-full font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Latitude</label>
                <input
                  type="number" step="any"
                  value={editForm.lat}
                  onChange={(e) => setEditForm({ ...editForm, lat: e.target.value })}
                  className="input-clean w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Longitude</label>
                <input
                  type="number" step="any"
                  value={editForm.lng}
                  onChange={(e) => setEditForm({ ...editForm, lng: e.target.value })}
                  className="input-clean w-full"
                />
              </div>

              <div className="md:col-span-2 flex items-center gap-3 pt-1">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={editForm.ai_enabled}
                    onChange={(e) => setEditForm({ ...editForm, ai_enabled: e.target.checked })}
                    className="rounded border-slate-300 text-blue-600"
                  />
                  <span className="text-slate-700 font-medium">AI Pipeline Enabled</span>
                </label>
              </div>

              {/* ── Live Feed Preview ── */}
              <div className="md:col-span-2 rounded-lg overflow-hidden border border-slate-200 bg-slate-900 aspect-video relative flex items-center justify-center">
                <span className="text-slate-500 text-xs z-0 pointer-events-none">Stream offline or loading...</span>
                <img
                  src={`http://localhost:8000/api/video/feed?camera_id=${encodeURIComponent(editingCam.code)}`}
                  alt="Live Camera Feed"
                  className="absolute inset-0 w-full h-full object-cover z-10"
                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                />
              </div>

              {/* ── Fence / Zone Configuration in Edit ── */}
              <div className="md:col-span-2 pt-3 border-t border-slate-100 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-800 uppercase tracking-wide">
                    🗺 Fence / Zone Configuration
                  </h3>
                  <Link
                    to="/zones"
                    className="text-[11px] text-blue-600 hover:text-blue-700 font-medium"
                    onClick={() => setEditingCam(null)}
                  >
                    Edit Polygon Boundaries →
                  </Link>
                </div>

                {editCamZones.length === 0 ? (
                  <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded p-2">
                    No zones configured for this camera. <Link to="/zones" className="text-blue-600" onClick={() => setEditingCam(null)}>Add a zone →</Link>
                  </p>
                ) : (
                  <div className="space-y-2">
                    {editCamZones.map((zone) => (
                      <div key={zone.id} className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-xs space-y-2">
                        <div className="flex items-center justify-between">
                          <div>
                            <span className="font-semibold text-slate-900">{zone.name}</span>
                            <span className="ml-2 text-slate-500 text-[10px]">{zone.type}</span>
                          </div>
                          <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                            zone.fence_type === '3D' ? 'bg-indigo-50 text-indigo-700 border-indigo-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>{zone.fence_type || '2D'}</span>
                        </div>

                        <div className="flex items-center gap-3">
                          <div>
                            <label className="block text-slate-500 font-medium mb-1 text-[10px]">Fence Type</label>
                            <div className="flex gap-1.5">
                              <button
                                type="button"
                                onClick={() => setEditCamZones(prev => prev.map(z => z.id === zone.id ? { ...z, fence_type: '2D' } : z))}
                                className={`px-2 py-0.5 rounded border text-[10px] font-semibold transition-colors ${
                                  zone.fence_type === '2D' || !zone.fence_type ? 'bg-blue-600 text-white border-blue-600' : 'bg-white border-slate-300 text-slate-600'
                                }`}
                              >2D</button>
                              <button
                                type="button"
                                onClick={() => setEditCamZones(prev => prev.map(z => z.id === zone.id ? { ...z, fence_type: '3D', fence_depth: z.fence_depth || 2.5 } : z))}
                                className={`px-2 py-0.5 rounded border text-[10px] font-semibold transition-colors ${
                                  zone.fence_type === '3D' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white border-slate-300 text-slate-600'
                                }`}
                              >3D</button>
                            </div>
                          </div>

                          {zone.fence_type === '3D' && (
                            <div>
                              <label className="block text-slate-500 font-medium mb-1 text-[10px]">Depth (m)</label>
                              <input
                                type="number" min="0.1" max="20" step="0.1"
                                value={zone.fence_depth || 2.5}
                                onChange={(e) => setEditCamZones(prev => prev.map(z => z.id === zone.id ? { ...z, fence_depth: e.target.value } : z))}
                                className="input-clean w-16 text-xs"
                              />
                            </div>
                          )}

                          <div className="ml-auto">
                            <button
                              type="button"
                              disabled={editZoneSaving}
                              onClick={() => handleSaveZoneFence(zone)}
                              className="px-2.5 py-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-semibold disabled:opacity-50"
                            >
                              {editZoneSaving ? '...' : 'Save'}
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="md:col-span-2 flex items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={savingEdit}
                  className="px-4 py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold text-xs shadow-sm transition-colors"
                >
                  {savingEdit ? 'Saving...' : 'Save Changes'}
                </button>
                <button
                  type="button"
                  onClick={() => { setEditingCam(null); setEditProbeResult(null); setEditCamZones([]); }}
                  className="px-4 py-2 rounded-md bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Cameras Table ─────────────────────────────────────── */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-slate-400 text-xs">Loading camera nodes...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                  <th className="py-3 px-4">Node / Identifier</th>
                  <th className="py-3 px-4">Location Sector</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Protocol</th>
                  <th className="py-3 px-4">Resolution &amp; Rate</th>
                  <th className="py-3 px-4">AI Pipeline</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                {camerasList.length > 0 ? (
                  camerasList.map((cam) => (
                    <tr key={cam.id || cam.code} className="hover:bg-slate-50/75 transition-colors">
                      <td className="py-3 px-4">
                        <div className="font-semibold text-slate-900 font-mono">{cam.code}</div>
                        <div className="text-[11px] text-slate-500">{cam.name}</div>
                        <div className="text-[10px] text-slate-400 font-mono">{cam.id}</div>
                      </td>
                      <td className="py-3 px-4">{cam.location}</td>
                      <td className="py-3 px-4">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${
                          cam.status === 'ONLINE'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                            : cam.status === 'MAINTENANCE'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cam.status === 'ONLINE' ? 'bg-emerald-500' : cam.status === 'MAINTENANCE' ? 'bg-amber-500' : 'bg-slate-400'}`} />
                          {cam.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-600">{cam.stream_type || cam.streamType}</td>
                      <td className="py-3 px-4 text-slate-600 font-mono text-[11px]">{cam.resolution} @ {cam.fps} FPS</td>
                      <td className="py-3 px-4">
                        <span className={`font-medium ${cam.ai_enabled ? 'text-emerald-700' : 'text-slate-400'}`}>
                          {cam.ai_enabled ? 'Active' : 'Disabled'}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right space-x-1.5">
                        <button
                          onClick={() => handleTestExisting(cam)}
                          disabled={isTesting}
                          title="Test stream connectivity"
                          className="px-2.5 py-1 rounded bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors disabled:opacity-50"
                        >
                          Probe
                        </button>
                        <Link
                          to="/zones"
                          className="px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700 text-xs font-medium transition-colors inline-block"
                        >
                          Zones
                        </Link>
                        {isOperatorOrAdmin && (
                          <>
                            <button
                              onClick={() => openEdit(cam)}
                              title="Edit Camera"
                              className="p-1 rounded text-slate-500 hover:text-blue-700 hover:bg-blue-50 transition-colors"
                            >
                              <Pencil className="w-3.5 h-3.5 inline" />
                            </button>
                            <button
                              onClick={() => handleRestart(cam.id || cam.code)}
                              title="Restart Camera Pipeline"
                              className="p-1 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors"
                            >
                              <RefreshCw className="w-3.5 h-3.5 inline" />
                            </button>
                            {cam.code !== 'CAM-00' && (
                              <button
                                onClick={() => handleDelete(cam.id || cam.code)}
                                title="Delete Camera Node"
                                className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5 inline" />
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={7} className="py-12 text-center text-slate-400">
                      <Camera className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                      <p className="text-xs font-medium text-slate-600">No camera nodes configured in database</p>
                      <p className="text-[11px] text-slate-400 mt-0.5">Click "+ Add Ingestion Node" to register a stream</p>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
