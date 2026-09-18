import React from 'react';
import { Camera, AlertCircle, Activity, Cpu } from 'lucide-react';

export default function KPIStatsRow({ 
  totalCameras = 1, 
  onlineCameras = 1, 
  activeIncidents = 0, 
  eventsToday = 0, 
  inferenceLatency = "28ms" 
}) {
  const stats = [
    {
      title: 'Active Cameras',
      value: `${onlineCameras} / ${totalCameras}`,
      subtext: onlineCameras === totalCameras ? 'All nodes online' : `${totalCameras - onlineCameras} offline`,
      icon: Camera,
      iconBg: 'bg-blue-50 text-blue-600',
    },
    {
      title: 'Active Incidents',
      value: activeIncidents,
      subtext: activeIncidents > 0 ? 'Requires attention' : 'Perimeter clear',
      icon: AlertCircle,
      iconBg: activeIncidents > 0 ? 'bg-red-50 text-red-600' : 'bg-emerald-50 text-emerald-600',
    },
    {
      title: 'Events Logged',
      value: eventsToday,
      subtext: 'Session telemetry active',
      icon: Activity,
      iconBg: 'bg-slate-100 text-slate-600',
    },
    {
      title: 'Inference Latency',
      value: inferenceLatency,
      subtext: 'Edge pipeline speed',
      icon: Cpu,
      iconBg: 'bg-emerald-50 text-emerald-600',
    }
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
      {stats.map((stat, i) => {
        const Icon = stat.icon;
        return (
          <div 
            key={i} 
            className="bg-white p-4 rounded-lg border border-slate-200 shadow-sm flex items-center justify-between"
          >
            <div>
              <div className="text-xs font-medium text-slate-500 mb-1">
                {stat.title}
              </div>
              <div className="text-2xl font-bold text-slate-900 tracking-tight">
                {stat.value}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {stat.subtext}
              </div>
            </div>

            <div className={`p-2.5 rounded-lg ${stat.iconBg}`}>
              <Icon className="w-5 h-5 shrink-0" />
            </div>
          </div>
        );
      })}
    </div>
  );
}
