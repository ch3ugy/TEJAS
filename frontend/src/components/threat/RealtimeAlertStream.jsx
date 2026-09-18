import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, ArrowRight, Clock, CheckCircle2 } from 'lucide-react';

export default function RealtimeAlertStream({ alerts = [] }) {
  const navigate = useNavigate();

  const getSeverityStyle = (sev) => {
    const s = (sev || '').toUpperCase();
    switch (s) {
      case 'PRIORITY':
      case 'CRITICAL':
        return { badge: 'bg-red-50 text-red-700 border-red-200', border: 'border-l-red-600' };
      case 'ALERT':
      case 'HIGH':
        return { badge: 'bg-orange-50 text-orange-700 border-orange-200', border: 'border-l-orange-500' };
      case 'NOTICE':
      case 'MEDIUM':
        return { badge: 'bg-amber-50 text-amber-700 border-amber-200', border: 'border-l-amber-500' };
      default:
        return { badge: 'bg-slate-50 text-slate-700 border-slate-200', border: 'border-l-slate-400' };
    }
  };

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-slate-600" />
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
            Operational Alerts
          </h3>
        </div>
        <span className="text-[11px] font-medium text-slate-500">
          Live Stream
        </span>
      </div>

      <div className="space-y-2.5 overflow-y-auto max-h-[340px] pr-1 flex-1">
        {alerts && alerts.length > 0 ? (
          alerts.map((alt) => {
            const style = getSeverityStyle(alt.severity);
            const targetId = alt.incident_id || alt.incidentId;

            return (
              <div
                key={alt.id}
                onClick={() => {
                  if (targetId) navigate(`/incidents/${targetId}`);
                  else navigate('/incidents');
                }}
                className={`p-3 rounded-lg bg-slate-50/70 border border-slate-200 border-l-4 ${style.border} hover:bg-slate-100/80 cursor-pointer transition-colors group`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className={`px-2 py-0.5 text-[10px] font-semibold rounded border ${style.badge}`}>
                    {alt.severity || 'INFO'}
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-slate-500">
                    <Clock className="w-3 h-3 text-slate-400" />
                    <span>{alt.timestamp || 'Just now'}</span>
                  </div>
                </div>

                <div className="font-semibold text-xs text-slate-900 group-hover:text-blue-600 transition-colors">
                  {alt.title}
                </div>

                {alt.message && (
                  <div className="text-xs text-slate-600 line-clamp-2 mt-0.5">
                    {alt.message}
                  </div>
                )}

                <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500 pt-1.5 border-t border-slate-200/60">
                  <span className="font-mono text-slate-600">{alt.camera || 'CAM-00'}</span>
                  <span className="flex items-center gap-1 text-blue-600 font-medium group-hover:underline">
                    View <ArrowRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </div>
              </div>
            );
          })
        ) : (
          <div className="text-center py-12 text-slate-400">
            <CheckCircle2 className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-500">No active alerts</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Continuous perimeter monitoring active</p>
          </div>
        )}
      </div>
    </div>
  );
}
