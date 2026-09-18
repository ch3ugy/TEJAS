import React from 'react';
import { GitCommit, Clock, CheckCircle2 } from 'lucide-react';

export default function EventTimeline({ incident = null, events = [] }) {
  let timelineItems = [];
  if (incident?.timeline && incident.timeline.length > 0) {
    timelineItems = incident.timeline.map(t => ({
      time: typeof t === 'string' ? '' : (t.time || t.timestamp || ''),
      camera: t.camera || t.camera_id || incident.primary_camera || 'CAM-00',
      event: typeof t === 'string' ? t : (t.event || t.description || JSON.stringify(t))
    }));
  } else if (events && events.length > 0) {
    timelineItems = events.slice(0, 6).map(e => ({
      time: e.timestamp ? (e.timestamp.length > 8 ? e.timestamp.substring(11, 19) : e.timestamp) : 'LIVE',
      camera: e.camera_id || 'CAM-00',
      event: `${e.event_type || 'DETECTION'} • Track #${e.track_id ?? e.entity_id ?? 'N/A'} (${e.object_type || 'Entity'})`
    }));
  }

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 shadow-sm flex flex-col h-full">
      <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
        <div className="flex items-center gap-2">
          <GitCommit className="w-4 h-4 text-slate-600" />
          <h3 className="text-xs font-semibold text-slate-900 uppercase tracking-wider">
            {incident ? 'Incident Timeline' : 'Operational Event Chronology'}
          </h3>
        </div>
        <span className="text-[11px] font-medium text-slate-500">
          Chronological
        </span>
      </div>

      <div className="relative pl-5 space-y-4 my-2 flex-1 overflow-y-auto max-h-[340px]">
        {timelineItems.length > 0 ? (
          <>
            {/* Neutral vertical line */}
            <div className="absolute left-2 top-2 bottom-2 w-px bg-slate-200" />

            {timelineItems.map((item, idx) => (
              <div key={idx} className="relative">
                {/* Dot marker */}
                <div className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white bg-blue-600 shadow-sm" />

                <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                  <span className="font-semibold text-slate-800 font-mono text-[11px]">{item.camera}</span>
                  <span className="text-[11px]">{item.time}</span>
                </div>

                <div className="text-xs p-2 rounded bg-slate-50 border border-slate-200 text-slate-700">
                  {item.event}
                </div>
              </div>
            ))}
          </>
        ) : (
          <div className="text-center py-12 text-slate-400">
            <Clock className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <p className="text-xs font-medium text-slate-500">No events logged yet</p>
            <p className="text-[11px] text-slate-400 mt-0.5">Telemetry log will populate as cameras process frames</p>
          </div>
        )}
      </div>
    </div>
  );
}
