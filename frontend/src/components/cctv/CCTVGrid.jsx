import React, { useState } from 'react';
import CameraFeedCanvas from './CameraFeedCanvas';
import { Grid2X2, Grid3X3, X } from 'lucide-react';

export default function CCTVGrid({ cameras = [], entities = [], zones = [], tick = 0, isLiveMode = false, telemetry = null }) {
  const [layout, setLayout] = useState('2x2'); // '2x2' or 'all'
  const [focusedCamera, setFocusedCamera] = useState(null);

  const displayedCameras = layout === '2x2' ? cameras.slice(0, 4) : cameras;

  return (
    <div className="space-y-3">
      {/* CCTV Grid Top Bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h2 className="text-xs font-bold tracking-wider text-slate-800 uppercase">
            {isLiveMode ? 'Live Camera Matrix' : 'Surveillance Grid'} ({displayedCameras.length} Channels)
          </h2>
          <span className="text-[10px] px-2 py-0.5 rounded bg-blue-50 text-blue-700 font-medium border border-blue-200">
            {isLiveMode ? 'YOLOv8 + ByteTrack Active' : 'Online'}
          </span>
        </div>

        {/* Layout Switcher */}
        <div className="flex items-center gap-1 bg-slate-100 p-0.5 rounded-md border border-slate-200">
          <button
            onClick={() => setLayout('2x2')}
            className={`p-1.5 rounded text-xs transition-colors ${
              layout === '2x2' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
            title="2x2 Grid"
          >
            <Grid2X2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setLayout('all')}
            className={`p-1.5 rounded text-xs transition-colors ${
              layout === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-800'
            }`}
            title="All Cameras Grid"
          >
            <Grid3X3 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Grid Canvas Container */}
      <div className={`grid gap-3.5 ${layout === '2x2' ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3'}`}>
        {displayedCameras.map((cam, idx) => {
          const isThisLive = isLiveMode && (cam.code === 'CAM-00' || cam.code === 'RESTRICTED-Z01' || idx === 0);
          return (
            <CameraFeedCanvas
              key={cam.id}
              camera={cam}
              entities={entities}
              zones={zones}
              tick={tick}
              isLive={isThisLive}
              telemetry={telemetry}
              onSelect={(selected) => setFocusedCamera(selected)}
            />
          );
        })}
      </div>

      {/* Focused Camera Modal */}
      {focusedCamera && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-4xl w-full rounded-xl overflow-hidden border border-slate-200 shadow-2xl p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-red-600 animate-pulse" />
                <span className="font-semibold text-slate-900 text-sm">
                  {focusedCamera.code} — {focusedCamera.name}
                </span>
              </div>
              <button
                onClick={() => setFocusedCamera(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="aspect-video w-full rounded-lg overflow-hidden border border-slate-200">
              <CameraFeedCanvas
                camera={focusedCamera}
                entities={entities}
                zones={zones}
                tick={tick}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
