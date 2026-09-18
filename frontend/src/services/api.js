// TEJAS API Client Service with Real Endpoints

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000/api';

function getAuthHeaders(extra = {}) {
  return { ...extra };
}

async function readApiJson(res, fallbackMessage) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.detail || data.error || data.message || fallbackMessage);
  }
  return data;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export const apiClient = {
  // ── Authentication Profile ──────────────────────────────
  async getCurrentUser() {
    return {
      username: 'open-operator',
      role: 'ADMIN',
      full_name: 'Duty Operator',
      is_active: true
    };
  },

  async getUsers() {
    try {
      const res = await fetch(`${BASE_URL}/auth/users`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("apiClient.getUsers failed:", e);
    }
    return [];
  },

  // ── Camera Endpoints & Lifecycle ─────────────────────────
  async getCameras() {
    try {
      const res = await fetch(`${BASE_URL}/cameras`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getCameras");
    }
    return null;
  },

  async probeCamera(sourceUrl, streamType = 'RTSP') {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/cameras/probe`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ 
          stream_url: sourceUrl, 
          source_url: sourceUrl, 
          stream_type: streamType 
        })
      });
      const data = await readApiJson(res, 'Camera probe failed');
      return {
        ...data,
        reachable: data.reachable !== undefined ? data.reachable : (data.connected === true || data.status === 'CONNECTED'),
        fps: data.fps || 0,
        resolution: data.resolution || '--',
        error: data.message || data.error || (data.connected === false ? 'Connection failed' : null)
      };
    } catch (e) {
      const isNetworkFailure = e instanceof TypeError || /failed to fetch|network/i.test(e.message || '');
      const message = e.name === 'AbortError'
        ? 'Backend probe timed out. Check that the API is running on port 8000.'
        : isNetworkFailure
        ? 'Backend API unreachable. Start the backend on http://127.0.0.1:8000, then test the stream again.'
        : (e.message || 'Backend API unreachable. Start the backend on port 8000 and try again.');
      return { reachable: false, error: message };
    }
  },

  async createCamera(cameraData) {
    const res = await fetch(`${BASE_URL}/cameras`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(cameraData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to create camera" }));
      throw new Error(err.detail || "Failed to create camera");
    }
    return await res.json();
  },

  async updateCamera(cameraId, cameraData) {
    const res = await fetch(`${BASE_URL}/cameras/${cameraId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(cameraData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to update camera" }));
      throw new Error(err.detail || "Failed to update camera");
    }
    return await res.json();
  },

  async deleteCamera(cameraId) {
    const res = await fetch(`${BASE_URL}/cameras/${cameraId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to delete camera" }));
      throw new Error(err.detail || "Failed to delete camera");
    }
    return await res.json();
  },

  async startCamera(cameraId) {
    const res = await fetch(`${BASE_URL}/cameras/${cameraId}/start`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Failed to start camera");
    return await res.json();
  },

  async stopCamera(cameraId) {
    const res = await fetch(`${BASE_URL}/cameras/${cameraId}/stop`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Failed to stop camera");
    return await res.json();
  },

  async restartCamera(cameraId) {
    const res = await fetch(`${BASE_URL}/cameras/${cameraId}/restart`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
    if (!res.ok) throw new Error("Failed to restart camera");
    return await res.json();
  },

  async testCamera(cameraId) {
    try {
      const res = await fetchWithTimeout(`${BASE_URL}/cameras/${cameraId}/test`, {
        method: 'POST',
        headers: getAuthHeaders()
      });
      const data = await readApiJson(res, 'Camera test failed');
      return {
        ...data,
        reachable: data.reachable !== undefined ? data.reachable : (data.connected === true || data.status === 'CONNECTED'),
        fps: data.fps || 0,
        resolution: data.resolution || '--',
        error: data.message || data.error || (data.connected === false ? 'Connection failed' : null)
      };
    } catch (e) {
      const isNetworkFailure = e instanceof TypeError || /failed to fetch|network/i.test(e.message || '');
      const message = e.name === 'AbortError'
        ? 'Backend camera test timed out.'
        : isNetworkFailure
        ? 'Backend API unreachable. Start the backend on http://127.0.0.1:8000.'
        : (e.message || 'Backend API unreachable');
      return { reachable: false, fps: 0, resolution: '--', error: message };
    }
  },

  // ── Zones Endpoints ─────────────────────────────────────
  async getZones() {
    try {
      const res = await fetch(`${BASE_URL}/zones`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getZones");
    }
    return [];
  },

  async getZone(zoneId) {
    try {
      const res = await fetch(`${BASE_URL}/zones/${zoneId}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getZone");
    }
    return null;
  },

  async getZonesByCamera(cameraCode) {
    try {
      const res = await fetch(`${BASE_URL}/zones?camera_code=${encodeURIComponent(cameraCode)}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getZonesByCamera");
    }
    return [];
  },

  async createZone(zoneData) {
    const res = await fetch(`${BASE_URL}/zones`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(zoneData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to create zone" }));
      throw new Error(err.detail || "Failed to create zone");
    }
    return await res.json();
  },

  async updateZone(zoneId, zoneData) {
    const res = await fetch(`${BASE_URL}/zones/${zoneId}`, {
      method: 'PUT',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(zoneData)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to update zone" }));
      throw new Error(err.detail || "Failed to update zone");
    }
    return await res.json();
  },

  async deleteZone(zoneId) {
    const res = await fetch(`${BASE_URL}/zones/${zoneId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Failed to delete zone" }));
      throw new Error(err.detail || "Failed to delete zone");
    }
    return await res.json();
  },

  // ── ANPR Endpoints ───────────────────────────────────────
  async restorePlate(plateNumber, intensity = 0.75) {
    try {
      const res = await fetch(`${BASE_URL}/anpr/restore`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ plate_number: plateNumber, intensity })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for restorePlate");
    }
    return null;
  },

  // ── Events & Incidents ──────────────────────────────────
  async ingestEvent(eventData) {
    try {
      const res = await fetch(`${BASE_URL}/events`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(eventData)
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for ingestEvent");
    }
    return null;
  },

  async getEvents(limit = 40) {
    try {
      const res = await fetch(`${BASE_URL}/events?limit=${limit}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getEvents");
    }
    return [];
  },

  async getAlerts() {
    try {
      const res = await fetch(`${BASE_URL}/alerts`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getAlerts");
    }
    return [];
  },

  async getIncidents(status = null, severity = null) {
    try {
      const params = new URLSearchParams();
      if (status && status !== 'ALL') params.append('status', status);
      if (severity && severity !== 'ALL') params.append('severity', severity);
      const url = `${BASE_URL}/incidents${params.toString() ? '?' + params.toString() : ''}`;
      const res = await fetch(url, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getIncidents");
    }
    return [];
  },

  async getIncidentDetail(incidentId) {
    try {
      const res = await fetch(`${BASE_URL}/incidents/${incidentId}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getIncidentDetail");
    }
    return null;
  },

  async updateIncidentStatus(incidentId, status, user = "Duty Operator", resolutionNotes = null, comment = null) {
    try {
      const res = await fetch(`${BASE_URL}/incidents/${incidentId}/action`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ 
          status, 
          user, 
          resolution_notes: resolutionNotes,
          comment 
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for updateIncidentStatus");
    }
    return null;
  },

  async addIncidentNote(incidentId, note, user = "Duty Operator") {
    try {
      const res = await fetch(`${BASE_URL}/incidents/${incidentId}/notes`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ note, user })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for addIncidentNote");
    }
    return null;
  },

  async triggerTestIncident(payload = {}) {
    try {
      const res = await fetch(`${BASE_URL}/incidents/test-trigger`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for triggerTestIncident");
    }
    return null;
  },

  // ── Global Tracking & Re-ID ─────────────────────────────
  async getGlobalTracks() {
    try {
      const res = await fetch(`${BASE_URL}/tracking/global-tracks`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getGlobalTracks");
    }
    return [];
  },

  async getGlobalTrackDetail(trackId) {
    try {
      const res = await fetch(`${BASE_URL}/tracking/global-tracks/${trackId}`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getGlobalTrackDetail");
    }
    return null;
  },

  async getTrackingConfig() {
    try {
      const res = await fetch(`${BASE_URL}/tracking/config`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getTrackingConfig");
    }
    return { similarity_threshold: 0.72, max_transit_seconds: 180.0 };
  },

  async updateTrackingConfig(similarityThreshold, maxTransitSeconds) {
    try {
      const res = await fetch(`${BASE_URL}/tracking/config`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          similarity_threshold: similarityThreshold,
          max_transit_seconds: maxTransitSeconds
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for updateTrackingConfig");
    }
    return null;
  },

  async getTopology() {
    try {
      const res = await fetch(`${BASE_URL}/tracking/topology`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getTopology");
    }
    return { registered_cameras: [], corridors: [] };
  },

  async addCorridor(fromCam, toCam, minTransit = 5.0, maxTransit = 180.0) {
    try {
      const res = await fetch(`${BASE_URL}/tracking/topology/corridor`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          from_camera: fromCam,
          to_camera: toCam,
          min_transit_seconds: minTransit,
          max_transit_seconds: maxTransit
        })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for addCorridor");
    }
    return null;
  },

  async simulateTransit(payload) {
    try {
      const res = await fetch(`${BASE_URL}/tracking/simulate-transit`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for simulateTransit");
    }
    return null;
  },

  // ── Face Recognition Subsystem APIs ───────────────────────
  async getFaceConfig() {
    try {
      const res = await fetch(`${BASE_URL}/face/config`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getFaceConfig");
    }
    return { enabled: true, similarity_threshold: 0.40, min_quality_score: 0.35 };
  },

  async updateFaceConfig(payload) {
    try {
      const res = await fetch(`${BASE_URL}/face/config`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for updateFaceConfig");
    }
    return null;
  },

  async getEnrolledFaces(category = null) {
    try {
      const url = category && category !== 'ALL' 
        ? `${BASE_URL}/face/enrolled?category=${encodeURIComponent(category)}`
        : `${BASE_URL}/face/enrolled`;
      const res = await fetch(url, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getEnrolledFaces");
    }
    return [];
  },

  async enrollFace(payload) {
    const res = await fetch(`${BASE_URL}/face/enrolled`, {
      method: 'POST',
      headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: "Enrollment failed" }));
      throw new Error(err.detail || "Enrollment failed");
    }
    return await res.json();
  },

  async deleteEnrolledFace(faceId, user = 'Duty Operator') {
    try {
      const res = await fetch(`${BASE_URL}/face/enrolled/${faceId}?user=${encodeURIComponent(user)}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for deleteEnrolledFace");
    }
    return null;
  },

  async testFaceRecognition(payload) {
    try {
      const res = await fetch(`${BASE_URL}/face/recognize`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(payload)
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for testFaceRecognition");
    }
    return null;
  },

  // ── Watchlist Endpoints ───────────────────────────────────
  async getWatchlist() {
    try {
      const res = await fetch(`${BASE_URL}/watchlist`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getWatchlist");
    }
    return [];
  },

  async addWatchlistEntry(entry) {
    try {
      const res = await fetch(`${BASE_URL}/watchlist`, {
        method: 'POST',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify(entry)
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for addWatchlistEntry");
    }
    return null;
  },

  async deleteWatchlistEntry(id) {
    try {
      const res = await fetch(`${BASE_URL}/watchlist/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for deleteWatchlistEntry");
    }
    return null;
  },

  // ── Analytics ────────────────────────────────────────────
  async getAnalyticsSummary() {
    try {
      const res = await fetch(`${BASE_URL}/analytics/summary`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getAnalyticsSummary");
    }
    return null;
  },

  async getHourlyAnalytics() {
    try {
      const res = await fetch(`${BASE_URL}/analytics/hourly`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getHourlyAnalytics");
    }
    return [];
  },

  async getCameraHotspots() {
    try {
      const res = await fetch(`${BASE_URL}/analytics/hotspots`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getCameraHotspots");
    }
    return [];
  },

  // ── Operational Threat Rules ─────────────────────────────
  async getThreatRules() {
    try {
      const res = await fetch(`${BASE_URL}/threat-rules`, {
        headers: getAuthHeaders()
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for getThreatRules");
    }
    return [];
  },

  async updateThreatRule(ruleId, weight, enabled = true) {
    try {
      const res = await fetch(`${BASE_URL}/threat-rules/${ruleId}`, {
        method: 'PUT',
        headers: getAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ weight, enabled })
      });
      if (res.ok) return await res.json();
    } catch (e) {
      console.warn("Backend API unavailable for updateThreatRule");
    }
    return null;
  }
};
