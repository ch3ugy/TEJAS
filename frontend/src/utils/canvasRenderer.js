// Advanced Canvas CCTV stream generator, HUD overlay, and AI detection visualizer

export function renderCCTVFrame(canvas, camera, entities = [], activeZones = [], tick = 0) {
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  // 1. Background tactical environment
  const grad = ctx.createLinearGradient(0, 0, w, h);
  if (camera.code === 'RESTRICTED-Z01') {
    grad.addColorStop(0, '#09131C');
    grad.addColorStop(0.6, '#0B1824');
    grad.addColorStop(1, '#050B10');
  } else if (camera.code === 'BOP-03') {
    grad.addColorStop(0, '#0E1716');
    grad.addColorStop(0.6, '#0F201C');
    grad.addColorStop(1, '#060F0D');
  } else {
    grad.addColorStop(0, '#0A0F1D');
    grad.addColorStop(0.6, '#10182E');
    grad.addColorStop(1, '#070A14');
  }
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // 2. Subtle CCTV noise & horizontal scan lines
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.02)';
  ctx.lineWidth = 1;
  for (let y = 0; y < h; y += 4) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  // 3. Draw Virtual Fence Zones (Polygons)
  activeZones.forEach(zone => {
    if (zone.cameraCode === camera.code && zone.points && zone.points.length >= 3) {
      ctx.save();
      ctx.beginPath();
      const firstPt = zone.points[0];
      ctx.moveTo((firstPt.x / 100) * w, (firstPt.y / 100) * h);
      for (let i = 1; i < zone.points.length; i++) {
        const pt = zone.points[i];
        ctx.lineTo((pt.x / 100) * w, (pt.y / 100) * h);
      }
      ctx.closePath();

      // Pulsing fill for restricted zones if threat active
      const isBreached = camera.activeThreats > 0 && zone.type === 'RESTRICTED';
      if (isBreached) {
        ctx.fillStyle = `rgba(239, 68, 68, ${0.12 + Math.sin(tick * 0.4) * 0.08})`;
      } else {
        ctx.fillStyle = zone.type === 'RESTRICTED' ? 'rgba(239, 68, 68, 0.10)' : 'rgba(245, 158, 11, 0.08)';
      }
      ctx.fill();

      // Glowing dashed border
      ctx.strokeStyle = zone.color || '#EF4444';
      ctx.lineWidth = isBreached ? 2.5 : 1.6;
      ctx.setLineDash([6, 4]);
      ctx.stroke();

      // Zone Label
      const labelPt = zone.points[0];
      ctx.fillStyle = zone.color || '#EF4444';
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      ctx.fillText(`⯌ ${zone.name.toUpperCase()}${isBreached ? ' [BREACH DETECTED]' : ''}`, (labelPt.x / 100) * w + 6, (labelPt.y / 100) * h + 14);
      ctx.restore();
    }
  });

  // 4. Render Detected Entities (Bounding boxes, IDs, Face detection, trails)
  entities.forEach(ent => {
    if (ent.cameraCode === camera.code) {
      const boxW = ent.width || 48;
      const boxH = ent.height || 92;
      const x = ent.x;
      const y = ent.y;

      const isCritical = ent.threatScore >= 70;
      const isVehicle = ent.type === 'VEHICLE';
      const mainColor = isCritical ? '#EF4444' : isVehicle ? '#06B6D4' : ent.status === 'AUTHORIZED' ? '#10B981' : '#F59E0B';

      ctx.save();

      // Historical Motion Trail
      if (ent.trail && ent.trail.length > 1) {
        ctx.beginPath();
        ctx.strokeStyle = mainColor;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([2, 3]);
        ctx.moveTo(ent.trail[0].x, ent.trail[0].y);
        for (let i = 1; i < ent.trail.length; i++) {
          ctx.lineTo(ent.trail[i].x, ent.trail[i].y);
        }
        ctx.stroke();
      }

      // Velocity Vector Arrow
      if (ent.status.includes('HEADING') || ent.status.includes('BREACH')) {
        ctx.beginPath();
        ctx.strokeStyle = '#EF4444';
        ctx.lineWidth = 2;
        ctx.setLineDash([]);
        ctx.moveTo(x + boxW / 2, y + boxH / 2);
        ctx.lineTo(x + boxW / 2 + 35, y + boxH / 2 - 20);
        ctx.stroke();

        ctx.fillStyle = '#EF4444';
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText("VELOCITY: 1.8 m/s -> DEPOT", x + boxW + 8, y + boxH / 2);
      }

      // Main Entity Bounding Box
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([]);
      ctx.strokeRect(x, y, boxW, boxH);

      // Corner accent brackets
      const bracketLen = 8;
      ctx.strokeStyle = '#FFFFFF';
      ctx.lineWidth = 2;
      // Top-Left
      ctx.beginPath();
      ctx.moveTo(x, y + bracketLen);
      ctx.lineTo(x, y);
      ctx.lineTo(x + bracketLen, y);
      ctx.stroke();
      // Top-Right
      ctx.beginPath();
      ctx.moveTo(x + boxW - bracketLen, y);
      ctx.lineTo(x + boxW, y);
      ctx.lineTo(x + boxW, y + bracketLen);
      ctx.stroke();
      // Bottom-Left
      ctx.beginPath();
      ctx.moveTo(x, y + boxH - bracketLen);
      ctx.lineTo(x, y + boxH);
      ctx.lineTo(x + bracketLen, y + boxH);
      ctx.stroke();
      // Bottom-Right
      ctx.beginPath();
      ctx.moveTo(x + boxW - bracketLen, y + boxH);
      ctx.lineTo(x + boxW, y + boxH);
      ctx.lineTo(x + boxW, y + boxH - bracketLen);
      ctx.stroke();

      // Header Tag Badge
      const labelText = `${ent.label}  ${Math.round((ent.confidence || 0.94) * 100)}%`;
      ctx.font = 'bold 10px "JetBrains Mono", monospace';
      const textWidth = ctx.measureText(labelText).width;

      ctx.fillStyle = mainColor;
      ctx.fillRect(x, y - 18, textWidth + 12, 18);

      ctx.fillStyle = '#080C14';
      ctx.fillText(labelText, x + 6, y - 5);

      // Face Detection Sub-Box (for Human Entities)
      if (!isVehicle) {
        const faceW = boxW * 0.45;
        const faceH = boxH * 0.22;
        const faceX = x + (boxW - faceW) / 2;
        const faceY = y + 4;

        ctx.strokeStyle = ent.status === 'AUTHORIZED' ? '#10B981' : '#06B6D4';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(faceX, faceY, faceW, faceH);

        // Face tag
        ctx.fillStyle = 'rgba(8, 12, 20, 0.85)';
        ctx.fillRect(faceX + faceW + 4, faceY, 70, 12);
        ctx.fillStyle = ent.status === 'AUTHORIZED' ? '#10B981' : '#06B6D4';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillText(ent.status === 'AUTHORIZED' ? 'FACE: AUTH 98%' : 'FACE: UNKNOWN', faceX + faceW + 6, faceY + 9);
      }

      // ANPR Plate Sub-Box (for Vehicles)
      if (isVehicle) {
        const plateW = boxW * 0.55;
        const plateH = 14;
        const plateX = x + (boxW - plateW) / 2;
        const plateY = y + boxH - 20;

        ctx.strokeStyle = '#F59E0B';
        ctx.lineWidth = 1.2;
        ctx.strokeRect(plateX, plateY, plateW, plateH);

        ctx.fillStyle = 'rgba(8, 12, 20, 0.85)';
        ctx.fillRect(plateX, plateY - 12, 85, 12);
        ctx.fillStyle = '#F59E0B';
        ctx.font = '8px "JetBrains Mono", monospace';
        ctx.fillText('ANPR: MP09AB1234', plateX + 4, plateY - 3);
      }

      // Bottom status badge
      if (ent.status) {
        ctx.fillStyle = 'rgba(14, 21, 36, 0.85)';
        ctx.fillRect(x, y + boxH + 3, textWidth + 8, 14);
        ctx.fillStyle = mainColor;
        ctx.font = '9px "JetBrains Mono", monospace';
        ctx.fillText(ent.status, x + 4, y + boxH + 13);
      }

      ctx.restore();
    }
  });

  // 5. Tactical Camera OSD (On-Screen Display)
  ctx.save();
  ctx.fillStyle = '#10B981';
  ctx.beginPath();
  ctx.arc(16, 18, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#F1F5F9';
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.fillText(`LIVE  ${camera.code} - ${camera.name.toUpperCase()}`, 26, 21);

  // Top right: High-precision timestamp
  const now = new Date();
  const timeStr = now.toISOString().replace('T', ' ').substring(0, 19) + '.' + String(now.getMilliseconds()).padStart(3, '0');
  ctx.font = '11px "JetBrains Mono", monospace';
  ctx.fillStyle = 'rgba(241, 245, 249, 0.8)';
  const timeWidth = ctx.measureText(timeStr).width;
  ctx.fillText(timeStr, w - timeWidth - 14, 21);

  // Bottom left: AI Ingestion Metrics
  ctx.font = '10px "JetBrains Mono", monospace';
  ctx.fillStyle = '#06B6D4';
  ctx.fillText(`AI INGEST: YOLOv8-X | BYTE-TRACK | FACE-DET | FPS: ${camera.fps || 30}`, 14, h - 14);

  // Bottom right: Coordinates
  ctx.fillStyle = 'rgba(148, 163, 184, 0.8)';
  const coordStr = `LAT: ${camera.lat.toFixed(4)}° N | LNG: ${camera.lng.toFixed(4)}° E`;
  const coordWidth = ctx.measureText(coordStr).width;
  ctx.fillText(coordStr, w - coordWidth - 14, h - 14);

  // Corner viewfinder reticles
  const rSize = 14;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(8, 8 + rSize); ctx.lineTo(8, 8); ctx.lineTo(8 + rSize, 8);
  ctx.moveTo(w - 8 - rSize, 8); ctx.lineTo(w - 8, 8); ctx.lineTo(w - 8, 8 + rSize);
  ctx.moveTo(8, h - 8 - rSize); ctx.lineTo(8, h - 8); ctx.lineTo(8 + rSize, h - 8);
  ctx.moveTo(w - 8 - rSize, h - 8); ctx.lineTo(w - 8, h - 8); ctx.lineTo(w - 8, h - 8 - rSize);
  ctx.stroke();

  ctx.restore();
}
