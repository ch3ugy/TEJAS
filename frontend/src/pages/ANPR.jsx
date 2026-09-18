import React, { useState, useEffect } from 'react';
import { 
  ScanLine, 
  Sparkles, 
  ShieldAlert, 
  CheckCircle2, 
  Sliders, 
  Camera, 
  Zap, 
  RefreshCw, 
  Car, 
  Radio, 
  AlertTriangle,
  Info
} from 'lucide-react';
import { useSurveillanceStream } from '../services/useSurveillanceStream';

export default function ANPR() {
  const { isConnected: wsConnected, lastAnprDetection } = useSurveillanceStream();

  // Navigation & View state
  const [activeTab, setActiveTab] = useState('live'); // 'live', 'testbench', 'watchlist'
  const [selectedSource, setSelectedSource] = useState('CAM-00');
  const [isRestoredView, setIsRestoredView] = useState(true);
  const [viewMode, setViewMode] = useState('split'); // 'split' or 'single'
  
  // Data state
  const [recentPlates, setRecentPlates] = useState([]);
  const [selectedPlate, setSelectedPlate] = useState(null);
  const [watchlistEntries, setWatchlistEntries] = useState([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  // Testbench Interactive State
  const [testbenchPlate, setTestbenchPlate] = useState('MP09AB1234');
  const [degradationType, setDegradationType] = useState('motion_blur');
  const [intensity, setIntensity] = useState(70);
  const [isProcessingTestbench, setIsProcessingTestbench] = useState(false);
  const [testbenchResult, setTestbenchResult] = useState(null);
  const [dispatchAlert, setDispatchAlert] = useState(null);

  // Fetch recent plates on mount
  const fetchRecentPlates = async () => {
    try {
      setLoadingRecent(true);
      const res = await fetch('/api/anpr/recent?limit=15');
      if (res.ok) {
        const data = await res.json();
        setRecentPlates(data);
        if (data.length > 0 && !selectedPlate) {
          setSelectedPlate(data[0]);
        }
      }
    } catch (err) {
      console.error('Failed to load recent plates:', err);
    } finally {
      setLoadingRecent(false);
    }
  };

  // Fetch watchlist entries
  const fetchWatchlist = async () => {
    try {
      const res = await fetch('/api/anpr/watchlist');
      if (res.ok) {
        const data = await res.json();
        setWatchlistEntries(data);
      }
    } catch (err) {
      console.error('Failed to load watchlist:', err);
    }
  };

  useEffect(() => {
    fetchRecentPlates();
    fetchWatchlist();
  }, []);

  // Listen to live ANPR WebSocket events
  useEffect(() => {
    if (lastAnprDetection && lastAnprDetection.plate_detected) {
      const newPlateItem = {
        id: `PLT-${Date.now().toString().slice(-6)}`,
        plate_number: lastAnprDetection.plate_number,
        vehicle_type: 'Vehicle',
        confidence_before: lastAnprDetection.confidence_before || 0.0,
        confidence_after: lastAnprDetection.confidence_after || 0.0,
        camera: lastAnprDetection.camera_id || 'CAM-00',
        timestamp: lastAnprDetection.timestamp || new Date().toLocaleTimeString(),
        watchlist_status: lastAnprDetection.watchlist_status || 'CLEAR',
        quality_score: String(lastAnprDetection.quality_assessment?.quality_score || 70),
        applied_enhancements: lastAnprDetection.applied_enhancements || [],
        raw_crop_base64: lastAnprDetection.raw_crop_base64,
        restored_crop_base64: lastAnprDetection.restored_crop_base64,
        raw_ocr_text: lastAnprDetection.raw_ocr_text,
        quality_metrics: lastAnprDetection.quality_assessment
      };

      setRecentPlates(prev => [newPlateItem, ...prev.slice(0, 19)]);
      setSelectedPlate(newPlateItem);
    }
  }, [lastAnprDetection]);

  // Execute Real Backend Restoration Pass
  const handleRunRestoration = async () => {
    try {
      setIsProcessingTestbench(true);
      const res = await fetch('/api/anpr/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plate_number: testbenchPlate,
          degradation_type: degradationType,
          intensity: intensity / 100.0
        })
      });

      if (res.ok) {
        const result = await res.json();
        setTestbenchResult(result);
        setSelectedPlate({
          id: `TEST-${Date.now().toString().slice(-4)}`,
          plate_number: result.plate_number,
          vehicle_type: 'Synthetic Testbench Vehicle',
          confidence_before: result.confidence_before,
          confidence_after: result.confidence_after,
          camera: 'BENCHMARK-SIM',
          timestamp: new Date().toLocaleTimeString(),
          watchlist_status: result.watchlist_status,
          quality_score: String(result.quality_assessment?.quality_score || 55),
          applied_enhancements: result.applied_enhancements || [],
          raw_crop_base64: result.raw_crop_base64,
          restored_crop_base64: result.restored_crop_base64,
          raw_ocr_text: result.raw_ocr_text,
          quality_metrics: result.quality_assessment
        });
      }
    } catch (err) {
      console.error('Testbench restoration failed:', err);
    } finally {
      setIsProcessingTestbench(false);
    }
  };

  const activeDisplay = selectedPlate || (recentPlates.length > 0 ? recentPlates[0] : null);
  const isWatchlistHit = activeDisplay && activeDisplay.watchlist_status && activeDisplay.watchlist_status !== 'CLEAR';
  const matchedDossier = watchlistEntries.find(w => w.identifier === activeDisplay?.plate_number);

  return (
    <div className="space-y-5">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ScanLine className="w-5 h-5 text-blue-600" />
            Automatic Number Plate Recognition (ANPR)
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Vehicle detection, optical enhancement pipeline, character recognition, and watchlist cross-referencing.
          </p>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('live')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              activeTab === 'live' 
                ? 'bg-blue-50 border-blue-200 text-blue-700' 
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Camera className="w-3.5 h-3.5" />
            <span>Live Ingest & Crops</span>
          </button>
          <button
            onClick={() => {
              setActiveTab('testbench');
              if (!testbenchResult) handleRunRestoration();
            }}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              activeTab === 'testbench' 
                ? 'bg-amber-50 border-amber-200 text-amber-700' 
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <Sliders className="w-3.5 h-3.5" />
            <span>Degradation Testbench</span>
          </button>
          <button
            onClick={() => setActiveTab('watchlist')}
            className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors flex items-center gap-1.5 ${
              activeTab === 'watchlist' 
                ? 'bg-red-50 border-red-200 text-red-700' 
                : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
            }`}
          >
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Vehicle Watchlist ({watchlistEntries.length})</span>
          </button>
        </div>
      </div>

      {/* Dispatch Interception Banner */}
      {dispatchAlert && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between text-xs text-red-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600" />
            <span>{dispatchAlert}</span>
          </div>
          <button onClick={() => setDispatchAlert(null)} className="text-red-700 hover:text-red-900 font-semibold">Dismiss</button>
        </div>
      )}

      {/* Main Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Real Plate Inspection Surface & Scans Table */}
        <div className="lg:col-span-8 space-y-4">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5">
            <div className="flex flex-wrap items-center justify-between pb-3 border-b border-slate-100 gap-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Optical Ingestion & Restoration Inspection Deck
                </h2>
              </div>

              {/* View mode toggle */}
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setViewMode('split')}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === 'split' ? 'bg-blue-100 text-blue-800' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Side-by-Side
                </button>
                <button
                  onClick={() => {
                    setViewMode('single');
                    setIsRestoredView(false);
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === 'single' && !isRestoredView ? 'bg-amber-100 text-amber-800' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Raw Crop
                </button>
                <button
                  onClick={() => {
                    setViewMode('single');
                    setIsRestoredView(true);
                  }}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === 'single' && isRestoredView ? 'bg-emerald-100 text-emerald-800' : 'text-slate-500 hover:text-slate-800'
                  }`}
                >
                  Restored Crop
                </button>
              </div>
            </div>

            {/* Visual Display Surface: Real Base64 Images */}
            <div className="py-4 px-4 bg-slate-50 rounded-lg border border-slate-200 my-4">
              {viewMode === 'split' ? (
                /* Side-by-Side Comparison of Real Crops */
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Left: Raw Sensor Crop */}
                  <div className="p-3 bg-white rounded-lg border border-slate-200 flex flex-col items-center">
                    <div className="w-full flex items-center justify-between text-[11px] text-slate-600 mb-2 font-medium">
                      <span>1. Raw Sensor Crop</span>
                      <span className="text-slate-400 font-mono">
                        {activeDisplay?.quality_metrics?.resolution 
                          ? `${activeDisplay.quality_metrics.resolution.width}x${activeDisplay.quality_metrics.resolution.height}px` 
                          : 'Original Input'}
                      </span>
                    </div>

                    <div className="w-full h-32 bg-slate-900 rounded-md border border-slate-300 flex items-center justify-center overflow-hidden p-2">
                      {activeDisplay?.raw_crop_base64 ? (
                        <img 
                          src={activeDisplay.raw_crop_base64} 
                          alt="Raw License Plate" 
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <div className="text-xs text-slate-400 text-center">
                          Waiting for plate detection...
                        </div>
                      )}
                    </div>

                    <div className="w-full mt-2.5 flex items-center justify-between text-xs">
                      <span className="text-slate-500">Raw OCR:</span>
                      <span className="text-slate-800 font-mono font-semibold">{activeDisplay?.raw_ocr_text || '—'}</span>
                    </div>
                    <div className="w-full flex items-center justify-between text-xs mt-1">
                      <span className="text-slate-500">Initial Confidence:</span>
                      <span className="text-slate-700 font-mono font-medium">{Math.round((activeDisplay?.confidence_before || 0) * 100)}%</span>
                    </div>
                  </div>

                  {/* Right: Restored Crop */}
                  <div className="p-3 bg-white rounded-lg border border-blue-200 flex flex-col items-center">
                    <div className="w-full flex items-center justify-between text-[11px] text-blue-700 mb-2 font-medium">
                      <span>2. Enhanced Crop</span>
                      <span className="text-emerald-600 font-mono text-[10px]">CLAHE + Deblur</span>
                    </div>

                    <div className="w-full h-32 bg-slate-900 rounded-md border border-blue-300 flex items-center justify-center overflow-hidden p-2">
                      {activeDisplay?.restored_crop_base64 ? (
                        <img 
                          src={activeDisplay.restored_crop_base64} 
                          alt="Restored License Plate" 
                          className="max-h-full max-w-full object-contain"
                        />
                      ) : (
                        <div className="text-xs text-slate-400 text-center">
                          Enhancement pipeline idle
                        </div>
                      )}
                    </div>

                    <div className="w-full mt-2.5 flex items-center justify-between text-xs">
                      <span className="text-slate-500">Normalized Registration:</span>
                      <span className="text-blue-700 font-mono font-bold text-sm">{activeDisplay?.plate_number || '—'}</span>
                    </div>
                    <div className="w-full flex items-center justify-between text-xs mt-1">
                      <span className="text-slate-500">Restored Confidence:</span>
                      <span className="text-emerald-600 font-mono font-bold">
                        {Math.round((activeDisplay?.confidence_after || 0) * 100)}%
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                /* Single High-Definition View */
                <div className="flex flex-col items-center justify-center py-3">
                  <div className="text-xs text-slate-500 mb-2">
                    {isRestoredView ? 'Enhanced Optical Plate' : 'Raw Sensor Crop'}
                  </div>
                  <div className="max-w-md w-full h-36 bg-slate-900 rounded-md border border-slate-300 flex items-center justify-center p-2">
                    {isRestoredView ? (
                      <img 
                        src={activeDisplay?.restored_crop_base64 || activeDisplay?.raw_crop_base64} 
                        alt="Restored Plate" 
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <img 
                        src={activeDisplay?.raw_crop_base64} 
                        alt="Raw Plate" 
                        className="max-h-full max-w-full object-contain"
                      />
                    )}
                  </div>
                  <div className="mt-3 text-center">
                    <span className="text-xs text-slate-500">Detected Registration: </span>
                    <span className="text-base font-bold text-slate-900 font-mono tracking-wider">{activeDisplay?.plate_number}</span>
                  </div>
                </div>
              )}

              {/* Quality Telemetry Bar */}
              {activeDisplay?.quality_metrics && (
                <div className="mt-4 pt-3 border-t border-slate-200 grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="p-2 rounded bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-medium">FOCUS (LAPLACIAN)</span>
                    <span className="font-bold font-mono text-slate-800">
                      {activeDisplay.quality_metrics.laplacian_var}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-medium">CONTRAST (STD DEV)</span>
                    <span className="font-bold font-mono text-slate-800">
                      {activeDisplay.quality_metrics.contrast}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-medium">LUMINANCE (MEAN)</span>
                    <span className="font-bold font-mono text-slate-800">
                      {activeDisplay.quality_metrics.brightness}
                    </span>
                  </div>

                  <div className="p-2 rounded bg-white border border-slate-200">
                    <span className="text-[10px] text-slate-400 block font-medium">COMPOSITE QUALITY</span>
                    <span className="font-bold font-mono text-blue-600">
                      {activeDisplay.quality_score || activeDisplay.quality_metrics.quality_score}%
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Live Camera Stream Feed */}
            {selectedSource === 'CAM-00' && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <Radio className="w-4 h-4 text-blue-600" />
                    <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                      Live Video Feed with ANPR Detection
                    </h3>
                  </div>
                  <span className="text-xs text-slate-500 font-mono">Camera: {selectedSource}</span>
                </div>

                <div className="relative aspect-video w-full bg-slate-900 rounded-lg overflow-hidden border border-slate-800">
                  <img
                    src="/api/video/feed"
                    alt="Live Feed"
                    className="w-full h-full object-contain"
                  />
                  <div className="absolute top-2 left-2 bg-slate-900/90 px-2 py-1 rounded text-[10px] font-medium text-emerald-400 border border-slate-700 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    Active Ingestion
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Recent Ingested Vehicle Plates Table */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center gap-2">
                <Car className="w-4 h-4 text-blue-600" />
                Recent Vehicle Scans ({recentPlates.length})
              </h3>
              <button
                onClick={fetchRecentPlates}
                disabled={loadingRecent}
                className="text-xs text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
              >
                <RefreshCw className={`w-3 h-3 ${loadingRecent ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 text-[11px]">
                    <th className="pb-2 font-medium">PLATE NUMBER</th>
                    <th className="pb-2 font-medium">RAW CONF</th>
                    <th className="pb-2 font-medium">RESTORED</th>
                    <th className="pb-2 font-medium">WATCHLIST</th>
                    <th className="pb-2 font-medium">CAMERA</th>
                    <th className="pb-2 font-medium">TIME</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recentPlates.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-slate-400">
                        No vehicle plates scanned yet.
                      </td>
                    </tr>
                  ) : (
                    recentPlates.map((plate) => (
                      <tr
                        key={plate.id}
                        onClick={() => setSelectedPlate(plate)}
                        className={`cursor-pointer hover:bg-slate-50 transition-colors ${
                          activeDisplay?.id === plate.id ? 'bg-blue-50/60' : ''
                        }`}
                      >
                        <td className="py-2.5 font-bold font-mono text-slate-900">
                          <div className="flex items-center gap-2">
                            {plate.raw_crop_base64 && (
                              <img src={plate.raw_crop_base64} alt="" className="w-8 h-4 object-cover rounded border border-slate-300" />
                            )}
                            <span>{plate.plate_number}</span>
                          </div>
                        </td>
                        <td className="py-2.5 font-mono text-slate-600">{Math.round((plate.confidence_before || 0) * 100)}%</td>
                        <td className="py-2.5 font-mono font-bold text-emerald-600">{Math.round((plate.confidence_after || 0) * 100)}%</td>
                        <td className="py-2.5">
                          <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${
                            plate.watchlist_status && plate.watchlist_status !== 'CLEAR'
                              ? 'bg-red-50 text-red-700 border-red-200 font-bold'
                              : 'bg-slate-100 text-slate-600 border-slate-200'
                          }`}>
                            {plate.watchlist_status || 'CLEAR'}
                          </span>
                        </td>
                        <td className="py-2.5 text-slate-500 font-mono text-[11px]">{plate.camera}</td>
                        <td className="py-2.5 text-slate-400 text-[11px]">{plate.timestamp}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right Column: Watchlist Intelligence & Testbench */}
        <div className="lg:col-span-4 space-y-4">
          {/* Watchlist Intelligence Check Card */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-red-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Watchlist Intelligence Check
                </h3>
              </div>
              <span className={`px-2 py-0.5 text-[10px] font-medium rounded border ${
                isWatchlistHit ? 'bg-red-50 text-red-700 border-red-200 font-bold' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
              }`}>
                {isWatchlistHit ? 'Watchlist Match' : 'Clear'}
              </span>
            </div>

            {isWatchlistHit ? (
              <div className="space-y-3 text-xs">
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <div className="text-[11px] text-red-700 font-bold uppercase">
                    ALERT LEVEL: PRIORITY
                  </div>
                  <div className="text-sm font-bold text-slate-900 mt-0.5">
                    {matchedDossier?.title || 'Target Vehicle on Watchlist'}
                  </div>
                  <div className="text-xs text-slate-600 mt-1">
                    {matchedDossier?.notes || 'Vehicle flagged in persistent surveillance registry.'}
                  </div>
                </div>

                <div className="space-y-2 text-slate-600">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Category:</span>
                    <span className="font-medium text-slate-800">{matchedDossier?.category || 'Security Flag'}</span>
                  </div>
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-400">Flagged Date:</span>
                    <span className="text-slate-800">{matchedDossier?.date_added || 'Active'}</span>
                  </div>
                </div>

                <button 
                  onClick={() => setDispatchAlert(`Interception alert triggered for vehicle ${activeDisplay.plate_number}.`)}
                  className="w-full mt-2 py-2 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center justify-center gap-1.5"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>Dispatch Security Unit</span>
                </button>
              </div>
            ) : (
              <div className="py-8 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-500 mx-auto" />
                <div className="text-sm font-semibold text-slate-800">Vehicle Cleared</div>
                <p className="text-xs text-slate-500 px-2">
                  No active surveillance flags recorded for plate {activeDisplay?.plate_number || 'target'}.
                </p>
              </div>
            )}
          </div>

          {/* Interactive Degradation Testbench Box */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center gap-2 mb-2">
              <Sliders className="w-4 h-4 text-blue-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Optical Restoration Testbench
              </h3>
            </div>
            <p className="text-xs text-slate-500 mb-3">
              Evaluate deblurring and contrast normalization on degraded license plates:
            </p>

            <div className="space-y-3 text-xs">
              <div>
                <label className="text-slate-600 block mb-1 font-medium">Target License Number</label>
                <input
                  type="text"
                  value={testbenchPlate}
                  onChange={(e) => setTestbenchPlate(e.target.value.toUpperCase())}
                  className="input-clean w-full font-mono uppercase font-bold"
                  placeholder="e.g. MP09AB1234"
                />
              </div>

              <div>
                <label className="text-slate-600 block mb-1 font-medium">Degradation Profile</label>
                <select
                  value={degradationType}
                  onChange={(e) => setDegradationType(e.target.value)}
                  className="input-clean w-full"
                >
                  <option value="motion_blur">Motion Blur (High-Speed Transit)</option>
                  <option value="low_light">Low Light (Night Exposure)</option>
                  <option value="noise">Sensor Noise</option>
                  <option value="low_res">Low Resolution (Distance)</option>
                </select>
              </div>

              <div>
                <div className="flex justify-between text-slate-600 mb-1">
                  <span>Distortion Intensity</span>
                  <span className="font-bold text-slate-800 font-mono">{intensity}%</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="95"
                  value={intensity}
                  onChange={(e) => setIntensity(Number(e.target.value))}
                  className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                />
              </div>

              <button
                onClick={handleRunRestoration}
                disabled={isProcessingTestbench}
                className="w-full py-2 rounded-md bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-xs font-semibold flex items-center justify-center gap-2 transition-colors shadow-sm"
              >
                {isProcessingTestbench ? (
                  <>
                    <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    <span>Processing Restoration...</span>
                  </>
                ) : (
                  <>
                    <Zap className="w-3.5 h-3.5" />
                    <span>Run Restoration Pass</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
