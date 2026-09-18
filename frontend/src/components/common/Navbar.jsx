import React, { useState, useEffect } from 'react';
import { Shield, Bell, User, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import { authService } from '../../services/auth';

export default function Navbar({ 
  isConnected = true, 
  activeIncidentsCount = 0, 
  severity = 'INFO'
}) {
  const [timeStr, setTimeStr] = useState('');
  const [currentUser, setCurrentUser] = useState(authService.getUser());

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString('en-US', { hour12: false }) + ' IST');
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);

    const handleAuthChange = () => {
      setCurrentUser(authService.getUser());
    };
    window.addEventListener('tejas_auth_changed', handleAuthChange);

    return () => {
      clearInterval(interval);
      window.removeEventListener('tejas_auth_changed', handleAuthChange);
    };
  }, []);

  const getSeverityBadge = (sev) => {
    const norm = (sev || '').toUpperCase();
    if (norm === 'PRIORITY' || norm === 'CRITICAL') {
      return { bg: 'bg-red-50 text-red-700 border-red-200', dot: 'bg-red-600', label: 'Priority Alert' };
    }
    if (norm === 'ALERT' || norm === 'HIGH') {
      return { bg: 'bg-orange-50 text-orange-700 border-orange-200', dot: 'bg-orange-500', label: 'Operational Alert' };
    }
    if (norm === 'NOTICE' || norm === 'MEDIUM') {
      return { bg: 'bg-amber-50 text-amber-800 border-amber-200', dot: 'bg-amber-500', label: 'Notice' };
    }
    return { bg: 'bg-slate-50 text-slate-700 border-slate-200', dot: 'bg-emerald-500', label: 'Normal / Secure' };
  };

  const sevBadge = getSeverityBadge(severity);
  const roleName = (currentUser?.role || 'OPERATOR').toUpperCase();
  const displayName = currentUser?.full_name || currentUser?.username || 'Duty Operator';

  return (
    <header className="h-14 bg-white border-b border-slate-200 px-5 flex items-center justify-between z-30 sticky top-0 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
      {/* Brand */}
      <div className="flex items-center gap-3">
        <Link to="/dashboard" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-sm transition-transform group-hover:scale-105">
            <Shield className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-base tracking-tight text-slate-900 font-sans">TEJAS</span>
              <span className="text-[10px] uppercase tracking-wider font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                Surveillance Core
              </span>
            </div>
          </div>
        </Link>
      </div>

      {/* Operational Status (Calm, Informative) */}
      <div className="hidden md:flex items-center gap-4 text-xs">
        {/* Connection Status */}
        <div className="flex items-center gap-1.5 text-slate-600 font-medium">
          <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500'}`} />
          <span className="text-slate-500 text-[11px]">{isConnected ? 'System Connected' : 'Connecting Network...'}</span>
        </div>

        {/* Operational Status */}
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-xs font-medium ${sevBadge.bg}`}>
          <span className={`w-1.5 h-1.5 rounded-full ${sevBadge.dot}`} />
          <span>{sevBadge.label}</span>
        </div>

        {/* System Clock */}
        <div className="flex items-center gap-1.5 text-slate-500 text-[11px] font-mono pl-3 border-l border-slate-200">
          <Clock className="w-3.5 h-3.5 text-slate-400" />
          <span>{timeStr}</span>
        </div>
      </div>

      {/* Right Controls: Incidents & User Profile */}
      <div className="flex items-center gap-3">
        {/* Incidents Quick Link */}
        <Link
          to="/incidents"
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs font-medium text-slate-700 hover:bg-slate-100 border border-slate-200 transition-colors"
          title="Active Incidents"
        >
          <Bell className="w-3.5 h-3.5 text-slate-500" />
          <span className="hidden sm:inline text-slate-600">Incidents</span>
          {activeIncidentsCount > 0 ? (
            <span className="px-1.5 py-0.2 text-[10px] font-bold rounded-full bg-red-100 text-red-700 border border-red-200">
              {activeIncidentsCount}
            </span>
          ) : (
            <span className="text-[10px] text-slate-400">0</span>
          )}
        </Link>

        {/* User Identity */}
        <div className="flex items-center gap-2 pl-3 border-l border-slate-200">
          <div className="w-7 h-7 rounded-full bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-600 text-xs font-medium">
            <User className="w-3.5 h-3.5" />
          </div>
          <div className="hidden lg:block text-left text-xs leading-tight">
            <div className="font-semibold text-slate-800">{displayName}</div>
            <div className="text-[10px] text-slate-500">{roleName}</div>
          </div>
        </div>
      </div>
    </header>
  );
}
