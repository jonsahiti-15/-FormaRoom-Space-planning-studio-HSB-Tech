(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;
  const G = App.Geometry;

  const PRIORITY = { bed: 0, wardrobe: 1, sofa: 2, table: 3, desk: 4, shelf: 5, storage: 6, chair: 7, lighting: 8, rug: 9, decor: 10 };
  const LAYER_ORDER = { rug: 0, bed: 1, wardrobe: 2, sofa: 3, table: 4, desk: 5, shelf: 6, storage: 7, chair: 8, lighting: 9, decor: 10 };
  const WALL_REQUIRED = { bed: true, wardrobe: true, shelf: true, desk: true };
  const WALL_OPTIONAL = { sofa: true, storage: true, table: true, chair: true, lighting: true, decor: true };

  function normalizeSelections(selections) {
    const map = new Map();
    if (Array.isArray(selections)) {
      selections.forEach(function (entry) {
        if (!entry || !entry.productId) return;
        const qty = Number(entry.quantity);
        const existing = map.get(entry.productId) || 0;
        map.set(entry.productId, existing + qty);
      });
    } else if (selections && typeof selections === 'object') {
      Object.keys(selections).forEach(function (id) {
        map.set(id, Number(selections[id]));
      });
    }
    return Array.from(map.entries()).map(function (entry) {
      return { productId: entry[0], quantity: entry[1] };
    });
  }

  function validateSelections(design, selections, productsById, templateId) {
    const errors = [];
    if (!design || !design.room) errors.push('Create a room before generating a layout.');
    if (!C.TEMPLATES[templateId]) errors.push('Choose one of the four supported placement templates.');
    const normalized = normalizeSelections(selections).filter(function (entry) { return entry.quantity !== 0; });
    if (!normalized.length) errors.push('Select at least one product and a quantity.');
    let total = 0;
    const categoryTotals = {};
    const cleaned = [];
    normalized.forEach(function (entry) {
      const product = productsById[entry.productId];
      if (!product) {
        errors.push('Product "' + entry.productId + '" is not in the catalog.');
        return;
      }
      if (!Number.isInteger(entry.quantity) || entry.quantity < 1) {
        errors.push('Quantity for ' + product.name + ' must be a whole number of at least 1.');
        return;
      }
      const categoryLimit = C.LIMITS.CATEGORY_LIMITS[product.category] || C.LIMITS.MAX_AI_SELECTION;
      categoryTotals[product.category] = (categoryTotals[product.category] || 0) + entry.quantity;
      if (categoryTotals[product.category] > categoryLimit) {
        errors.push(App.Catalog.getCategoryLabel(product.category) + ' are limited to ' + categoryLimit + ' items per design.');
      }
      total += entry.quantity;
      cleaned.push({ productId: entry.productId, quantity: entry.quantity, product: product });
    });
    if (total > C.LIMITS.MAX_AI_SELECTION) {
      errors.push('AI-assisted layouts are limited to ' + C.LIMITS.MAX_AI_SELECTION + ' selected items.');
    }
    if (total > C.LIMITS.MAX_PLACED_ITEMS) {
      errors.push('A design is limited to ' + C.LIMITS.MAX_PLACED_ITEMS + ' placed furniture items.');
    }
    return { errors: errors, selections: cleaned, total: total };
  }

  function buildRequests(selections) {
    const requests = [];
    selections.forEach(function (entry, groupIndex) {
      for (let i = 0; i < entry.quantity; i++) {
        requests.push({
          product: entry.product,
          groupIndex: groupIndex,
          unitIndex: i,
          category: entry.product.category,
          isDiningChair: entry.product.category === 'chair' && Math.max(entry.product.widthCm, entry.product.lengthCm) <= 65,
          tableType: entry.product.category === 'table' ? (Math.max(entry.product.widthCm, entry.product.lengthCm) >= 140 ? 'dining' : 'coffee') : null
        });
      }
    });
    requests.sort(function (a, b) {
      const pa = PRIORITY[a.category] == null ? 99 : PRIORITY[a.category];
      const pb = PRIORITY[b.category] == null ? 99 : PRIORITY[b.category];
      if (pa !== pb) return pa - pb;
      const areaA = a.product.widthCm * a.product.lengthCm;
      const areaB = b.product.widthCm * b.product.lengthCm;
      if (areaA !== areaB) return areaB - areaA;
      return a.product.id.localeCompare(b.product.id);
    });
    return requests;
  }

  function makeFootprint(product, x, z, rotationDeg) {
    return { x: x, z: z, widthCm: product.widthCm, lengthCm: product.lengthCm, rotationDeg: U.normalizeDeg(rotationDeg) };
  }

  function roomMetrics(design) {
    const room = design.room;
    const size = G.roomSize(room);
    const center = G.roomCenter(room);
    let halfDiag = 0;
    if (G.isCircle(room)) halfDiag = size.width / 2;
    else halfDiag = Math.hypot(size.width, size.length) / 2;
    return { room: room, width: size.width, length: size.length, center: center, halfDiag: halfDiag, circle: G.isCircle(room) };
  }

  function distances(metrics, x, z) {
    if (metrics.circle) {
      const distCenter = Math.hypot(x - metrics.center.x, z - metrics.center.z);
      const wall = Math.max(0, metrics.width / 2 - distCenter);
      return {
        wall: wall,
        center: distCenter,
        corner: Math.max(0, metrics.width / 2 - distCenter)
      };
    }
    const wall = Math.min(x, metrics.width - x, z, metrics.length - z);
    const center = Math.hypot(x - metrics.center.x, z - metrics.center.z);
    const corners = [
      Math.hypot(x, z), Math.hypot(x - metrics.width, z),
      Math.hypot(x, z - metrics.length), Math.hypot(x - metrics.width, z - metrics.length)
    ];
    return { wall: wall, center: center, corner: Math.min.apply(null, corners) };
  }

  function windowSpanOnWall(design, wallId, fp) {
    const wall = G.getWall(design.room, wallId);
    if (!wall) return null;
    const corners = G.cornersFor(fp.x, fp.z, fp.widthCm, fp.lengthCm, fp.rotationDeg);
    const values = corners.map(function (corner) {
      return (corner.x - wall.start.x) * wall.dir.x + (corner.z - wall.start.z) * wall.dir.z;
    });
    return { left: Math.min.apply(null, values), right: Math.max.apply(null, values) };
  }

  function candidateWindowConflict(design, candidate, product) {
    if (!candidate.wall) return false;
    if (['wardrobe', 'shelf', 'storage'].indexOf(product.category) < 0) return false;
    if (product.heightCm <= 140) return false;
    const span = windowSpanOnWall(design, candidate.wall, candidate.footprint);
    if (!span) return false;
    const windows = (design.structuralItems || []).filter(function (item) { return item.type === 'window' && item.wall === candidate.wall; });
    for (let i = 0; i < windows.length; i++) {
      const half = windows[i].widthCm / 2;
      const left = windows[i].offsetCm - half;
      const right = windows[i].offsetCm + half;
      if (span.right + 12 > left && right + 12 > span.left) return true;
    }
    return false;
  }

  function wallCandidates(metrics, design, request, template) {
    const product = request.product;
    const out = [];
    if (metrics.circle) {
      const radius = metrics.width / 2;
      const gap = template === 'space' ? 2 : template === 'center' ? 6 : 4;
      const steps = 36;
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const rot = G.circularBackRotation(angle);
        if (!G.productFitsRoom(design, product, rot)) continue;
        const centerRadius = radius - gap - product.lengthCm / 2;
        if (centerRadius < 10) continue;
        const x = metrics.center.x + Math.cos(angle) * centerRadius;
        const z = metrics.center.z + Math.sin(angle) * centerRadius;
        out.push({ x: x, z: z, rotationDeg: rot, kind: 'wall', wall: null, angle: angle });
      }
      return out;
    }
    const walls = G.getWalls(design.room);
    walls.forEach(function (wall) {
      const rot = G.wallRotationForBack(wall);
      if (!G.productFitsRoom(design, product, rot)) return;
      const ext = G.projectedHalfExtents(product.widthCm, product.lengthCm, rot);
      const along = (wall.id === 'north' || wall.id === 'south') ? ext.hx : ext.hz;
      const into = (wall.id === 'north' || wall.id === 'south') ? ext.hz : ext.hx;
      const gap = template === 'space' ? 1 : template === 'center' ? 6 : 3;
      if (along * 2 + 4 > wall.lengthCm) return;
      const step = U.clamp(Math.min(product.widthCm, product.lengthCm) / 2, 18, 45);
      const offsets = new Set();
      for (let s = along + 2; s <= wall.lengthCm - along - 2 + 0.01; s += step) offsets.add(U.round(s, 2));
      offsets.add(U.round(wall.lengthCm / 2, 2));
      offsets.forEach(function (offset) {
        const p = G.wallPoint(wall, offset);
        const x = p.x + wall.inward.x * (into + gap);
        const z = p.z + wall.inward.z * (into + gap);
        out.push({
          x: x, z: z, rotationDeg: rot, kind: 'wall', wall: wall.id,
          offsetCm: offset, wallLengthCm: wall.lengthCm
        });
      });
    });
    return out;
  }

  function interiorCandidates(metrics, design, request, template) {
    const product = request.product;
    const out = [];
    const rotations = [0, 90, 180, 270];
    const step = U.clamp(Math.min(product.widthCm, product.lengthCm) / 2, 20, 55);
    const size = geometryRect(metrics);
    for (let x = 8; x <= size.width - 8 + 0.01; x += step) {
      for (let z = 8; z <= size.length - 8 + 0.01; z += step) {
        for (let r = 0; r < rotations.length; r++) {
          const rot = rotations[r];
          if (!G.productFitsRoom(design, product, rot)) continue;
          out.push({ x: x, z: z, rotationDeg: rot, kind: 'interior', wall: null });
        }
      }
    }
    const center = metrics.center;
    for (let r = 0; r < rotations.length; r++) {
      out.push({ x: center.x, z: center.z, rotationDeg: rotations[r], kind: 'interior', wall: null });
    }
    return out;
  }

  function geometryRect(metrics) {
    if (metrics.circle) {
      return { width: metrics.width, length: metrics.length };
    }
    return { width: metrics.width, length: metrics.length };
  }

  function rotateLocalOffset(local, rotationDeg) {
    return G.rotateVec(local.x, local.z, rotationDeg);
  }

  function diningChairCandidates(metrics, design, request, context) {
    const out = [];
    if (!request.isDiningChair) return out;
    const tables = context.placed.filter(function (entry) {
      return entry.request.category === 'table' && entry.request.tableType === 'dining';
    });
    const product = request.product;
    tables.forEach(function (table) {
      const tableProduct = table.product;
      const tableRot = table.item.rotationDeg;
      const sides = [
        { normal: { x: 0, z: -1 }, halfAlong: tableProduct.widthCm / 2, baseRot: 180, parallelSpan: tableProduct.widthCm },
        { normal: { x: 0, z: 1 }, halfAlong: tableProduct.widthCm / 2, baseRot: 0, parallelSpan: tableProduct.widthCm },
        { normal: { x: -1, z: 0 }, halfAlong: tableProduct.lengthCm / 2, baseRot: 90, parallelSpan: tableProduct.lengthCm },
        { normal: { x: 1, z: 0 }, halfAlong: tableProduct.lengthCm / 2, baseRot: 270, parallelSpan: tableProduct.lengthCm }
      ];
      sides.forEach(function (side) {
        const tableHalfDepth = side.normal.x !== 0 ? tableProduct.widthCm / 2 : tableProduct.lengthCm / 2;
        const chairHalfDepth = product.lengthCm / 2;
        const distance = tableHalfDepth + 4 + chairHalfDepth;
        const parallelOffsets = [0];
        if (side.parallelSpan >= 130) parallelOffsets.push(-side.parallelSpan / 4, side.parallelSpan / 4);
        parallelOffsets.forEach(function (parallel) {
          const normal = rotateLocalOffset({ x: side.normal.x * distance, z: side.normal.z * distance }, tableRot);
          const along = rotateLocalOffset({ x: side.normal.z !== 0 ? parallel : 0, z: side.normal.x !== 0 ? parallel : 0 }, tableRot);
          out.push({
            x: table.item.xCm + normal.x + along.x,
            z: table.item.zCm + normal.z + along.z,
            rotationDeg: U.normalizeDeg(tableRot + side.baseRot),
            kind: 'anchorDining',
            wall: null,
            anchorId: table.item.id
          });
        });
      });
    });
    return out;
  }

  function coffeeTableCandidates(metrics, design, request, context) {
    const out = [];
    if (request.category !== 'table' || request.tableType !== 'coffee') return out;
    const sofas = context.placed.filter(function (entry) { return entry.request.category === 'sofa'; });
    sofas.forEach(function (sofa) {
      const product = request.product;
      const distance = sofa.product.lengthCm / 2 + 35 + product.lengthCm / 2;
      const offset = rotateLocalOffset({ x: 0, z: -distance }, sofa.item.rotationDeg);
      out.push({
        x: sofa.item.xCm + offset.x,
        z: sofa.item.zCm + offset.z,
        rotationDeg: sofa.item.rotationDeg,
        kind: 'anchorCoffee',
        wall: null,
        anchorId: sofa.item.id
      });
    });
    return out;
  }

  function nightstandCandidates(metrics, design, request, context) {
    const out = [];
    if (request.category !== 'storage') return out;
    const product = request.product;
    if (product.widthCm > 65) return out;
    const beds = context.placed.filter(function (entry) { return entry.request.category === 'bed'; });
    beds.forEach(function (bed) {
      const bedRot = bed.item.rotationDeg;
      const sideOffset = bed.product.widthCm / 2 + product.widthCm / 2 + 5;
      const localZ = bed.product.lengthCm / 2 - product.lengthCm / 2 - 2;
      [-1, 1].forEach(function (sign) {
        const offset = rotateLocalOffset({ x: sign * sideOffset, z: localZ }, bedRot);
        out.push({
          x: bed.item.xCm + offset.x,
          z: bed.item.zCm + offset.z,
          rotationDeg: bedRot,
          kind: 'anchorNightstand',
          wall: null,
          anchorId: bed.item.id
        });
      });
    });
    return out;
  }

  function deskChairCandidates(metrics, design, request, context) {
    const out = [];
    if (request.category !== 'chair') return out;
    const product = request.product;
    const desks = context.placed.filter(function (entry) { return entry.request.category === 'desk'; });
    desks.forEach(function (desk) {
      const distance = desk.product.lengthCm / 2 + 12 + product.lengthCm / 2;
      const offset = rotateLocalOffset({ x: 0, z: -distance }, desk.item.rotationDeg);
      out.push({
        x: desk.item.xCm + offset.x,
        z: desk.item.zCm + offset.z,
        rotationDeg: U.normalizeDeg(desk.item.rotationDeg + 180),
        kind: 'anchorDesk',
        wall: null,
        anchorId: desk.item.id
      });
    });
    return out;
  }

  function rugCandidates(metrics, design, request, context) {
    const out = [];
    if (request.category !== 'rug') return out;
    const product = request.product;
    context.placed.forEach(function (entry) {
      const cat = entry.request.category;
      if (cat === 'table') {
        out.push({
          x: entry.item.xCm,
          z: entry.item.zCm,
          rotationDeg: entry.item.rotationDeg,
          kind: 'anchorRug',
          wall: null,
          anchorId: entry.item.id
        });
      } else if (cat === 'bed') {
        const offset = rotateLocalOffset({ x: 0, z: entry.product.lengthCm * 0.22 }, entry.item.rotationDeg);
        out.push({
          x: entry.item.xCm + offset.x,
          z: entry.item.zCm + offset.z,
          rotationDeg: entry.item.rotationDeg,
          kind: 'anchorRug',
          wall: null,
          anchorId: entry.item.id
        });
      } else if (cat === 'sofa') {
        const distance = entry.product.lengthCm / 2 + 12 + product.lengthCm / 2;
        const offset = rotateLocalOffset({ x: 0, z: -distance }, entry.item.rotationDeg);
        out.push({
          x: entry.item.xCm + offset.x,
          z: entry.item.zCm + offset.z,
          rotationDeg: entry.item.rotationDeg,
          kind: 'anchorRug',
          wall: null,
          anchorId: entry.item.id
        });
      }
    });
    return out;
  }

  function generateCandidates(metrics, design, request, template, context) {
    const category = request.category;
    const candidates = [];
    if (category === 'rug') {
      candidates.push.apply(candidates, rugCandidates(metrics, design, request, context));
      candidates.push.apply(candidates, interiorCandidates(metrics, design, request, template));
      return candidates;
    }
    if (WALL_REQUIRED[category]) {
      candidates.push.apply(candidates, wallCandidates(metrics, design, request, template));
    } else {
      candidates.push.apply(candidates, wallCandidates(metrics, design, request, template));
      candidates.push.apply(candidates, interiorCandidates(metrics, design, request, template));
    }
    candidates.push.apply(candidates, diningChairCandidates(metrics, design, request, context));
    candidates.push.apply(candidates, deskChairCandidates(metrics, design, request, context));
    candidates.push.apply(candidates, coffeeTableCandidates(metrics, design, request, context));
    candidates.push.apply(candidates, nightstandCandidates(metrics, design, request, context));
    return candidates;
  }

  function isTallNearWindowBlocked(design, candidate, product) {
    return candidateWindowConflict(design, candidate, product);
  }

  function candidateCollisions(design, request, candidate, context) {
    const product = request.product;
    const fp = makeFootprint(product, candidate.x, candidate.z, candidate.rotationDeg);
    if (!G.footprintInsideRoom(design.room, fp.x, fp.z, fp.widthCm, fp.lengthCm, fp.rotationDeg, 1)) return true;
    if (product.category !== 'rug') {
      const zones = context.doorZones;
      for (let i = 0; i < zones.length; i++) {
        if (G.obbOverlap(fp, { x: zones[i].x, z: zones[i].z, widthCm: zones[i].widthCm, lengthCm: zones[i].lengthCm, rotationDeg: zones[i].rotationDeg })) return true;
      }
      for (let i = 0; i < context.placed.length; i++) {
        const other = context.placed[i];
        if (other.product.category === 'rug') continue;
        if (G.obbOverlap(fp, { x: other.item.xCm, z: other.item.zCm, widthCm: other.product.widthCm, lengthCm: other.product.lengthCm, rotationDeg: other.item.rotationDeg, pad: 1.5 })) return true;
      }
    } else {
      for (let i = 0; i < context.placed.length; i++) {
        const other = context.placed[i];
        if (other.product.category !== 'rug') continue;
        if (G.obbOverlap(fp, { x: other.item.xCm, z: other.item.zCm, widthCm: other.product.widthCm, lengthCm: other.product.lengthCm, rotationDeg: other.item.rotationDeg })) return true;
      }
    }
    if (isTallNearWindowBlocked(design, { x: candidate.x, z: candidate.z, rotationDeg: candidate.rotationDeg, wall: candidate.wall, footprint: fp }, product)) return true;
    return false;
  }

  function scoreCandidate(design, metrics, request, candidate, template, context) {
    const product = request.product;
    const dist = distances(metrics, candidate.x, candidate.z);
    const wallN = U.clamp(dist.wall / Math.max(60, metrics.width / 2), 0, 2);
    const centerN = U.clamp(dist.center / Math.max(80, metrics.halfDiag), 0, 1.5);
    const cornerN = U.clamp(dist.corner / Math.max(80, metrics.halfDiag), 0, 2);
    let score = 0;
    const cat = product.category;
    switch (cat) {
      case 'bed':
        score = wallN * 2.4 + centerN * 0.15;
        break;
      case 'wardrobe':
        score = wallN * 2.2 + centerN * 0.15;
        break;
      case 'shelf':
        score = wallN * 2.0 + centerN * 0.2;
        break;
      case 'desk':
        score = wallN * 1.8 + centerN * 0.25;
        break;
      case 'storage':
        score = wallN * 1.6 + centerN * 0.25;
        if (candidate.kind === 'anchorNightstand') score -= 2.2;
        break;
      case 'sofa':
        score = wallN * 1.5 + centerN * (template === 'center' ? 0.9 : 0.35);
        break;
      case 'table':
        score = centerN * 1.25 + wallN * 0.35;
        if (candidate.kind === 'anchorCoffee') score -= 2.4;
        if (template === 'wall') score += wallN * 0.8;
        break;
      case 'chair':
        if (request.isDiningChair) {
          score = 0.4 + centerN * 0.15 + wallN * 0.1;
          if (candidate.kind === 'anchorDining') score -= 3.2;
          if (candidate.kind === 'anchorDesk') score -= 2.8;
        } else {
          score = wallN * 0.8 + centerN * (template === 'center' ? 0.6 : 0.25);
          if (candidate.kind === 'anchorDesk') score -= 2.8;
          if (candidate.kind === 'anchorNightstand') score -= 1.5;
          if (candidate.kind !== 'anchorDesk') {
            const sofaNear = nearestCategoryDistance(context, candidate, ['sofa']);
            if (sofaNear !== null && sofaNear < 160) score -= (1 - sofaNear / 160) * 1.2;
          }
        }
        break;
      case 'lighting':
        score = wallN * 1.0 + cornerN * 0.9 + centerN * 0.45;
        break;
      case 'rug':
        score = centerN * 0.8 + wallN * 0.15;
        if (candidate.kind === 'anchorRug') score -= 2.6;
        break;
      case 'decor':
        score = cornerN * 1.1 + wallN * 0.6 + centerN * 0.2;
        break;
      default:
        score = wallN + centerN;
    }
    if (candidate.wall && candidate.offsetCm != null && candidate.wallLengthCm) {
      const offsetFromCenter = Math.abs(candidate.offsetCm - candidate.wallLengthCm / 2) / Math.max(1, candidate.wallLengthCm / 2);
      if (cat === 'bed') score += offsetFromCenter * 0.9;
      else if (cat === 'sofa') score += offsetFromCenter * 0.7;
      else if (cat === 'wardrobe') score += offsetFromCenter * 0.45;
      else if (cat === 'desk' || cat === 'shelf' || cat === 'storage') score += offsetFromCenter * 0.35;
    }
    if (template === 'wall') {
      if (cat !== 'rug') score += wallN * 0.65;
    } else if (template === 'center') {
      if (cat === 'table' || cat === 'rug' || cat === 'sofa') score += centerN * 0.7;
      if (cat === 'lighting' || cat === 'decor') score += cornerN * 0.3;
    } else if (template === 'space') {
      if (cat !== 'rug') score += wallN * 0.45;
      const nearest = nearestPlacedDistance(context, candidate);
      if (nearest !== null) score += Math.min(1, nearest / 260) * 0.55;
    } else {
      score += wallN * 0.18 + centerN * 0.18;
    }
    if (cat === 'chair' && request.isDiningChair && candidate.kind !== 'anchorDining') score += 1.6;
    if (cat === 'lighting') {
      const nearSeating = nearestCategoryDistance(context, candidate, ['sofa', 'chair']);
      if (nearSeating !== null && nearSeating < 140) score -= 0.45;
    }
    if (cat === 'decor') {
      const nearWindow = nearestWindowDistance(design, candidate);
      if (nearWindow !== null && nearWindow < 120) score -= 0.4;
    }
    if (cat === 'rug') {
      const nearTable = nearestCategoryDistance(context, candidate, ['table']);
      if (nearTable !== null && nearTable < 170) score -= 0.35;
    }
    return score;
  }

  function nearestPlacedDistance(context, candidate) {
    let min = null;
    context.placed.forEach(function (entry) {
      const d = Math.hypot(candidate.x - entry.item.xCm, candidate.z - entry.item.zCm);
      if (min === null || d < min) min = d;
    });
    return min;
  }

  function nearestCategoryDistance(context, candidate, categories) {
    let min = null;
    context.placed.forEach(function (entry) {
      if (categories.indexOf(entry.request.category) < 0) return;
      const d = Math.hypot(candidate.x - entry.item.xCm, candidate.z - entry.item.zCm);
      if (min === null || d < min) min = d;
    });
    return min;
  }

  function nearestWindowDistance(design, candidate) {
    let min = null;
    (design.structuralItems || []).forEach(function (item) {
      if (item.type !== 'window') return;
      const wall = G.getWall(design.room, item.wall);
      if (!wall) return;
      const p = G.wallPoint(wall, item.offsetCm);
      const d = Math.hypot(candidate.x - p.x, candidate.z - p.z);
      if (min === null || d < min) min = d;
    });
    return min;
  }

  function placeRequest(metrics, design, request, template, context) {
    const candidates = generateCandidates(metrics, design, request, template, context);
    let best = null;
    let seen = new Set();
    candidates.forEach(function (candidate) {
      const key = U.round(candidate.x, 1) + ':' + U.round(candidate.z, 1) + ':' + Math.round(candidate.rotationDeg);
      if (seen.has(key)) return;
      seen.add(key);
      if (candidateCollisions(design, request, candidate, context)) return;
      const score = scoreCandidate(design, metrics, request, candidate, template, context);
      if (!best || score < best.score) {
        best = { score: score, candidate: candidate };
      }
    });
    if (!best) return null;
    return {
      kind: best.candidate.kind,
      item: {
        id: U.uid('item'),
        productId: request.product.id,
        xCm: U.round(best.candidate.x, 1),
        zCm: U.round(best.candidate.z, 1),
        rotationDeg: U.normalizeDeg(best.candidate.rotationDeg),
        locked: false,
        variantId: App.Catalog.defaultVariantId(request.product),
        addedVia: 'ai',
        placedAt: new Date().toISOString()
      }
    };
  }

  function generateLayout(options) {
    const opts = options || {};
    const design = opts.design || App.State.get();
    const productsById = opts.productsById || App.Catalog.getProductsById();
    const template = opts.template || 'balanced';
    const validation = validateSelections(design, opts.selections || [], productsById, template);
    if (validation.errors.length) {
      return { ok: false, errors: validation.errors, items: [], unplaced: [], warnings: [], template: template };
    }
    if (G.isCircle(design.room) && (design.structuralItems || []).length) {
      return { ok: false, errors: ['Circular rooms cannot contain doors or windows in this version.'], items: [], unplaced: [], warnings: [], template: template };
    }
    const metrics = roomMetrics(design);
    const requests = buildRequests(validation.selections);
    const context = {
      placed: [],
      doorZones: G.doorSwingZones(design)
    };
    const items = [];
    const unplaced = [];
    let placedUnits = 0;
    requests.forEach(function (request) {
      const placement = placeRequest(metrics, design, request, template, context);
      if (!placement) {
        unplaced.push(request);
        return;
      }
      items.push(placement.item);
      context.placed.push({ request: request, item: placement.item, product: request.product, kind: placement.kind });
      placedUnits++;
    });
    items.sort(function (a, b) {
      const aProduct = productsById[a.productId];
      const bProduct = productsById[b.productId];
      const la = LAYER_ORDER[aProduct.category] == null ? 50 : LAYER_ORDER[aProduct.category];
      const lb = LAYER_ORDER[bProduct.category] == null ? 50 : LAYER_ORDER[bProduct.category];
      if (la !== lb) return la - lb;
      return (aProduct.name || '').localeCompare(bProduct.name || '');
    });
    const groupedUnplaced = [];
    const unplacedMap = new Map();
    unplaced.forEach(function (request) {
      const existing = unplacedMap.get(request.product.id);
      if (existing) existing.quantity += 1;
      else {
        const reason = G.productFitsRoom(design, request.product, 0) || G.productFitsRoom(design, request.product, 90) ||
          G.productFitsRoom(design, request.product, 180) || G.productFitsRoom(design, request.product, 270)
          ? 'No collision-free, door-clear position was found at a supported orientation.'
          : 'The product footprint does not fit inside the room.';
        const entry = { productId: request.product.id, name: request.product.name, quantity: 1, reason: reason };
        unplacedMap.set(request.product.id, entry);
        groupedUnplaced.push(entry);
      }
    });
    const warnings = [];
    if (groupedUnplaced.length) {
      const details = groupedUnplaced.map(function (entry) { return entry.name + ' ×' + entry.quantity; }).join(', ');
      warnings.push('Some selected products could not be placed: ' + details + '. They were not silently discarded.');
    }
    if (!items.length) {
      warnings.push('No items could be placed. The current design was left unchanged.');
    }
    const roomArea = G.roomAreaSqm(design.room);
    const coveredArea = items.reduce(function (sum, item) {
      const product = productsById[item.productId];
      if (!product || product.category === 'rug') return sum;
      return sum + product.widthCm * product.lengthCm;
    }, 0) / 10000;
    const anchored = context.placed.filter(function (entry) {
      return entry.kind && entry.kind.indexOf('anchor') === 0;
    }).length;
    return {
      ok: true,
      errors: [],
      items: items,
      unplaced: groupedUnplaced,
      warnings: warnings,
      template: template,
      stats: {
        requested: validation.total,
        placed: placedUnits,
        failed: unplaced.length,
        anchored: anchored,
        coverage: roomArea > 0 ? U.clamp(Math.round((coveredArea / roomArea) * 100), 0, 100) : 0
      }
    };
  }

  App.AI = {
    generateLayout: generateLayout,
    validateSelections: validateSelections,
    normalizeSelections: normalizeSelections,
    TEMPLATES: C.TEMPLATES
  };
})(window.App = window.App || {});
