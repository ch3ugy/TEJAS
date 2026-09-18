import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeZoneEntry, buildZonePayload } from './zoneModel.js';

test('normalizeZoneEntry preserves 3D fence metadata', () => {
  const zone = normalizeZoneEntry({
    id: 'ZONE-42',
    name: 'Perimeter',
    type: 'RESTRICTED',
    camera_code: 'CAM-99',
    points_json: [{ x: 10, y: 10 }, { x: 90, y: 10 }, { x: 90, y: 90 }],
    fence_type: '3D',
    fence_depth: 4.5,
  });

  assert.equal(zone.fence_type, '3D');
  assert.equal(zone.fence_depth, 4.5);
  assert.equal(zone.cameraCode, 'CAM-99');
});

test('buildZonePayload keeps 3D fence settings for persistence', () => {
  const payload = buildZonePayload({
    name: 'Perimeter',
    type: 'RESTRICTED',
    cameraCode: 'CAM-99',
    points: [{ x: 10, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }],
    ruleTriggers: ['Intrusion'],
    fence_type: '3D',
    fence_depth: 6.2,
  });

  assert.equal(payload.fence_type, '3D');
  assert.equal(payload.fence_depth, 6.2);
  assert.equal(payload.camera_code, 'CAM-99');
});
