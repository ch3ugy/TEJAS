import React from 'react';
import { Outlet } from 'react-router-dom';
import Navbar from '../components/common/Navbar';
import Sidebar from '../components/common/Sidebar';
import { useSurveillanceStream } from '../services/useSurveillanceStream';
import { useVideoTelemetry } from '../services/useVideoTelemetry';

export default function DashboardLayout() {
  const { activeThreat, incidents, isConnected } = useSurveillanceStream();
  const { telemetry, isBackendOnline } = useVideoTelemetry(true, 2000);

  const unresolvedCount = (incidents || []).filter(i => i.status !== 'RESOLVED').length;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col antialiased">
      {/* Top Navbar */}
      <Navbar 
        isConnected={isConnected && isBackendOnline}
        activeIncidentsCount={unresolvedCount}
        severity={activeThreat?.severity || activeThreat?.level || 'INFO'}
      />

      {/* Main Workspace Area with Sidebar and Content */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar 
          activeIncidentsCount={unresolvedCount}
          telemetry={telemetry}
          isOnline={isBackendOnline}
        />
        <main className="flex-1 overflow-y-auto bg-slate-50">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
