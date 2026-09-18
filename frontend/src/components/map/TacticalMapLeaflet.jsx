import React, { useState, useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polygon, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { Crosshair, ShieldAlert, Navigation } from 'lucide-react';
import { apiClient } from '../../services/api';

// Centered on Jammu Border Tactical Sector
const SECTOR_CENTER = [32.7285, 74.8605];

// Custom Leaflet DivIcons for Clean Professional Surveillance
function createCameraIcon(code, isThreat = false, isSelected = false) {
  return L.divIcon({
    className: 'custom-tactical-marker',
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center;">
        ${isThreat ? '<span style="position: absolute; width: 30px; height: 30px; border-radius: 50%; background: rgba(220, 38, 38, 0.25); animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>' : ''}
        <div style="
          width: 26px; 
          height: 26px; 
          border-radius: 6px; 
          background: ${isThreat ? '#DC2626' : isSelected ? '#2563EB' : '#FFFFFF'}; 
          border: 1.5px solid ${isThreat ? '#991B1B' : isSelected ? '#1D4ED8' : '#64748B'}; 
          display: flex; 
          align-items: center; 
          justify-content: center;
          box-shadow: 0 1px 3px rgba(0,0,0,0.15);
          cursor: pointer;
        ">
          <span style="color: ${isThreat || isSelected ? '#FFFFFF' : '#1E293B'}; font-size: 10px; font-weight: bold; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
            ${code.replace('CAM-', 'C').replace('BOP-', 'B')}
          </span>
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  });
}

function createIncidentIcon(severity) {
  const isPriority = severity === 'CRITICAL' || severity === 'PRIORITY';
  return L.divIcon({
    className: 'custom-incident-beacon',
    html: `
      <div style="position: relative; display: flex; align-items: center; justify-content: center;">
        <span style="position: absolute; width: 32px; height: 32px; border-radius: 50%; background: ${isPriority ? 'rgba(220, 38, 38, 0.25)' : 'rgba(217, 119, 6, 0.25)'}; animation: ping 2s cubic-bezier(0, 0, 0.2, 1) infinite;"></span>
        <div style="
          width: 20px; 
          height: 20px; 
          border-radius: 50%; 
          background: ${isPriority ? '#DC2626' : '#D97706'}; 
          border: 2px solid #FFFFFF; 
          display: flex; 
          align-items: center; 
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, sans-serif;
          font-size: 11px;
          font-weight: 800;
          color: #FFFFFF;
          box-shadow: 0 2px 4px rgba(0,0,0,0.2);
        ">
          !
        </div>
      </div>
    `,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -16]
  });
}

// Map Controller for Dynamic Pan/Recenter
function MapController({ center, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, zoom, { animate: true });
    }
  }, [center, zoom, map]);
  return null;
}

export default function TacticalMapLeaflet({ 
  onCameraSelect = null, 
  activeThreat = null, 
  selectedCameraId = null,
  height = "380px"
}) {
  const [cameras, setCameras] = useState([]);
  const [zones, setZones] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showZones, setShowZones] = useState(true);
  const [showIncidents, setShowIncidents] = useState(true);
  const [focusedPoint, setFocusedPoint] = useState(SECTOR_CENTER);
  const [mapZoom, setMapZoom] = useState(14);

  useEffect(() => {
    let isMounted = true;

    async function loadTacticalSpatialData() {
      try {
        setIsLoading(true);
        const [camsRes, zonesRes, incsRes] = await Promise.all([
          apiClient.getCameras(),
          apiClient.getZones(),
          apiClient.getIncidents('ALL')
        ]);

        if (isMounted) {
          if (camsRes && camsRes.length > 0) {
            setCameras(camsRes);
          }
          if (zonesRes && zonesRes.length > 0) {
            setZones(zonesRes);
          }
          if (incsRes && incsRes.length > 0) {
            setIncidents(incsRes);
          }
        }
      } catch (err) {
        console.warn("Error loading spatial data for tactical map:", err);
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    loadTacticalSpatialData();
    return () => { isMounted = false; };
  }, []);

  const cameraCoordMap = useMemo(() => {
    const map = {};
    cameras.forEach(c => {
      if (c.lat && c.lng) {
        map[c.id] = [c.lat, c.lng];
        if (c.code) map[c.code] = [c.lat, c.lng];
      }
    });
    return map;
  }, [cameras]);

  const activeIncidents = useMemo(() => {
    return incidents.filter(i => i.status !== 'RESOLVED');
  }, [incidents]);

  const handleRecenter = () => {
    setFocusedPoint(SECTOR_CENTER);
    setMapZoom(14);
  };

  const renderedPolygons = useMemo(() => {
    return zones.map((z) => {
      const rawPoints = Array.isArray(z.points_json) && z.points_json.length >= 3
        ? z.points_json
        : Array.isArray(z.points) && z.points.length >= 3
          ? z.points
          : [];

      const positions = rawPoints.length >= 3
        ? rawPoints.map(pt => {
            const x = Number(pt?.x ?? pt?.lat ?? 0);
            const y = Number(pt?.y ?? pt?.lng ?? 0);
            const lat = Number.isFinite(x) ? x : 32.7285;
            const lng = Number.isFinite(y) ? y : 74.8605;
            return [lat, lng];
          })
        : [
            [32.7310, 74.8630],
            [32.7350, 74.8670],
            [32.7335, 74.8720],
            [32.7290, 74.8660]
          ];

      return {
        id: z.id,
        name: z.name,
        type: z.type,
        color: z.color || '#DC2626',
        positions,
        fence_type: z.fence_type || '2D',
        fence_depth: Number(z.fence_depth || 0.0),
      };
    });
  }, [zones]);

  return (
    <div className="bg-white rounded-lg border border-slate-200 shadow-sm flex flex-col overflow-hidden relative">
      {/* Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-2">
          <div className="p-1 rounded bg-blue-50 text-blue-600">
            <Crosshair className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Perimeter Geospatial Overview
              </h3>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-50 text-emerald-700 font-semibold border border-emerald-200">
                Online
              </span>
            </div>
            <p className="text-[11px] text-slate-500">
              Sector Alpha-Bravo (32.7285° N, 74.8605° E)
            </p>
          </div>
        </div>

        {/* Map Viewport Controls */}
        <div className="flex items-center gap-2 text-xs">
          <button
            onClick={() => setShowZones(!showZones)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
              showZones 
                ? 'bg-blue-50 text-blue-700 border-blue-200' 
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Zones ({renderedPolygons.length})
          </button>

          <button
            onClick={() => setShowIncidents(!showIncidents)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors border ${
              showIncidents 
                ? 'bg-red-50 text-red-700 border-red-200' 
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            Incidents ({activeIncidents.length})
          </button>

          <button
            onClick={handleRecenter}
            className="p-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-600 transition-colors"
            title="Recenter Map View"
          >
            <Navigation className="w-3.5 h-3.5 text-slate-600" />
          </button>
        </div>
      </div>

      {/* Map Container Viewport */}
      <div style={{ height }} className="w-full relative bg-slate-100">
        {isLoading && (
          <div className="absolute inset-0 z-30 bg-white/70 backdrop-blur-sm flex items-center justify-center text-xs text-slate-600 font-medium gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
            <span>Loading geospatial layers...</span>
          </div>
        )}

        <MapContainer
          center={SECTOR_CENTER}
          zoom={mapZoom}
          scrollWheelZoom={true}
          style={{ height: '100%', width: '100%' }}
        >
          <MapController center={focusedPoint} zoom={mapZoom} />

          {/* CartoDB Voyager Clean High-Contrast Base Tiles */}
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            subdomains="abcd"
            maxZoom={19}
          />

          {/* International Border Line Indicator */}
          <Polyline
            positions={[
              [32.7230, 74.8500],
              [32.7265, 74.8560],
              [32.7290, 74.8610],
              [32.7320, 74.8650],
              [32.7360, 74.8710]
            ]}
            pathOptions={{
              color: '#DC2626',
              weight: 2,
              dashArray: '6, 8',
              opacity: 0.8
            }}
          />

          {/* Render Polygonal Restricted Zones */}
          {showZones && renderedPolygons.map(zone => (
            <React.Fragment key={zone.id}>
              <Polygon
                positions={zone.positions}
                pathOptions={{
                  color: zone.fence_type === '3D' ? '#4F46E5' : zone.color,
                  fillColor: zone.color,
                  fillOpacity: zone.fence_type === '3D' ? 0.28 : 0.20,
                  weight: zone.fence_type === '3D' ? 2 : 1.5,
                  dashArray: zone.fence_type === '3D' ? '3, 5' : '4, 4'
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1 p-1">
                    <div className="font-bold text-red-700 flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      <span>{zone.name}</span>
                    </div>
                    <div className="text-slate-500 text-[11px]">Type: {zone.type}</div>
                    <div className="text-slate-600 text-[11px]">{zone.fence_type || '2D'} fence · {zone.fence_depth > 0 ? `${zone.fence_depth}m depth` : 'ground footprint'}</div>
                  </div>
                </Popup>
              </Polygon>
              {zone.fence_type === '3D' && (
                <Polygon
                  positions={zone.positions.map(([lat, lng], idx) => {
                    const drift = idx % 2 === 0 ? 0.0005 : -0.0005;
                    return [lat + drift, lng + 0.0007];
                  })}
                  pathOptions={{
                    color: '#A5B4FC',
                    fillColor: '#818CF8',
                    fillOpacity: 0.08,
                    weight: 1,
                    dashArray: '2, 4'
                  }}
                />
              )}
            </React.Fragment>
          ))}

          {/* Render Camera Nodes from Database */}
          {cameras.map(cam => {
            if (!cam.lat || !cam.lng) return null;
            const isThreat = activeIncidents.some(
              i => i.primary_camera === cam.id || i.primary_camera === cam.code
            );
            const isSelected = selectedCameraId === cam.id || selectedCameraId === cam.code;

            return (
              <Marker
                key={cam.id}
                position={[cam.lat, cam.lng]}
                icon={createCameraIcon(cam.code || cam.id, isThreat, isSelected)}
                eventHandlers={{
                  click: () => {
                    if (onCameraSelect) onCameraSelect(cam);
                  }
                }}
              >
                <Popup>
                  <div className="text-xs space-y-1.5 p-1">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1">
                      <span className="font-bold text-slate-900 font-mono">{cam.code}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-50 text-emerald-700 font-medium">
                        {cam.status}
                      </span>
                    </div>
                    <div className="font-medium text-slate-800 text-[11px]">{cam.name}</div>
                    <div className="text-[11px] text-slate-500">Location: {cam.location}</div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      {cam.lat.toFixed(4)}°N, {cam.lng.toFixed(4)}°E
                    </div>
                    {isThreat && (
                      <div className="text-[10px] font-bold text-red-700 pt-0.5">
                        Active Alert Associated
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            );
          })}

          {/* Render Active Incident Beacons on Map */}
          {showIncidents && activeIncidents.map(inc => {
            const coords = cameraCoordMap[inc.primary_camera];
            if (!coords) return null;

            const beaconCoords = [coords[0] + 0.0006, coords[1] + 0.0006];

            return (
              <Marker
                key={inc.id}
                position={beaconCoords}
                icon={createIncidentIcon(inc.severity)}
              >
                <Popup>
                  <div className="text-xs space-y-1.5 p-1">
                    <div className="flex items-center justify-between gap-2 border-b border-slate-200 pb-1">
                      <span className="font-bold text-red-700 font-mono">{inc.id}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-red-50 text-red-700 font-bold">
                        {inc.severity}
                      </span>
                    </div>
                    <div className="font-medium text-slate-900 text-[11px]">{inc.title}</div>
                    <div className="text-[11px] text-slate-500">Target: {inc.target_entity}</div>
                    <div className="text-[11px] text-slate-500">Camera: {inc.primary_camera}</div>
                    <a
                      href={`/incidents/${inc.id}`}
                      className="block mt-1 text-center text-[11px] bg-blue-600 hover:bg-blue-700 text-white rounded py-1 font-medium transition-colors"
                    >
                      View Incident
                    </a>
                  </div>
                </Popup>
              </Marker>
            );
          })}
        </MapContainer>

        {/* Map Corner Telemetry Badge */}
        <div className="absolute bottom-3 left-3 z-[400] bg-white/95 backdrop-blur-md px-2.5 py-1.5 rounded-md border border-slate-200 text-xs text-slate-600 shadow-sm flex items-center gap-2.5">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-medium text-slate-800">Geospatial</span>
          </div>
          <span className="text-slate-300">|</span>
          <span><strong>{cameras.length}</strong> Cameras</span>
          <span className="text-slate-300">|</span>
          <span><strong>{renderedPolygons.length}</strong> Zones</span>
          <span className="text-slate-300">|</span>
          <span className={activeIncidents.length > 0 ? "text-red-700 font-medium" : "text-slate-600"}>
            <strong>{activeIncidents.length}</strong> Active Breaches
          </span>
        </div>
      </div>
    </div>
  );
}
