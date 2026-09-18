// TEJAS Mock Intelligence Data & Knowledge Base

export const CAMERAS = [
  {
    id: "CAM-01",
    code: "BOP-03",
    name: "Border Outpost 03 (North Perimeter)",
    location: "Sector A - Post 3",
    lat: 32.7266,
    lng: 74.8570,
    status: "ONLINE",
    fps: 30,
    resolution: "1920x1080",
    streamType: "RTSP",
    aiEnabled: true,
    activeThreats: 1,
    detectedCount: { people: 2, vehicles: 0 },
    zones: ["Restricted Zone Alpha", "Perimeter Fence"]
  },
  {
    id: "CAM-02",
    code: "BORDER-RD-12",
    name: "Patrol Road Checkpoint 12",
    location: "Sector A - Road Access",
    lat: 32.7289,
    lng: 74.8612,
    status: "ONLINE",
    fps: 30,
    resolution: "1920x1080",
    streamType: "RTSP",
    aiEnabled: true,
    activeThreats: 0,
    detectedCount: { people: 1, vehicles: 1 },
    zones: ["Transit Corridor", "Entry Gate"]
  },
  {
    id: "CAM-03",
    code: "BOP-04",
    name: "Border Outpost 04 (Ammunition Depot)",
    location: "Sector B - High Security",
    lat: 32.7315,
    lng: 74.8645,
    status: "ONLINE",
    fps: 28,
    resolution: "1920x1080",
    streamType: "RTSP",
    aiEnabled: true,
    activeThreats: 1,
    detectedCount: { people: 1, vehicles: 0 },
    zones: ["Sensitive Storage Zone", "Inner Perimeter"]
  },
  {
    id: "CAM-04",
    code: "RESTRICTED-Z01",
    name: "Restricted Zone Tactical Camera",
    location: "Sector B - Perimeter Gate 4",
    lat: 32.7340,
    lng: 74.8680,
    status: "ONLINE",
    fps: 30,
    resolution: "1920x1080",
    streamType: "RTSP",
    aiEnabled: true,
    activeThreats: 1,
    detectedCount: { people: 1, vehicles: 0 },
    zones: ["No-Go Zone Beta", "Virtual Tripwire"]
  },
  {
    id: "CAM-05",
    code: "GATE-01",
    name: "Main Entry Logistics Gate",
    location: "Sector C - Commercial Entry",
    lat: 32.7210,
    lng: 74.8510,
    status: "ONLINE",
    fps: 30,
    resolution: "1920x1080",
    streamType: "RTSP",
    aiEnabled: true,
    activeThreats: 0,
    detectedCount: { people: 3, vehicles: 2 },
    zones: ["ANPR Inspection Bay", "Public Approach"]
  },
  {
    id: "CAM-06",
    code: "WAREHOUSE-E",
    name: "Supply Depot Yard East",
    location: "Sector C - Logistics Depot",
    lat: 32.7245,
    lng: 74.8540,
    status: "ONLINE",
    fps: 25,
    resolution: "1280x720",
    streamType: "RTSP",
    aiEnabled: true,
    activeThreats: 0,
    detectedCount: { people: 0, vehicles: 1 },
    zones: ["Loading Bay", "Exit Corridor"]
  }
];

export const INITIAL_THREAT_RULES = [
  { id: "rule_restricted_intrusion", name: "Restricted-Zone Intrusion", weight: 30, category: "Spatial", enabled: true, desc: "Entity crosses marked virtual fence or no-entry polygon" },
  { id: "rule_movement_sensitive", name: "Movement Toward Sensitive Zone", weight: 20, category: "Kinematic", enabled: true, desc: "Trajectory vector points continuously toward high-security perimeter" },
  { id: "rule_watchlist_vehicle", name: "Watchlist Vehicle Detected", weight: 40, category: "Intelligence", enabled: true, desc: "ANPR plate match found in high-priority law enforcement watchlist" },
  { id: "rule_night_movement", name: "Night-time Movement", weight: 15, category: "Temporal", enabled: true, desc: "Movement detected during designated blackout curfew hours (21:00 - 05:00)" },
  { id: "rule_loitering", name: "Loitering Detection", weight: 15, category: "Behavioral", enabled: true, desc: "Entity dwell time exceeds threshold (120s) without linear transit" },
  { id: "rule_unverified_identity", name: "Unknown / Unverified Identity", weight: 10, category: "Identity", enabled: true, desc: "Facial feature does not match active authorized personnel database" },
  { id: "rule_authorized_personnel", name: "Authorized Personnel Verification", weight: -30, category: "Override", enabled: true, desc: "Biometric or RFID credential successfully confirms friendly authority" }
];

export const WATCHLIST = [
  {
    id: "WL-001",
    type: "VEHICLE",
    identifier: "MP09AB1234",
    title: "Black Scorpio SUV",
    threatLevel: "CRITICAL",
    category: "Suspected Reconnaissance",
    dateAdded: "2026-08-14",
    notes: "Reported casing border outpost perimeters during night hours. High interception priority.",
    lastSeen: "Border Rd Checkpoint 12 (10:14 AM)",
    status: "ACTIVE_ALERT"
  },
  {
    id: "WL-002",
    type: "VEHICLE",
    identifier: "DL01CA4092",
    title: "White Bolero Pickup",
    threatLevel: "HIGH",
    category: "Contraband Suspect",
    dateAdded: "2026-08-28",
    notes: "Repeated unauthorized night entries reported near Sector B culvert.",
    lastSeen: "Gate 01 Logistics (Yesterday)",
    status: "FLAGGED"
  },
  {
    id: "WL-003",
    type: "PERSON",
    identifier: "SUSPECT-994",
    title: "Unidentified Male (Cross-border Courier)",
    threatLevel: "CRITICAL",
    category: "Border Infiltration",
    dateAdded: "2026-09-01",
    notes: "Associated with night wire breach attempts near BOP-03. Distinctive dark tactical jacket.",
    lastSeen: "Sector A (Today 10:21 AM)",
    status: "TRACKING_ACTIVE"
  },
  {
    id: "WL-004",
    type: "VEHICLE",
    identifier: "HR26DQ8991",
    title: "Grey Innova Crysta",
    threatLevel: "MEDIUM",
    category: "Suspicious Loitering",
    dateAdded: "2026-09-10",
    notes: "Excessive dwell time recorded outside sensitive depot boundary.",
    lastSeen: "Sector C Yard (2 days ago)",
    status: "MONITORED"
  }
];

export const CROSS_CAMERA_TRACKING_SAMPLE = {
  entityId: "PERSON #27",
  alias: "Subject-Delta-27",
  classification: "Male / Dark Jacket / Backpack",
  status: "ACTIVE_INTRUSION",
  overallConfidence: 0.94,
  currentThreatScore: 82,
  handoffs: [
    {
      step: 1,
      cameraCode: "BOP-03",
      cameraName: "Border Outpost 03",
      timestamp: "10:21:04",
      dwellDuration: "45s",
      detectionType: "PERSON",
      confidence: 0.94,
      matchSimilarity: 1.0,
      zone: "Perimeter Approach",
      speed: "1.4 m/s",
      snapshot: "person_bop03.jpg"
    },
    {
      step: 2,
      cameraCode: "BORDER-RD-12",
      cameraName: "Patrol Road Checkpoint 12",
      timestamp: "10:23:41",
      dwellDuration: "1m 12s",
      detectionType: "PERSON",
      confidence: 0.91,
      matchSimilarity: 0.89,
      zone: "Transit Corridor",
      speed: "1.8 m/s",
      snapshot: "person_road12.jpg"
    },
    {
      step: 3,
      cameraCode: "BOP-04",
      cameraName: "Border Outpost 04",
      timestamp: "10:25:17",
      dwellDuration: "1m 52s",
      detectionType: "PERSON (LOITERING)",
      confidence: 0.95,
      matchSimilarity: 0.92,
      zone: "Outer Fence Boundary",
      speed: "0.2 m/s",
      snapshot: "person_bop04.jpg"
    },
    {
      step: 4,
      cameraCode: "RESTRICTED-Z01",
      cameraName: "Restricted Zone Tactical Cam",
      timestamp: "10:27:09",
      dwellDuration: "Active",
      detectionType: "RESTRICTED ZONE BREACH",
      confidence: 0.96,
      matchSimilarity: 0.94,
      zone: "Restricted Zone Alpha (BREACH)",
      speed: "2.1 m/s",
      snapshot: "person_breach.jpg"
    }
  ]
};

export const SAMPLE_INCIDENTS = [
  {
    id: "INC-2026-0913-001",
    title: "Coordinated Perimeter Breach & Loitering",
    targetEntity: "PERSON #27",
    threatScore: 82,
    severity: "HIGH",
    primaryCamera: "RESTRICTED-Z01 (Sector B)",
    timestamp: "10:27:09",
    status: "INVESTIGATING",
    assignedTo: "Commander Rawat (Alpha Lead)",
    threatFactors: [
      { rule: "Restricted-zone intrusion", delta: 30, desc: "Subject breached virtual polygonal boundary on Cam RESTRICTED-Z01" },
      { rule: "Movement toward sensitive zone", delta: 20, desc: "Direct heading vector toward ammunition shelter" },
      { rule: "Loitering detected", delta: 15, desc: "Dwell time > 120 seconds in blind sector near BOP-04" },
      { rule: "Night-time / Blackout movement", delta: 15, desc: "Movement logged in infrared blackout corridor" },
      { rule: "Unknown / Unverified identity", delta: 2, desc: "Facial signature mismatch against personnel registry" }
    ],
    timeline: [
      { time: "10:21:04", camera: "BOP-03", event: "Initial detection: Pedestrian crossing outer perimeter berm" },
      { time: "10:23:41", camera: "BORDER-RD-12", event: "Cross-camera re-ID match (89% similarity). Rapid transit" },
      { time: "10:25:17", camera: "BOP-04", event: "Entity halted in blind foliage zone. Loitering timer triggered (112s)" },
      { time: "10:27:09", camera: "RESTRICTED-Z01", event: "Virtual tripwire intersected. Threat score crossed 80 threshold. CRITICAL ALERT dispatched" }
    ],
    auditLogs: [
      { time: "10:27:10", user: "AI Engine", action: "Automatic Incident Generated (Score: 82)" },
      { time: "10:27:30", user: "Operator Verma", action: "Alert Acknowledged. Dispatching QRT Unit 2" },
      { time: "10:28:15", user: "Operator Verma", action: "Status updated to INVESTIGATING" }
    ]
  },
  {
    id: "INC-2026-0913-002",
    title: "Watchlist Vehicle ANPR Trigger",
    targetEntity: "VEHICLE #08 (MP09AB1234)",
    threatScore: 75,
    severity: "HIGH",
    primaryCamera: "BORDER-RD-12",
    timestamp: "10:14:22",
    status: "ESCALATED",
    assignedTo: "Inspector Sharma",
    threatFactors: [
      { rule: "Watchlist vehicle detected", delta: 40, desc: "Matches National Security Watchlist entry #WL-001" },
      { rule: "Night-time movement", delta: 15, desc: "Movement during restricted curfew window" },
      { rule: "Movement toward sensitive zone", delta: 20, desc: "Vehicle trajectory advancing along supply depot access line" }
    ],
    timeline: [
      { time: "10:12:05", camera: "GATE-01", event: "High-speed approach detected" },
      { time: "10:14:22", camera: "BORDER-RD-12", event: "Plate blurred by motion blur. AI super-resolution applied. OCR resolved MP09AB1234 (94% conf). Watchlist match confirmed" },
      { time: "10:15:00", camera: "BORDER-RD-12", event: "Vehicle bypassed secondary barrier" }
    ],
    auditLogs: [
      { time: "10:14:23", user: "AI ANPR Engine", action: "Restoration completed, plate matched WL-001" },
      { time: "10:15:10", user: "Inspector Sharma", action: "Escalated to Central Border Police Dispatch" }
    ]
  },
  {
    id: "INC-2026-0912-003",
    title: "Suspected Abandoned Object Near Logistics Bay",
    targetEntity: "OBJECT #04",
    threatScore: 48,
    severity: "MEDIUM",
    primaryCamera: "WAREHOUSE-E",
    timestamp: "Yesterday 22:40",
    status: "RESOLVED",
    assignedTo: "Security Officer Kulkarni",
    threatFactors: [
      { rule: "Abandoned object dwell > 15m", delta: 25, desc: "Stationary unattended package left near loading bay" },
      { rule: "Night-time movement", delta: 15, desc: "Off-hours drop off" },
      { rule: "Authorized personnel override", delta: 8, desc: "Logistics staff later retrieved package" }
    ],
    timeline: [
      { time: "22:40:11", camera: "WAREHOUSE-E", event: "Package dropped near door" },
      { time: "22:55:12", camera: "WAREHOUSE-E", event: "Dwell threshold exceeded. Alert generated" },
      { time: "23:05:00", camera: "WAREHOUSE-E", event: "Authorized warehouse manager verified package as maintenance gear" }
    ],
    auditLogs: [
      { time: "22:55:12", user: "AI Engine", action: "Object alert logged" },
      { time: "23:10:00", user: "Officer Kulkarni", action: "Marked RESOLVED (False Positive - Authorized Gear)" }
    ]
  }
];

export const ANPR_SAMPLES = [
  {
    id: "ANPR-01",
    plateNumber: "MP09AB1234",
    vehicleType: "Mahindra Scorpio (Black)",
    confidenceBefore: 0.32,
    confidenceAfter: 0.94,
    camera: "BORDER-RD-12",
    timestamp: "10:14:22",
    watchlistStatus: "CRITICAL_HIT",
    watchListId: "WL-001",
    qualityScore: "POOR -> EXCELLENT",
    appliedEnhancements: ["Deblur Filter (Kernel 5x5)", "Super-Resolution GAN (4x)", "Histogram Equalization", "Contrast Normalization"],
    speedEstimate: "58 km/h"
  },
  {
    id: "ANPR-02",
    plateNumber: "DL01CA4092",
    vehicleType: "Bolero Pickup (White)",
    confidenceBefore: 0.45,
    confidenceAfter: 0.91,
    camera: "GATE-01",
    timestamp: "09:48:10",
    watchlistStatus: "HIGH_HIT",
    watchListId: "WL-002",
    qualityScore: "BLURRED -> SHARP",
    appliedEnhancements: ["Motion Deblur", "Super-Resolution", "Adaptive Binarization"],
    speedEstimate: "24 km/h"
  },
  {
    id: "ANPR-03",
    plateNumber: "HR26DQ8991",
    vehicleType: "Innova Crysta (Grey)",
    confidenceBefore: 0.62,
    confidenceAfter: 0.97,
    camera: "WAREHOUSE-E",
    timestamp: "08:15:33",
    watchlistStatus: "CLEAR",
    watchListId: null,
    qualityScore: "FAIR -> CRISP",
    appliedEnhancements: ["Contrast Enhancement", "Denoising"],
    speedEstimate: "18 km/h"
  },
  {
    id: "ANPR-04",
    plateNumber: "RJ14UB6620",
    vehicleType: "Tata 407 Cargo",
    confidenceBefore: 0.28,
    confidenceAfter: 0.88,
    camera: "BOP-03",
    timestamp: "07:30:19",
    watchlistStatus: "CLEAR",
    watchListId: null,
    qualityScore: "LOW LIGHT -> ENHANCED",
    appliedEnhancements: ["Low-Light Gamma Boost", "Super-Resolution", "Edge Sharpener"],
    speedEstimate: "32 km/h"
  }
];

export const VIRTUAL_ZONES = [
  {
    id: "ZONE-01",
    name: "Sector B Restricted Perimeter",
    type: "RESTRICTED",
    color: "#EF4444",
    cameraCode: "RESTRICTED-Z01",
    threatWeight: 30,
    points: [
      { x: 15, y: 35 },
      { x: 85, y: 30 },
      { x: 90, y: 85 },
      { x: 10, y: 85 }
    ],
    ruleTriggers: ["Intrusion", "Loitering > 60s"]
  },
  {
    id: "ZONE-02",
    name: "Ammunition Storage Buffer",
    type: "SENSITIVE",
    color: "#F59E0B",
    cameraCode: "BOP-04",
    threatWeight: 20,
    points: [
      { x: 30, y: 25 },
      { x: 80, y: 25 },
      { x: 80, y: 75 },
      { x: 30, y: 75 }
    ],
    ruleTriggers: ["Directional Vector", "Unattended Object"]
  },
  {
    id: "ZONE-03",
    name: "North Outpost Approach Line",
    type: "BORDER",
    color: "#06B6D4",
    cameraCode: "BOP-03",
    threatWeight: 15,
    points: [
      { x: 5, y: 60 },
      { x: 95, y: 55 },
      { x: 95, y: 95 },
      { x: 5, y: 95 }
    ],
    ruleTriggers: ["Night Motion", "Human Entry"]
  },
  {
    id: "ZONE-04",
    name: "Commercial Gate Ingress",
    type: "ENTRY",
    color: "#10B981",
    cameraCode: "GATE-01",
    threatWeight: 0,
    points: [
      { x: 20, y: 40 },
      { x: 80, y: 40 },
      { x: 80, y: 90 },
      { x: 20, y: 90 }
    ],
    ruleTriggers: ["ANPR Capture", "Authorized Badge"]
  }
];

export const ANALYTICS_DATA = {
  hourlyThreats: [
    { hour: "00:00", low: 2, medium: 1, high: 0, critical: 0 },
    { hour: "02:00", low: 1, medium: 2, high: 1, critical: 0 },
    { hour: "04:00", low: 3, medium: 1, high: 2, critical: 1 },
    { hour: "06:00", low: 8, medium: 2, high: 0, critical: 0 },
    { hour: "08:00", low: 18, medium: 4, high: 1, critical: 0 },
    { hour: "10:00", low: 24, medium: 7, high: 3, critical: 2 },
    { hour: "12:00", low: 19, medium: 5, high: 1, critical: 0 },
    { hour: "14:00", low: 15, medium: 3, high: 0, critical: 0 },
    { hour: "16:00", low: 22, medium: 6, high: 1, critical: 0 },
    { hour: "18:00", low: 17, medium: 4, high: 2, critical: 0 },
    { hour: "20:00", low: 12, medium: 8, high: 3, critical: 1 },
    { hour: "22:00", low: 6, medium: 5, high: 2, critical: 1 }
  ],
  eventTypesBreakdown: [
    { name: "Restricted Zone Entry", count: 42, color: "#EF4444" },
    { name: "Night-time Movement", count: 68, color: "#F59E0B" },
    { name: "Loitering Suspicion", count: 35, color: "#06B6D4" },
    { name: "Watchlist Plate Match", count: 12, color: "#8B5CF6" },
    { name: "Directional Advance", count: 29, color: "#3B82F6" },
    { name: "Authorized Overrides", count: 85, color: "#10B981" }
  ],
  cameraIncidentRankings: [
    { camera: "BOP-03", incidents: 38, avgThreat: 64 },
    { camera: "RESTRICTED-Z01", incidents: 31, avgThreat: 78 },
    { camera: "BOP-04", incidents: 25, avgThreat: 58 },
    { camera: "BORDER-RD-12", incidents: 22, avgThreat: 46 },
    { camera: "GATE-01", incidents: 14, avgThreat: 22 },
    { camera: "WAREHOUSE-E", incidents: 8, avgThreat: 31 }
  ]
};
