(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;
  const G = App.Geometry;
  const H = C.HOME;

  let home = null;
  const listeners = [];
  const designCache = new Map();
  const designRequests = new Map();

  function nowIso() { return new Date().toISOString(); }

  function rotateVec(x, z, deg) {
    const r = U.degToRad(deg || 0);
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return { x: x * cos - z * sin, z: x * sin + z * cos };
  }

  function createHome(options) {
    const opts = options || {};
    return {
      id: opts.id || U.uid('home'),
      name: String(opts.name || 'My whole home').trim().slice(0, 60) || 'My whole home',
      version: 2,
      rooms: [],
      links: [],
      createdAt: opts.createdAt || nowIso(),
      updatedAt: nowIso()
    };
  }

  function normalizeHome(raw) {
    const warnings = [];
    if (!raw || typeof raw !== 'object') {
      return { home: null, warnings: ['The saved Whole Home record was empty.'] };
    }
    const legacyLevels = Array.isArray(raw.levels) && raw.levels.length > 1;
    const legacyStairs = Array.isArray(raw.stairs) && raw.stairs.length > 0;
    if (legacyLevels || legacyStairs) {
      warnings.push('Floors are no longer used, so every saved room was moved onto one plan and staircases were removed. Rooms from upper floors were placed beside the ground-floor rooms. Staircases are now normal catalog products.');
    }

    const rooms = [];
    const roomIds = new Set();
    const roomLevelIds = new Map();
    (Array.isArray(raw.rooms) ? raw.rooms : []).forEach(function (entry) {
      if (!entry || !entry.designId) { warnings.push('A room without a saved design was skipped.'); return; }
      const width = Number(entry.widthCm);
      const length = Number(entry.lengthCm);
      if (!U.isFiniteNumber(width) || !U.isFiniteNumber(length) || width <= 0 || length <= 0) {
        warnings.push('A room with unreadable dimensions was skipped.');
        return;
      }
      let id = String(entry.id || U.uid('room'));
      if (roomIds.has(id)) id = U.uid('room');
      roomIds.add(id);
      if (entry.levelId) roomLevelIds.set(id, String(entry.levelId));
      rooms.push({
        id: id,
        designId: String(entry.designId),
        xCm: U.isFiniteNumber(Number(entry.xCm)) ? Number(entry.xCm) : 0,
        zCm: U.isFiniteNumber(Number(entry.zCm)) ? Number(entry.zCm) : 0,
        rot: [0, 90, 180, 270].indexOf(Number(entry.rot)) >= 0 ? Number(entry.rot) : 0,
        widthCm: width,
        lengthCm: length,
        heightCm: U.isFiniteNumber(Number(entry.heightCm)) ? Number(entry.heightCm) : C.ROOM.DEFAULT_HEIGHT_CM,
        diameterCm: U.isFiniteNumber(Number(entry.diameterCm)) ? Number(entry.diameterCm) : width,
        shape: entry.shape === 'circle' ? 'circle' : 'rectangle',
        label: entry.label ? String(entry.label).slice(0, 40) : ''
      });
    });

    /* Old homes stacked floors on the same coordinates. Lay each level's rooms
       out beside the previous level instead, so the flattened plan has no
       overlapping rooms or duplicated walls. */
    if (legacyLevels) {
      const levelOrder = raw.levels.slice().sort(function (a, b) {
        return (Number(a.index) || 0) - (Number(b.index) || 0);
      }).map(function (level) { return String(level.id); });
      const groups = new Map();
      const loose = [];
      rooms.forEach(function (room) {
        const levelId = roomLevelIds.get(room.id);
        if (levelId && levelOrder.indexOf(levelId) >= 0) {
          if (!groups.has(levelId)) groups.set(levelId, []);
          groups.get(levelId).push(room);
        } else {
          loose.push(room);
        }
      });
      const footprint = function (room) {
        const swap = room.rot === 90 || room.rot === 270;
        return { w: swap ? room.lengthCm : room.widthCm, d: swap ? room.widthCm : room.lengthCm };
      };
      const GAP = 120;
      let cursorX = 0;
      const pack = function (list) {
        if (!list.length) return;
        const minX = Math.min.apply(null, list.map(function (r) { return r.xCm; }));
        const minZ = Math.min.apply(null, list.map(function (r) { return r.zCm; }));
        list.forEach(function (r) {
          r.xCm = Math.round(r.xCm - minX + cursorX);
          r.zCm = Math.round(r.zCm - minZ);
        });
        cursorX = Math.max.apply(null, list.map(function (r) {
          return r.xCm + footprint(r).w;
        })) + GAP;
      };
      levelOrder.forEach(function (levelId) { pack(groups.get(levelId) || []); });
      pack(loose);
    }

    const byId = new Map(rooms.map(function (r) { return [r.id, r]; }));
    const links = [];
    const linkIds = new Set();
    (Array.isArray(raw.links) ? raw.links : []).forEach(function (entry) {
      if (!entry) return;
      const a = byId.get(entry.fromRoomId);
      const b = byId.get(entry.toRoomId);
      if (!a || !b || a.id === b.id) { warnings.push('A door link with a missing room was removed.'); return; }
      if (!entry.fromOpeningId || !entry.toOpeningId) return;
      let id = String(entry.id || U.uid('link'));
      if (linkIds.has(id)) id = U.uid('link');
      linkIds.add(id);
      links.push({
        id: id,
        fromRoomId: a.id,
        fromOpeningId: String(entry.fromOpeningId),
        toRoomId: b.id,
        toOpeningId: String(entry.toOpeningId)
      });
    });

    return {
      home: {
        id: String(raw.id || U.uid('home')),
        name: String(raw.name || 'My whole home').trim().slice(0, 60) || 'My whole home',
        version: 2,
        rooms: rooms,
        links: links,
        createdAt: raw.createdAt || nowIso(),
        updatedAt: raw.updatedAt || nowIso()
      },
      warnings: warnings
    };
  }

  function notify(reason) {
    const snapshot = home;
    listeners.slice().forEach(function (fn) {
      try { fn(snapshot, reason); } catch (err) { console.error('Home listener failed:', err); }
    });
  }

  function commit(reason) {
    if (!home) return;
    home.updatedAt = nowIso();
    notify(reason);
  }

  function init(record) { home = record || null; notify('init'); }
  function get() { return home; }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    listeners.push(listener);
    return function () {
      const i = listeners.indexOf(listener);
      if (i >= 0) listeners.splice(i, 1);
    };
  }

  function guard() {
    if (!home) return { ok: false, error: 'Create a whole home first.' };
    return null;
  }

  /* ----------------------------------------------------------------- rooms */

  function rooms() { return home ? home.rooms : []; }
  function roomById(id) { return rooms().find(function (r) { return r.id === id; }) || null; }

  function footprint(room) {
    const swap = room.rot === 90 || room.rot === 270;
    return { w: swap ? room.lengthCm : room.widthCm, d: swap ? room.widthCm : room.lengthCm };
  }

  function rectOf(room) {
    const f = footprint(room);
    return { x: room.xCm, z: room.zCm, w: f.w, d: f.d, id: room.id };
  }

  function centerOf(room) {
    const f = footprint(room);
    return { x: room.xCm + f.w / 2, z: room.zCm + f.d / 2 };
  }

  function homeBounds() {
    if (!home || !home.rooms.length) return { minX: 0, minZ: 0, maxX: 1000, maxZ: 1000, width: 1000, depth: 1000 };
    let minX = Infinity, minZ = Infinity, maxX = -Infinity, maxZ = -Infinity;
    home.rooms.forEach(function (room) {
      const r = rectOf(room);
      minX = Math.min(minX, r.x); minZ = Math.min(minZ, r.z);
      maxX = Math.max(maxX, r.x + r.w); maxZ = Math.max(maxZ, r.z + r.d);
    });
    return { minX: minX, minZ: minZ, maxX: maxX, maxZ: maxZ, width: maxX - minX, depth: maxZ - minZ };
  }

  function centerOfHome() {
    const b = homeBounds();
    return { x: (b.minX + b.maxX) / 2, z: (b.minZ + b.maxZ) / 2 };
  }

  /* Design coordinates (0..width, 0..length) to level coordinates. */
  function toLevel(room, lx, lz) {
    const c = centerOf(room);
    const v = rotateVec(lx - room.widthCm / 2, lz - room.lengthCm / 2, room.rot);
    return { x: c.x + v.x, z: c.z + v.z };
  }

  /* Level coordinates back into the design's own plan coordinates. */
  function toDesignPoint(room, x, z) {
    const c = centerOf(room);
    const v = rotateVec(x - c.x, z - c.z, -room.rot);
    return { x: v.x + room.widthCm / 2, z: v.z + room.lengthCm / 2 };
  }

  function designRoomShape(room) {
    return {
      shape: room.shape === 'circle' ? 'circle' : 'rectangle',
      widthCm: room.widthCm,
      lengthCm: room.lengthCm,
      heightCm: room.heightCm,
      diameterCm: room.diameterCm || room.widthCm
    };
  }

  function wallsOf(room) {
    return G.getWalls(designRoomShape(room));
  }

  /* Where an opening (door/window) sits in the level plan, and which way it faces. */
  function openingPose(room, opening) {
    if (!room || !opening) return null;
    const wall = wallsOf(room).find(function (w) { return w.id === opening.wall; });
    if (!wall) return null;
    const offset = U.clamp(Number(opening.offsetCm) || 0, 0, wall.lengthCm);
    const p = G.wallPoint(wall, offset);
    const at = toLevel(room, p.x, p.z);
    const inward = rotateVec(wall.inward.x, wall.inward.z, room.rot);
    const along = rotateVec(wall.dir.x, wall.dir.z, room.rot);
    const halfW = (Number(opening.widthCm) || 90) / 2;
    return {
      roomId: room.id,
      openingId: opening.id,
      type: opening.type,
      x: at.x,
      z: at.z,
      inward: inward,
      outward: { x: -inward.x, z: -inward.z },
      along: along,
      halfW: halfW,
      wall: wall,
      sillCm: Number(opening.sillCm) || 0,
      heightCm: Number(opening.heightCm) || 200,
      widthCm: Number(opening.widthCm) || 90,
      inwardDeg: Math.atan2(inward.z, inward.x) * 180 / Math.PI
    };
  }

  function openingsOf(room) {
    const design = designCache.get(room.designId);
    if (!design || !Array.isArray(design.structuralItems)) return [];
    return design.structuralItems.filter(function (item) { return item.type === 'door'; });
  }

  function allOpeningsOf(room) {
    const design = designCache.get(room.designId);
    if (!design || !Array.isArray(design.structuralItems)) return [];
    return design.structuralItems;
  }

  function openingInRoom(roomId, openingId) {
    const room = roomById(roomId);
    if (!room) return null;
    return allOpeningsOf(room).find(function (item) { return item.id === openingId; }) || null;
  }

  function linkForOpening(roomId, openingId) {
    if (!home) return null;
    return home.links.find(function (link) {
      return (link.fromRoomId === roomId && link.fromOpeningId === openingId) ||
        (link.toRoomId === roomId && link.toOpeningId === openingId);
    }) || null;
  }

  function linkPartner(link, roomId) {
    if (!link || !home) return null;
    if (link.fromRoomId === roomId) {
      return { roomId: link.toRoomId, openingId: link.toOpeningId, link: link };
    }
    if (link.toRoomId === roomId) {
      return { roomId: link.fromRoomId, openingId: link.fromOpeningId, link: link };
    }
    return null;
  }

  function roomHasLink(room) {
    if (!room) return false;
    return openingsOf(room).some(function (door) {
      return !!linkForOpening(room.id, door.id);
    });
  }

  function rectsOverlap(a, b, gap) {
    const g = gap || 0;
    return a.x < b.x + b.w + g && a.x + a.w + g > b.x && a.z < b.z + b.d + g && a.z + a.d + g > b.z;
  }

  function collides(roomId, rect) {
    return rooms().some(function (other) {
      if (other.id === roomId) return false;
      return rectsOverlap(rect, rectOf(other), 0);
    });
  }

  function canPlaceRoom(room, delta) {
    const f = footprint(room);
    return !collides(room.id, {
      x: room.xCm + delta.x,
      z: room.zCm + delta.z,
      w: f.w,
      d: f.d
    });
  }

  function snap(value) {
    return Math.round(value / H.SNAP_CM) * H.SNAP_CM;
  }

  /* Rooms are packed left to right in rows so a new design always lands somewhere
     visible; the user then drags it into place. */
  function packSpot(room, existing) {
    const gap = H.PACK_GAP_CM;
    const pageW = H.PACK_PAGE_CM;
    const f = { w: room.widthCm, d: room.lengthCm };
    let cursorX = 0;
    let rowZ = 0;
    let rowH = 0;
    const taken = (existing || []).map(rectOf);
    for (let attempt = 0; attempt < 400; attempt++) {
      if (cursorX + f.w > pageW) { cursorX = 0; rowZ += rowH + gap; rowH = 0; }
      const rect = { x: snap(cursorX), z: snap(rowZ), w: f.w, d: f.d };
      const blocked = taken.some(function (t) { return rectsOverlap(rect, t, gap); });
      if (!blocked) return { x: rect.x, z: rect.z };
      cursorX += Math.max(60, f.w * 0.25);
      rowH = Math.max(rowH, f.d);
    }
    return { x: snap(cursorX), z: snap(rowZ + rowH + gap) };
  }

  function addRoom(options) {
    const bad = guard();
    if (bad) return bad;
    const opts = options || {};
    if (!opts.designId) return { ok: false, error: 'Choose a saved room first.' };
    if (home.rooms.length >= H.MAX_ROOMS) {
      return { ok: false, error: 'A home is limited to ' + H.MAX_ROOMS + ' rooms.' };
    }
    if (home.rooms.some(function (r) { return r.designId === opts.designId; })) {
      return { ok: false, error: 'That room design is already in the home. Duplicate the design first if you need it twice.' };
    }
    const design = designCache.get(opts.designId);
    if (!design) return { ok: false, error: 'That saved design could not be read.' };
    const dims = design.room || {};
    const room = {
      id: U.uid('room'),
      designId: String(opts.designId),
      xCm: 0,
      zCm: 0,
      rot: [0, 90, 180, 270].indexOf(Number(opts.rot)) >= 0 ? Number(opts.rot) : 0,
      widthCm: Number(dims.widthCm) || C.ROOM.DEFAULT_WIDTH_CM,
      lengthCm: Number(dims.lengthCm) || C.ROOM.DEFAULT_LENGTH_CM,
      heightCm: Number(dims.heightCm) || C.ROOM.DEFAULT_HEIGHT_CM,
      diameterCm: Number(dims.diameterCm) || Number(dims.widthCm) || C.ROOM.DEFAULT_WIDTH_CM,
      shape: dims.shape === 'circle' ? 'circle' : 'rectangle',
      label: String(opts.label || '').slice(0, 40)
    };
    const spot = packSpot(room, home.rooms);
    room.xCm = spot.x;
    room.zCm = spot.z;
    home.rooms.push(room);
    commit('room-add');
    return { ok: true, room: room };
  }

  function removeRoom(id) {
    const bad = guard();
    if (bad) return bad;
    const index = home.rooms.findIndex(function (r) { return r.id === id; });
    if (index < 0) return { ok: false, error: 'That room is no longer in the home.' };
    home.rooms.splice(index, 1);
    home.links = home.links.filter(function (l) { return l.fromRoomId !== id && l.toRoomId !== id; });
    commit('room-remove');
    return { ok: true };
  }

  /* The same saved design can appear twice in a home (two identical bedrooms),
     as long as each copy is its own room with its own links. */
  function duplicateRoom(id) {
    const bad = guard();
    if (bad) return bad;
    const source = roomById(id);
    if (!source) return { ok: false, error: 'That room is no longer in the home.' };
    if (home.rooms.length >= H.MAX_ROOMS) {
      return { ok: false, error: 'A home is limited to ' + H.MAX_ROOMS + ' rooms.' };
    }
    const copy = U.deepClone(source);
    copy.id = U.uid('room');
    copy.label = '';
    const spot = packSpot(copy, home.rooms);
    copy.xCm = spot.x;
    copy.zCm = spot.z;
    home.rooms.push(copy);
    commit('room-add');
    return { ok: true, room: copy };
  }

  function setRoomLabel(id, label) {
    const bad = guard();
    if (bad) return bad;
    const room = roomById(id);
    if (!room) return { ok: false, error: 'That room is no longer in the home.' };
    room.label = String(label || '').slice(0, 40);
    commit('room-label');
    return { ok: true, room: room };
  }

  function moveRoom(id, x, z) {
    const bad = guard();
    if (bad) return bad;
    const room = roomById(id);
    if (!room) return { ok: false, error: 'That room is no longer in the home.' };
    const nx = snap(Number(x));
    const nz = snap(Number(z));
    if (!U.isFiniteNumber(nx) || !U.isFiniteNumber(nz)) return { ok: false, error: 'Room position must be a number.' };
    const rect = { x: nx, z: nz, w: footprint(room).w, d: footprint(room).d };
    if (collides(room.id, rect)) return { ok: false, error: 'blocked', collided: true };
    room.xCm = nx;
    room.zCm = nz;
    commit('room-move');
    return { ok: true, room: room };
  }

  /* Drag helper: try the requested spot, then slide on one axis, then give up. */
  function tryMoveRoom(id, x, z) {
    const room = roomById(id);
    if (!room) return { ok: false };
    const direct = moveRoom(id, x, z);
    if (direct.ok) return direct;
    const alongX = moveRoom(id, x, room.zCm);
    if (alongX.ok) return alongX;
    const alongZ = moveRoom(id, room.xCm, z);
    if (alongZ.ok) return alongZ;
    return { ok: false, error: 'blocked', collided: true };
  }

  function rotateRoom(id, stepDeg) {
    const bad = guard();
    if (bad) return bad;
    const room = roomById(id);
    if (!room) return { ok: false, error: 'That room is no longer in the home.' };
    const next = ((Number(room.rot) + (Number(stepDeg) || 90)) % 360 + 360) % 360;
    const test = { x: room.xCm, z: room.zCm, w: 0, d: 0 };
    const swap = next === 90 || next === 270;
    test.w = swap ? room.lengthCm : room.widthCm;
    test.d = swap ? room.widthCm : room.lengthCm;
    if (collides(room.id, test)) {
      return { ok: false, error: 'There is not enough room to turn this room here. Move it first.' };
    }
    room.rot = next;
    commit('room-rotate');
    return { ok: true, room: room };
  }

  function relayout() {
    const bad = guard();
    if (bad) return bad;
    const list = rooms().slice();
    const placed = [];
    list.slice().sort(function (a, b) {
      return (b.widthCm * b.lengthCm) - (a.widthCm * a.lengthCm);
    }).forEach(function (room) {
      const spot = packSpot(room, placed);
      room.xCm = spot.x;
      room.zCm = spot.z;
      placed.push(room);
    });
    commit('relayout');
    return { ok: true, count: list.length };
  }

  /* ----------------------------------------------------------------- links */

  function addLink(options) {
    const bad = guard();
    if (bad) return bad;
    const opts = options || {};
    const a = roomById(opts.fromRoomId);
    const b = roomById(opts.toRoomId);
    if (!a || !b) return { ok: false, error: 'Pick two rooms that are still in the home.' };
    if (a.id === b.id) return { ok: false, error: 'A door has to connect two different rooms.' };
    if (home.links.length >= H.MAX_LINKS) return { ok: false, error: 'This home has reached its link limit.' };
    const openA = openingInRoom(a.id, opts.fromOpeningId);
    const openB = openingInRoom(b.id, opts.toOpeningId);
    if (!openA || !openB) return { ok: false, error: 'Both ends of a link must be doors.' };
    if (openA.type !== 'door' || openB.type !== 'door') return { ok: false, error: 'Only doors can be linked. Windows stay sealed.' };
    const existingA = linkForOpening(a.id, openA.id);
    const existingB = linkForOpening(b.id, openB.id);
    if (existingA || existingB) {
      home.links = home.links.filter(function (l) {
        return l.id !== (existingA && existingA.id) && l.id !== (existingB && existingB.id);
      });
    }
    const link = {
      id: U.uid('link'),
      fromRoomId: a.id,
      fromOpeningId: openA.id,
      toRoomId: b.id,
      toOpeningId: openB.id
    };
    home.links.push(link);
    commit('link-add');
    return { ok: true, link: link, replaced: !!(existingA || existingB) };
  }

  function removeLink(id) {
    const bad = guard();
    if (bad) return bad;
    const before = home.links.length;
    home.links = home.links.filter(function (l) { return l.id !== id; });
    if (home.links.length === before) return { ok: false, error: 'That link no longer exists.' };
    commit('link-remove');
    return { ok: true };
  }

  /* Suggest the closest compatible door pair for an unlinked door. Doors have
     to face each other and line up along the wall, otherwise walking through
     would teleport you sideways. */
  function suggestPartner(room, opening) {
    const pose = openingPose(room, opening);
    if (!pose) return null;
    let best = null;
    rooms().forEach(function (other) {
      if (other.id === room.id) return;
      openingsOf(other).forEach(function (candidate) {
        if (linkForOpening(other.id, candidate.id)) return;
        const otherPose = openingPose(other, candidate);
        if (!otherPose) return;
        const facing = otherPose.inward.x * pose.outward.x + otherPose.inward.z * pose.outward.z;
        if (facing <= 0.5) return;
        const lateral = Math.abs((otherPose.x - pose.x) * pose.along.x + (otherPose.z - pose.z) * pose.along.z);
        if (lateral > 80) return;
        const distance = Math.hypot(otherPose.x - pose.x, otherPose.z - pose.z);
        const score = distance + lateral * 0.5;
        if (!best || score < best.score) best = { room: other, opening: candidate, pose: otherPose, distance: distance, lateral: lateral, score: score };
      });
    });
    return best;
  }

  /* ------------------------------------------------------ partner doorways */

  function levelWall(room, wallId) {
    const wall = wallsOf(room).find(function (w) { return w.id === wallId; });
    if (!wall) return null;
    return {
      wall: wall,
      start: toLevel(room, wall.start.x, wall.start.z),
      dir: rotateVec(wall.dir.x, wall.dir.z, room.rot),
      outward: rotateVec(wall.outward.x, wall.outward.z, room.rot),
      lengthCm: wall.lengthCm
    };
  }

  /* The one wall of a rectangular room that looks back at a doorway. */
  function wallFacing(room, outward) {
    let best = null;
    wallsOf(room).forEach(function (wall) {
      const out = rotateVec(wall.outward.x, wall.outward.z, room.rot);
      const dot = out.x * outward.x + out.z * outward.z;
      if (!best || dot < best.dot) best = { wall: wall, outward: out, dot: dot };
    });
    return best && best.dot < -0.9 ? best : null;
  }

  function nearestRoomsFor(room, opening, limit) {
    const pose = openingPose(room, opening);
    if (!pose) return [];
    const list = [];
    rooms().forEach(function (other) {
      if (other.id === room.id || other.shape === 'circle') return;
      const rect = rectOf(other);
      const dx = Math.max(rect.x - pose.x, 0, pose.x - (rect.x + rect.w));
      const dz = Math.max(rect.z - pose.z, 0, pose.z - (rect.z + rect.d));
      list.push({ room: other, distance: Math.hypot(dx, dz) });
    });
    list.sort(function (a, b) { return a.distance - b.distance; });
    return limit ? list.slice(0, limit) : list;
  }

  function nearestRoomFor(room, opening) {
    return nearestRoomsFor(room, opening, 1)[0] || null;
  }

  /* Joins a door to another room even when that room has no door of its own.
     The room is slid against the doorway (only when it is not already there)
     and a matching door is carved into its facing wall, then both are linked. */
  function connectDoor(fromRoomId, fromOpeningId, toRoomId) {
    const bad = guard();
    if (bad) return bad;
    const source = roomById(fromRoomId);
    const target = roomById(toRoomId);
    if (!source || !target) return { ok: false, error: 'Pick two rooms that are still in the home.' };
    if (source.id === target.id) return { ok: false, error: 'A door has to connect two different rooms.' };
    const sourceOpening = openingInRoom(source.id, fromOpeningId);
    if (!sourceOpening || sourceOpening.type !== 'door') return { ok: false, error: 'Choose a door in the first room.' };
    if (target.shape === 'circle') return { ok: false, error: 'Round rooms have no straight wall to cut a doorway into.' };
    const linked = linkForOpening(source.id, sourceOpening.id);
    if (!linked && home.links.length >= H.MAX_LINKS) return { ok: false, error: 'This home has reached its link limit.' };
    const pose = openingPose(source, sourceOpening);
    if (!pose) return { ok: false, error: 'That door could not be located on the plan.' };
    const facing = wallFacing(target, pose.outward);
    if (!facing) return { ok: false, error: 'No wall of that room can face this door. Rotate the room and try again.' };
    const line = levelWall(target, facing.wall.id);
    if (!line) return { ok: false, error: 'That room has no usable wall for a doorway.' };

    const spec = C.STRUCTURAL.DOOR;
    const widthCm = U.clamp(Number(sourceOpening.widthCm) || spec.defaultWidthCm, spec.minWidthCm, spec.maxWidthCm);
    const heightCm = U.clamp(Number(sourceOpening.heightCm) || spec.defaultHeightCm, spec.minHeightCm, spec.maxHeightCm);
    const margin = widthCm / 2 + C.STRUCTURAL.OPENING_GAP_CM;
    if (line.lengthCm < margin * 2) return { ok: false, error: 'That wall is too short for a door this wide.' };
    const along = (pose.x - line.start.x) * line.dir.x + (pose.z - line.start.z) * line.dir.z;
    const targetOffset = U.clamp(along, margin, line.lengthCm - margin);
    const doorPoint = {
      x: line.start.x + line.dir.x * targetOffset,
      z: line.start.z + line.dir.z * targetOffset
    };
    const gap = (pose.x - line.start.x) * line.outward.x + (pose.z - line.start.z) * line.outward.z;

    /* Prefer sliding the dead-end room itself onto the doorway. Moving the room
       that already has working links would tear those doorways apart, so only
       the room without links is allowed to move. */
    const sourceDelta = { x: doorPoint.x - pose.x, z: doorPoint.z - pose.z };
    const targetDelta = {
      x: line.outward.x * gap + line.dir.x * (along - targetOffset),
      z: line.outward.z * gap + line.dir.z * (along - targetOffset)
    };
    const sourceLinked = roomHasLink(source);
    const targetLinked = roomHasLink(target);
    let mover = null;
    let delta = { x: 0, z: 0 };
    if (Math.abs(sourceDelta.x) <= 0.6 && Math.abs(sourceDelta.z) <= 0.6) {
      delta = { x: 0, z: 0 };
    } else if (!sourceLinked && canPlaceRoom(source, sourceDelta)) {
      mover = source;
      delta = sourceDelta;
    } else if (!targetLinked && canPlaceRoom(target, targetDelta)) {
      mover = target;
      delta = targetDelta;
    } else {
      return { ok: false, error: 'The rooms cannot be moved together without overlapping. Move them closer in the plan first.' };
    }
    let shift = null;
    if (mover && (Math.abs(delta.x) > 0.6 || Math.abs(delta.z) > 0.6)) {
      shift = delta;
      mover.xCm += delta.x;
      mover.zCm += delta.z;
      if (App.Home3D && App.Home3D.nudgeWalker) App.Home3D.nudgeWalker(delta.x, delta.z);
    }
    const moved = !!shift;
    function rollbackMove() {
      if (!shift) return;
      mover.xCm -= shift.x;
      mover.zCm -= shift.z;
      if (App.Home3D && App.Home3D.nudgeWalker) App.Home3D.nudgeWalker(-shift.x, -shift.z);
      shift = null;
    }

    const design = designCache.get(target.designId);
    if (!design) {
      rollbackMove();
      return { ok: false, error: 'The room design could not be read from this browser.' };
    }
    if (!Array.isArray(design.structuralItems)) design.structuralItems = [];

    let opening = openingsOf(target).find(function (item) {
      if (linkForOpening(target.id, item.id)) return false;
      return item.wall === facing.wall.id && Math.abs(Number(item.offsetCm) - targetOffset) <= 30;
    });

    const style = C.STRUCTURAL.DOOR_STYLES[sourceOpening.style] ? sourceOpening.style : C.STRUCTURAL.DEFAULT_DOOR_STYLE;
    let created = false;
    if (!opening) {
      const item = {
        id: U.uid('opening'),
        type: 'door',
        wall: facing.wall.id,
        offsetCm: targetOffset,
        widthCm: widthCm,
        heightCm: heightCm,
        sillCm: 0,
        style: style
      };
      const validation = G.validateStructuralItem(design, item);
      if (validation.errors.length) {
        rollbackMove();
        return { ok: false, error: validation.errors[0] };
      }
      const active = App.State && App.State.get ? App.State.get() : null;
      if (active && active.id === design.id) {
        const added = App.State.addStructural('door', item.wall, item.offsetCm, {
          widthCm: item.widthCm, heightCm: item.heightCm, style: item.style
        });
        if (!added.ok) {
          rollbackMove();
          return added;
        }
        opening = added.item;
        if (design !== active) {
          design.structuralItems.push(U.deepClone(added.item));
          design.updatedAt = nowIso();
          App.Storage.saveDesign(design).catch(function (err) { console.error('Partner door could not be saved:', err); });
        }
      } else {
        design.structuralItems.push(item);
        design.updatedAt = nowIso();
        App.Storage.saveDesign(design).catch(function (err) { console.error('Partner door could not be saved:', err); });
        opening = item;
      }
      created = true;
    }

    const result = addLink({
      fromRoomId: source.id,
      fromOpeningId: sourceOpening.id,
      toRoomId: target.id,
      toOpeningId: opening.id
    });
    if (!result.ok) {
      rollbackMove();
      return result;
    }
    return {
      ok: true,
      link: result.link,
      room: target,
      openingId: opening.id,
      moved: moved,
      created: created
    };
  }

  function autoLink() {
    const bad = guard();
    if (bad) return bad;
    let created = 0;
    let moved = 0;
    let addedDoors = 0;
    home.rooms.forEach(function (room) {
      openingsOf(room).forEach(function (opening) {
        if (linkForOpening(room.id, opening.id)) return;
        if (home.links.length >= H.MAX_LINKS) return;
        const best = suggestPartner(room, opening);
        if (!best || best.distance > 260) return;
        const result = addLink({
          fromRoomId: room.id,
          fromOpeningId: opening.id,
          toRoomId: best.room.id,
          toOpeningId: best.opening.id
        });
        if (result.ok) created++;
      });
    });
    /* Rooms that still have no way in get a fresh doorway cut into the nearest
       neighbour, so a walk-through is never a dead end. */
    home.rooms.forEach(function (room) {
      if (room.shape === 'circle') return;
      const doors = openingsOf(room);
      if (!doors.length) return;
      const hasLink = doors.some(function (door) { return linkForOpening(room.id, door.id); });
      if (hasLink) return;
      if (home.links.length >= H.MAX_LINKS) return;
      for (let i = 0; i < doors.length; i++) {
        if (linkForOpening(room.id, doors[i].id)) continue;
        const candidates = nearestRoomsFor(room, doors[i], 3);
        let joined = false;
        for (let c = 0; c < candidates.length; c++) {
          const result = connectDoor(room.id, doors[i].id, candidates[c].room.id);
          if (!result.ok) continue;
          created++;
          if (result.moved) moved++;
          if (result.created) addedDoors++;
          joined = true;
          break;
        }
        if (joined) break;
      }
    });
    return { ok: true, created: created, moved: moved, addedDoors: addedDoors };
  }

  /* ------------------------------------------------------------- diagnostics */

  function issues() {
    const list = [];
    if (!home) return list;
    const seen = {};
    home.rooms.forEach(function (room) {
      const rect = rectOf(room);
      home.rooms.forEach(function (other) {
        if (other.id === room.id) return;
        const key = [room.id, other.id].sort().join('|');
        if (seen[key]) return;
        seen[key] = true;
        if (rectsOverlap(rect, rectOf(other), -1)) {
          list.push({ code: 'overlap', severity: 'error', roomId: room.id, message: 'Two rooms overlap on the plan.' });
        }
      });
      if (!designCache.has(room.designId) && !room.designId) {
        list.push({ code: 'design', severity: 'error', roomId: room.id, message: 'A room has no design reference.' });
      }
      const openings = allOpeningsOf(room);
      if (openings.length) {
        openings.filter(function (o) { return o.type === 'door'; }).forEach(function (door) {
          if (!linkForOpening(room.id, door.id)) {
            list.push({
              code: 'unlinked',
              severity: 'warning',
              roomId: room.id,
              openingId: door.id,
              message: 'A door in ' + (designName(room) || 'a room') + ' leads nowhere yet.'
            });
          }
        });
      }
    });
    const orphan = home.rooms.length > 0 && home.links.length === 0;
    if (orphan) {
      list.push({ code: 'islands', severity: 'warning', message: 'No doors connect the rooms yet, so walk mode cannot move between them.' });
    }
    return list;
  }

  function designName(room) {
    if (!room) return null;
    if (room.label) return room.label;
    const design = designCache.get(room.designId);
    return design ? design.name : null;
  }

  function stats() {
    if (!home) return { rooms: 0, areaSqm: 0, links: 0, items: 0, price: 0 };
    let area = 0;
    let items = 0;
    let price = 0;
    home.rooms.forEach(function (room) {
      area += G.roomAreaSqm(designRoomShape(room));
      const design = designCache.get(room.designId);
      if (design) {
        items += (design.placedItems || []).length;
        if (App.Pricing && App.Pricing.summarize) {
          const summary = App.Pricing.summarize(design, App.Catalog.getProductsById());
          price += Number(summary && summary.total) || 0;
        }
      }
    });
    return {
      rooms: home.rooms.length,
      areaSqm: area,
      links: home.links.length,
      items: items,
      price: price
    };
  }

  /* ---------------------------------------------------------- design access */

  function primeDesign(designId, design) {
    if (!designId || !design) return;
    designCache.set(String(designId), design);
  }

  function cachedDesign(designId) {
    return designCache.get(String(designId)) || null;
  }

  function loadDesign(designId) {
    const id = String(designId);
    if (designCache.has(id)) return Promise.resolve(designCache.get(id));
    if (designRequests.has(id)) return designRequests.get(id);
    const request = App.Storage.getDesign(id).then(function (envelope) {
      designRequests.delete(id);
      const design = envelope && envelope.design ? envelope.design : null;
      if (design) designCache.set(id, design);
      return design;
    }).catch(function (err) {
      designRequests.delete(id);
      console.warn('Home design could not be read:', err);
      return null;
    });
    designRequests.set(id, request);
    return request;
  }

  function ensureDesigns() {
    if (!home) return Promise.resolve([]);
    const missing = home.rooms.filter(function (room) { return !designCache.has(room.designId); });
    if (!missing.length) return Promise.resolve(home.rooms);
    return Promise.all(missing.map(function (room) { return loadDesign(room.designId); })).then(function () {
      return home.rooms;
    });
  }

  function invalidateDesign(designId) {
    designCache.delete(String(designId));
  }

  function refreshRoomDims(room) {
    const design = designCache.get(room.designId);
    if (!design || !design.room) return false;
    const dims = design.room;
    const changed = room.widthCm !== Number(dims.widthCm) || room.lengthCm !== Number(dims.lengthCm) ||
      room.heightCm !== Number(dims.heightCm) || room.shape !== (dims.shape === 'circle' ? 'circle' : 'rectangle');
    if (!changed) return false;
    room.widthCm = Number(dims.widthCm) || room.widthCm;
    room.lengthCm = Number(dims.lengthCm) || room.lengthCm;
    room.heightCm = Number(dims.heightCm) || room.heightCm;
    room.diameterCm = Number(dims.diameterCm) || room.widthCm;
    room.shape = dims.shape === 'circle' ? 'circle' : 'rectangle';
    return true;
  }

  function syncRoomDimensions() {
    let changed = false;
    if (!home) return false;
    home.rooms.forEach(function (room) { if (refreshRoomDims(room)) changed = true; });
    if (changed) commit('room-dims');
    return changed;
  }

  function setName(name) {
    const bad = guard();
    if (bad) return bad;
    home.name = String(name || home.name).trim().slice(0, 60) || home.name;
    commit('name');
    return { ok: true };
  }

  App.Home = {
    create: createHome,
    normalizeHome: normalizeHome,
    init: init,
    get: get,
    subscribe: subscribe,
    setName: setName,

    rooms: rooms,
    roomById: roomById,
    footprint: footprint,
    rectOf: rectOf,
    centerOf: centerOf,
    homeBounds: homeBounds,
    centerOfHome: centerOfHome,
    toLevel: toLevel,
    toDesignPoint: toDesignPoint,
    designRoomShape: designRoomShape,
    wallsOf: wallsOf,
    openingPose: openingPose,
    openingsOf: openingsOf,
    allOpeningsOf: allOpeningsOf,
    openingInRoom: openingInRoom,
    addRoom: addRoom,
    removeRoom: removeRoom,
    duplicateRoom: duplicateRoom,
    setRoomLabel: setRoomLabel,
    moveRoom: moveRoom,
    tryMoveRoom: tryMoveRoom,
    rotateRoom: rotateRoom,
    relayout: relayout,
    collides: collides,
    snap: snap,
    designName: designName,

    links: function () { return home ? home.links : []; },
    addLink: addLink,
    removeLink: removeLink,
    linkForOpening: linkForOpening,
    linkPartner: linkPartner,
    suggestPartner: suggestPartner,
    connectDoor: connectDoor,
    nearestRoomFor: nearestRoomFor,
    nearestRoomsFor: nearestRoomsFor,
    autoLink: autoLink,

    issues: issues,
    stats: stats,
    primeDesign: primeDesign,
    cachedDesign: cachedDesign,
    loadDesign: loadDesign,
    ensureDesigns: ensureDesigns,
    invalidateDesign: invalidateDesign,
    syncRoomDimensions: syncRoomDimensions
  };
})(window.App = window.App || {});
