(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;

  let design = null;
  const listeners = [];
  const wallHistory = [];

  function nowIso() { return new Date().toISOString(); }

  function clampRoomDim(value, fallback) {
    const n = U.toNumber(value, fallback);
    return U.clamp(n, C.ROOM.MIN_DIM_CM, C.ROOM.MAX_DIM_CM);
  }

  function clampHeight(value, fallback) {
    const n = U.toNumber(value, fallback);
    return U.clamp(n, C.ROOM.MIN_HEIGHT_CM, C.ROOM.MAX_HEIGHT_CM);
  }

  function normalizeShape(shape) {
    if (shape === 'circle' || shape === 'square' || shape === 'rectangle') return shape;
    return 'rectangle';
  }

  function normalizeRoomUse(value) {
    return C.ROOM_USES[value] ? value : 'living';
  }

  function normalizeWallColor(value) {
    const str = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(str)) return str.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(str)) {
      return ('#' + str.charAt(1) + str.charAt(1) + str.charAt(2) + str.charAt(2) + str.charAt(3) + str.charAt(3)).toLowerCase();
    }
    return C.WALL_DEFAULT_COLOR;
  }

  /* An empty exterior colour means "same paint as the inside", so designs made
     before exterior paint existed keep their original single-colour walls. */
  function normalizeExteriorWallColor(value) {
    const str = String(value == null ? '' : value).trim();
    if (!str) return null;
    return normalizeWallColor(str);
  }

  function normalizeFloor(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const scaleRaw = Number(source.textureScale);
    const scale = U.isFiniteNumber(scaleRaw)
      ? U.clamp(scaleRaw, C.FLOOR_TEXTURE.MIN_SCALE_M, C.FLOOR_TEXTURE.MAX_SCALE_M)
      : C.FLOOR_TEXTURE.DEFAULT_SCALE_M;
    return {
      mode: source.mode === 'texture' ? 'texture' : 'color',
      color: normalizeFloorColor(source.color),
      textureKey: typeof source.textureKey === 'string' && source.textureKey ? source.textureKey : null,
      textureScale: scale
    };
  }

  function normalizeFloorColor(value) {
    const str = String(value || '').trim();
    if (/^#[0-9a-f]{6}$/i.test(str)) return str.toLowerCase();
    if (/^#[0-9a-f]{3}$/i.test(str)) {
      return ('#' + str.charAt(1) + str.charAt(1) + str.charAt(2) + str.charAt(2) + str.charAt(3) + str.charAt(3)).toLowerCase();
    }
    return C.FLOOR_DEFAULT_COLOR;
  }

  function normalizeStructuralStyle(type, style) {
    const styles = type === 'window' ? C.STRUCTURAL.WINDOW_STYLES : C.STRUCTURAL.DOOR_STYLES;
    const fallback = type === 'window' ? C.STRUCTURAL.DEFAULT_WINDOW_STYLE : C.STRUCTURAL.DEFAULT_DOOR_STYLE;
    const str = String(style || '').trim();
    return styles[str] ? str : fallback;
  }

  function buildRoom(data) {
    const shape = normalizeShape(data && data.shape);
    let width = clampRoomDim(data && data.widthCm, C.ROOM.DEFAULT_WIDTH_CM);
    let length = clampRoomDim(data && data.lengthCm, C.ROOM.DEFAULT_LENGTH_CM);
    let diameter = clampRoomDim(data && data.diameterCm, C.ROOM.DEFAULT_WIDTH_CM);
    if (shape === 'square') length = width;
    if (shape === 'circle') {
      diameter = clampRoomDim(data && (data.diameterCm || data.widthCm), C.ROOM.DEFAULT_WIDTH_CM);
      width = diameter;
      length = diameter;
    }
    return {
      shape: shape,
      widthCm: width,
      lengthCm: length,
      heightCm: clampHeight(data && data.heightCm, C.ROOM.DEFAULT_HEIGHT_CM),
      diameterCm: shape === 'circle' ? diameter : diameter
    };
  }

  function createDesign(options) {
    const opts = options || {};
    const shape = normalizeShape(opts.shape);
    const room = buildRoom({
      shape: shape,
      widthCm: opts.widthCm,
      lengthCm: opts.lengthCm,
      heightCm: opts.heightCm,
      diameterCm: opts.diameterCm
    });
    return {
      id: opts.id || U.uid('design'),
      name: String(opts.name || 'Untitled room').trim().slice(0, 80) || 'Untitled room',
      companyId: C.COMPANY_ID,
      room: room,
      structuralItems: [],
      interiorWalls: [],
      placedItems: [],
      budget: U.isFiniteNumber(Number(opts.budget)) && Number(opts.budget) >= 0 ? Number(opts.budget) : C.DEFAULT_BUDGET,
      mode: opts.mode === 'ai' ? 'ai' : 'manual',
      roomUse: normalizeRoomUse(opts.roomUse),
      wallColor: normalizeWallColor(opts.wallColor),
      exteriorWallColor: normalizeExteriorWallColor(opts.exteriorWallColor),
      floor: normalizeFloor(opts.floor),
      version: 1,
      createdAt: opts.createdAt || nowIso(),
      updatedAt: nowIso()
    };
  }

  function normalizeStructural(raw, room, warnings) {
    if (!raw || (raw.type !== 'door' && raw.type !== 'window')) {
      warnings.push('A structural item with an unknown type was skipped.');
      return null;
    }
    const item = {
      id: raw.id || U.uid('opening'),
      type: raw.type,
      wall: ['north', 'east', 'south', 'west'].indexOf(raw.wall) >= 0 ? raw.wall : 'north',
      offsetCm: Number(raw.offsetCm),
      widthCm: Number(raw.widthCm),
      heightCm: Number(raw.heightCm),
      sillCm: raw.type === 'window' ? Number(raw.sillCm) : 0,
      style: normalizeStructuralStyle(raw.type, raw.style)
    };
    if (raw.productId) {
      item.productId = String(raw.productId);
      if (U.isFiniteNumber(Number(raw.price)) && raw.price !== null && raw.price !== '') item.price = Number(raw.price);
      if (raw.name) item.name = String(raw.name).trim().slice(0, 80);
    }
    if (!U.isFiniteNumber(item.offsetCm) || !U.isFiniteNumber(item.widthCm) || !U.isFiniteNumber(item.heightCm) ||
      item.widthCm <= 0 || item.heightCm <= 0) {
      warnings.push('A ' + raw.type + ' with invalid dimensions was skipped.');
      return null;
    }
    if (item.type === 'window' && !U.isFiniteNumber(item.sillCm)) item.sillCm = 90;
    return item;
  }

  function normalizePlaced(raw, productsById, usedIds, warnings) {
    if (!raw || !raw.productId) {
      warnings.push('A placed item without a product reference was skipped.');
      return null;
    }
    let id = raw.id || U.uid('item');
    if (usedIds.has(id)) {
      const replacement = U.uid('item');
      warnings.push('A duplicate instance ID was replaced with a new ID.');
      id = replacement;
    }
    usedIds.add(id);
    const x = Number(raw.xCm);
    const z = Number(raw.zCm);
    if (!U.isFiniteNumber(x) || !U.isFiniteNumber(z)) {
      warnings.push('A placed item with an invalid position was skipped.');
      return null;
    }
    const product = productsById[raw.productId];
    if (!product) warnings.push('Product "' + raw.productId + '" is not in the catalog and will need attention.');
    return {
      id: id,
      productId: String(raw.productId),
      xCm: x,
      zCm: z,
      rotationDeg: U.normalizeDeg(raw.rotationDeg),
      locked: !!raw.locked,
      variantId: raw.variantId || null,
      addedVia: raw.addedVia === 'ai' ? 'ai' : 'manual',
      placedAt: raw.placedAt || nowIso()
    };
  }

  function normalizeInteriorWall(raw, room, warnings) {
    if (!raw) return null;
    const x1 = Number(raw.x1Cm);
    const z1 = Number(raw.z1Cm);
    const x2 = Number(raw.x2Cm);
    const z2 = Number(raw.z2Cm);
    if (![x1, z1, x2, z2].every(U.isFiniteNumber)) {
      warnings.push('A partition wall with unreadable endpoints was skipped.');
      return null;
    }
    const length = Math.hypot(x2 - x1, z2 - z1);
    if (length < 40) {
      warnings.push('A partition wall shorter than 40 cm was skipped.');
      return null;
    }
    const wall = {
      id: String(raw.id || U.uid('wall')),
      x1Cm: x1,
      z1Cm: z1,
      x2Cm: x2,
      z2Cm: z2,
      thicknessCm: U.clamp(U.toNumber(raw.thicknessCm, C.WALL_THICKNESS_CM), 6, 40),
      heightCm: U.clamp(U.toNumber(raw.heightCm, room.heightCm), 100, room.heightCm),
      openings: []
    };
    const openings = [];
    (Array.isArray(raw.openings) ? raw.openings : []).forEach(function (entry) {
      if (!entry) return;
      const type = entry.type === 'window' ? 'window' : 'door';
      const width = U.clamp(U.toNumber(entry.widthCm, type === 'window' ? 120 : 90), 40, Math.max(40, length - 10));
      const offset = U.clamp(U.toNumber(entry.offsetCm, length / 2), width / 2, length - width / 2);
      const sill = type === 'window' ? U.clamp(U.toNumber(entry.sillCm, 90), 0, wall.heightCm - 40) : 0;
      const height = U.clamp(U.toNumber(entry.heightCm, type === 'window' ? 120 : 210), 40, wall.heightCm - sill);
      if (height < 40) return;
      openings.push({
        id: String(entry.id || U.uid('iopen')),
        type: type,
        offsetCm: offset,
        widthCm: width,
        heightCm: height,
        sillCm: sill
      });
    });
    openings.sort(function (a, b) { return a.offsetCm - b.offsetCm; });
    let lastRight = -1;
    openings.forEach(function (opening) {
      const left = opening.offsetCm - opening.widthCm / 2;
      if (left < lastRight) return;
      wall.openings.push(opening);
      lastRight = opening.offsetCm + opening.widthCm / 2;
    });
    return wall;
  }

  function normalizeLoadedDesign(raw) {
    const warnings = [];
    if (!raw || typeof raw !== 'object') {
      return { design: null, warnings: ['The saved record did not contain a design.'] };
    }
    const id = raw.id || U.uid('design');
    const name = String(raw.name || 'Recovered design').trim().slice(0, 80) || 'Recovered design';
    const rawRoom = raw.room || {};
    let shape = normalizeShape(rawRoom.shape);
    if (!['rectangle', 'square', 'circle'].includes(rawRoom.shape)) {
      warnings.push('The room shape was not recognised and has been reset to a rectangle.');
    }
    const roomData = buildRoom({
      shape: shape,
      widthCm: rawRoom.widthCm,
      lengthCm: rawRoom.lengthCm,
      heightCm: rawRoom.heightCm,
      diameterCm: rawRoom.diameterCm
    });
    if (U.toNumber(rawRoom.widthCm, null) === null) warnings.push('Room width was missing; a default width was used.');
    if (shape !== 'circle' && U.toNumber(rawRoom.lengthCm, null) === null) warnings.push('Room length was missing; a default length was used.');
    if (U.toNumber(rawRoom.heightCm, null) === null) warnings.push('Room height was missing; a default height was used.');

    const productsById = App.Catalog ? App.Catalog.getProductsById() : {};
    const usedIds = new Set();
    const placedItems = [];
    (Array.isArray(raw.placedItems) ? raw.placedItems : []).forEach(function (entry) {
      const item = normalizePlaced(entry, productsById, usedIds, warnings);
      if (item) placedItems.push(item);
    });
    const structuralItems = [];
    const usedStructuralIds = new Set();
    (Array.isArray(raw.structuralItems) ? raw.structuralItems : []).forEach(function (entry) {
      const item = normalizeStructural(entry, roomData, warnings);
      if (!item) return;
      if (usedStructuralIds.has(item.id)) {
        item.id = U.uid('opening');
        warnings.push('A duplicate opening ID was replaced with a new ID.');
      }
      usedStructuralIds.add(item.id);
      structuralItems.push(item);
    });
    if (shape === 'circle' && structuralItems.length) {
      warnings.push('This design was circular but contained doors/windows, which are not supported on curved walls. Those openings were removed.');
      structuralItems.length = 0;
    }
    const interiorWalls = [];
    const usedWallIds = new Set();
    if (shape === 'circle' && Array.isArray(raw.interiorWalls) && raw.interiorWalls.length) {
      warnings.push('Partition walls are not supported in circular rooms and were removed.');
    } else {
      (Array.isArray(raw.interiorWalls) ? raw.interiorWalls : []).forEach(function (entry) {
        const wall = normalizeInteriorWall(entry, roomData, warnings);
        if (!wall) return;
        if (usedWallIds.has(wall.id)) {
          wall.id = U.uid('wall');
          warnings.push('A duplicate partition wall ID was replaced with a new ID.');
        }
        usedWallIds.add(wall.id);
        interiorWalls.push(wall);
      });
    }
    const budget = raw.budget === null || raw.budget === undefined ? null : Number(raw.budget);
    const wallColor = normalizeWallColor(raw.wallColor);
    if (raw.wallColor && !/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(raw.wallColor).trim())) {
      warnings.push('The saved wall colour was not valid and the default warm white was used.');
    }
    let exteriorWallColor = null;
    if (raw.exteriorWallColor != null && String(raw.exteriorWallColor).trim()) {
      if (/^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(String(raw.exteriorWallColor).trim())) {
        exteriorWallColor = normalizeWallColor(raw.exteriorWallColor);
      } else {
        warnings.push('The saved outside wall colour was not valid, so the inside colour is used outside.');
      }
    }
    return {
      design: {
        id: id,
        name: name,
        companyId: raw.companyId || C.COMPANY_ID,
        room: roomData,
        structuralItems: structuralItems,
        interiorWalls: interiorWalls,
        placedItems: placedItems,
        budget: U.isFiniteNumber(budget) && budget >= 0 ? budget : null,
        mode: raw.mode === 'ai' ? 'ai' : 'manual',
        roomUse: normalizeRoomUse(raw.roomUse),
        wallColor: wallColor,
        exteriorWallColor: exteriorWallColor,
        floor: normalizeFloor(raw.floor),
        version: 1,
        createdAt: raw.createdAt || nowIso(),
        updatedAt: raw.updatedAt || nowIso()
      },
      warnings: warnings
    };
  }

  function notify(reason) {
    const snapshot = design;
    listeners.slice().forEach(function (listener) {
      try {
        listener(snapshot, reason);
      } catch (err) {
        console.error('State listener failed:', err);
      }
    });
  }

  function commit(reason) {
    if (!design) return;
    design.updatedAt = nowIso();
    notify(reason);
  }

  function init(initialDesign) {
    design = initialDesign || null;
    notify('init');
  }

  function get() { return design; }

  function subscribe(listener) {
    if (typeof listener !== 'function') return function () {};
    listeners.push(listener);
    return function () {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    };
  }

  function ensureDesign() {
    if (!design) return { ok: false, error: 'Create a room first.' };
    return null;
  }

  function categoryCount(productId) {
    if (!design) return 0;
    const product = App.Catalog.getProduct(productId);
    if (!product) return 0;
    return design.placedItems.filter(function (item) {
      const p = App.Catalog.getProduct(item.productId);
      return p && p.category === product.category;
    }).length;
  }

  function limitCheck(productId, extra) {
    const count = extra || 1;
    if (!design) return { ok: false, error: 'Create a room first.' };
    if (!productId) return { ok: false, error: 'Choose a product first.' };
    const product = App.Catalog.getProduct(productId);
    if (!product) return { ok: false, error: 'This product is not available.' };
    if (design.placedItems.length + count > C.LIMITS.MAX_PLACED_ITEMS) {
      return { ok: false, error: 'This design is limited to ' + C.LIMITS.MAX_PLACED_ITEMS + ' placed furniture items. Remove an item before adding more.' };
    }
    const categoryLimit = C.LIMITS.CATEGORY_LIMITS[product.category];
    if (categoryLimit && categoryCount(productId) + count > categoryLimit) {
      return { ok: false, error: App.Catalog.getCategoryLabel(product.category) + ' are limited to ' + categoryLimit + ' items per design.' };
    }
    return { ok: true };
  }

  function makePlacedItem(productId, x, z, rotationDeg, variantId, addedVia) {
    const product = App.Catalog.getProduct(productId);
    const variant = product ? App.Catalog.variantFor(product, variantId) : null;
    return {
      id: U.uid('item'),
      productId: productId,
      xCm: U.round(x, 2),
      zCm: U.round(z, 2),
      rotationDeg: U.normalizeDeg(rotationDeg),
      locked: false,
      variantId: variant ? variant.id : null,
      addedVia: addedVia === 'ai' ? 'ai' : 'manual',
      placedAt: nowIso()
    };
  }

  function addPlaced(productId, x, z, rotationDeg, variantId, addedVia) {
    const guard = ensureDesign();
    if (guard) return guard;
    if (!U.isFiniteNumber(x) || !U.isFiniteNumber(z)) return { ok: false, error: 'That position is not valid.' };
    const limit = limitCheck(productId, 1);
    if (!limit.ok) return limit;
    const item = makePlacedItem(productId, x, z, rotationDeg, variantId, addedVia);
    const product = App.Catalog.getProduct(productId);
    if (product && product.category === 'rug') design.placedItems.unshift(item);
    else design.placedItems.push(item);
    commit('placed-add');
    return { ok: true, item: item };
  }

  function updatePlaced(id, patch) {
    const guard = ensureDesign();
    if (guard) return guard;
    const item = design.placedItems.find(function (p) { return p.id === id; });
    if (!item) return { ok: false, error: 'That item is no longer in the design.' };
    const p = patch || {};
    const wantsTransform = Object.prototype.hasOwnProperty.call(p, 'xCm') || Object.prototype.hasOwnProperty.call(p, 'zCm') ||
      Object.prototype.hasOwnProperty.call(p, 'rotationDeg');
    if (item.locked && wantsTransform && p.locked !== false) {
      return { ok: false, error: 'This item is locked. Unlock it before moving or rotating it.' };
    }
    if (Object.prototype.hasOwnProperty.call(p, 'xCm')) {
      if (!U.isFiniteNumber(p.xCm)) return { ok: false, error: 'Position must be a valid number.' };
      item.xCm = U.round(p.xCm, 2);
    }
    if (Object.prototype.hasOwnProperty.call(p, 'zCm')) {
      if (!U.isFiniteNumber(p.zCm)) return { ok: false, error: 'Position must be a valid number.' };
      item.zCm = U.round(p.zCm, 2);
    }
    if (Object.prototype.hasOwnProperty.call(p, 'rotationDeg')) {
      if (!U.isFiniteNumber(p.rotationDeg)) return { ok: false, error: 'Rotation must be a valid number.' };
      item.rotationDeg = U.normalizeDeg(p.rotationDeg);
    }
    if (Object.prototype.hasOwnProperty.call(p, 'locked')) item.locked = !!p.locked;
    if (Object.prototype.hasOwnProperty.call(p, 'variantId')) {
      const product = App.Catalog.getProduct(item.productId);
      const variant = product ? App.Catalog.variantFor(product, p.variantId) : null;
      if (product && product.variants.length && !variant) return { ok: false, error: 'That variant is not available.' };
      item.variantId = variant ? variant.id : null;
    }
    commit('placed-update');
    return { ok: true, item: item };
  }

  function removePlaced(id) {
    const guard = ensureDesign();
    if (guard) return guard;
    const index = design.placedItems.findIndex(function (p) { return p.id === id; });
    if (index < 0) return { ok: false, error: 'That item is no longer in the design.' };
    design.placedItems.splice(index, 1);
    commit('placed-remove');
    return { ok: true };
  }

  function duplicatePlaced(id) {
    const guard = ensureDesign();
    if (guard) return guard;
    const source = design.placedItems.find(function (p) { return p.id === id; });
    if (!source) return { ok: false, error: 'That item is no longer in the design.' };
    const limit = limitCheck(source.productId, 1);
    if (!limit.ok) return limit;
    const product = App.Catalog.getProduct(source.productId);
    if (!product) return { ok: false, error: 'The product for this item is unavailable.' };
    let x = source.xCm + 25;
    let z = source.zCm + 25;
    let rotation = source.rotationDeg;
    const spot = App.Geometry.nearestFreePlacement(design, product, App.Catalog.getProductsById(), x, z, rotation);
    if (spot) {
      x = spot.xCm;
      z = spot.zCm;
      rotation = spot.rotationDeg;
    } else {
      const clampPos = App.Geometry.clampCenterToRoom(design.room, product.widthCm, product.lengthCm, rotation, x, z, 2);
      if (clampPos) { x = clampPos.x; z = clampPos.z; }
    }
    const copy = makePlacedItem(source.productId, x, z, rotation, source.variantId, 'manual');
    const sourceIndex = design.placedItems.indexOf(source);
    design.placedItems.splice(sourceIndex + 1, 0, copy);
    commit('placed-duplicate');
    return { ok: true, item: copy };
  }

  function moveLayer(id, direction) {
    const guard = ensureDesign();
    if (guard) return guard;
    const index = design.placedItems.findIndex(function (p) { return p.id === id; });
    if (index < 0) return { ok: false, error: 'That item is no longer in the design.' };
    const target = direction === 'up' ? index + 1 : index - 1;
    if (target < 0 || target >= design.placedItems.length) {
      return { ok: false, error: direction === 'up' ? 'This item is already in the top layer.' : 'This item is already in the bottom layer.' };
    }
    const temp = design.placedItems[target];
    design.placedItems[target] = design.placedItems[index];
    design.placedItems[index] = temp;
    commit('layer-change');
    return { ok: true };
  }

  function addStructural(type, wall, offsetCm, options) {
    const guard = ensureDesign();
    if (guard) return guard;
    if (App.Geometry.isCircle(design.room)) {
      return { ok: false, error: 'Doors and windows cannot be added to circular walls in this version.' };
    }
    const opts = options || {};
    const kind = type === 'window' ? 'window' : 'door';
    const spec = kind === 'window' ? C.STRUCTURAL.WINDOW : C.STRUCTURAL.DOOR;
    const w = App.Geometry.getWall(design.room, wall);
    if (!w) return { ok: false, error: 'Choose a valid wall.' };
    const maxWidth = Math.max(spec.minWidthCm, w.lengthCm - C.STRUCTURAL.MIN_WALL_MARGIN_CM * 2);
    const width = U.clamp(U.toNumber(opts.widthCm, spec.defaultWidthCm), Math.min(spec.minWidthCm, maxWidth), Math.min(spec.maxWidthCm, maxWidth));
    let height = U.clamp(U.toNumber(opts.heightCm, spec.defaultHeightCm), spec.minHeightCm, spec.maxHeightCm);
    let sill = kind === 'window' ? U.clamp(U.toNumber(opts.sillCm, spec.defaultSillCm), 0, design.room.heightCm - 40) : 0;
    if (sill + height > design.room.heightCm) height = Math.max(40, design.room.heightCm - sill);
    const offset = U.isFiniteNumber(offsetCm) ? offsetCm : w.lengthCm / 2;
    const item = {
      id: U.uid('opening'),
      type: kind,
      wall: w.id,
      offsetCm: U.clamp(offset, width / 2, w.lengthCm - width / 2),
      widthCm: width,
      heightCm: height,
      sillCm: sill,
      style: normalizeStructuralStyle(kind, opts.style || (kind === 'window' ? C.STRUCTURAL.DEFAULT_WINDOW_STYLE : C.STRUCTURAL.DEFAULT_DOOR_STYLE))
    };
    if (opts.productId) {
      item.productId = String(opts.productId);
      item.price = U.toNumber(opts.price, 0);
      item.name = String(opts.name || spec.label).trim().slice(0, 80);
    }
    const validation = App.Geometry.validateStructuralItem(design, item);
    if (validation.errors.length) {
      return { ok: false, error: validation.errors[0] };
    }
    design.structuralItems.push(item);
    commit('structural-add');
    return { ok: true, item: item };
  }

  function updateStructural(id, patch) {
    const guard = ensureDesign();
    if (guard) return guard;
    const item = design.structuralItems.find(function (p) { return p.id === id; });
    if (!item) return { ok: false, error: 'That opening is no longer in the design.' };
    const original = U.deepClone(item);
    const p = patch || {};
    ['offsetCm', 'widthCm', 'heightCm', 'sillCm'].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(p, key)) {
        const value = Number(p[key]);
        if (!U.isFiniteNumber(value)) return;
        item[key] = value;
      }
    });
    if (Object.prototype.hasOwnProperty.call(p, 'wall')) item.wall = p.wall;
    if (Object.prototype.hasOwnProperty.call(p, 'style')) item.style = normalizeStructuralStyle(item.type, p.style);
    if (item.type === 'door') item.sillCm = 0;
    const validation = App.Geometry.validateStructuralItem(design, item);
    if (validation.errors.length) {
      Object.assign(item, original);
      return { ok: false, error: validation.errors[0], details: validation.errors };
    }
    commit('structural-update');
    return { ok: true, item: item };
  }

  function removeStructural(id) {
    const guard = ensureDesign();
    if (guard) return guard;
    const index = design.structuralItems.findIndex(function (p) { return p.id === id; });
    if (index < 0) return { ok: false, error: 'That opening is no longer in the design.' };
    design.structuralItems.splice(index, 1);
    commit('structural-remove');
    return { ok: true };
  }

  /* ------------------------------------------------------- partition walls */

  function rememberWalls() {
    if (!design) return;
    wallHistory.push({ designId: design.id, walls: U.deepClone(design.interiorWalls || []) });
    if (wallHistory.length > 40) wallHistory.shift();
  }

  function insideRoomBounds(room, x, z) {
    const size = App.Geometry.roomSize(room);
    return x >= -0.5 && z >= -0.5 && x <= size.width + 0.5 && z <= size.length + 0.5;
  }

  function cleanWallPoints(room, wall, excludeId) {
    const size = App.Geometry.roomSize(room);
    wall.x1Cm = U.clamp(U.round(wall.x1Cm, 1), 0, size.width);
    wall.z1Cm = U.clamp(U.round(wall.z1Cm, 1), 0, size.length);
    wall.x2Cm = U.clamp(U.round(wall.x2Cm, 1), 0, size.width);
    wall.z2Cm = U.clamp(U.round(wall.z2Cm, 1), 0, size.length);
    const length = App.Geometry.interiorWallLength(wall);
    if (length < 40) return { ok: false, error: 'Walls need to be at least 40 cm long.' };
    if (!insideRoomBounds(room, wall.x1Cm, wall.z1Cm) || !insideRoomBounds(room, wall.x2Cm, wall.z2Cm)) {
      return { ok: false, error: 'Both ends of a wall must stay inside the room.' };
    }
    const duplicate = (design.interiorWalls || []).some(function (other) {
      if (other.id === excludeId) return false;
      const sameForward = Math.hypot(other.x1Cm - wall.x1Cm, other.z1Cm - wall.z1Cm) < 1 &&
        Math.hypot(other.x2Cm - wall.x2Cm, other.z2Cm - wall.z2Cm) < 1;
      const sameBackward = Math.hypot(other.x1Cm - wall.x2Cm, other.z1Cm - wall.z2Cm) < 1 &&
        Math.hypot(other.x2Cm - wall.x1Cm, other.z2Cm - wall.z1Cm) < 1;
      return sameForward || sameBackward;
    });
    if (duplicate) return { ok: false, error: 'A wall already runs between those two points.' };
    return { ok: true };
  }

  function addInteriorWall(input) {
    const guard = ensureDesign();
    if (guard) return guard;
    if (App.Geometry.isCircle(design.room)) {
      return { ok: false, error: 'Partition walls are not supported in circular rooms in this version.' };
    }
    const opts = input || {};
    const wall = {
      id: U.uid('wall'),
      x1Cm: U.toNumber(opts.x1Cm, 0),
      z1Cm: U.toNumber(opts.z1Cm, 0),
      x2Cm: U.toNumber(opts.x2Cm, 0),
      z2Cm: U.toNumber(opts.z2Cm, 0),
      thicknessCm: U.clamp(U.toNumber(opts.thicknessCm, C.WALL_THICKNESS_CM), 6, 40),
      heightCm: U.clamp(U.toNumber(opts.heightCm, design.room.heightCm), 100, design.room.heightCm),
      openings: []
    };
    if (![wall.x1Cm, wall.z1Cm, wall.x2Cm, wall.z2Cm].every(U.isFiniteNumber)) {
      return { ok: false, error: 'Wall endpoints must be numbers.' };
    }
    const check = cleanWallPoints(design.room, wall, null);
    if (!check.ok) return check;
    if (!Array.isArray(design.interiorWalls)) design.interiorWalls = [];
    rememberWalls();
    design.interiorWalls.push(wall);
    commit('wall-add');
    if (typeof App.onInteriorWallChanged === 'function') App.onInteriorWallChanged('add', wall);
    return { ok: true, wall: wall };
  }

  function updateInteriorWall(id, patch, options) {
    const guard = ensureDesign();
    if (guard) return guard;
    const wall = (design.interiorWalls || []).find(function (w) { return w.id === id; });
    if (!wall) return { ok: false, error: 'That wall is no longer in the design.' };
    const p = patch || {};
    const next = U.deepClone(wall);
    ['x1Cm', 'z1Cm', 'x2Cm', 'z2Cm'].forEach(function (key) {
      if (Object.prototype.hasOwnProperty.call(p, key)) {
        const value = Number(p[key]);
        if (!U.isFiniteNumber(value)) return;
        next[key] = value;
      }
    });
    if (Object.prototype.hasOwnProperty.call(p, 'thicknessCm')) {
      next.thicknessCm = U.clamp(U.toNumber(p.thicknessCm, next.thicknessCm), 6, 40);
    }
    if (Object.prototype.hasOwnProperty.call(p, 'heightCm')) {
      next.heightCm = U.clamp(U.toNumber(p.heightCm, next.heightCm), 100, design.room.heightCm);
    }
    const check = cleanWallPoints(design.room, next, id);
    if (!check.ok) return check;
    const length = App.Geometry.interiorWallLength(next);
    next.openings = (next.openings || []).map(function (opening) {
      const width = Math.min(opening.widthCm, Math.max(40, length - 10));
      return Object.assign({}, opening, {
        widthCm: width,
        offsetCm: U.clamp(opening.offsetCm, width / 2, Math.max(width / 2, length - width / 2))
      });
    });
    const changed = JSON.stringify(wall) !== JSON.stringify(next);
    if (!changed) return { ok: true, wall: wall };
    if (!(options && options.silentHistory)) rememberWalls();
    Object.assign(wall, next);
    commit('wall-update');
    if (typeof App.onInteriorWallChanged === 'function') App.onInteriorWallChanged('update', wall);
    return { ok: true, wall: wall };
  }

  function removeInteriorWall(id) {
    const guard = ensureDesign();
    if (guard) return guard;
    const index = (design.interiorWalls || []).findIndex(function (w) { return w.id === id; });
    if (index < 0) return { ok: false, error: 'That wall is no longer in the design.' };
    rememberWalls();
    design.interiorWalls.splice(index, 1);
    commit('wall-remove');
    if (typeof App.onInteriorWallChanged === 'function') App.onInteriorWallChanged('remove', null);
    return { ok: true };
  }

  function addInteriorOpening(wallId, offsetCm, type, options) {
    const guard = ensureDesign();
    if (guard) return guard;
    const wall = (design.interiorWalls || []).find(function (w) { return w.id === wallId; });
    if (!wall) return { ok: false, error: 'That wall is no longer in the design.' };
    const opts = options || {};
    const kind = type === 'window' ? 'window' : 'door';
    const spec = kind === 'window' ? C.STRUCTURAL.WINDOW : C.STRUCTURAL.DOOR;
    const length = App.Geometry.interiorWallLength(wall);
    const width = U.clamp(U.toNumber(opts.widthCm, spec.defaultWidthCm), 40, Math.max(40, length - 10));
    const height = U.clamp(U.toNumber(opts.heightCm, spec.defaultHeightCm), 40, wall.heightCm - (kind === 'window' ? 20 : 0));
    const sill = kind === 'window' ? U.clamp(U.toNumber(opts.sillCm, spec.defaultSillCm), 0, wall.heightCm - height) : 0;
    const offset = U.clamp(U.isFiniteNumber(offsetCm) ? offsetCm : length / 2, width / 2, Math.max(width / 2, length - width / 2));
    if (sill + height > wall.heightCm) return { ok: false, error: 'That opening is taller than the wall.' };
    const overlap = (wall.openings || []).some(function (opening) {
      return Math.abs(opening.offsetCm - offset) < (opening.widthCm + width) / 2 + 5;
    });
    if (overlap) return { ok: false, error: 'Another opening is already in the way. Move it first.' };
    const opening = {
      id: U.uid('iopen'),
      type: kind,
      offsetCm: U.round(offset, 1),
      widthCm: U.round(width, 1),
      heightCm: U.round(height, 1),
      sillCm: U.round(sill, 1)
    };
    rememberWalls();
    if (!Array.isArray(wall.openings)) wall.openings = [];
    wall.openings.push(opening);
    wall.openings.sort(function (a, b) { return a.offsetCm - b.offsetCm; });
    commit('interior-opening-add');
    return { ok: true, opening: opening };
  }

  function updateInteriorOpening(wallId, openingId, patch) {
    const guard = ensureDesign();
    if (guard) return guard;
    const wall = (design.interiorWalls || []).find(function (w) { return w.id === wallId; });
    if (!wall) return { ok: false, error: 'That wall is no longer in the design.' };
    const opening = (wall.openings || []).find(function (o) { return o.id === openingId; });
    if (!opening) return { ok: false, error: 'That opening is no longer on this wall.' };
    const p = patch || {};
    const next = U.deepClone(opening);
    if (Object.prototype.hasOwnProperty.call(p, 'offsetCm')) next.offsetCm = U.toNumber(p.offsetCm, next.offsetCm);
    if (Object.prototype.hasOwnProperty.call(p, 'widthCm')) next.widthCm = U.toNumber(p.widthCm, next.widthCm);
    if (Object.prototype.hasOwnProperty.call(p, 'heightCm')) next.heightCm = U.toNumber(p.heightCm, next.heightCm);
    if (Object.prototype.hasOwnProperty.call(p, 'sillCm')) next.sillCm = U.toNumber(p.sillCm, next.sillCm);
    const length = App.Geometry.interiorWallLength(wall);
    next.widthCm = U.clamp(next.widthCm, 40, Math.max(40, length - 10));
    next.offsetCm = U.clamp(next.offsetCm, next.widthCm / 2, Math.max(next.widthCm / 2, length - next.widthCm / 2));
    if (next.type === 'window') {
      next.sillCm = U.clamp(next.sillCm, 0, wall.heightCm - 40);
    } else {
      next.sillCm = 0;
    }
    next.heightCm = U.clamp(next.heightCm, 40, wall.heightCm - next.sillCm);
    const overlap = (wall.openings || []).some(function (other) {
      if (other.id === opening.id) return false;
      return Math.abs(other.offsetCm - next.offsetCm) < (other.widthCm + next.widthCm) / 2 + 5;
    });
    if (overlap) return { ok: false, error: 'That would overlap another opening on the wall.' };
    rememberWalls();
    Object.assign(opening, next);
    commit('interior-opening-update');
    return { ok: true, opening: opening };
  }

  function removeInteriorOpening(wallId, openingId) {
    const guard = ensureDesign();
    if (guard) return guard;
    const wall = (design.interiorWalls || []).find(function (w) { return w.id === wallId; });
    if (!wall) return { ok: false, error: 'That wall is no longer in the design.' };
    const index = (wall.openings || []).findIndex(function (o) { return o.id === openingId; });
    if (index < 0) return { ok: false, error: 'That opening is no longer on this wall.' };
    rememberWalls();
    wall.openings.splice(index, 1);
    commit('interior-opening-remove');
    return { ok: true };
  }

  function undoInteriorWall() {
    const guard = ensureDesign();
    if (guard) return guard;
    while (wallHistory.length) {
      const entry = wallHistory.pop();
      if (entry.designId !== design.id) continue;
      design.interiorWalls = entry.walls;
      commit('wall-undo');
      if (typeof App.onInteriorWallChanged === 'function') App.onInteriorWallChanged('undo', null);
      return { ok: true };
    }
    return { ok: false, error: 'No wall change to undo.' };
  }

  function getInteriorWall(id) {
    return design && (design.interiorWalls || []).find(function (w) { return w.id === id; }) || null;
  }

  function beginWallEdit() {
    rememberWalls();
    return { ok: true };
  }

  function setRoom(patch) {
    const guard = ensureDesign();
    if (guard) return guard;
    const p = patch || {};
    const shape = p.shape ? normalizeShape(p.shape) : design.room.shape;
    const room = buildRoom({
      shape: shape,
      widthCm: U.toNumber(p.widthCm, design.room.widthCm),
      lengthCm: U.toNumber(p.lengthCm, design.room.lengthCm),
      heightCm: U.toNumber(p.heightCm, design.room.heightCm),
      diameterCm: U.toNumber(p.diameterCm, design.room.diameterCm)
    });
    if (room.widthCm < C.ROOM.MIN_DIM_CM || room.widthCm > C.ROOM.MAX_DIM_CM ||
      room.lengthCm < C.ROOM.MIN_DIM_CM || room.lengthCm > C.ROOM.MAX_DIM_CM) {
      return { ok: false, error: 'Room dimensions must be between ' + C.ROOM.MIN_DIM_CM + ' and ' + C.ROOM.MAX_DIM_CM + ' cm.' };
    }
    if (room.heightCm < C.ROOM.MIN_HEIGHT_CM || room.heightCm > C.ROOM.MAX_HEIGHT_CM) {
      return { ok: false, error: 'Room height must be between ' + C.ROOM.MIN_HEIGHT_CM + ' and ' + C.ROOM.MAX_HEIGHT_CM + ' cm.' };
    }
    design.room = room;
    /* Partition walls belong to the old footprint. Clamp them into the new
       room and drop any that would now be outside or too short. */
    if (App.Geometry.isCircle(room) || !Array.isArray(design.interiorWalls)) {
      if (Array.isArray(design.interiorWalls)) design.interiorWalls = [];
    } else {
      design.interiorWalls = design.interiorWalls.map(function (wall) {
        const next = U.deepClone(wall);
        next.x1Cm = U.clamp(next.x1Cm, 0, room.widthCm);
        next.z1Cm = U.clamp(next.z1Cm, 0, room.lengthCm);
        next.x2Cm = U.clamp(next.x2Cm, 0, room.widthCm);
        next.z2Cm = U.clamp(next.z2Cm, 0, room.lengthCm);
        next.heightCm = Math.min(next.heightCm || room.heightCm, room.heightCm);
        return next;
      }).filter(function (wall) {
        return App.Geometry.interiorWallLength(wall) >= 40;
      });
    }
    commit('room-update');
    return { ok: true, room: room };
  }

  function setBudget(value) {
    const guard = ensureDesign();
    if (guard) return guard;
    if (value === null || value === '' || value === undefined) {
      design.budget = null;
      commit('budget-update');
      return { ok: true };
    }
    const n = Number(value);
    if (!U.isFiniteNumber(n) || n < 0) return { ok: false, error: 'Budget must be zero or a positive number.' };
    design.budget = U.round(n, 2);
    commit('budget-update');
    return { ok: true };
  }

  function setName(value) {
    const guard = ensureDesign();
    if (guard) return guard;
    const name = String(value || '').trim().slice(0, 80);
    if (!name) return { ok: false, error: 'A design name is required.' };
    design.name = name;
    commit('name-update');
    return { ok: true };
  }

  function setMode(mode) {
    const guard = ensureDesign();
    if (guard) return guard;
    design.mode = mode === 'ai' ? 'ai' : 'manual';
    commit('mode-update');
    return { ok: true };
  }

  function setWallColor(value) {
    const guard = ensureDesign();
    if (guard) return guard;
    const color = normalizeWallColor(value);
    if (color === design.wallColor) return { ok: true, wallColor: color };
    design.wallColor = color;
    commit('wall-color');
    return { ok: true, wallColor: color };
  }

  function setExteriorWallColor(value) {
    const guard = ensureDesign();
    if (guard) return guard;
    const color = value == null || String(value).trim() === '' ? null : normalizeWallColor(value);
    if (color === (design.exteriorWallColor || null)) return { ok: true, exteriorWallColor: color };
    design.exteriorWallColor = color;
    commit('exterior-wall-color');
    return { ok: true, exteriorWallColor: color };
  }

  function setFloor(patch) {
    const guard = ensureDesign();
    if (guard) return guard;
    const p = patch || {};
    const current = design.floor || normalizeFloor(null);
    const next = {
      mode: p.mode === 'texture' ? 'texture' : p.mode === 'color' ? 'color' : current.mode,
      color: Object.prototype.hasOwnProperty.call(p, 'color') ? normalizeFloorColor(p.color) : current.color,
      textureKey: Object.prototype.hasOwnProperty.call(p, 'textureKey') ? (typeof p.textureKey === 'string' && p.textureKey ? p.textureKey : null) : current.textureKey,
      textureScale: Object.prototype.hasOwnProperty.call(p, 'textureScale')
        ? (U.isFiniteNumber(Number(p.textureScale)) ? U.clamp(Number(p.textureScale), C.FLOOR_TEXTURE.MIN_SCALE_M, C.FLOOR_TEXTURE.MAX_SCALE_M) : current.textureScale)
        : current.textureScale
    };
    if (next.mode === 'texture' && !next.textureKey) {
      return { ok: false, error: 'Choose a floor texture image first, or switch back to a solid colour.' };
    }
    design.floor = next;
    commit('floor-update');
    return { ok: true, floor: next };
  }

  function resetFloor() {
    const guard = ensureDesign();
    if (guard) return guard;
    design.floor = normalizeFloor(null);
    commit('floor-update');
    return { ok: true, floor: design.floor };
  }

  function replacePlacedItems(items, options) {
    const guard = ensureDesign();
    if (guard) return guard;
    const opts = options || {};
    if (!Array.isArray(items)) return { ok: false, error: 'No layout items were provided.' };
    if (items.length > C.LIMITS.MAX_PLACED_ITEMS) {
      return { ok: false, error: 'A layout cannot exceed ' + C.LIMITS.MAX_PLACED_ITEMS + ' items.' };
    }
    const normalized = [];
    const used = new Set();
    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      if (!raw || !raw.productId) return { ok: false, error: 'A generated item was missing its product reference.' };
      if (!App.Catalog.getProduct(raw.productId)) return { ok: false, error: 'A generated item referenced an unavailable product.' };
      let id = raw.id || U.uid('item');
      while (used.has(id)) id = U.uid('item');
      used.add(id);
      normalized.push({
        id: id,
        productId: raw.productId,
        xCm: Number(raw.xCm),
        zCm: Number(raw.zCm),
        rotationDeg: U.normalizeDeg(raw.rotationDeg),
        locked: !!raw.locked,
        variantId: raw.variantId || null,
        addedVia: opts.addedVia === 'manual' ? 'manual' : 'ai',
        placedAt: nowIso()
      });
    }
    design.placedItems = normalized;
    commit(opts.reason || 'layout-replaced');
    return { ok: true };
  }

  function removeAllPlaced() {
    const guard = ensureDesign();
    if (guard) return guard;
    design.placedItems = [];
    commit('placed-clear');
    return { ok: true };
  }

  function replaceStructuralItems(items, options) {
    const guard = ensureDesign();
    if (guard) return guard;
    const opts = options || {};
    if (!Array.isArray(items)) return { ok: false, error: 'No openings were provided.' };
    const normalized = [];
    const used = new Set();
    for (let i = 0; i < items.length; i++) {
      const raw = items[i];
      if (!raw) return { ok: false, error: 'A generated opening was empty.' };
      let id = raw.id || U.uid('opening');
      while (used.has(id)) id = U.uid('opening');
      used.add(id);
      normalized.push(normalizeStructural(raw, design.room, []));
    }
    if (normalized.some(function (item) { return !item; })) {
      return { ok: false, error: 'A generated opening had invalid data.' };
    }
    design.structuralItems = normalized;
    commit(opts.reason || 'structural-replaced');
    return { ok: true };
  }

  function capturePlacedItems() {
    return design ? U.deepClone(design.placedItems) : [];
  }

  function restorePlacedItems(items) {
    const guard = ensureDesign();
    if (guard) return guard;
    const result = replacePlacedItems(items, { addedVia: 'manual', reason: 'layout-restored' });
    return result;
  }

  function countProductInstances(productId) {
    if (!design) return 0;
    return design.placedItems.filter(function (item) { return item.productId === productId; }).length;
  }

  function getStructural(id) {
    if (!design) return null;
    return design.structuralItems.find(function (item) { return item.id === id; }) || null;
  }

  function getPlaced(id) {
    if (!design) return null;
    return design.placedItems.find(function (item) { return item.id === id; }) || null;
  }

  App.State = {
    createDesign: createDesign,
    normalizeLoadedDesign: normalizeLoadedDesign,
    init: init,
    get: get,
    subscribe: subscribe,
    addPlaced: addPlaced,
    updatePlaced: updatePlaced,
    removePlaced: removePlaced,
    duplicatePlaced: duplicatePlaced,
    moveLayer: moveLayer,
    addStructural: addStructural,
    updateStructural: updateStructural,
    removeStructural: removeStructural,
    addInteriorWall: addInteriorWall,
    updateInteriorWall: updateInteriorWall,
    removeInteriorWall: removeInteriorWall,
    addInteriorOpening: addInteriorOpening,
    updateInteriorOpening: updateInteriorOpening,
    removeInteriorOpening: removeInteriorOpening,
    undoInteriorWall: undoInteriorWall,
    beginWallEdit: beginWallEdit,
    getInteriorWall: getInteriorWall,
    setRoom: setRoom,
    setBudget: setBudget,
    setName: setName,
    setMode: setMode,
    setWallColor: setWallColor,
    setExteriorWallColor: setExteriorWallColor,
    setFloor: setFloor,
    resetFloor: resetFloor,
    replacePlacedItems: replacePlacedItems,
    replaceStructuralItems: replaceStructuralItems,
    removeAllPlaced: removeAllPlaced,
    capturePlacedItems: capturePlacedItems,
    restorePlacedItems: restorePlacedItems,
    countProductInstances: countProductInstances,
    categoryCount: categoryCount,
    limitCheck: limitCheck,
    getStructural: getStructural,
    getPlaced: getPlaced
  };
})(window.App = window.App || {});
