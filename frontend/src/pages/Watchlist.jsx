import React, { useState, useEffect } from 'react';
import { 
  ShieldAlert, 
  Plus, 
  Search, 
  Car, 
  User, 
  Trash2, 
  CheckCircle2, 
  Sliders, 
  Camera, 
  UserX, 
  Activity, 
  Zap, 
  Info, 
  X 
} from 'lucide-react';
import { apiClient } from '../services/api';

export default function Watchlist() {
  const [activeTab, setActiveTab] = useState('FACE'); // 'FACE' or 'VEHICLE'

  // Face Recognition State
  const [enrolledFaces, setEnrolledFaces] = useState([]);
  const [faceConfig, setFaceConfig] = useState({ enabled: true, similarity_threshold: 0.40, min_quality_score: 0.35 });
  const [faceSearch, setFaceSearch] = useState('');
  const [faceCategoryFilter, setFaceCategoryFilter] = useState('ALL');
  const [isEnrollingFace, setIsEnrollingFace] = useState(false);
  const [isCalibrating, setIsCalibrating] = useState(false);
  const [faceLoading, setFaceLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');

  // Enrollment Form
  const [enrollForm, setEnrollForm] = useState({
    name: '',
    category: 'WATCHLIST',
    threat_level: 'PRIORITY',
    notes: '',
    image_base64: '',
    preview_url: ''
  });
  const [enrollSubmitting, setEnrollSubmitting] = useState(false);
  const [enrollError, setEnrollError] = useState('');


  // ANPR Vehicle Watchlist State
  const [vehicleWatchlist, setVehicleWatchlist] = useState([]);
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [isAddingVehicle, setIsAddingVehicle] = useState(false);
  const [vehicleForm, setVehicleForm] = useState({
    identifier: '',
    title: '',
    category: 'Suspected Reconnaissance',
    threat_level: 'PRIORITY',
    notes: ''
  });

  // Load data on mount
  const loadFaceData = async () => {
    setFaceLoading(true);
    try {
      const [cfg, faces] = await Promise.all([
        apiClient.getFaceConfig(),
        apiClient.getEnrolledFaces(faceCategoryFilter)
      ]);
      if (cfg) setFaceConfig(cfg);
      if (faces) setEnrolledFaces(faces);
    } catch (e) {
      console.error("Error loading face data:", e);
    } finally {
      setFaceLoading(false);
    }
  };

  const loadVehicleData = async () => {
    try {
      const list = await apiClient.getWatchlist();
      setVehicleWatchlist(list || []);
    } catch (e) {
      console.error("Error loading vehicle watchlist:", e);
    }
  };

  useEffect(() => {
    if (activeTab === 'FACE') {
      loadFaceData();
    } else {
      loadVehicleData();
    }
  }, [activeTab, faceCategoryFilter]);

  const showToast = (msg) => {
    setFeedbackMsg(msg);
    setTimeout(() => setFeedbackMsg(''), 4500);
  };

  // Face Config Update
  const handleSaveConfig = async () => {
    try {
      const res = await apiClient.updateFaceConfig({
        enabled: faceConfig.enabled,
        similarity_threshold: parseFloat(faceConfig.similarity_threshold),
        min_quality_score: parseFloat(faceConfig.min_quality_score),
        user: 'Duty Operator'
      });
      if (res) {
        setFaceConfig(res);
        setIsCalibrating(false);
        showToast('Face recognition parameters calibrated.');
      }
    } catch (e) {
      showToast('Failed to update face config.');
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const b64 = event.target?.result;
      setEnrollForm(prev => ({
        ...prev,
        image_base64: b64,
        preview_url: b64
      }));
      setEnrollError('');
    };
    reader.readAsDataURL(file);
  };

  const handleEnrollSubmit = async (e) => {
    e.preventDefault();
    if (!enrollForm.name.trim()) {
      setEnrollError('Identity name is required.');
      return;
    }
    if (!enrollForm.image_base64) {
      setEnrollError('Reference photo is required. Please upload an image.');
      return;
    }

    setEnrollSubmitting(true);
    setEnrollError('');
    try {
      const res = await apiClient.enrollFace({
        name: enrollForm.name.trim(),
        category: enrollForm.category,
        threat_level: enrollForm.threat_level,
        notes: enrollForm.notes,
        image_base64: enrollForm.image_base64,
        user: 'Duty Operator'
      });
      if (res && res.success) {
        showToast(`Successfully enrolled identity: ${enrollForm.name}`);
        setIsEnrollingFace(false);
        setEnrollForm({
          name: '',
          category: 'WATCHLIST',
          threat_level: 'PRIORITY',
          notes: '',
          image_base64: '',
          preview_url: ''
        });
        loadFaceData();
      }
    } catch (err) {
      setEnrollError(err.message || 'Enrollment failed. Ensure face is clear and unobstructed.');
    } finally {
      setEnrollSubmitting(false);
    }
  };

  const handleDeleteFace = async (faceId, faceName) => {
    if (!window.confirm(`Remove identity "${faceName}" from database?`)) return;
    try {
      const res = await apiClient.deleteEnrolledFace(faceId, 'Duty Operator');
      if (res && res.success) {
        showToast(`Removed record for ${faceName}.`);
        loadFaceData();
      }
    } catch (e) {
      showToast('Failed to delete enrolled face.');
    }
  };


  const handleAddVehicle = async (e) => {
    e.preventDefault();
    if (!vehicleForm.identifier.trim()) return;

    try {
      const res = await apiClient.addWatchlistEntry({
        type: 'VEHICLE',
        identifier: vehicleForm.identifier.trim().toUpperCase(),
        title: vehicleForm.title.trim() || 'Tracked Vehicle',
        category: vehicleForm.category,
        threat_level: vehicleForm.threat_level,
        notes: vehicleForm.notes
      });
      if (res) {
        showToast(`Vehicle plate ${vehicleForm.identifier} added to watchlist.`);
        setIsAddingVehicle(false);
        setVehicleForm({
          identifier: '',
          title: '',
          category: 'Suspected Reconnaissance',
          threat_level: 'PRIORITY',
          notes: ''
        });
        loadVehicleData();
      }
    } catch (e) {
      showToast('Failed to add vehicle to watchlist.');
    }
  };

  const handleDeleteVehicle = async (id, plate) => {
    if (!window.confirm(`Remove vehicle plate "${plate}" from watchlist?`)) return;
    try {
      await apiClient.deleteWatchlistEntry(id);
      showToast(`Vehicle ${plate} removed from watchlist.`);
      loadVehicleData();
    } catch (e) {
      showToast('Failed to delete vehicle.');
    }
  };

  const filteredFaces = enrolledFaces.filter(f => {
    const q = faceSearch.toLowerCase();
    return (f.name || '').toLowerCase().includes(q) ||
           (f.id || '').toLowerCase().includes(q) ||
           (f.notes || '').toLowerCase().includes(q);
  });

  const filteredVehicles = vehicleWatchlist.filter(v => {
    const q = vehicleSearch.toLowerCase();
    return (v.identifier || '').toLowerCase().includes(q) ||
           (v.title || '').toLowerCase().includes(q) ||
           (v.notes || '').toLowerCase().includes(q);
  });

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldAlert className="w-5 h-5 text-red-600" />
            Operational Watchlist & Identity Registry
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage biometric face records and flagged vehicle license plates. Matches generate high-priority security events.
          </p>
        </div>

        {/* Tab Switcher & Toast */}
        <div className="flex items-center gap-3">
          {feedbackMsg && (
            <div className="px-3 py-1.5 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
              {feedbackMsg}
            </div>
          )}

          <div className="flex items-center p-1 rounded-lg bg-slate-100 border border-slate-200 text-xs">
            <button
              onClick={() => setActiveTab('FACE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'FACE' 
                  ? 'bg-white text-slate-900 shadow-sm font-semibold' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>Person Watchlist ({enrolledFaces.length})</span>
            </button>
            <button
              onClick={() => setActiveTab('VEHICLE')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md font-medium transition-colors ${
                activeTab === 'VEHICLE' 
                  ? 'bg-white text-slate-900 shadow-sm font-semibold' 
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <Car className="w-3.5 h-3.5" />
              <span>Vehicle Watchlist ({vehicleWatchlist.length})</span>
            </button>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: FACIAL BIOMETRIC REGISTRY                                          */}
      {/* ========================================================================= */}
      {activeTab === 'FACE' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="flex flex-wrap items-center gap-2.5">
              <div className={`px-2.5 py-1 rounded-md border flex items-center gap-1.5 font-medium ${
                faceConfig.enabled 
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' 
                  : 'bg-slate-100 border-slate-200 text-slate-500'
              }`}>
                <Activity className="w-3.5 h-3.5" />
                <span>Recognition: {faceConfig.enabled ? 'Active' : 'Disabled'}</span>
              </div>

              <select
                value={faceCategoryFilter}
                onChange={(e) => setFaceCategoryFilter(e.target.value)}
                className="input-clean text-xs py-1"
              >
                <option value="ALL">All Categories</option>
                <option value="WATCHLIST">Watchlist (Flagged)</option>
                <option value="AUTHORIZED">Authorized Personnel</option>
                <option value="SECURITY_STAFF">Security Staff</option>
              </select>

              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search enrolled identity..."
                  value={faceSearch}
                  onChange={(e) => setFaceSearch(e.target.value)}
                  className="input-clean pl-8 py-1 text-xs w-56"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsCalibrating(!isCalibrating)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium transition-colors"
              >
                <Sliders className="w-3.5 h-3.5 text-slate-500" />
                <span>Calibrate Gating</span>
              </button>

              <button
                onClick={() => setIsEnrollingFace(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Enroll New Face</span>
              </button>
            </div>
          </div>

          {/* Calibration Panel */}
          {isCalibrating && (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-100">
                <h3 className="font-bold text-slate-800 flex items-center gap-2">
                  <Sliders className="w-4 h-4 text-blue-600" />
                  Biometric Recognition Calibration
                </h3>
                <button onClick={() => setIsCalibrating(false)} className="text-slate-400 hover:text-slate-600">
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
                <div className="space-y-1.5">
                  <label className="text-slate-700 font-medium">Recognition Engine</label>
                  <div className="pt-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={faceConfig.enabled}
                        onChange={(e) => setFaceConfig({ ...faceConfig, enabled: e.target.checked })}
                        className="rounded border-slate-300 text-blue-600 focus:ring-0"
                      />
                      <span className="text-slate-700">
                        {faceConfig.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                    </label>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    If disabled, video pipelines track entities without biometric inference.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-slate-700 font-medium">Similarity Threshold</label>
                    <span className="text-blue-600 font-bold font-mono">{faceConfig.similarity_threshold}</span>
                  </div>
                  <input
                    type="range"
                    min="0.25"
                    max="0.85"
                    step="0.05"
                    value={faceConfig.similarity_threshold}
                    onChange={(e) => setFaceConfig({ ...faceConfig, similarity_threshold: e.target.value })}
                    className="w-full accent-blue-600"
                  />
                  <p className="text-[11px] text-slate-400">
                    Default: 0.40. Higher prevents false positives; lower accommodates angle variance.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <div className="flex justify-between">
                    <label className="text-slate-700 font-medium">Min Quality Gating</label>
                    <span className="text-blue-600 font-bold font-mono">{faceConfig.min_quality_score}</span>
                  </div>
                  <input
                    type="range"
                    min="0.20"
                    max="0.70"
                    step="0.05"
                    value={faceConfig.min_quality_score}
                    onChange={(e) => setFaceConfig({ ...faceConfig, min_quality_score: e.target.value })}
                    className="w-full accent-blue-600"
                  />
                  <p className="text-[11px] text-slate-400">
                    Rejects blurry or tiny face crops to avoid spurious matches.
                  </p>
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleSaveConfig}
                  className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs transition-colors"
                >
                  Save Calibration
                </button>
              </div>
            </div>
          )}

          {/* Enrolled Face Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredFaces.map((face) => {
              const isWatchlist = face.category === 'WATCHLIST';
              const isAuth = face.category === 'AUTHORIZED' || face.category === 'SECURITY_STAFF';

              return (
                <div
                  key={face.id}
                  className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 hover:border-slate-300 transition-all flex flex-col justify-between"
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-slate-100 text-slate-600">
                        {face.id}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded border ${
                        isWatchlist 
                          ? 'bg-red-50 text-red-700 border-red-200' 
                          : isAuth 
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200' 
                            : 'bg-slate-100 text-slate-600 border-slate-200'
                      }`}>
                        {face.category}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="w-14 h-14 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center flex-shrink-0">
                        {face.photo_base64 ? (
                          <img 
                            src={face.photo_base64.startsWith('data:') ? face.photo_base64 : `data:image/jpeg;base64,${face.photo_base64}`} 
                            alt={face.name} 
                            className="w-full h-full object-cover" 
                          />
                        ) : (
                          <User className="w-6 h-6 text-slate-400" />
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <h3 className="font-semibold text-xs text-slate-900 truncate">{face.name}</h3>
                        <div className="text-[11px] text-slate-500 mt-0.5">
                          Classification: <strong className={isWatchlist ? 'text-red-700' : 'text-emerald-700'}>{isWatchlist ? 'PRIORITY' : 'AUTHORIZED'}</strong>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Quality: {(face.quality_score * 100).toFixed(0)}%
                        </div>
                      </div>
                    </div>

                    {face.notes && (
                      <p className="text-xs text-slate-500 line-clamp-2 bg-slate-50 p-2 rounded border border-slate-100">
                        {face.notes}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 mt-3">
                    <span className="text-[10px]">
                      {face.created_at ? new Date(face.created_at).toLocaleDateString() : 'Enrolled'}
                    </span>
                    <button
                      onClick={() => handleDeleteFace(face.id, face.name)}
                      className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors"
                      title="Remove identity"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })}

            {filteredFaces.length === 0 && !faceLoading && (
              <div className="col-span-full bg-white rounded-lg border border-slate-200 shadow-sm p-12 text-center text-slate-500">
                <UserX className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs">No enrolled identities found matching your query.</p>
                <button
                  onClick={() => setIsEnrollingFace(true)}
                  className="mt-3 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
                >
                  Enroll First Identity
                </button>
              </div>
            )}
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: ANPR VEHICLE WATCHLIST                                             */}
      {/* ========================================================================= */}
      {activeTab === 'VEHICLE' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search registered plate or vehicle..."
                value={vehicleSearch}
                onChange={(e) => setVehicleSearch(e.target.value)}
                className="input-clean pl-8 w-full text-xs"
              />
            </div>

            <button
              onClick={() => setIsAddingVehicle(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-sm transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Register Target Vehicle</span>
            </button>
          </div>

          {/* Vehicle Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVehicles.map((item) => (
              <div
                key={item.id}
                className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 flex flex-col justify-between hover:border-slate-300 transition-colors"
              >
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-slate-600 px-2 py-0.5 rounded bg-slate-100 font-mono">
                      {item.id}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded bg-red-50 text-red-700 border border-red-200">
                      PRIORITY
                    </span>
                  </div>

                  <div>
                    <span className="text-lg font-bold text-slate-900 font-mono tracking-wider">
                      {item.identifier}
                    </span>
                    <h3 className="text-xs text-slate-700 font-semibold mt-0.5">{item.title}</h3>
                    <p className="text-[11px] text-slate-500 mt-0.5">{item.category}</p>
                  </div>

                  {item.notes && (
                    <p className="text-xs text-slate-500 bg-slate-50 p-2.5 rounded border border-slate-100 line-clamp-2">
                      {item.notes}
                    </p>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-400 mt-3">
                  <span>Logged: {item.date_added || 'Active'}</span>
                  <button
                    onClick={() => handleDeleteVehicle(item.id, item.identifier)}
                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}

            {filteredVehicles.length === 0 && (
              <div className="col-span-full bg-white rounded-lg border border-slate-200 shadow-sm p-12 text-center text-slate-500">
                <Car className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                <p className="text-xs">No registered target vehicles found.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ENROLL NEW FACE                                                    */}
      {/* ========================================================================= */}
      {isEnrollingFace && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full p-6 rounded-lg border border-slate-200 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-600" />
                Enroll Identity in Registry
              </h3>
              <button onClick={() => setIsEnrollingFace(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            {enrollError && (
              <div className="p-2.5 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                {enrollError}
              </div>
            )}

            <form onSubmit={handleEnrollSubmit} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-medium mb-1">Full Name / Identifier</label>
                <input
                  type="text"
                  required
                  value={enrollForm.name}
                  onChange={(e) => setEnrollForm({ ...enrollForm, name: e.target.value })}
                  placeholder="e.g. Officer Vikram Singh..."
                  className="input-clean w-full"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-700 font-medium mb-1">Category</label>
                  <select
                    value={enrollForm.category}
                    onChange={(e) => setEnrollForm({ ...enrollForm, category: e.target.value })}
                    className="input-clean w-full"
                  >
                    <option value="WATCHLIST">Watchlist (Flagged)</option>
                    <option value="AUTHORIZED">Authorized Personnel</option>
                    <option value="SECURITY_STAFF">Security Staff</option>
                    <option value="VISITOR">Visitor</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-700 font-medium mb-1">Operational Level</label>
                  <select
                    value={enrollForm.threat_level}
                    onChange={(e) => setEnrollForm({ ...enrollForm, threat_level: e.target.value })}
                    className="input-clean w-full"
                  >
                    <option value="PRIORITY">PRIORITY</option>
                    <option value="ALERT">ALERT</option>
                    <option value="NOTICE">NOTICE</option>
                    <option value="INFO">INFO</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Reference Photo</label>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhotoSelect}
                  className="input-clean w-full file:mr-3 file:py-1 file:px-2.5 file:rounded file:border-0 file:text-xs file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
              </div>

              {enrollForm.preview_url && (
                <div className="flex items-center gap-3 p-2 bg-slate-50 rounded border border-slate-200">
                  <img src={enrollForm.preview_url} alt="Preview" className="w-12 h-12 rounded object-cover border border-slate-300" />
                  <span className="text-xs text-emerald-700">Photo loaded for biometric feature embedding.</span>
                </div>
              )}

              <div>
                <label className="block text-slate-700 font-medium mb-1">Intelligence / Dossier Notes</label>
                <textarea
                  rows={2}
                  value={enrollForm.notes}
                  onChange={(e) => setEnrollForm({ ...enrollForm, notes: e.target.value })}
                  placeholder="Clearance context or notes..."
                  className="input-clean w-full"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEnrollingFace(false)}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={enrollSubmitting}
                  className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold shadow-sm transition-colors"
                >
                  {enrollSubmitting ? 'Enrolling...' : 'Confirm Enrollment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODAL: ADD VEHICLE TARGET                                                 */}
      {/* ========================================================================= */}
      {isAddingVehicle && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-md w-full p-6 rounded-lg border border-slate-200 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <Car className="w-4 h-4 text-red-600" />
                Register Vehicle Watchlist Target
              </h3>
              <button onClick={() => setIsAddingVehicle(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddVehicle} className="space-y-3">
              <div>
                <label className="block text-slate-700 font-medium mb-1">License Plate Number</label>
                <input
                  type="text"
                  required
                  value={vehicleForm.identifier}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, identifier: e.target.value })}
                  placeholder="e.g. DL01AB1234..."
                  className="input-clean w-full uppercase font-mono font-semibold"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Vehicle Description</label>
                <input
                  type="text"
                  value={vehicleForm.title}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, title: e.target.value })}
                  placeholder="e.g. Dark Grey SUV..."
                  className="input-clean w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Reason / Category</label>
                <input
                  type="text"
                  value={vehicleForm.category}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, category: e.target.value })}
                  placeholder="e.g. Perimeter Infiltration Suspect..."
                  className="input-clean w-full"
                />
              </div>

              <div>
                <label className="block text-slate-700 font-medium mb-1">Operational Notes</label>
                <textarea
                  rows={2}
                  value={vehicleForm.notes}
                  onChange={(e) => setVehicleForm({ ...vehicleForm, notes: e.target.value })}
                  placeholder="Reason for surveillance or interception order..."
                  className="input-clean w-full"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setIsAddingVehicle(false)}
                  className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-1.5 rounded-md bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-sm transition-colors"
                >
                  Register Plate
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
