import React, { useState } from 'react';
import { ShieldAlert, Car, UserCheck, Package, CheckCircle2 } from 'lucide-react';
import { apiClient } from '../../services/api';

export default function ScenarioBar() {
  const [activeTrigger, setActiveTrigger] = useState(null);
  const [feedback, setFeedback] = useState('');

  const testProtocols = [
    {
      id: 'intrusion',
      label: '1. Restricted Perimeter Breach',
      desc: 'Dispatches real ZONE_INTRUSION event -> Level ALERT',
      icon: ShieldAlert,
      payload: { title: 'Test: Restricted Perimeter Breach', event_type: 'ZONE_INTRUSION', level: 'ALERT', camera_code: 'CAM-00' }
    },
    {
      id: 'watchlist_vehicle',
      label: '2. Watchlist Plate Intercept',
      desc: 'Dispatches WATCHLIST_PLATE_MATCH -> Level PRIORITY',
      icon: Car,
      payload: { title: 'Test: Watchlist Vehicle Intercept', event_type: 'WATCHLIST_PLATE_MATCH', level: 'PRIORITY', camera_code: 'CAM-00' }
    },
    {
      id: 'authorized_patrol',
      label: '3. Authorized Staff Verification',
      desc: 'Dispatches AUTHORIZED_FACE_VERIFIED -> Level INFO',
      icon: UserCheck,
      payload: { title: 'Test: Patrol Verified', event_type: 'AUTHORIZED_FACE_VERIFIED', level: 'INFO', camera_code: 'CAM-00' }
    },
    {
      id: 'loitering',
      label: '4. Critical Loitering Alert',
      desc: 'Dispatches LOITERING incident past dwell threshold -> Level ALERT',
      icon: Package,
      payload: { title: 'Test: Protracted Loitering', event_type: 'LOITERING', level: 'ALERT', camera_code: 'CAM-00' }
    }
  ];

  const handleTrigger = async (proto) => {
    setActiveTrigger(proto.id);
    setFeedback('Dispatching...');
    try {
      await apiClient.triggerTestIncident(proto.payload);
      setFeedback(`Dispatched: ${proto.label}`);
      setTimeout(() => setFeedback(''), 3000);
    } catch (e) {
      setFeedback('Failed to trigger');
    } finally {
      setActiveTrigger(null);
    }
  };

  return (
    <div className="tactical-card p-3 rounded-xl border border-[#1E2D48] mb-4 font-mono">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-400" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-200">
            Operational Protocol Field Tests
          </span>
        </div>
        {feedback && (
          <span className="text-[10px] text-cyan-400 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" />
            {feedback}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2 text-xs">
        {testProtocols.map((proto) => {
          const Icon = proto.icon;
          return (
            <button
              key={proto.id}
              onClick={() => handleTrigger(proto)}
              disabled={activeTrigger !== null}
              className="p-2 rounded-lg border text-left bg-[#0E1524] border-slate-800 hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all"
            >
              <div className="flex items-center gap-2 mb-1">
                <Icon className="w-3.5 h-3.5 text-cyan-400" />
                <span className="font-bold text-slate-200 text-[11px]">
                  {proto.label}
                </span>
              </div>
              <p className="text-[10px] text-slate-400 line-clamp-1">{proto.desc}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
