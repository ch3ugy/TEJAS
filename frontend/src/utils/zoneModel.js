export function normalizeZoneEntry(zone = {}) {
  const cameraCode = zone.camera_code || zone.cameraCode || zone.camera || 'CAM-00';
  const points = Array.isArray(zone.points_json) && zone.points_json.length >= 3
    ? zone.points_json
    : Array.isArray(zone.points) && zone.points.length >= 3
      ? zone.points
      : [
          { x: 15, y: 25 },
          { x: 85, y: 25 },
          { x: 85, y: 85 },
          { x: 15, y: 85 },
        ];

  return {
    id: zone.id || `ZONE-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
    name: zone.name || 'Unnamed Zone',
    type: zone.type || 'RESTRICTED',
    color: zone.color || '#DC2626',
    cameraCode,
    points,
    ruleTriggers: Array.isArray(zone.rule_triggers) ? zone.rule_triggers : ['Intrusion'],
    fence_type: zone.fence_type || '2D',
    fence_depth: Number(zone.fence_depth ?? 0.0),
  };
}

export function buildZonePayload(zone) {
  return {
    name: zone.name,
    type: zone.type,
    color: zone.color,
    camera_code: zone.cameraCode || zone.camera_code || 'CAM-00',
    threat_weight: zone.threat_weight ?? 0,
    points_json: zone.points || [],
    rule_triggers: zone.ruleTriggers || ['Intrusion'],
    fence_type: zone.fence_type || '2D',
    fence_depth: zone.fence_type === '3D' ? Number(zone.fence_depth || 0.0) : 0.0,
  };
}
