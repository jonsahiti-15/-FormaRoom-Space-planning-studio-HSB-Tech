(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;
  const H = C.HOME;
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const COLORS = {
    background: '#eef3ef',
    dot: 'rgba(24, 62, 42, 0.10)',
    wall: '#2d3b33',
    wallSoft: 'rgba(45, 59, 51, 0.35)',
    green: '#0f7a52',
    greenSoft: 'rgba(15, 122, 82, 0.14)',
    amber: '#b4763a',
    amberSoft: 'rgba(180, 118, 58, 0.16)',
    danger: '#b93b2f',
    label: '#31413a',
    muted: '#718078',
    white: '#ffffff',
    door: '#7a5f43',
    glass: '#8fb8c6'
  };

  let canvas = null;
  let wrap = null;
  let ctx = null;
  let dpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;
  let raf = null;
  let resizeObserver = null;
  let view = { scale: 0.2, panX: 40, panY: 40, initialized: false };
  let tool = 'select';
  let selected = null;
  let pending = null;
  let hover = null;
  let drag = null;
  let spaceDown = false;
  let hitZones = [];

  function requestDraw() {
    if (raf) return;
    raf = requestAnimationFrame(function () { raf = null; draw(); });
  }

  function getHome() { return App.Home.get(); }

  function homeRooms() {
    const home = getHome();
    return home ? home.rooms : [];
  }

  function toScreen(x, z) {
    return { x: view.panX + x * view.scale, y: view.panY + z * view.scale };
  }

  function toWorld(sx, sy) {
    return { x: (sx - view.panX) / view.scale, z: (sy - view.panY) / view.scale };
  }

  function pointerPos(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function fitView(redraw) {
    const rooms = homeRooms();
    if (!cssWidth || !cssHeight) return;
    let minX = 0, minZ = 0, maxX = 1200, maxZ = 1200;
    if (rooms.length) {
      minX = Infinity; minZ = Infinity; maxX = -Infinity; maxZ = -Infinity;
      rooms.forEach(function (room) {
        const r = App.Home.rectOf(room);
        minX = Math.min(minX, r.x); minZ = Math.min(minZ, r.z);
        maxX = Math.max(maxX, r.x + r.w); maxZ = Math.max(maxZ, r.z + r.d);
      });
    }
    const padX = Math.max(56, cssWidth * 0.08);
    const padY = U.clamp(cssHeight * 0.17, 34, 86);
    const w = Math.max(100, maxX - minX);
    const d = Math.max(100, maxZ - minZ);
    const scale = Math.min((cssWidth - padX * 2) / w, (cssHeight - padY * 2) / d);
    view.scale = U.clamp(scale, 0.02, 3);
    view.panX = (cssWidth - w * view.scale) / 2 - minX * view.scale;
    view.panY = (cssHeight - d * view.scale) / 2 - minZ * view.scale;
    view.initialized = true;
    if (redraw !== false) requestDraw();
  }

  function zoomBy(factor, ax, ay) {
    const anchorX = U.isFiniteNumber(ax) ? ax : cssWidth / 2;
    const anchorY = U.isFiniteNumber(ay) ? ay : cssHeight / 2;
    const world = toWorld(anchorX, anchorY);
    const next = U.clamp(view.scale * factor, 0.02, 3);
    if (next === view.scale) return;
    view.scale = next;
    view.panX = anchorX - world.x * view.scale;
    view.panY = anchorY - world.z * view.scale;
    requestDraw();
  }

  function setTool(next) {
    tool = ['select', 'link', 'erase'].indexOf(next) >= 0 ? next : 'select';
    pending = null;
    hint();
    requestDraw();
  }

  function getTool() { return tool; }

  function setSelected(next) {
    selected = next;
    requestDraw();
  }

  function hint(extra) {
    if (typeof App.onHomePlanHint !== 'function') return;
    let text = '';
    if (tool === 'link') {
      text = pending
        ? 'Now click a door in another room — or click the room itself to cut a matching door and connect it.'
        : 'Click a door symbol to start linking two rooms.';
    } else if (tool === 'erase') {
      text = 'Click a link or room to remove it. Clicking a door opens its room design.';
    } else {
      text = 'Drag rooms to arrange them. Press R to rotate the selected room.';
    }
    App.onHomePlanHint(extra ? extra + ' ' + text : text);
  }

  /* ------------------------------------------------------------- rendering */

  function roundRect(x, y, w, h, r) {
    const radius = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function pill(text, x, y, options) {
    const opts = options || {};
    const size = opts.size || 11;
    ctx.font = (opts.bold ? '600 ' : '') + size + 'px ' + FONT;
    const lines = String(text).split('\n');
    let width = 0;
    lines.forEach(function (line) { width = Math.max(width, ctx.measureText(line).width); });
    const padX = 7;
    const lineHeight = size * 1.28;
    const boxW = width + padX * 2;
    const boxH = lineHeight * lines.length + 6;
    const bx = opts.align === 'center' ? x - boxW / 2 : opts.align === 'right' ? x - boxW : x;
    const by = opts.baseline === 'middle' ? y - boxH / 2 : y;
    ctx.fillStyle = opts.background || 'rgba(255,255,255,0.92)';
    roundRect(bx, by, boxW, boxH, 5);
    ctx.fill();
    if (opts.stroke) {
      ctx.strokeStyle = opts.stroke;
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.fillStyle = opts.color || COLORS.label;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    lines.forEach(function (line, i) {
      ctx.fillText(line, bx + padX, by + 3 + i * lineHeight);
    });
    return { x: bx, y: by, w: boxW, h: boxH };
  }

  function drawBackdrop() {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    const step = Math.max(28, Math.min(160, 100 * view.scale * 10));
    const startW = toWorld(0, 0);
    const endW = toWorld(cssWidth, cssHeight);
    ctx.fillStyle = COLORS.dot;
    const fromX = Math.floor(startW.x / step) * step;
    const fromZ = Math.floor(startW.z / step) * step;
    for (let x = fromX; x < endW.x; x += step) {
      for (let z = fromZ; z < endW.z; z += step) {
        const p = toScreen(x, z);
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
    }
  }

  function drawRoom(room, isSelected, isPending) {
    const rect = App.Home.rectOf(room);
    const p = toScreen(rect.x, rect.z);
    const w = rect.w * view.scale;
    const d = rect.d * view.scale;
    const design = App.Home.cachedDesign(room.designId);
    const use = design && design.roomUse ? design.roomUse : 'other';
    ctx.fillStyle = H.ROOM_FILLS[use] || H.ROOM_FILLS.other;
    ctx.fillRect(p.x, p.y, w, d);
    if (design && design.wallColor) {
      ctx.fillStyle = design.wallColor;
      ctx.globalAlpha = 0.5;
      ctx.fillRect(p.x, p.y, w, d);
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = isSelected ? C.HIGHLIGHT : COLORS.wall;
    ctx.lineWidth = isSelected ? 3 : Math.max(1.5, Math.min(5, 12 * view.scale));
    ctx.strokeRect(p.x, p.y, w, d);
    if (isPending) {
      ctx.strokeStyle = COLORS.green;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 4, p.y - 4, w + 8, d + 8);
      ctx.setLineDash([]);
    }
    hitZones.push({ type: 'room', id: room.id, x: p.x, y: p.y, w: w, d: d });

    const name = App.Home.designName(room) || 'Room';
    if (w > 70 && d > 40) {
      pill(name + '\n' + Math.round(rect.w) + ' × ' + Math.round(rect.d) + ' cm',
        p.x + w / 2, p.y + d / 2, { align: 'center', baseline: 'middle', size: 11, bold: true, background: 'rgba(255,255,255,0.82)' });
    }

    const openings = App.Home.allOpeningsOf(room);
    openings.forEach(function (item) {
      const pose = App.Home.openingPose(room, item);
      if (!pose) return;
      const center = toScreen(pose.x, pose.z);
      const half = pose.widthCm * view.scale / 2;
      const angle = Math.atan2(pose.along.z, pose.along.x);
      ctx.save();
      ctx.translate(center.x, center.y);
      ctx.rotate(angle);
      const isDoor = item.type === 'door';
      const linked = isDoor && App.Home.linkForOpening(room.id, item.id);
      ctx.fillStyle = isDoor ? (linked ? COLORS.green : COLORS.door) : COLORS.glass;
      const thickness = Math.max(3, Math.min(9, 14 * view.scale));
      ctx.fillRect(-half, -thickness / 2, half * 2, thickness);
      if (isDoor) {
        ctx.strokeStyle = linked ? COLORS.green : 'rgba(45,59,51,0.55)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(-half, 0, half * 2, -Math.PI / 2, 0);
        ctx.stroke();
      }
      ctx.restore();
      const screenRadius = Math.max(11, half);
      hitZones.push({
        type: isDoor ? 'door' : 'window',
        id: item.id,
        roomId: room.id,
        x: center.x,
        y: center.y,
        r: screenRadius,
        linked: !!linked
      });
      if (linked && view.scale > 0.06) {
        pill(isDoor ? '↔' : '', center.x, center.y - 9, { align: 'center', baseline: 'middle', size: 9, background: 'rgba(255,255,255,0.9)' });
      }
    });
  }

  function drawLinks(home) {
    home.links.forEach(function (link) {
      const a = App.Home.roomById(link.fromRoomId);
      const b = App.Home.roomById(link.toRoomId);
      if (!a || !b) return;
      const openA = App.Home.openingInRoom(a.id, link.fromOpeningId);
      const openB = App.Home.openingInRoom(b.id, link.toOpeningId);
      const poseA = App.Home.openingPose(a, openA);
      const poseB = App.Home.openingPose(b, openB);
      if (!poseA || !poseB) return;
      const pa = toScreen(poseA.x, poseA.z);
      const pb = toScreen(poseB.x, poseB.z);
      const mid = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
      ctx.setLineDash([]);
      [pa, pb].forEach(function (point) {
        ctx.fillStyle = COLORS.white;
        ctx.strokeStyle = COLORS.green;
        ctx.beginPath();
        ctx.arc(point.x, point.y, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      });
      const active = selected && selected.type === 'link' && selected.id === link.id;
      ctx.fillStyle = active ? COLORS.green : COLORS.white;
      ctx.strokeStyle = COLORS.green;
      ctx.beginPath();
      ctx.arc(mid.x, mid.y, active ? 10 : 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = active ? COLORS.white : COLORS.green;
      ctx.font = '600 10px ' + FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('↔', mid.x, mid.y + 0.5);
      hitZones.push({ type: 'link', id: link.id, x: mid.x, y: mid.y, r: 12 });
    });
  }

  function drawPending() {
    if (!pending) return;
    if (pending.type === 'door') {
      const room = App.Home.roomById(pending.roomId);
      const opening = room && App.Home.openingInRoom(room.id, pending.id);
      const pose = App.Home.openingPose(room, opening);
      if (!pose) return;
      const p = toScreen(pose.x, pose.z);
      ctx.strokeStyle = COLORS.green;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, 16, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      if (hover && hover.type === 'door' && hover.roomId !== pending.roomId) {
        const other = App.Home.roomById(hover.roomId);
        const otherOpening = other && App.Home.openingInRoom(other.id, hover.id);
        const otherPose = App.Home.openingPose(other, otherOpening);
        if (otherPose) {
          const q = toScreen(otherPose.x, otherPose.z);
          ctx.strokeStyle = 'rgba(15,122,82,0.55)';
          ctx.setLineDash([6, 5]);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(q.x, q.y);
          ctx.stroke();
          ctx.setLineDash([]);
        }
      }
      return;
    }
  }

  function drawLegend() {
    const home = getHome();
    if (!home) return;
    const items = [
      { color: COLORS.wall, label: 'Wall' },
      { color: COLORS.green, label: 'Linked door' },
      { color: COLORS.door, label: 'Unlinked door' },
      { color: COLORS.glass, label: 'Window' }
    ];
    ctx.font = '10px ' + FONT;
    let width = 12;
    items.forEach(function (item) { width += 16 + ctx.measureText(item.label).width + 12; });
    const x = 12;
    const y = cssHeight - 30;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    roundRect(x, y, width, 22, 6);
    ctx.fill();
    let cursor = x + 10;
    items.forEach(function (item) {
      ctx.fillStyle = item.color;
      ctx.fillRect(cursor, y + 8, 10, 6);
      cursor += 14;
      ctx.fillStyle = COLORS.label;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(item.label, cursor, y + 15);
      cursor += ctx.measureText(item.label).width + 12;
    });
    const scaleBar = 100 * view.scale;
    pill(home.name + ' · ' + home.rooms.length + ' room(s)',
      cssWidth - 12, 12, { align: 'right', size: 11, bold: true, stroke: 'rgba(15,122,82,0.3)' });
    if (scaleBar > 18) {
      ctx.strokeStyle = COLORS.label;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cssWidth - 12 - scaleBar, cssHeight - 19);
      ctx.lineTo(cssWidth - 12, cssHeight - 19);
      ctx.stroke();
      pill('1 m', cssWidth - 12, cssHeight - 40, { align: 'right', size: 9, background: 'transparent' });
    }
  }

  function drawEmpty() {
    pill('No rooms on the plan yet.\nUse “Add a saved room” to bring a design in.',
      cssWidth / 2, cssHeight / 2, { align: 'center', baseline: 'middle', size: 13, background: 'rgba(255,255,255,0.94)', stroke: 'rgba(15,122,82,0.25)' });
  }

  function draw() {
    if (!ctx || !cssWidth || !cssHeight) return;
    hitZones = [];
    const home = getHome();
    drawBackdrop();
    if (!home) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); return; }
    homeRooms().forEach(function (room) {
      const isSelected = selected && selected.type === 'room' && selected.id === room.id;
      drawRoom(room, isSelected, false);
    });
    drawLinks(home);
    drawPending();
    if (!homeRooms().length) drawEmpty();
    drawLegend();
  }

  /* ----------------------------------------------------------- interaction */

  function hitTest(x, y) {
    for (let i = hitZones.length - 1; i >= 0; i--) {
      const zone = hitZones[i];
      if (zone.r != null) {
        if (Math.hypot(x - zone.x, y - zone.y) <= zone.r) return zone;
      } else if (x >= zone.x && x <= zone.x + zone.w && y >= zone.y && y <= zone.y + zone.d) {
        return zone;
      }
    }
    return null;
  }

  function emitSelect(zone) {
    if (typeof App.onHomePlanSelect !== 'function') return;
    if (!zone) { App.onHomePlanSelect(null); return; }
    App.onHomePlanSelect({ type: zone.type, id: zone.id, roomId: zone.roomId, end: zone.end, linked: zone.linked });
  }

  function onPointerDown(event) {
    if (!canvas) return;
    const pos = pointerPos(event);
    const zone = hitTest(pos.x, pos.y);
    if (event.button === 1 || event.button === 2 || spaceDown) {
      drag = { kind: 'pan', startX: pos.x, startY: pos.y, panX: view.panX, panY: view.panY };
      canvas.setPointerCapture(event.pointerId);
      event.preventDefault();
      return;
    }
    if (tool === 'link') {
      if (zone && zone.type === 'door') {
        if (!pending) {
          pending = { type: 'door', roomId: zone.roomId, id: zone.id };
          hint();
          requestDraw();
        } else if (pending.roomId !== zone.roomId) {
          const result = App.Home.addLink({
            fromRoomId: pending.roomId,
            fromOpeningId: pending.id,
            toRoomId: zone.roomId,
            toOpeningId: zone.id
          });
          pending = null;
          if (typeof App.onHomePlanAction === 'function') App.onHomePlanAction('link', result);
        } else {
          pending = null;
          requestDraw();
        }
      } else if (zone && zone.type === 'link' && event.altKey) {
        App.Home.removeLink(zone.id);
        pending = null;
      } else if (pending && zone && zone.type === 'room' && zone.id !== pending.roomId) {
        const result = App.Home.connectDoor(pending.roomId, pending.id, zone.id);
        pending = null;
        if (typeof App.onHomePlanAction === 'function') App.onHomePlanAction('connect-door', result);
        requestDraw();
      } else {
        pending = null;
        requestDraw();
      }
      return;
    }
    if (tool === 'erase') {
      if (zone && zone.type === 'link') App.Home.removeLink(zone.id);
      else if (zone && zone.type === 'room') {
        if (typeof App.onHomePlanAction === 'function') App.onHomePlanAction('remove-room', { roomId: zone.id });
      } else if (zone && (zone.type === 'door' || zone.type === 'window')) {
        if (typeof App.onHomePlanAction === 'function') {
          App.onHomePlanAction('opening-in-design', { roomId: zone.roomId, openingId: zone.id, kind: zone.type });
        }
      }
      return;
    }
    if (zone && zone.type === 'room') {
      const room = App.Home.roomById(zone.id);
      if (!room) return;
      selected = { type: 'room', id: room.id };
      emitSelect(zone);
      drag = {
        kind: 'room',
        id: room.id,
        offsetX: world0(room, pos).x,
        offsetZ: world0(room, pos).z,
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      requestDraw();
      return;
    }
    if (zone && (zone.type === 'link' || zone.type === 'door')) {
      selected = { type: zone.type, id: zone.id, roomId: zone.roomId };
      emitSelect(zone);
      requestDraw();
      return;
    }
    selected = null;
    emitSelect(null);
    requestDraw();
  }

  function world0(room, pos) {
    const world = toWorld(pos.x, pos.y);
    return { x: world.x - room.xCm, z: world.z - room.zCm };
  }

  function onPointerMove(event) {
    const pos = pointerPos(event);
    if (drag) {
      if (drag.kind === 'pan') {
        view.panX = drag.panX + (pos.x - drag.startX);
        view.panY = drag.panY + (pos.y - drag.startY);
        requestDraw();
        return;
      }
      if (drag.kind === 'room') {
        const room = App.Home.roomById(drag.id);
        if (!room) return;
        const world = toWorld(pos.x, pos.y);
        const result = App.Home.tryMoveRoom(room.id, world.x - drag.offsetX, world.z - drag.offsetZ);
        drag.moved = drag.moved || !!result.ok;
        requestDraw();
        return;
      }
    }
    const zone = hitTest(pos.x, pos.y);
    const changed = JSON.stringify(zone && { t: zone.type, i: zone.id }) !== JSON.stringify(hover && { t: hover.type, i: hover.id });
    hover = zone;
    if (canvas) {
      canvas.style.cursor = zone
        ? (tool === 'erase' ? 'crosshair' : zone.type === 'room' ? 'grab' : 'pointer')
        : (spaceDown ? 'grabbing' : 'default');
    }
    if (changed && tool === 'link') requestDraw();
  }

  function onPointerUp(event) {
    if (drag && drag.kind === 'room' && drag.moved) {
      if (typeof App.onHomePlanAction === 'function') App.onHomePlanAction('moved', { roomId: drag.id });
    }
    drag = null;
    if (canvas && canvas.hasPointerCapture && event.pointerId != null && canvas.hasPointerCapture(event.pointerId)) {
      canvas.releasePointerCapture(event.pointerId);
    }
    requestDraw();
  }

  function onWheel(event) {
    event.preventDefault();
    const pos = pointerPos(event);
    zoomBy(event.deltaY < 0 ? 1.12 : 0.89, pos.x, pos.y);
  }

  function onKeyDown(event) {
    if (event.code === 'Space' && !U.isTypingTarget(event.target)) {
      spaceDown = true;
      if (canvas) canvas.style.cursor = 'grabbing';
    }
  }

  function onKeyUp(event) {
    if (event.code === 'Space') {
      spaceDown = false;
      if (canvas) canvas.style.cursor = 'default';
    }
  }

  function handleResize() {
    if (!wrap || !canvas) return;
    const rect = wrap.getBoundingClientRect();
    cssWidth = Math.max(1, rect.width);
    cssHeight = Math.max(1, rect.height);
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    canvas.style.width = cssWidth + 'px';
    canvas.style.height = cssHeight + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (!view.initialized) fitView(false);
    requestDraw();
  }

  function init(canvasEl, wrapEl) {
    canvas = canvasEl;
    wrap = wrapEl;
    ctx = canvas.getContext('2d');
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', function (event) { event.preventDefault(); });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    resizeObserver = new ResizeObserver(function () { handleResize(); });
    resizeObserver.observe(wrap);
    handleResize();
  }

  function focusRoom(id) {
    const room = App.Home.roomById(id);
    if (!room || !cssWidth || !cssHeight) return;
    const rect = App.Home.rectOf(room);
    const pad = 70;
    const scale = U.clamp(Math.min((cssWidth - pad * 2) / rect.w, (cssHeight - pad * 2) / rect.d), 0.02, 3);
    view.scale = scale;
    view.panX = cssWidth / 2 - (rect.x + rect.w / 2) * scale;
    view.panY = cssHeight / 2 - (rect.z + rect.d / 2) * scale;
    view.initialized = true;
    requestDraw();
  }

  function afterChange() {
    if (!view.initialized) fitView(false);
    requestDraw();
  }

  App.HomePlan = {
    init: init,
    requestDraw: requestDraw,
    afterChange: afterChange,
    fitView: fitView,
    focusRoom: focusRoom,
    zoomBy: zoomBy,
    setTool: setTool,
    getTool: getTool,
    setSelected: setSelected,
    hint: hint,
    getPending: function () { return pending; }
  };
})(window.App = window.App || {});
