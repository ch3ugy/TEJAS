import React, { useState, useEffect } from 'react';
import { 
  BarChart, 
  Bar, 
  PieChart, 
  Pie, 
  Cell, 
  XAxis, 
  YAxis, 
  Tooltip, 
  ResponsiveContainer, 
  CartesianGrid, 
  Legend, 
  AreaChart, 
  Area 
} from 'recharts';
import { BarChart3, TrendingUp, Activity, RefreshCw } from 'lucide-react';
import { ANALYTICS_DATA } from '../data/mockData';
import { apiClient } from '../services/api';

export default function Analytics() {
  const [hourlyThreats, setHourlyThreats] = useState(ANALYTICS_DATA.hourlyThreats);
  const [eventTypesBreakdown, setEventTypesBreakdown] = useState(ANALYTICS_DATA.eventTypesBreakdown);
  const [cameraIncidentRankings, setCameraIncidentRankings] = useState(ANALYTICS_DATA.cameraIncidentRankings);
  const [loading, setLoading] = useState(false);

  const fetchAnalytics = async () => {
    setLoading(true);
    try {
      const [hourly, hotspots, summary] = await Promise.all([
        apiClient.getHourlyAnalytics(),
        apiClient.getCameraHotspots(),
        apiClient.getAnalyticsSummary()
      ]);

      if (hourly && hourly.length > 0) {
        setHourlyThreats(hourly);
      }
      if (hotspots && hotspots.length > 0) {
        setCameraIncidentRankings(hotspots);
      }
      if (summary?.threat_distribution) {
        const dist = summary.threat_distribution;
        const total = (dist.critical || 0) + (dist.high || 0) + (dist.medium || 0) + (dist.low || 0);
        if (total > 0) {
          setEventTypesBreakdown([
            { name: 'Priority Breach', count: dist.critical || 0, color: '#DC2626' },
            { name: 'Alert Warning', count: dist.high || 0, color: '#EA580C' },
            { name: 'Notice Advisory', count: dist.medium || 0, color: '#D97706' },
            { name: 'Routine Event', count: dist.low || 0, color: '#2563EB' }
          ]);
        }
      }
    } catch (e) {
      console.warn("Analytics fetch failed, using fallback:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAnalytics();
  }, []);

  return (
    <div className="space-y-5">
      {/* Top Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-5 h-5 text-blue-600" />
            Surveillance & Operational Analytics
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Aggregated spatio-temporal trends, perimeter incident density, and diurnal activity distributions.
          </p>
        </div>

        {/* Time Window Selector & Refresh */}
        <div className="flex items-center gap-3">
          <button
            onClick={fetchAnalytics}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Sync Telemetry</span>
          </button>
          <div className="bg-slate-100 rounded-md p-1 border border-slate-200 flex text-xs">
            <button className="px-2.5 py-1 rounded bg-white font-medium text-slate-900 shadow-sm">24 Hours</button>
            <button className="px-2.5 py-1 rounded text-slate-600 hover:text-slate-900">7 Days</button>
            <button className="px-2.5 py-1 rounded text-slate-600 hover:text-slate-900">30 Days</button>
          </div>
        </div>
      </div>

      {/* Primary Analytics Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Events Over 24 Hours by Severity (8 Cols) */}
        <div className="lg:col-span-8 bg-white rounded-lg border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-blue-600" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                Hourly Incident Activity (24h Window)
              </h2>
            </div>
            <span className="text-[11px] text-slate-500">
              Aggregated across active cameras
            </span>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyThreats}>
                <defs>
                  <linearGradient id="colorPriority" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#DC2626" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#DC2626" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorAlert" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EA580C" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#EA580C" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorNotice" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2563EB" stopOpacity={0.4}/>
                    <stop offset="95%" stopColor="#2563EB" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                <XAxis dataKey="hour" stroke="#94A3B8" fontSize={11} />
                <YAxis stroke="#94A3B8" fontSize={11} />
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#FFFFFF', 
                    borderColor: '#E2E8F0', 
                    borderRadius: '6px', 
                    fontSize: '12px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }} 
                />
                <Area type="monotone" dataKey="critical" stroke="#DC2626" fillOpacity={1} fill="url(#colorPriority)" name="Priority" />
                <Area type="monotone" dataKey="high" stroke="#EA580C" fillOpacity={1} fill="url(#colorAlert)" name="Alert" />
                <Area type="monotone" dataKey="medium" stroke="#2563EB" fillOpacity={1} fill="url(#colorNotice)" name="Notice" />
                <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Event Classification Pie (4 Cols) */}
        <div className="lg:col-span-4 bg-white rounded-lg border border-slate-200 shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <Activity className="w-4 h-4 text-blue-600" />
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
              Operational Posture Distribution
            </h2>
          </div>

          <div className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={eventTypesBreakdown}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="count"
                >
                  {eventTypesBreakdown.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip 
                  contentStyle={{ 
                    backgroundColor: '#FFFFFF', 
                    borderColor: '#E2E8F0', 
                    borderRadius: '6px', 
                    fontSize: '12px',
                    boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                  }} 
                />
                <Legend layout="horizontal" verticalAlign="bottom" align="center" wrapperStyle={{ fontSize: '11px' }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Lower Analytics: Hotspot Camera Rankings */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800 mb-4">
          Camera Sector Incident Frequency
        </h2>

        <div className="h-64 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={cameraIncidentRankings} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
              <XAxis type="number" stroke="#94A3B8" fontSize={11} />
              <YAxis dataKey="camera" type="category" stroke="#94A3B8" fontSize={11} width={100} />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: '#FFFFFF', 
                  borderColor: '#E2E8F0', 
                  borderRadius: '6px', 
                  fontSize: '12px',
                  boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
                }} 
              />
              <Bar dataKey="incidents" fill="#2563EB" radius={[0, 4, 4, 0]} name="Total Incidents" />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '10px' }} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
