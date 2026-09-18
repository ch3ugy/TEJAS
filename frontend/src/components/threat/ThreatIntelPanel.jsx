import React from 'react';
import { ShieldCheck, AlertTriangle, AlertCircle, Info, ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function ThreatIntelPanel({ activeStatus, latestIncident }) {
  const alertLevel = (activeStatus?.alert_level || latestIncident?.severity || 'INFO').toUpperCase();
  const entityName = activeStatus?.entity && activeStatus.entity !== 'MONITORING IDLE' 
    ? activeStatus.entity 
    : (latestIncident?.target_entity || 'No anomalous entity detected');
  const reason = activeStatus?.alert_reason || latestIncident?.title || 'Continuous perimeter monitoring active.';
  const camera = latestIncident?.primary_camera || 'CAM-00';

  const getLevelMeta = (lvl) => {
    switch (lvl) {
      case 'PRIORITY':
        return { 
          title: 'Priority Breach Action Required', 
          badge: 'bg-red-100 text-red-800 border-red-200', 
          bar: 'bg-red-600',
          icon: AlertCircle 
        };
      case 'ALERT':
        return { 
          title: 'Perimeter Operational Alert', 
          badge: 'bg-orange-100 text-orange-800 border-orange-200', 
          bar: 'bg-orange-500',
          icon: AlertTriangle 
        };
      case 'NOTICE':
        return { 
          title: 'Tactical Notice / Observation', 
          badge: 'bg-amber-100 text-amber-800 border-amber-200', 
          bar: 'bg-amber-500',
          icon: Info 
        };
      default:
        return { 
          title: 'Perimeter Secure — Monitoring', 
          badge: 'bg-emerald-100 text-emerald-800 border-emerald-200', 
          bar: 'bg-emerald-500',
          icon: ShieldCheck 
        };
    }
  };

  const meta = getLevelMeta(alertLevel);
  const Icon = meta.icon;

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-5 shadow-sm flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between pb-3 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className={`p-2 rounded-lg ${meta.badge}`}>
              <Icon className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-slate-900">{meta.title}</h3>
              <p className="text-xs text-slate-500">Operational Decision Engine</p>
            </div>
          </div>
          <span className={`px-2.5 py-1 text-xs font-semibold rounded-full border ${meta.badge}`}>
            {alertLevel}
          </span>
        </div>

        <div className="py-4 space-y-3 text-xs">
          <div>
            <span className="text-slate-500 font-medium block mb-0.5">Active Subject:</span>
            <span className="text-slate-900 font-semibold text-sm">{entityName}</span>
          </div>

          <div>
            <span className="text-slate-500 font-medium block mb-0.5">Operational Context:</span>
            <p className="text-slate-700 leading-relaxed">{reason}</p>
          </div>

          <div className="flex items-center gap-4 text-slate-600 pt-1">
            <span>Primary Sensor: <strong className="text-slate-900">{camera}</strong></span>
            <span>State: <strong className="text-slate-900">{activeStatus?.authorization_state || 'Grounded'}</strong></span>
          </div>
        </div>
      </div>

      <div className="pt-3 border-t border-slate-100 flex items-center justify-between text-xs">
        <span className="text-slate-500">Rule-based correlation active</span>
        {latestIncident?.id ? (
          <Link 
            to={`/incidents/${latestIncident.id}`}
            className="flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700"
          >
            <span>View Incident Dossier</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        ) : (
          <Link 
            to="/incidents"
            className="flex items-center gap-1 font-medium text-blue-600 hover:text-blue-700"
          >
            <span>Incident Log</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        )}
      </div>
    </div>
  );
}
