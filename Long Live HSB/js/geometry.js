(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;
  const EPS = 0.001;

  function isCircle(room) { return !!room && room.shape === 'circle'; }

  function roomSize(room) {
    if (!room) return { width: 0, length: 0 };
    if (room.shape === 'circle') {
      const d = Number(room.diameterCm) || 0;
      return { width: d, length: d };
    }
    return { width: Number(room.widthCm) || 0, length: Number(room.lengthCm) || 0 };
  }

  function roomRadius(room) {
    return isCircle(room) ? (Number(room.diameterCm) || 0) / 2 : 0;
  }

  function roomCenter(room) {
    const s = roomSize(room);
    return { x: s.width / 2, z: s.length / 2 };
  }

  function roomAreaSqm(room) {
    const s = roomSize(room);
    if (!s.width || !s.length) return 0;
    if (isCircle(room)) return Math.PI * Math.pow(s.width / 2, 2) / 10000;
    return s.width * s.length / 10000;
  }

  function roomShapeLabel(room) {
    if (!room) return '—';
    if (room.shape === 'circle') return 'Circular';
    if (room.shape === 'square') return 'Square';
    return 'Rectangular';
  }

  function roomBounds(room) {
    const s = roomSize(room);
    if (isCircle(room)) {
      const c = s.width / 2;
      return { minX: 0, minZ: 0, maxX: s.width, maxZ: s.length, centerX: c, centerZ: c, radius: c };
    }
    return { minX: 0, minZ: 0, maxX: s.width, maxZ: s.length, centerX: s.width / 2, centerZ: s.length / 2, radius: null };
  }

  function pointInRoom(room, x, z, margin) {
    const m = margin || 0;
    const s = roomSize(room);
    if (isCircle(room)) {
      const cx = s.width / 2;
      const cz = s.length / 2;
      const r = s.width / 2 - m;
      if (r <= 0) return false;
      return Math.hypot(x - cx, z - cz) <= r + EPS;
    }
    return x >= m - EPS && z >= m - EPS && x <= s.width - m + EPS && z <= s.length - m + EPS;
  }

  function getWalls(room) {
    if (!room || isCircle(room)) return [];
    const s = roomSize(room);
    return [
      { id: 'north', label: 'North wall', lengthCm: s.width, start: { x: 0, z: 0 }, dir: { x: 1, z: 0 }, inward: { x: 0, z: 1 }, outward: { x: 0, z: -1 } },
      { id: 'east', label: 'East wall', lengthCm: s.length, start: { x: s.width, z: 0 }, dir: { x: 0, z: 1 }, inward: { x: -1, z: 0 }, outward: { x: 1, z: 0 } },
      { id: 'south', label: 'South wall', lengthCm: s.width, start: { x: s.width, z: s.length }, dir: { x: -1, z: 0 }, inward: { x: 0, z: -1 }, outward: { x: 0, z: 1 } },
      { id: 'west', label: 'West wall', lengthCm: s.length, start: { x: 0, z: s.length }, dir: { x: 0, z: -1 }, inward: { x: 1, z: 0 }, outward: { x: -1, z: 0 } }
    ];
  }

  function getWall(room, wallId) {
    return getWalls(room).find(function (w) { return w.id === wallId; }) || null;
  }

  function wallPoint(wall, offsetCm) {
    return { x: wall.start.x + wall.dir.x * offsetCm, z: wall.start.z + wall.dir.z * offsetCm };
  }

  function nearestWallPoint(room, x, z) {
    const walls = getWalls(room);
    if (!walls.length) return null;
    let best = null;
    walls.forEach(function (wall) {
      const t = (x - wall.start.x) * wall.dir.x + (z - wall.start.z) * wall.dir.z;
      const offset = U.clamp(t, 0, wall.lengthCm);
      const p = wallPoint(wall, offset);
      const distance = Math.hypot(x - p.x, z - p.z);
      if (!best || distance < best.distance) best = { wall: wall, offsetCm: offset, distance: distance, x: p.x, z: p.z };
    });
    return best;
  }

  function rotationRad(deg) { return U.degToRad(deg || 0); }

  function rotateVec(x, z, deg) {
    const r = rotationRad(deg);
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return { x: x * cos - z * sin, z: x * sin + z * cos };
  }

  function cornersFor(x, z, widthCm, lengthCm, rotationDeg) {
    const hw = widthCm / 2;
    const hl = lengthCm / 2;
    const local = [
      { x: -hw, z: -hl }, { x: hw, z: -hl }, { x: hw, z: hl }, { x: -hw, z: hl }
    ];
    const r = rotationRad(rotationDeg);
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return local.map(function (p) {
      return { x: x + p.x * cos - p.z * sin, z: z + p.x * sin + p.z * cos };
    });
  }

  function pointInOBB(px, pz, x, z, widthCm, lengthCm, rotationDeg) {
    const r = -rotationRad(rotationDeg);
    const dx = px - x;
    const dz = pz - z;
    const u = dx * Math.cos(r) - dz * Math.sin(r);
    const v = dx * Math.sin(r) + dz * Math.cos(r);
    return Math.abs(u) <= widthCm / 2 + EPS && Math.abs(v) <= lengthCm / 2 + EPS;
  }

  function circleOverlapsObb(cx, cz, radiusCm, x, z, widthCm, lengthCm, rotationDeg) {
    const r = -rotationRad(rotationDeg);
    const dx = cx - x;
    const dz = cz - z;
    const u = dx * Math.cos(r) - dz * Math.sin(r);
    const v = dx * Math.sin(r) + dz * Math.cos(r);
    const nearestU = U.clamp(u, -widthCm / 2, widthCm / 2);
    const nearestV = U.clamp(v, -lengthCm / 2, lengthCm / 2);
    return Math.hypot(u - nearestU, v - nearestV) < radiusCm;
  }

  function aabbFor(x, z, widthCm, lengthCm, rotationDeg) {
    const cs = cornersFor(x, z, widthCm, lengthCm, rotationDeg);
    const xs = cs.map(function (p) { return p.x; });
    const zs = cs.map(function (p) { return p.z; });
    return { minX: Math.min.apply(null, xs), maxX: Math.max.apply(null, xs), minZ: Math.min.apply(null, zs), maxZ: Math.max.apply(null, zs) };
  }

  function footprintInsideRoom(room, x, z, widthCm, lengthCm, rotationDeg, margin) {
    const m = margin || 0;
    const s = roomSize(room);
    if (!s.width || !s.length) return false;
    if (isCircle(room)) {
      const cx = s.width / 2;
      const cz = s.length / 2;
      const r = s.width / 2 - m;
      if (r <= 0) return false;
      const corners = cornersFor(x, z, widthCm, lengthCm, rotationDeg);
      for (let i = 0; i < corners.length; i++) {
        if (Math.hypot(corners[i].x - cx, corners[i].z - cz) > r + EPS) return false;
      }
      return true;
    }
    const a = aabbFor(x, z, widthCm, lengthCm, rotationDeg);
    return a.minX >= m - EPS && a.minZ >= m - EPS && a.maxX <= s.width - m + EPS && a.maxZ <= s.length - m + EPS;
  }

  function projectedHalfExtents(widthCm, lengthCm, rotationDeg) {
    const r = rotationRad(rotationDeg);
    const cos = Math.abs(Math.cos(r));
    const sin = Math.abs(Math.sin(r));
    return {
      hx: (widthCm * cos + lengthCm * sin) / 2,
      hz: (widthCm * sin + lengthCm * cos) / 2
    };
  }

  function clampCenterToRoom(room, widthCm, lengthCm, rotationDeg, x, z, margin) {
    const m = margin || 0;
    const s = roomSize(room);
    if (isCircle(room)) {
      const cx = s.width / 2;
      const cz = s.length / 2;
      const corners = cornersFor(0, 0, widthCm, lengthCm, rotationDeg);
      let maxCorner = 0;
      corners.forEach(function (p) { maxCorner = Math.max(maxCorner, Math.hypot(p.x, p.z)); });
      const maxOffset = s.width / 2 - m - maxCorner;
      if (maxOffset < 0) return null;
      const dx = x - cx;
      const dz = z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist <= maxOffset + EPS) return { x: x, z: z };
      const k = maxOffset / (dist || 1);
      return { x: cx + dx * k, z: cz + dz * k };
    }
    const ext = projectedHalfExtents(widthCm, lengthCm, rotationDeg);
    const minX = ext.hx + m;
    const maxX = s.width - ext.hx - m;
    const minZ = ext.hz + m;
    const maxZ = s.length - ext.hz - m;
    if (minX > maxX + EPS || minZ > maxZ + EPS) return null;
    return { x: U.clamp(x, minX, maxX), z: U.clamp(z, minZ, maxZ) };
  }

  function obbOverlap(a, b) {
    const wa = (a.widthCm || 0) / 2 + (a.pad || 0);
    const ha = (a.lengthCm || 0) / 2 + (a.pad || 0);
    const wb = (b.widthCm || 0) / 2 + (b.pad || 0);
    const hb = (b.lengthCm || 0) / 2 + (b.pad || 0);
    if (wa <= 0 || ha <= 0 || wb <= 0 || hb <= 0) return false;
    const ca = cornersFor(a.x, a.z, wa * 2, ha * 2, a.rotationDeg || 0);
    const cb = cornersFor(b.x, b.z, wb * 2, hb * 2, b.rotationDeg || 0);
    const axes = [];
    const ra = rotationRad(a.rotationDeg || 0);
    const rb = rotationRad(b.rotationDeg || 0);
    axes.push({ x: Math.cos(ra), z: Math.sin(ra) });
    axes.push({ x: -Math.sin(ra), z: Math.cos(ra) });
    axes.push({ x: Math.cos(rb), z: Math.sin(rb) });
    axes.push({ x: -Math.sin(rb), z: Math.cos(rb) });
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
      let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
      ca.forEach(function (p) {
        const d = p.x * axis.x + p.z * axis.z;
        minA = Math.min(minA, d); maxA = Math.max(maxA, d);
      });
      cb.forEach(function (p) {
        const d = p.x * axis.x + p.z * axis.z;
        minB = Math.min(minB, d); maxB = Math.max(maxB, d);
      });
      if (maxA <= minB + EPS || maxB <= minA + EPS) return false;
    }
    return true;
  }

  function placedFootprint(item, product, overrides) {
    const o = overrides || {};
    return {
      x: overrides && U.isFiniteNumber(overrides.x) ? overrides.x : item.xCm,
      z: overrides && U.isFiniteNumber(overrides.z) ? overrides.z : item.zCm,
      widthCm: product ? product.widthCm : 40,
      lengthCm: product ? product.lengthCm : 40,
      rotationDeg: overrides && U.isFiniteNumber(overrides.rotationDeg) ? overrides.rotationDeg : (item.rotationDeg || 0),
      pad: o.pad || 0
    };
  }

  function placedItemFootprint(design, item, product, overrides) {
    return placedFootprint(item, product, overrides);
  }

  function structuralSpan(item) {
    const half = (Number(item.widthCm) || 0) / 2;
    return { left: (Number(item.offsetCm) || 0) - half, right: (Number(item.offsetCm) || 0) + half, center: Number(item.offsetCm) || 0 };
  }

  function structuralRect(design, item) {
    const wall = getWall(design.room, item.wall);
    if (!wall) return null;
    const p = wallPoint(wall, item.offsetCm);
    const angle = Math.atan2(wall.dir.z, wall.dir.x) * 180 / Math.PI;
    return {
      x: p.x,
      z: p.z,
      widthCm: item.widthCm,
      lengthCm: 16,
      rotationDeg: angle,
      wall: wall,
      sillCm: item.type === 'window' ? (Number(item.sillCm) || 0) : 0,
      heightCm: item.heightCm
    };
  }

  function doorSwingZones(design) {
    if (!design || !design.room || isCircle(design.room)) return [];
    return (design.structuralItems || []).filter(function (item) { return item.type === 'door'; }).map(function (item) {
      const wall = getWall(design.room, item.wall);
      if (!wall) return null;
      const p = wallPoint(wall, item.offsetCm);
      const depth = Math.max(60, Number(item.widthCm) || C.STRUCTURAL.DOOR.defaultWidthCm);
      const cx = p.x + wall.inward.x * depth / 2;
      const cz = p.z + wall.inward.z * depth / 2;
      const angle = Math.atan2(wall.dir.z, wall.dir.x) * 180 / Math.PI;
      return {
        structuralId: item.id,
        x: cx,
        z: cz,
        widthCm: Number(item.widthCm) || C.STRUCTURAL.DOOR.defaultWidthCm,
        lengthCm: depth,
        rotationDeg: angle,
        pad: 0
      };
    }).filter(Boolean);
  }

  function validateStructuralItem(design, item, opts) {
    const options = opts || {};
    const errors = [];
    if (!design || !design.room) return { errors: ['No room is defined.'], warnings: [] };
    if (isCircle(design.room)) {
      errors.push('Curved walls do not support doors or windows in this version.');
      return { errors: errors, warnings: [] };
    }
    if (!item || (item.type !== 'door' && item.type !== 'window')) {
      errors.push('Opening type must be a door or window.');
      return { errors: errors, warnings: [] };
    }
    const wall = getWall(design.room, item.wall);
    if (!wall) errors.push('Choose a valid wall.');
    const width = Number(item.widthCm);
    const height = Number(item.heightCm);
    const offset = Number(item.offsetCm);
    const sill = item.type === 'window' ? Number(item.sillCm) : 0;
    if (!U.isFiniteNumber(width) || width <= 0) errors.push('Opening width must be a positive number.');
    if (!U.isFiniteNumber(height) || height <= 0) errors.push('Opening height must be a positive number.');
    if (!U.isFiniteNumber(offset)) errors.push('Wall offset must be a number.');
    if (!U.isFiniteNumber(sill) || sill < 0) errors.push('Window sill must be zero or greater.');
    if (sill + height > design.room.heightCm + EPS) errors.push('The opening would exceed the room height.');
    if (item.type === 'door' && height > design.room.heightCm) errors.push('The door is taller than the room.');
    if (wall) {
      const half = width / 2;
      if (offset - half < -EPS || offset + half > wall.lengthCm + EPS) {
        errors.push('The opening extends beyond the ' + wall.label.toLowerCase() + '.');
      }
      const others = (design.structuralItems || []).filter(function (o) {
        return o.id !== item.id && o.wall === item.wall && o.id !== options.ignoreId;
      });
      const span = { left: offset - half, right: offset + half };
      others.forEach(function (other) {
        const otherSpan = structuralSpan(other);
        if (span.right + C.STRUCTURAL.OPENING_GAP_CM > otherSpan.left && otherSpan.right + C.STRUCTURAL.OPENING_GAP_CM > span.left) {
          errors.push('This opening overlaps another opening on the same wall.');
        }
      });
    }
    return { errors: errors, warnings: [] };
  }

  function validateStructuralItems(design) {
    const results = [];
    (design.structuralItems || []).forEach(function (item) {
      const result = validateStructuralItem(design, item);
      if (result.errors.length) results.push({ item: item, errors: result.errors });
    });
    return results;
  }

  function getOverlaps(design, item, product, opts) {
    const options = opts || {};
    if (!product) return [];
    if (options.ignoreRugs !== false && product.category === 'rug') return [];
    const fp = placedFootprint(item, product, { pad: options.pad || 0 });
    const overlaps = [];
    (design.placedItems || []).forEach(function (other) {
      if (other.id === item.id) return;
      const otherProduct = options.productsById ? options.productsById[other.productId] : null;
      if (!otherProduct) return;
      if (options.ignoreRugs !== false && otherProduct.category === 'rug') return;
      if (options.skipLegitPairs !== false) {
        const catPair = [product.category, otherProduct.category].sort().join('|');
        if (catPair === 'chair|table') return;
      }
      const otherFp = { x: other.xCm, z: other.zCm, widthCm: otherProduct.widthCm, lengthCm: otherProduct.lengthCm, rotationDeg: other.rotationDeg, pad: options.pad || 0 };
      if (obbOverlap(fp, otherFp)) overlaps.push(other.id);
    });
    return overlaps;
  }

  function blocksDoorSwing(design, item, product, overrides) {
    if (!product) return [];
    const fp = placedFootprint(item, product, overrides);
    if (product.category === 'rug') return [];
    const blocked = [];
    doorSwingZones(design).forEach(function (zone) {
      const zoneFp = { x: zone.x, z: zone.z, widthCm: zone.widthCm, lengthCm: zone.lengthCm, rotationDeg: zone.rotationDeg };
      if (obbOverlap(fp, zoneFp)) blocked.push(zone.structuralId);
    });
    return blocked;
  }

  function validatePlacedItem(design, item, product, productsById) {
    const errors = [];
    const warnings = [];
    if (!product) {
      errors.push('This product is no longer available in the catalog.');
      return { errors: errors, warnings: warnings };
    }
    if (!U.isFiniteNumber(item.xCm) || !U.isFiniteNumber(item.zCm) || !U.isFiniteNumber(item.rotationDeg)) {
      errors.push('The item has invalid position data.');
      return { errors: errors, warnings: warnings };
    }
    if (!footprintInsideRoom(design.room, item.xCm, item.zCm, product.widthCm, product.lengthCm, item.rotationDeg, 0)) {
      errors.push('The item extends outside the room.');
    }
    const overlaps = getOverlaps(design, item, product, { productsById: productsById });
    if (overlaps.length) warnings.push('The footprint overlaps ' + overlaps.length + ' other item' + (overlaps.length === 1 ? '' : 's') + '.');
    const blocked = blocksDoorSwing(design, item, product);
    if (blocked.length) warnings.push('The item occupies a door clearance zone.');
    return { errors: errors, warnings: warnings };
  }

  function designIssues(design, productsById) {
    const issues = [];
    if (!design) return issues;
    const structuralProblems = validateStructuralItems(design);
    structuralProblems.forEach(function (problem) {
      problem.errors.forEach(function (message) {
        issues.push({
          id: 'structure-' + problem.item.id,
          severity: 'error',
          code: 'structural',
          message: (problem.item.type === 'door' ? 'Door' : 'Window') + ' issue: ' + message,
          structuralId: problem.item.id
        });
      });
    });
    const seenPairs = {};
    (design.placedItems || []).forEach(function (item) {
      const product = productsById ? productsById[item.productId] : null;
      const result = validatePlacedItem(design, item, product, productsById);
      result.errors.forEach(function (message) {
        issues.push({
          id: 'item-' + item.id + '-' + issues.length,
          severity: 'error',
          code: 'placement',
          message: (product ? product.name : 'Unknown product') + ': ' + message,
          instanceId: item.id
        });
      });
      result.warnings.forEach(function (message) {
        issues.push({
          id: 'warn-' + item.id + '-' + issues.length,
          severity: 'warning',
          code: 'overlap',
          message: (product ? product.name : 'Unknown product') + ': ' + message,
          instanceId: item.id
        });
      });
      if (product && product.category !== 'rug' && productsById) {
        (design.placedItems || []).forEach(function (other) {
          if (other.id === item.id) return;
          const key = [item.id, other.id].sort().join('|');
          if (seenPairs[key]) return;
          seenPairs[key] = true;
          if (other.productId === item.productId) return;
          const otherProduct = productsById[other.productId];
          if (!otherProduct || otherProduct.category === 'rug') return;
          const pair = [product.category, otherProduct.category].sort().join('|');
          if (pair === 'chair|table') return;
          const fpA = placedFootprint(item, product);
          const fpB = placedFootprint(other, otherProduct);
          if (obbOverlap(fpA, fpB)) {
            issues.push({
              id: 'pair-' + key,
              severity: 'warning',
              code: 'collision',
              message: product.name + ' and ' + otherProduct.name + ' overlap physically.',
              instanceId: item.id
            });
          }
        });
      }
    });
    return issues;
  }

  function productFitsRoom(design, product, rotationDeg) {
    if (!design || !design.room || !product) return false;
    const s = roomSize(design.room);
    if (!s.width || !s.length) return false;
    if (isCircle(design.room)) {
      const corners = cornersFor(0, 0, product.widthCm, product.lengthCm, rotationDeg || 0);
      let maxCorner = 0;
      corners.forEach(function (p) { maxCorner = Math.max(maxCorner, Math.hypot(p.x, p.z)); });
      return maxCorner <= s.width / 2 + EPS;
    }
    const ext = projectedHalfExtents(product.widthCm, product.lengthCm, rotationDeg || 0);
    return ext.hx * 2 <= s.width + EPS && ext.hz * 2 <= s.length + EPS;
  }

  function findFreeSpot(design, product, productsById, opts) {
    const options = opts || {};
    if (!design || !design.room || !product) return null;
    const s = roomSize(design.room);
    const rotations = options.rotations || (product.category === 'rug' ? [0, 90] : [0, 90, 180, 270]);
    const step = U.clamp(Math.min(product.widthCm, product.lengthCm) / 2, 15, 50);
    const pad = 5;
    const doorZones = doorSwingZones(design);
    const center = roomCenter(design.room);
    let best = null;
    let fallback = null;
    const rangeX = isCircle(design.room) ? s.width : s.width;
    const rangeZ = isCircle(design.room) ? s.length : s.length;
    for (let ix = 0; ix <= Math.ceil(rangeX / step); ix++) {
      for (let iz = 0; iz <= Math.ceil(rangeZ / step); iz++) {
        for (let ri = 0; ri < rotations.length; ri++) {
          const rot = rotations[ri];
          if (!productFitsRoom(design, product, rot)) continue;
          const x = U.clamp(ix * step, 1, s.width - 1);
          const z = U.clamp(iz * step, 1, s.length - 1);
          const clamped = clampCenterToRoom(design.room, product.widthCm, product.lengthCm, rot, x, z, 4);
          if (!clamped) continue;
          if (!footprintInsideRoom(design.room, clamped.x, clamped.z, product.widthCm, product.lengthCm, rot, 3)) continue;
          const fp = { x: clamped.x, z: clamped.z, widthCm: product.widthCm, lengthCm: product.lengthCm, rotationDeg: rot, pad: pad };
          let conflict = false;
          (design.placedItems || []).forEach(function (other) {
            const otherProduct = productsById ? productsById[other.productId] : null;
            if (!otherProduct || (product.category === 'rug') || (otherProduct.category === 'rug')) return;
            const ofp = { x: other.xCm, z: other.zCm, widthCm: otherProduct.widthCm, lengthCm: otherProduct.lengthCm, rotationDeg: other.rotationDeg, pad: 2 };
            if (obbOverlap(fp, ofp)) conflict = true;
          });
          let doorConflict = false;
          if (product.category !== 'rug') {
            doorZones.forEach(function (zone) {
              if (obbOverlap(fp, { x: zone.x, z: zone.z, widthCm: zone.widthCm, lengthCm: zone.lengthCm, rotationDeg: zone.rotationDeg, pad: 2 })) doorConflict = true;
            });
          }
          const score = Math.hypot(clamped.x - center.x, clamped.z - center.z) + (doorConflict ? 100000 : 0) + (conflict ? 100000 : 0);
          const candidate = { xCm: clamped.x, zCm: clamped.z, rotationDeg: rot, overlaps: conflict || doorConflict };
          if (!fallback || score < fallback.score) fallback = { score: score, candidate: candidate };
          if (!conflict && !doorConflict) {
            if (!best || score < best.score) best = { score: score, candidate: candidate };
          }
        }
      }
    }
    if (best) return best.candidate;
    if (options.allowOverlapFallback && fallback) return fallback.candidate;
    return null;
  }

  function nearestFreePlacement(design, product, productsById, x, z, rotationDeg) {
    const baseRot = U.normalizeDeg(rotationDeg || 0);
    const s = roomSize(design.room);
    if (!s.width || !s.length) return null;
    const target = clampCenterToRoom(design.room, product.widthCm, product.lengthCm, baseRot, x, z, 2);
    if (!target) {
      if (findFreeSpot(design, product, productsById, { allowOverlapFallback: true, rotations: [baseRot, U.normalizeDeg(baseRot + 90)] })) {
        return findFreeSpot(design, product, productsById, { allowOverlapFallback: true, rotations: [baseRot, U.normalizeDeg(baseRot + 90)] });
      }
      return null;
    }
    if (footprintInsideRoom(design.room, target.x, target.z, product.widthCm, product.lengthCm, baseRot, 0)) {
      return { xCm: target.x, zCm: target.z, rotationDeg: baseRot };
    }
    return null;
  }

  function wallRotationForBack(wall) {
    const outward = wall.outward;
    const deg = Math.atan2(-outward.x, outward.y) * 180 / Math.PI;
    return U.normalizeDeg(deg);
  }

  function circularBackRotation(angleRad) {
    const deg = angleRad * 180 / Math.PI - 90;
    return U.normalizeDeg(deg);
  }

  function roomChangeWarnings(design, room) {
    const warnings = [];
    if (!design) return warnings;
    let outside = 0;
    const productsById = App.Catalog ? App.Catalog.getProductsById() : {};
    (design.placedItems || []).forEach(function (item) {
      const product = productsById[item.productId];
      if (!product) return;
      if (!footprintInsideRoom(room, item.xCm, item.zCm, product.widthCm, product.lengthCm, item.rotationDeg, 0)) outside++;
    });
    if (outside) warnings.push(outside + ' furniture item' + (outside === 1 ? '' : 's') + ' will be outside the new room.');
    if (isCircle(room) && (design.structuralItems || []).length) warnings.push('Doors and windows must be removed for a circular room in this version.');
    const tempDesign = { room: room, structuralItems: design.structuralItems, placedItems: design.placedItems };
    validateStructuralItems(tempDesign).forEach(function (problem) {
      warnings.push((problem.item.type === 'door' ? 'A door' : 'A window') + ' will be invalid: ' + problem.errors[0]);
    });
    return warnings;
  }

  function roomLabelLines(room) {
    const s = roomSize(room);
    if (!room) return [];
    if (isCircle(room)) return ['Ø ' + U.formatNumber(s.width, 0) + ' cm', 'H ' + U.formatNumber(room.heightCm, 0) + ' cm'];
    return [U.formatNumber(s.width, 0) + ' cm', U.formatNumber(s.length, 0) + ' cm'];
  }

  /* ------------------------------------------------------- partition walls */

  function interiorWallsOf(design) {
    if (!design || !Array.isArray(design.interiorWalls)) return [];
    return design.interiorWalls;
  }

  function interiorWallLength(wall) {
    if (!wall) return 0;
    return Math.hypot(Number(wall.x2Cm) - Number(wall.x1Cm), Number(wall.z2Cm) - Number(wall.z1Cm));
  }

  function interiorWallDir(wall) {
    const length = interiorWallLength(wall) || 1;
    return { x: (Number(wall.x2Cm) - Number(wall.x1Cm)) / length, z: (Number(wall.z2Cm) - Number(wall.z1Cm)) / length };
  }

  function interiorWallPoint(wall, offsetCm) {
    const dir = interiorWallDir(wall);
    return { x: Number(wall.x1Cm) + dir.x * offsetCm, z: Number(wall.z1Cm) + dir.z * offsetCm };
  }

  function projectOnInteriorWall(wall, x, z) {
    const length = interiorWallLength(wall);
    const dir = interiorWallDir(wall);
    const t = (x - wall.x1Cm) * dir.x + (z - wall.z1Cm) * dir.z;
    const offsetCm = U.clamp(t, 0, length);
    const point = interiorWallPoint(wall, offsetCm);
    return { offsetCm: offsetCm, distance: Math.hypot(x - point.x, z - point.z), x: point.x, z: point.z };
  }

  /* An interior opening is stored as an offset from the wall start, so moving
     either endpoint keeps doors and windows attached to the wall. */
  function interiorWallOpenings(wall) {
    return wall && Array.isArray(wall.openings) ? wall.openings : [];
  }

  function interiorWallSegments(wall) {
    const length = interiorWallLength(wall);
    const openings = interiorWallOpenings(wall).map(function (opening) {
      const width = Math.max(10, Number(opening.widthCm) || 90);
      return {
        left: U.clamp((Number(opening.offsetCm) || 0) - width / 2, 0, length),
        right: U.clamp((Number(opening.offsetCm) || 0) + width / 2, 0, length)
      };
    }).filter(function (opening) { return opening.right - opening.left > 1; })
      .sort(function (a, b) { return a.left - b.left; });
    const segments = [];
    let cursor = 0;
    openings.forEach(function (opening) {
      if (opening.left > cursor + 0.5) segments.push({ start: cursor, end: opening.left });
      cursor = Math.max(cursor, opening.right);
    });
    if (cursor < length - 0.5) segments.push({ start: cursor, end: length });
    return segments;
  }

  function nearestInteriorWall(design, x, z) {
    let best = null;
    interiorWallsOf(design).forEach(function (wall) {
      const projected = projectOnInteriorWall(wall, x, z);
      if (!best || projected.distance < best.distance) {
        best = { wall: wall, offsetCm: projected.offsetCm, distance: projected.distance, x: projected.x, z: projected.z };
      }
    });
    return best;
  }

  /* Endpoints latch onto room corners, other wall ends and the perimeter, which
     is what makes chained walls meet without gaps. */
  function snapWallPoint(design, x, z, options) {
    const opts = options || {};
    const room = design && design.room;
    if (!room) return { x: x, z: z, snapped: false };
    const size = roomSize(room);
    const tolerance = Math.max(2, Number(opts.toleranceCm) || 16);
    let sx = U.clamp(x, 0, size.width);
    let sz = U.clamp(z, 0, size.length);
    let snapped = false;
    let lockedX = false;
    let lockedZ = false;
    const anchor = opts.anchor;
    if (anchor) {
      if (Math.abs(sx - anchor.x) <= tolerance) { sx = anchor.x; lockedX = true; snapped = true; }
      else if (Math.abs(sz - anchor.z) <= tolerance) { sz = anchor.z; lockedZ = true; snapped = true; }
    }
    const candidates = [
      { x: 0, z: 0 }, { x: size.width, z: 0 }, { x: size.width, z: size.length }, { x: 0, z: size.length }
    ];
    interiorWallsOf(design).forEach(function (wall) {
      if (opts.excludeId && wall.id === opts.excludeId) return;
      candidates.push({ x: wall.x1Cm, z: wall.z1Cm }, { x: wall.x2Cm, z: wall.z2Cm });
    });
    let best = null;
    candidates.forEach(function (candidate) {
      const distance = Math.hypot(sx - candidate.x, sz - candidate.z);
      if (distance <= tolerance && (!best || distance < best.distance)) best = { point: candidate, distance: distance };
    });
    if (best) { sx = best.point.x; sz = best.point.z; lockedX = true; lockedZ = true; snapped = true; }
    /* Snap each axis on its own: a wall that starts on a corner still needs its
       free end to land on the grid. */
    if (opts.grid !== false) {
      if (!lockedX) sx = Math.round(sx / C.SNAP_CM) * C.SNAP_CM;
      if (!lockedZ) sz = Math.round(sz / C.SNAP_CM) * C.SNAP_CM;
    }
    return { x: U.clamp(sx, 0, size.width), z: U.clamp(sz, 0, size.length), snapped: snapped };
  }

  function pointToSegment(px, pz, ax, az, bx, bz) {
    const dx = bx - ax;
    const dz = bz - az;
    const lengthSq = dx * dx + dz * dz;
    const t = lengthSq > 0 ? U.clamp(((px - ax) * dx + (pz - az) * dz) / lengthSq, 0, 1) : 0;
    return { t: t, x: ax + dx * t, z: az + dz * t, distance: Math.hypot(px - (ax + dx * t), pz - (az + dz * t)) };
  }

  App.Geometry = {
    isCircle: isCircle,
    roomSize: roomSize,
    roomRadius: roomRadius,
    roomCenter: roomCenter,
    roomAreaSqm: roomAreaSqm,
    roomShapeLabel: roomShapeLabel,
    roomBounds: roomBounds,
    pointInRoom: pointInRoom,
    getWalls: getWalls,
    getWall: getWall,
    wallPoint: wallPoint,
    nearestWallPoint: nearestWallPoint,
    rotateVec: rotateVec,
    cornersFor: cornersFor,
    pointInOBB: pointInOBB,
    circleOverlapsObb: circleOverlapsObb,
    aabbFor: aabbFor,
    footprintInsideRoom: footprintInsideRoom,
    projectedHalfExtents: projectedHalfExtents,
    clampCenterToRoom: clampCenterToRoom,
    obbOverlap: obbOverlap,
    placedFootprint: placedFootprint,
    structuralSpan: structuralSpan,
    structuralRect: structuralRect,
    doorSwingZones: doorSwingZones,
    validateStructuralItem: validateStructuralItem,
    validateStructuralItems: validateStructuralItems,
    getOverlaps: getOverlaps,
    blocksDoorSwing: blocksDoorSwing,
    validatePlacedItem: validatePlacedItem,
    designIssues: designIssues,
    productFitsRoom: productFitsRoom,
    findFreeSpot: findFreeSpot,
    nearestFreePlacement: nearestFreePlacement,
    wallRotationForBack: wallRotationForBack,
    circularBackRotation: circularBackRotation,
    roomChangeWarnings: roomChangeWarnings,
    roomLabelLines: roomLabelLines,
    interiorWallsOf: interiorWallsOf,
    interiorWallLength: interiorWallLength,
    interiorWallDir: interiorWallDir,
    interiorWallPoint: interiorWallPoint,
    projectOnInteriorWall: projectOnInteriorWall,
    interiorWallOpenings: interiorWallOpenings,
    interiorWallSegments: interiorWallSegments,
    nearestInteriorWall: nearestInteriorWall,
    snapWallPoint: snapWallPoint,
    pointToSegment: pointToSegment
  };
})(window.App = window.App || {});
