import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  AlertOctagon, 
  ArrowRight, 
  Filter, 
  ShieldAlert, 
  CheckCircle2, 
  Clock, 
  Search, 
  Zap, 
  RefreshCw, 
  Camera, 
  Eye 
} from 'lucide-react';
import { apiClient } from '../services/api';
import { wsService } from '../services/websocket';

export default function Incidents() {
  const navigate = useNavigate();
  const [incidents, setIncidents] = useState([]);
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterSeverity, setFilterSeverity] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const fetchIncidents = async () => {
    setIsLoading(true);
    try {
      const data = await apiClient.getIncidents(filterStatus, filterSeverity);
      setIncidents(data || []);
    } catch (err) {
      console.error("Failed to fetch incidents:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidents();

    const unsubscribe = wsService.subscribe((msg) => {
      if (msg.type === 'NEW_INCIDENT' || msg.type === 'INCIDENT_UPDATED' || msg.type === 'CORRELATED_EVENT') {
        fetchIncidents();
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [filterStatus, filterSeverity]);

  const handleQuickStatus = async (e, incidentId, targetStatus) => {
    e.stopPropagation();
    try {
      await apiClient.updateIncidentStatus(
        incidentId, 
        targetStatus, 
        "Duty Operator", 
        null, 
        `Quick action to ${targetStatus}`
      );
      await fetchIncidents();
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const filtered = incidents.filter(inc => {
    const target = inc.target_entity || '';
    const title = inc.title || '';
    const cam = inc.primary_camera || '';
    const id = inc.id || '';
    const q = searchQuery.toLowerCase();
    return title.toLowerCase().includes(q) ||
           target.toLowerCase().includes(q) ||
           cam.toLowerCase().includes(q) ||
           id.toLowerCase().includes(q);
  });

  const getAlertLevel = (inc) => {
    const sev = (inc.severity || '').toUpperCase();
    if (sev === 'CRITICAL' || inc.threat_score >= 80) return { label: 'PRIORITY', style: 'bg-red-50 text-red-700 border-red-200' };
    if (sev === 'HIGH' || inc.threat_score >= 60) return { label: 'ALERT', style: 'bg-orange-50 text-orange-700 border-orange-200' };
    if (sev === 'MEDIUM' || inc.threat_score >= 30) return { label: 'NOTICE', style: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'INFO', style: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <AlertOctagon className="w-5 h-5 text-red-600" />
            Security Incidents & Operations Triage
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Correlated incidents automatically synthesized from perimeter intrusions, watchlist matches, and entity tracking.
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2.5">
          <button
            onClick={fetchIncidents}
            disabled={isLoading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium shadow-sm transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh Incidents</span>
          </button>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
        {/* Status Filter Tabs */}
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-slate-400 text-xs mr-2 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5" /> Status:
          </span>
          {['ALL', 'NEW', 'ACKNOWLEDGED', 'INVESTIGATING', 'RESOLVED'].map((st) => (
            <button
              key={st}
              onClick={() => setFilterStatus(st)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filterStatus === st
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 font-semibold'
                  : 'text-slate-600 hover:text-slate-900 border border-transparent hover:bg-slate-50'
              }`}
            >
              {st}
            </button>
          ))}
        </div>

        {/* Severity & Search Controls */}
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by ID, entity, camera..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-clean pl-8 py-1 text-xs w-56"
            />
          </div>

          <select
            value={filterSeverity}
            onChange={(e) => setFilterSeverity(e.target.value)}
            className="input-clean py-1 text-xs"
          >
            <option value="ALL">All Levels</option>
            <option value="CRITICAL">Priority</option>
            <option value="HIGH">Alert</option>
            <option value="MEDIUM">Notice</option>
            <option value="LOW">Info</option>
          </select>
        </div>
      </div>

      {/* Incidents Table */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500">
                <th className="py-3 px-4 font-semibold">Incident / Description</th>
                <th className="py-3 px-4 font-semibold">Target Entity</th>
                <th className="py-3 px-4 font-semibold">Operational Level</th>
                <th className="py-3 px-4 font-semibold">Primary Camera</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold">Timestamp</th>
                <th className="py-3 px-4 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-slate-500">
                    <ShieldAlert className="w-8 h-8 text-slate-300 mx-auto mb-2" />
                    <p className="font-medium text-slate-700">No active incidents matching filters.</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Operational breaches and watchlist hits will be listed here in real-time.
                    </p>
                  </td>
                </tr>
              ) : (
                filtered.map((inc) => {
                  const alertLevel = getAlertLevel(inc);
                  return (
                    <tr 
                      key={inc.id} 
                      onClick={() => navigate(`/incidents/${inc.id}`)}
                      className="hover:bg-slate-50/80 cursor-pointer transition-colors group"
                    >
                      <td className="py-3.5 px-4">
                        <div className="font-semibold text-slate-900 group-hover:text-blue-600 transition-colors font-mono">
                          {inc.id}
                        </div>
                        <div className="text-slate-500 text-xs truncate max-w-xs">{inc.title}</div>
                      </td>

                      <td className="py-3.5 px-4 text-slate-700 font-medium">
                        {inc.target_entity}
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 text-[10px] font-bold rounded border ${alertLevel.style}`}>
                          {alertLevel.label}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-600 font-mono text-[11px]">
                        <span className="flex items-center gap-1.5">
                          <Camera className="w-3.5 h-3.5 text-slate-400" />
                          <span>{inc.primary_camera}</span>
                        </span>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${
                          inc.status === 'NEW'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : inc.status === 'ACKNOWLEDGED'
                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                            : inc.status === 'INVESTIGATING'
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                        }`}>
                          {inc.status}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 text-slate-500 text-[11px] font-mono">
                        {inc.timestamp}
                      </td>

                      <td className="py-3.5 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {inc.status === 'NEW' && (
                            <button
                              onClick={(e) => handleQuickStatus(e, inc.id, 'ACKNOWLEDGED')}
                              className="px-2.5 py-1 rounded-md bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-[11px] font-medium transition-colors"
                            >
                              Ack
                            </button>
                          )}

                          {inc.status === 'ACKNOWLEDGED' && (
                            <button
                              onClick={(e) => handleQuickStatus(e, inc.id, 'INVESTIGATING')}
                              className="px-2.5 py-1 rounded-md bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-[11px] font-medium transition-colors"
                            >
                              Investigate
                            </button>
                          )}

                          {inc.status === 'INVESTIGATING' && (
                            <button
                              onClick={(e) => handleQuickStatus(e, inc.id, 'RESOLVED')}
                              className="px-2.5 py-1 rounded-md bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-[11px] font-medium transition-colors"
                            >
                              Resolve
                            </button>
                          )}

                          <button 
                            onClick={() => navigate(`/incidents/${inc.id}`)}
                            className="inline-flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium pl-1 group-hover:translate-x-0.5 transition-transform"
                          >
                            <span>Dossier</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
