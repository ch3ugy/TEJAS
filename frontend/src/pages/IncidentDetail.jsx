import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  AlertTriangle, 
  Clock, 
  Camera, 
  User, 
  Check, 
  Send, 
  ShieldAlert, 
  Download, 
  Car, 
  FileText, 
  RefreshCw, 
  CheckCircle2, 
  XCircle, 
  Activity 
} from 'lucide-react';
import { apiClient } from '../services/api';
import { wsService } from '../services/websocket';

export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const [operatorNote, setOperatorNote] = useState('');
  const [operatorName, setOperatorName] = useState('Duty Operator');
  const [isResolveModalOpen, setIsResolveModalOpen] = useState(false);
  const [resolutionInput, setResolutionInput] = useState('');
  const [selectedEvidence, setSelectedEvidence] = useState(null);

  const fetchIncidentDetail = async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await apiClient.getIncidentDetail(id);
      if (data) {
        setIncident(data);
        if (data.evidence && data.evidence.length > 0) {
          setSelectedEvidence(data.evidence[0]);
        }
      } else {
        setError(`Incident ${id} was not found in the registry.`);
      }
    } catch (err) {
      console.error('Error fetching incident detail:', err);
      setError('Failed to connect to surveillance registry.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIncidentDetail();

    const unsubscribe = wsService.subscribe((msg) => {
      if ((msg.type === 'INCIDENT_UPDATED' || msg.type === 'NEW_INCIDENT') && msg.data?.id === id) {
        fetchIncidentDetail();
        setFeedbackMsg(`Updated by ${msg.data?.user || 'System'}`);
        setTimeout(() => setFeedbackMsg(''), 4000);
      }
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [id]);

  const handleStatusTransition = async (targetStatus, resolutionNotes = null) => {
    if (!incident) return;
    try {
      setActionLoading(true);
      const res = await apiClient.updateIncidentStatus(
        incident.id,
        targetStatus,
        operatorName,
        resolutionNotes,
        `Status transitioned to ${targetStatus}`
      );
      if (res) {
        setFeedbackMsg(`Status transitioned to ${targetStatus}`);
        setIsResolveModalOpen(false);
        setResolutionInput('');
        await fetchIncidentDetail();
      } else {
        setFeedbackMsg(`Failed to transition status to ${targetStatus}`);
      }
    } catch (err) {
      console.error('Error updating status:', err);
      setFeedbackMsg('Error updating status.');
    } finally {
      setActionLoading(false);
      setTimeout(() => setFeedbackMsg(''), 4500);
    }
  };

  const handleAddRemark = async (e) => {
    e?.preventDefault();
    if (!operatorNote.trim() || !incident) return;
    try {
      setActionLoading(true);
      const res = await apiClient.addIncidentNote(incident.id, operatorNote.trim(), operatorName);
      if (res) {
        setFeedbackMsg('Operator note recorded.');
        setOperatorNote('');
        await fetchIncidentDetail();
      } else {
        setFeedbackMsg('Failed to record note.');
      }
    } catch (err) {
      console.error('Error adding remark:', err);
      setFeedbackMsg('Error submitting note.');
    } finally {
      setActionLoading(false);
      setTimeout(() => setFeedbackMsg(''), 4000);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] space-y-3">
        <RefreshCw className="w-8 h-8 text-blue-600 animate-spin" />
        <span className="text-xs text-slate-500 font-medium">
          Retrieving Incident Dossier [{id}]...
        </span>
      </div>
    );
  }

  if (error || !incident) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <button
          onClick={() => navigate('/incidents')}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Incidents</span>
        </button>
        <div className="bg-white p-8 rounded-lg border border-red-200 shadow-sm text-center space-y-3">
          <AlertTriangle className="w-10 h-10 text-red-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-900">Incident Unavailable</h2>
          <p className="text-xs text-slate-500">{error || 'Unknown error'}</p>
          <button
            onClick={fetchIncidentDetail}
            className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium rounded-md inline-flex items-center gap-1.5 mt-2 transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry Query</span>
          </button>
        </div>
      </div>
    );
  }

  const getAlertLevel = (inc) => {
    const sev = (inc.severity || '').toUpperCase();
    if (sev === 'CRITICAL' || inc.threat_score >= 80) return { label: 'PRIORITY', style: 'bg-red-50 text-red-700 border-red-200' };
    if (sev === 'HIGH' || inc.threat_score >= 60) return { label: 'ALERT', style: 'bg-orange-50 text-orange-700 border-orange-200' };
    if (sev === 'MEDIUM' || inc.threat_score >= 30) return { label: 'NOTICE', style: 'bg-amber-50 text-amber-700 border-amber-200' };
    return { label: 'INFO', style: 'bg-slate-100 text-slate-700 border-slate-200' };
  };

  const alertBadge = getAlertLevel(incident);
  const evidenceItems = incident.evidence || [];
  const auditLogs = incident.audit_logs || [];
  const triggeringEvents = incident.triggering_events || [];

  return (
    <div className="space-y-5">
      {/* Back button & Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          onClick={() => navigate('/incidents')}
          className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-700 font-medium transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Back to Incidents</span>
        </button>

        <div className="flex items-center gap-3">
          {feedbackMsg && (
            <div className="px-3 py-1 rounded-md bg-emerald-50 border border-emerald-200 text-emerald-700 text-xs font-medium">
              {feedbackMsg}
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-slate-500 bg-white px-2.5 py-1 rounded-md border border-slate-200 shadow-sm">
            <span>Operator:</span>
            <select
              value={operatorName}
              onChange={(e) => setOperatorName(e.target.value)}
              className="input-clean py-0.5 text-xs"
            >
              <option value="Duty Operator">Duty Operator</option>
              <option value="Lead Analyst">Lead Analyst</option>
              <option value="Commander Rao">Commander Rao</option>
            </select>
          </div>

          <button
            onClick={fetchIncidentDetail}
            className="p-1.5 rounded-md bg-white hover:bg-slate-50 text-slate-600 border border-slate-200 shadow-sm transition-colors"
            title="Refresh Dossier"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${actionLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Primary Incident Header Card */}
      <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-800">
              {incident.id}
            </span>
            <span className={`px-2 py-0.5 text-xs font-bold rounded border ${alertBadge.style}`}>
              {alertBadge.label}
            </span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded border ${
              incident.status === 'NEW'
                ? 'bg-red-50 text-red-700 border-red-200'
                : incident.status === 'ACKNOWLEDGED'
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : incident.status === 'INVESTIGATING'
                ? 'bg-blue-50 text-blue-700 border-blue-200'
                : 'bg-emerald-50 text-emerald-700 border-emerald-200'
            }`}>
              STATUS: {incident.status}
            </span>
            {incident.affected_track_id && (
              <span className="px-2 py-0.5 text-xs font-mono rounded bg-slate-100 text-slate-600 border border-slate-200">
                Track: {incident.affected_track_id}
              </span>
            )}
          </div>

          <h1 className="text-xl font-bold text-slate-900 mt-2">
            {incident.title}
          </h1>

          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-500 mt-1.5">
            <span>Camera: <strong className="text-slate-800 font-medium">{incident.primary_camera}</strong></span>
            <span>•</span>
            <span>Target: <strong className="text-slate-800 font-medium">{incident.target_entity}</strong></span>
            <span>•</span>
            <span>Logged: <strong className="text-slate-700 font-medium font-mono">{incident.timestamp}</strong></span>
          </div>

          {/* ANPR Match Banner if available */}
          {incident.anpr_data && incident.anpr_data.license_plate && (
            <div className="mt-3 inline-flex items-center gap-2.5 px-3 py-1.5 rounded-md bg-red-50 border border-red-200 text-xs">
              <Car className="w-4 h-4 text-red-600" />
              <span className="text-red-900 font-medium">Vehicle Registration:</span>
              <strong className="text-slate-900 font-mono font-bold tracking-wider">
                {incident.anpr_data.license_plate}
              </strong>
              {incident.anpr_data.watchlist_status && (
                <span className="px-1.5 py-0.5 rounded text-[10px] bg-red-100 text-red-800 font-bold">
                  {incident.anpr_data.watchlist_status}
                </span>
              )}
            </div>
          )}

          {/* Resolution Summary Banner if resolved */}
          {incident.status === 'RESOLVED' && incident.resolution_notes && (
            <div className="mt-3 p-3 rounded-md bg-emerald-50 border border-emerald-200 text-xs">
              <span className="text-emerald-800 font-bold">RESOLUTION REPORT:</span>
              <p className="text-emerald-900 mt-0.5">{incident.resolution_notes}</p>
            </div>
          )}
        </div>

        {/* Tactical Lifecycle Operator Action Bar */}
        <div className="flex flex-wrap items-center gap-2">
          {incident.status === 'NEW' && (
            <button
              disabled={actionLoading}
              onClick={() => handleStatusTransition('ACKNOWLEDGED')}
              className="px-3.5 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Acknowledge</span>
            </button>
          )}

          {incident.status !== 'RESOLVED' && (
            <>
              <button
                disabled={actionLoading}
                onClick={() => handleStatusTransition('INVESTIGATING')}
                className={`px-3.5 py-1.5 rounded-md text-xs font-semibold transition-colors flex items-center gap-1.5 ${
                  incident.status === 'INVESTIGATING'
                    ? 'bg-blue-50 text-blue-700 border border-blue-200 cursor-default'
                    : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                }`}
              >
                <Activity className="w-3.5 h-3.5" />
                <span>{incident.status === 'INVESTIGATING' ? 'Under Investigation' : 'Investigate'}</span>
              </button>

              <button
                disabled={actionLoading}
                onClick={() => handleStatusTransition('ESCALATED')}
                className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors flex items-center gap-1.5"
              >
                <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                <span>Escalate</span>
              </button>

              <button
                disabled={actionLoading}
                onClick={() => setIsResolveModalOpen(true)}
                className="px-3.5 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold shadow-sm transition-colors flex items-center gap-1.5"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Mark Resolved</span>
              </button>
            </>
          )}

          {incident.status === 'RESOLVED' && (
            <button
              disabled={actionLoading}
              onClick={() => handleStatusTransition('INVESTIGATING')}
              className="px-3.5 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium transition-colors"
            >
              Re-Open
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* Left Column: Evidence Dossier & Triggering Events */}
        <div className="lg:col-span-7 space-y-4">
          {/* Primary Evidence Viewer */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Camera className="w-4 h-4 text-blue-600" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Captured Evidence Artifacts
                </h2>
              </div>
              <span className="text-xs text-slate-400">
                {evidenceItems.length} artifact{evidenceItems.length === 1 ? '' : 's'}
              </span>
            </div>

            {selectedEvidence ? (
              <div className="space-y-3">
                <div className="relative aspect-video bg-slate-900 rounded-lg border border-slate-800 overflow-hidden flex items-center justify-center">
                  {selectedEvidence.snapshot_base64 ? (
                    <img
                      src={selectedEvidence.snapshot_base64.startsWith('data:') 
                        ? selectedEvidence.snapshot_base64 
                        : `data:image/jpeg;base64,${selectedEvidence.snapshot_base64}`}
                      alt="Evidence"
                      className="w-full h-full object-contain"
                    />
                  ) : selectedEvidence.file_path ? (
                    <img
                      src={`http://127.0.0.1:8000/api/incidents/${incident.id}/evidence/${selectedEvidence.id}/file`}
                      alt="Evidence Snapshot"
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = '';
                      }}
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center text-slate-500 space-y-2">
                      <Camera className="w-10 h-10 text-slate-600" />
                      <span className="text-xs">Digital Evidence Artifact Stored</span>
                    </div>
                  )}

                  {/* Sensor Overlay */}
                  <div className="absolute top-3 left-3 text-[10px] font-mono text-slate-200 bg-slate-900/90 px-2.5 py-1 rounded border border-slate-700">
                    SENSOR: {selectedEvidence.camera_id || incident.primary_camera} • {selectedEvidence.timestamp || incident.timestamp}
                  </div>

                  {selectedEvidence.file_path && (
                    <a
                      href={`http://127.0.0.1:8000/api/incidents/${incident.id}/evidence/${selectedEvidence.id}/file`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="absolute bottom-3 right-3 px-2.5 py-1 bg-slate-900/90 hover:bg-slate-800 text-white rounded text-[10px] font-medium flex items-center gap-1 border border-slate-700"
                    >
                      <Download className="w-3 h-3" />
                      <span>Download</span>
                    </a>
                  )}
                </div>

                {/* Evidence Artifact Selector Row */}
                {evidenceItems.length > 1 && (
                  <div className="flex items-center gap-2 overflow-x-auto pb-1">
                    {evidenceItems.map((ev, idx) => (
                      <button
                        key={ev.id || idx}
                        onClick={() => setSelectedEvidence(ev)}
                        className={`px-3 py-1.5 rounded-md text-xs whitespace-nowrap transition-colors border ${
                          selectedEvidence?.id === ev.id
                            ? 'bg-blue-50 text-blue-700 border-blue-300 font-semibold'
                            : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                        }`}
                      >
                        Artifact #{idx + 1}: {ev.evidence_type} ({ev.camera_id || 'CAM'})
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="aspect-video bg-slate-50 rounded-lg border border-dashed border-slate-300 flex flex-col items-center justify-center p-6 text-center">
                <Camera className="w-10 h-10 text-slate-400 mb-2" />
                <span className="text-xs font-medium text-slate-600">No physical evidence recorded</span>
                <p className="text-[11px] text-slate-400 mt-1 max-w-sm">
                  Snapshots and crops will appear here when captured automatically by the pipeline.
                </p>
              </div>
            )}
          </div>

          {/* Triggering Events & Chronology */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Triggering Events & Chronology
                </h3>
              </div>
              <span className="text-xs text-slate-400">
                {triggeringEvents.length || incident.timeline?.length || 0} events
              </span>
            </div>

            <div className="space-y-3 relative pl-5">
              <div className="absolute left-2 top-2 bottom-2 w-0.5 bg-slate-200" />

              {triggeringEvents.length > 0 ? (
                triggeringEvents.map((event, idx) => (
                  <div key={event.id || idx} className="relative">
                    <div className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full bg-blue-600 border-2 border-white ring-1 ring-slate-300" />
                    <div className="flex items-center justify-between text-xs text-slate-500 font-mono mb-1">
                      <span className="font-semibold text-slate-800">{event.camera_id}</span>
                      <span>{event.timestamp}</span>
                    </div>
                    <div className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-semibold text-blue-700 text-xs">
                          {event.event_type}
                        </span>
                        {event.confidence && (
                          <span className="text-[11px] text-slate-500 font-mono">
                            Conf: {(event.confidence * 100).toFixed(1)}%
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        Entity: {event.entity_id || 'Unknown'} • Location: {event.location || 'Perimeter'}
                      </div>
                    </div>
                  </div>
                ))
              ) : incident.timeline && incident.timeline.length > 0 ? (
                incident.timeline.map((item, idx) => (
                  <div key={idx} className="relative">
                    <div className="absolute -left-5 top-1.5 w-2.5 h-2.5 rounded-full bg-blue-600 border-2 border-white ring-1 ring-slate-300" />
                    <div className="flex items-center justify-between text-xs text-slate-500 font-mono mb-1">
                      <span className="font-semibold text-slate-800">{item.camera || incident.primary_camera}</span>
                      <span>{item.time || item.timestamp}</span>
                    </div>
                    <div className="text-xs text-slate-700 bg-slate-50 p-2.5 rounded-lg border border-slate-200">
                      {item.event || item.description || JSON.stringify(item)}
                    </div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 py-3">
                  No triggering event chronology attached.
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right Column: Threat Factors & Audit Logs */}
        <div className="lg:col-span-5 space-y-4">
          {/* Operational Threat Factors Breakdown */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 mb-3">
              <div>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Operational Rule Evaluation
                </h3>
                <span className="text-xs text-slate-400">Pipeline trigger conditions</span>
              </div>
              <span className={`px-2 py-0.5 text-xs font-bold rounded border ${alertBadge.style}`}>
                {alertBadge.label}
              </span>
            </div>

            <div className="space-y-2">
              {incident.threat_factors && incident.threat_factors.length > 0 ? (
                incident.threat_factors.map((factor, idx) => (
                  <div key={idx} className="p-2.5 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="flex items-center justify-between text-xs font-semibold text-slate-800 mb-0.5">
                      <span>{factor.rule || factor.name || 'Perimeter Condition'}</span>
                      <span className="text-[11px] font-mono text-blue-600">TRIGGERED</span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      {factor.desc || factor.description || 'Threshold condition satisfied during active surveillance.'}
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-200 text-xs text-slate-500">
                  Perimeter rule triggered on camera {incident.primary_camera}.
                </div>
              )}
            </div>
          </div>

          {/* Audit Logs & Remark Composer */}
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-blue-600" />
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">
                  Chain of Custody & Audit Trail
                </h3>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {auditLogs.length} logs
              </span>
            </div>

            <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1">
              {auditLogs.length > 0 ? (
                auditLogs.map((log, idx) => (
                  <div key={log.id || idx} className="p-2.5 rounded bg-slate-50 border border-slate-200 text-xs">
                    <div className="flex items-center justify-between text-slate-500 text-[11px] mb-1">
                      <span className="font-semibold text-slate-800">{log.user || 'System'}</span>
                      <span className="font-mono text-[10px]">{log.timestamp || log.created_at || 'Just now'}</span>
                    </div>
                    <div className="text-slate-700">{log.action}</div>
                  </div>
                ))
              ) : (
                <div className="text-xs text-slate-400 py-3 text-center">
                  No operator audit actions recorded yet.
                </div>
              )}
            </div>

            {/* Operator Remark Composer */}
            <form onSubmit={handleAddRemark} className="pt-2 border-t border-slate-100 flex gap-2">
              <input
                type="text"
                value={operatorNote}
                onChange={(e) => setOperatorNote(e.target.value)}
                placeholder="Append official operator note..."
                className="input-clean flex-1 text-xs"
              />
              <button
                type="submit"
                disabled={actionLoading || !operatorNote.trim()}
                className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-md text-xs font-semibold shadow-sm flex items-center gap-1 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Post</span>
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Resolution Dialog Modal */}
      {isResolveModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white max-w-lg w-full p-6 rounded-lg border border-slate-200 shadow-xl space-y-4 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100">
              <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                Resolve Incident [{incident.id}]
              </h3>
              <button
                onClick={() => setIsResolveModalOpen(false)}
                className="text-slate-400 hover:text-slate-600"
              >
                <XCircle className="w-4 h-4" />
              </button>
            </div>

            <p className="text-slate-600">
              Provide formal resolution remarks to close this security incident. The report will be appended to the immutable chain of custody.
            </p>

            <textarea
              rows={4}
              value={resolutionInput}
              onChange={(e) => setResolutionInput(e.target.value)}
              placeholder="e.g. Area verified by security patrol. Personnel identified and verified with appropriate authorization. False alarm cleared."
              className="input-clean w-full"
            />

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setIsResolveModalOpen(false)}
                className="px-3 py-1.5 rounded-md border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 font-medium"
              >
                Cancel
              </button>
              <button
                disabled={actionLoading || !resolutionInput.trim()}
                onClick={() => handleStatusTransition('RESOLVED', resolutionInput.trim())}
                className="px-4 py-1.5 rounded-md bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white font-semibold shadow-sm transition-colors"
              >
                Confirm Resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
