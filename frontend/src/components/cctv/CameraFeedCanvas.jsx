import React, { useRef, useEffect, useState, useCallback } from 'react';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { renderCCTVFrame } from '../../utils/canvasRenderer';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

export default function CameraFeedCanvas({ 
  camera, 
  entities = [], 
  zones = [], 
  tick = 0,
  isLive = false,
  telemetry = null
}) {
  const canvasRef = useRef(null);
  const [streamError, setStreamError] = useState(false);
  const [streamKey, setStreamKey] = useState(Date.now());
  const [retryCount, setRetryCount] = useState(0);
  const [isReconnecting, setIsReconnecting] = useState(false);

  useEffect(() => {
    if (isLive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    let animId;
    const render = () => {
      renderCCTVFrame(canvas, camera, entities, zones, tick);
      animId = requestAnimationFrame(render);
    };
    render();

    return () => {
      if (animId) cancelAnimationFrame(animId);
    };
  }, [camera, entities, zones, tick, isLive]);

  const handleStreamError = useCallback(() => {
    if (retryCount < 3) {
      setIsReconnecting(true);
      const timer = setTimeout(() => {
        setRetryCount(prev => prev + 1);
        setStreamKey(Date.now());
        setIsReconnecting(false);
      }, 1500);
      return () => clearTimeout(timer);
    } else {
      setStreamError(true);
      setIsReconnecting(false);
    }
  }, [retryCount]);

  const handleManualRetry = () => {
    setStreamError(false);
    setRetryCount(0);
    setIsReconnecting(false);
    setStreamKey(Date.now());
  };

  const camCode = camera?.code || camera?.id || 'CAM-00';
  const liveUrl = `${API_BASE}/video/feed?camera_id=${encodeURIComponent(camCode)}`;

  return (
    <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm flex flex-col">
      {/* Video Viewport */}
      <div className="relative aspect-video bg-slate-950 w-full overflow-hidden flex items-center justify-center">
        {isLive ? (
          streamError ? (
            <div className="flex flex-col items-center justify-center p-6 text-center text-slate-400 w-full h-full">
              <AlertCircle className="w-8 h-8 text-amber-500 mb-2" />
              <div className="text-xs font-semibold text-slate-200 mb-1">
                Camera Stream Offline
              </div>
              <p className="text-[11px] text-slate-400 max-w-sm mb-3">
                Unable to receive video frames from node {camCode}.
              </p>
              <button
                onClick={handleManualRetry}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Connection</span>
              </button>
            </div>
          ) : (
            <>
              <img
                key={streamKey}
                src={`${liveUrl}&t=${streamKey}`}
                alt={`Live Feed: ${camCode}`}
                className="w-full h-full object-cover"
                onError={handleStreamError}
                onLoad={() => {
                  setStreamError(false);
                  setRetryCount(0);
                  setIsReconnecting(false);
                }}
              />
              {isReconnecting && (
                <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded bg-slate-900/80 text-white text-[11px] font-medium backdrop-blur-sm z-20">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Reconnecting...</span>
                </div>
              )}
            </>
          )
        ) : (
          <canvas
            ref={canvasRef}
            width={640}
            height={360}
            className="w-full h-full object-cover"
          />
        )}

        {/* Minimal Corner Overlay */}
        {isLive && !streamError && (
          <div className="absolute top-3 left-3 flex items-center gap-2 z-10">
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold bg-red-600 text-white shadow-sm">
              <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
              LIVE
            </span>
            <span className="px-2 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-900/75 text-slate-200 backdrop-blur-sm">
              {camCode}
            </span>
          </div>
        )}
      </div>

      {/* Clean Bottom Meta Row */}
      <div className="px-3.5 py-2.5 bg-white border-t border-slate-100 flex items-center justify-between text-xs text-slate-600">
        <div>
          <span className="font-semibold text-slate-900">{camera?.name || 'Primary Camera'}</span>
          <span className="text-slate-400 text-[11px] ml-2">{camera?.location || 'Command Sector'}</span>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-slate-500 font-mono">
          <span>{telemetry?.fps ? `${Math.round(telemetry.fps)} FPS` : '15 FPS'}</span>
          <span>{telemetry?.resolution || '1280x720'}</span>
        </div>
      </div>
    </div>
  );
}
