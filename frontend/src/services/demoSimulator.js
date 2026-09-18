/**
 * TEJAS Phase 2 — demoSimulator.js
 * 
 * This module is ISOLATED. The simulation engine no longer runs automatically.
 * The `simulator` export is a no-op stub that satisfies existing imports
 * without injecting fake data into the production event stream.
 *
 * Dashboard/Surveillance/Settings pages now use real WebSocket events
 * from the backend (OPERATIONAL_EVENT type) via useSurveillanceStream.
 *
 * The real simulation and demo data has been moved to __demo__/demoSimulator.demo.js
 * for optional offline demo use only.
 */

const NOOP_STATE = {
  stage: 0,
  activeScenario: null,
  isRunning: false,
  entities: [],
  threatAssessment: {
    score: 0,
    severity: 'INFO',
    alert_level: 'INFO',
    breakdown: [],
    recommendation: 'System operating on real surveillance data.',
  },
  alerts: [],
  cameras: [],
  zones: [],
  incident: null,
  tick: 0,
  latestANPR: null,
};

class IsolatedSimulator {
  constructor() {
    this.listeners = new Set();
    // Auto-stopped: never calls setInterval
    console.info('[TEJAS] demoSimulator: ISOLATED (Phase 2 — real data mode)');
  }

  subscribe(callback) {
    // Immediately send a single no-op state, then do nothing
    try {
      callback(NOOP_STATE);
    } catch (_) {}
    return () => {}; // noop unsubscribe
  }

  getState() {
    return NOOP_STATE;
  }

  // Legacy method stubs (no-ops)
  start() {}
  pause() {}
  resume() {}
  reset() {}
  triggerScenario() {}
  updateRuleWeight() {}
}

export const simulator = new IsolatedSimulator();
