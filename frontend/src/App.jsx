import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import DashboardLayout from './layouts/DashboardLayout';
import Dashboard from './pages/Dashboard';
import Surveillance from './pages/Surveillance';
import Incidents from './pages/Incidents';
import IncidentDetail from './pages/IncidentDetail';
import ANPR from './pages/ANPR';
import Tracking from './pages/Tracking';
import Analytics from './pages/Analytics';
import Cameras from './pages/Cameras';
import Zones from './pages/Zones';
import Watchlist from './pages/Watchlist';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<DashboardLayout />}>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/surveillance" element={<Surveillance />} />
          <Route path="/incidents" element={<Incidents />} />
          <Route path="/incidents/:id" element={<IncidentDetail />} />
          <Route path="/anpr" element={<ANPR />} />
          <Route path="/tracking" element={<Tracking />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/cameras" element={<Cameras />} />
          <Route path="/zones" element={<Zones />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/settings" element={<Settings />} />
        </Route>

        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
