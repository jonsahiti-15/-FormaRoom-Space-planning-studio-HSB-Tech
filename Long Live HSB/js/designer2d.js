(function (App) {
  'use strict';

  const U = App.Util;
  const G = App.Geometry;
  const C = App.CONFIG;
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
  const COLORS = {
    background: '#eef3ef',
    dot: 'rgba(24, 62, 42, 0.09)',
    floor: '#fcfdfc',
    floorStroke: 'rgba(15, 122, 82, 0.16)',
    grid: 'rgba(15, 122, 82, 0.07)',
    wall: '#2d3b33',
    wallLight: '#4a5b51',
    green: '#0f7a52',
    greenSoft: 'rgba(15, 122, 82, 0.13)',
    danger: '#b93b2f',
    dangerSoft: 'rgba(185, 59, 47, 0.1)',
    label: '#3e4f46',
    muted: '#718078',
    door: '#7a5f43',
    glass: '#a8cdd8',
    glassStroke: '#5c8492',
    white: '#ffffff'
  };

  let canvas = null;
  let wrap = null;
  let ctx = null;
  let dpr = 1;
  let cssWidth = 0;
  let cssHeight = 0;
  let view = { scale: 1, panX: 0, panY: 0, initialized: false };
  let interaction = null;
  let ghost = null;
  let toolGhost = null;
  let dragProductId = null;
  let tool = 'select';
  let wallDraw = null;
  let wallHover = null;
  let snapEnabled = true;
  let spaceDown = false;
  let lastNotifiedScale = null;
  let raf = null;
  let resizeObserver = null;
  let handlersBound = false;

  function requestDraw() {
    if (raf) return;
    raf = requestAnimationFrame(function () {
      raf = null;
      draw();
    });
  }

  function getDesign() { return App.State ? App.State.get() : null; }

  function getSelected() {
    return App.getSelection ? App.getSelection() : null;
  }

  function getProductsById() {
    return App.Catalog ? App.Catalog.getProductsById() : {};
  }

  function init(canvasEl, wrapEl) {
    canvas = canvasEl;
    wrap = wrapEl;
    ctx = canvas.getContext('2d');
    bindEvents();
    resizeObserver = new ResizeObserver(function () { handleResize(); });
    resizeObserver.observe(wrap);
    handleResize();
    requestDraw();
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
    if (!view.initialized && getDesign()) {
      fitView(false);
    } else if (view.initialized) {
      notifyView();
    }
    requestDraw();
  }

  function notifyView() {
    if (typeof App.onPlanViewChange === 'function' && view.initialized) {
      if (lastNotifiedScale !== view.scale) {
        lastNotifiedScale = view.scale;
        App.onPlanViewChange(view.scale);
      }
    }
  }

  function fitView(redraw) {
    const design = getDesign();
    if (!design || !cssWidth || !cssHeight) return;
    const size = G.roomSize(design.room);
    if (!size.width || !size.length) return;
    const paddingX = Math.max(70, Math.min(120, cssWidth * 0.13));
    const paddingTop = 100;
    const paddingBottom = 90;
    const availableW = Math.max(40, cssWidth - paddingX * 2);
    const availableH = Math.max(40, cssHeight - paddingTop - paddingBottom);
    const scale = Math.min(availableW / size.width, availableH / size.length);
    view.scale = U.clamp(scale, 0.04, 6);
    view.panX = (cssWidth - size.width * view.scale) / 2;
    view.panY = paddingTop + (availableH - size.length * view.scale) / 2;
    view.initialized = true;
    lastNotifiedScale = null;
    notifyView();
    if (redraw !== false) requestDraw();
  }

  function zoomBy(factor, anchorX, anchorY) {
    if (!view.initialized) return;
    const ax = U.isFiniteNumber(anchorX) ? anchorX : cssWidth / 2;
    const ay = U.isFiniteNumber(anchorY) ? anchorY : cssHeight / 2;
    const worldX = (ax - view.panX) / view.scale;
    const worldZ = (ay - view.panY) / view.scale;
    const next = U.clamp(view.scale * factor, 0.04, 6);
    if (next === view.scale) return;
    view.scale = next;
    view.panX = ax - worldX * view.scale;
    view.panY = ay - worldZ * view.scale;
    notifyView();
    requestDraw();
  }

  function setTool(nextTool) {
    tool = ['select', 'wall', 'door', 'window'].indexOf(nextTool) >= 0 ? nextTool : 'select';
    toolGhost = null;
    if (tool !== 'wall') { wallDraw = null; wallHover = null; }
    updateCursor();
    requestDraw();
    if (typeof App.onPlanToolChange === 'function') App.onPlanToolChange(tool);
  }

  function getTool() { return tool; }

  function beginWallTool() {
    const design = getDesign();
    if (!design) {
      if (typeof App.notify === 'function') App.notify('Create a room before drawing partition walls.', 'warning');
      return;
    }
    if (G.isCircle(design.room)) {
      if (typeof App.notify === 'function') App.notify('Partition walls are not supported in circular rooms in this version.', 'warning');
      return;
    }
    setTool('wall');
    if (typeof App.notify === 'function') {
      App.notify('Click once for the wall start, then again for the end. Endpoints snap to corners and other walls.', 'info', { duration: 5200 });
    }
  }

  function setSnap(enabled) {
    snapEnabled = !!enabled;
    requestDraw();
  }

  function toggleSnap() {
    snapEnabled = !snapEnabled;
    return snapEnabled;
  }

  function getSnap() { return snapEnabled; }

  function startCatalogDrag(productId) {
    dragProductId = productId;
    ghost = null;
  }

  function endCatalogDrag() {
    dragProductId = null;
    ghost = null;
    requestDraw();
  }

  function screenToPlan(sx, sy) {
    return { x: (sx - view.panX) / view.scale, z: (sy - view.panY) / view.scale };
  }

  function pointerInfo(event) {
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const plan = screenToPlan(sx, sy);
    return { sx: sx, sy: sy, x: plan.x, z: plan.z };
  }

  function planToScreen(x, z) {
    return { x: view.panX + x * view.scale, y: view.panY + z * view.scale };
  }

  function snapValue(value) {
    return snapEnabled ? Math.round(value / C.SNAP_CM) * C.SNAP_CM : value;
  }

  function getPlacedProduct(item) {
    return item ? App.Catalog.getProduct(item.productId) : null;
  }

  function hitTestPlaced(px, py) {
    const design = getDesign();
    if (!design) return null;
    const products = getProductsById();
    for (let i = design.placedItems.length - 1; i >= 0; i--) {
      const item = design.placedItems[i];
      const product = products[item.productId];
      if (!product) continue;
      if (G.pointInOBB(px, py, item.xCm, item.zCm, product.widthCm, product.lengthCm, item.rotationDeg)) {
        return { type: 'placed', id: item.id, item: item, product: product };
      }
    }
    return null;
  }

  function hitTestStructural(px, py) {
    const design = getDesign();
    if (!design || G.isCircle(design.room)) return null;
    const walls = G.getWalls(design.room);
    let best = null;
    walls.forEach(function (wall) {
      const t = (px - wall.start.x) * wall.dir.x + (py - wall.start.z) * wall.dir.z;
      if (t < 0 || t > wall.lengthCm) return;
      const p = G.wallPoint(wall, t);
      const distPx = Math.hypot(px - p.x, py - p.z) * view.scale;
      if (distPx > 16) return;
      (design.structuralItems || []).forEach(function (item) {
        if (item.wall !== wall.id) return;
        const span = G.structuralSpan(item);
        if (t >= span.left - 3 && t <= span.right + 3) {
          if (!best || distPx < best.distancePx) best = { type: 'structural', id: item.id, item: item, wall: wall, distancePx: distPx };
        }
      });
    });
    return best;
  }

  function rotationHandleScreen(item, product) {
    const center = planToScreen(item.xCm, item.zCm);
    const angle = U.degToRad(item.rotationDeg);
    const localOffset = product.lengthCm / 2 + 26 / view.scale;
    const vecX = Math.sin(angle) * localOffset;
    const vecY = -Math.cos(angle) * localOffset;
    return {
      x: center.x + vecX * view.scale,
      y: center.y + vecY * view.scale,
      center: center
    };
  }

  function hitTestRotationHandle(event) {
    const selected = getSelected();
    if (!selected || selected.type !== 'placed') return false;
    const design = getDesign();
    if (!design) return false;
    const item = design.placedItems.find(function (p) { return p.id === selected.id; });
    if (!item || item.locked) return false;
    const product = getPlacedProduct(item);
    if (!product) return false;
    const info = pointerInfo(event);
    const handle = rotationHandleScreen(item, product);
    return Math.hypot(info.sx - handle.x, info.sy - handle.y) <= 13;
  }

  function structuralResizeHandles(item) {
    const design = getDesign();
    if (!design || !item) return null;
    const wall = G.getWall(design.room, item.wall);
    if (!wall) return null;
    const span = G.structuralSpan(item);
    const left = planToScreen.apply(null, wallPointCoords(wall, span.left));
    const right = planToScreen.apply(null, wallPointCoords(wall, span.right));
    return { left: left, right: right };
  }

  function hitTestStructuralResizeHandle(event) {
    const selected = getSelected();
    if (!selected || selected.type !== 'structural') return null;
    const design = getDesign();
    if (!design) return null;
    const item = design.structuralItems.find(function (p) { return p.id === selected.id; });
    if (!item) return null;
    const handles = structuralResizeHandles(item);
    if (!handles) return null;
    const info = pointerInfo(event);
    if (Math.hypot(info.sx - handles.left.x, info.sy - handles.left.y) <= 12) {
      return { item: item, edge: 'left' };
    }
    if (Math.hypot(info.sx - handles.right.x, info.sy - handles.right.y) <= 12) {
      return { item: item, edge: 'right' };
    }
    return null;
  }

  function hitTestInteriorWall(px, py, thresholdPx) {
    const design = getDesign();
    if (!design || !(design.interiorWalls || []).length) return null;
    const threshold = thresholdPx || 10;
    let best = null;
    design.interiorWalls.forEach(function (wall) {
      const projected = G.projectOnInteriorWall(wall, px, py);
      const edge = (U.toNumber(wall.thicknessCm, C.WALL_THICKNESS_CM) / 2) * view.scale + 2;
      const distancePx = projected.distance * view.scale;
      if (distancePx > Math.max(threshold, edge)) return;
      if (!best || distancePx < best.distancePx) {
        best = { type: 'wall', id: wall.id, wall: wall, distancePx: distancePx };
      }
    });
    return best;
  }

  function wallEndpointHandles(wall) {
    return {
      start: planToScreen(wall.x1Cm, wall.z1Cm),
      end: planToScreen(wall.x2Cm, wall.z2Cm)
    };
  }

  function hitTestWallEndpoint(event) {
    const selected = getSelected();
    if (!selected || selected.type !== 'wall') return null;
    const design = getDesign();
    if (!design) return null;
    const wall = (design.interiorWalls || []).find(function (w) { return w.id === selected.id; });
    if (!wall) return null;
    const info = pointerInfo(event);
    const handles = wallEndpointHandles(wall);
    if (Math.hypot(info.sx - handles.start.x, info.sy - handles.start.y) <= 11) return { wall: wall, edge: 'start' };
    if (Math.hypot(info.sx - handles.end.x, info.sy - handles.end.y) <= 11) return { wall: wall, edge: 'end' };
    return null;
  }

  function hitTestAt(event) {
    const info = pointerInfo(event);
    const structural = hitTestStructural(info.x, info.z);
    if (structural) return structural;
    const placed = hitTestPlaced(info.x, info.z);
    if (placed) return placed;
    return hitTestInteriorWall(info.x, info.z);
  }

  function updateCursor() {
    if (!canvas) return;
    if (interaction) {
      canvas.style.cursor = interaction.type === 'pan' ? 'grabbing' : interaction.type === 'structural-resize' ? 'ew-resize' : 'grabbing';
      return;
    }
    if (tool === 'wall') {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (tool === 'door' || tool === 'window') {
      canvas.style.cursor = 'crosshair';
      return;
    }
    if (!getDesign()) {
      canvas.style.cursor = 'default';
      return;
    }
    const selected = getSelected();
    if (selected && selected.type === 'structural') {
      const item = getDesign().structuralItems.find(function (p) { return p.id === selected.id; });
      if (item && lastMouse) {
        const handles = structuralResizeHandles(item);
        if (handles && (Math.hypot(lastMouse.sx - handles.left.x, lastMouse.sy - handles.left.y) <= 12 ||
          Math.hypot(lastMouse.sx - handles.right.x, lastMouse.sy - handles.right.y) <= 12)) {
          canvas.style.cursor = 'ew-resize';
          return;
        }
      }
    }
    if (selected && selected.type === 'wall') {
      const wall = (getDesign().interiorWalls || []).find(function (w) { return w.id === selected.id; });
      if (wall && lastMouse) {
        const handles = wallEndpointHandles(wall);
        if (Math.hypot(lastMouse.sx - handles.start.x, lastMouse.sy - handles.start.y) <= 11 ||
          Math.hypot(lastMouse.sx - handles.end.x, lastMouse.sy - handles.end.y) <= 11) {
          canvas.style.cursor = 'crosshair';
          return;
        }
      }
    }
    if (selected && selected.type === 'placed') {
      const item = getDesign().placedItems.find(function (p) { return p.id === selected.id; });
      const product = item && getPlacedProduct(item);
      if (item && product && !item.locked) {
        const mouse = lastMouse;
        if (mouse) {
          const handle = rotationHandleScreen(item, product);
          if (Math.hypot(mouse.sx - handle.x, mouse.sy - handle.y) <= 13) {
            canvas.style.cursor = 'grab';
            return;
          }
        }
      }
    }
    if (lastMouse) {
      const hit = hitTestPlaced(lastMouse.x, lastMouse.z);
      if (hit) {
        canvas.style.cursor = hit.item.locked ? 'not-allowed' : 'grab';
        return;
      }
      const structural = hitTestStructural(lastMouse.x, lastMouse.z);
      if (structural) {
        canvas.style.cursor = 'grab';
        return;
      }
      const wallHit = hitTestInteriorWall(lastMouse.x, lastMouse.z);
      if (wallHit) {
        canvas.style.cursor = 'pointer';
        return;
      }
    }
    canvas.style.cursor = spaceDown ? 'grab' : 'default';
  }

  let lastMouse = null;

  function bindEvents() {
    if (handlersBound) return;
    handlersBound = true;
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('dragover', onDragOver);
    canvas.addEventListener('dragleave', onDragLeave);
    canvas.addEventListener('drop', onDrop);
    canvas.addEventListener('contextmenu', function (event) {
      event.preventDefault();
      if (wallDraw) { wallDraw = null; requestDraw(); }
    });
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { spaceDown = false; });
  }

  function onKeyDown(event) {
    if (U.isTypingTarget(event.target)) return;
    if (document.querySelector('.modal-backdrop')) return;
    if (typeof App.isPlanShortcutBlocked === 'function' && App.isPlanShortcutBlocked()) return;
    if (event.code === 'Space' && !event.repeat) {
      spaceDown = true;
      if (canvas && document.activeElement === canvas) event.preventDefault();
      updateCursor();
      return;
    }
    const selected = getSelected();
    const design = getDesign();
    if (!design) return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
      if (typeof App.State.undoInteriorWall === 'function') {
        const result = App.State.undoInteriorWall();
        if (result && result.ok) {
          event.preventDefault();
          if (typeof App.notify === 'function') App.notify('Last wall change undone.', 'info');
        }
      }
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      const key = event.key.toLowerCase();
      if (key === 'v') { setTool('select'); return; }
      if (key === 'b') { beginWallTool(); return; }
      if (key === 'd') { setTool('door'); return; }
      if (key === 'w') { setTool('window'); return; }
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && selected) {
      event.preventDefault();
      if (typeof App.deleteSelection === 'function') App.deleteSelection();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'd' && selected) {
      event.preventDefault();
      if (typeof App.duplicateSelection === 'function') App.duplicateSelection();
      return;
    }
    if (event.key === 'Escape') {
      if (wallDraw) {
        wallDraw = null;
        requestDraw();
        return;
      }
      if (tool !== 'select') setTool('select');
      else if (typeof App.clearSelection === 'function') App.clearSelection();
      return;
    }
    if (selected && selected.type === 'placed' && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].indexOf(event.key) >= 0) {
      event.preventDefault();
      const item = design.placedItems.find(function (p) { return p.id === selected.id; });
      if (!item) return;
      if (item.locked) {
        if (typeof App.notify === 'function') App.notify('This item is locked. Unlock it before moving it.', 'warning');
        return;
      }
      const step = event.shiftKey ? 1 : C.SNAP_CM;
      let dx = 0;
      let dz = 0;
      if (event.key === 'ArrowLeft') dx = -step;
      if (event.key === 'ArrowRight') dx = step;
      if (event.key === 'ArrowUp') dz = -step;
      if (event.key === 'ArrowDown') dz = step;
      App.State.updatePlaced(item.id, { xCm: item.xCm + dx, zCm: item.zCm + dz });
      return;
    }
    if (selected && selected.type === 'structural' && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
      event.preventDefault();
      const item = design.structuralItems.find(function (p) { return p.id === selected.id; });
      if (!item) return;
      const step = event.shiftKey ? 1 : C.SNAP_CM;
      const next = item.offsetCm + (event.key === 'ArrowRight' ? step : -step);
      const result = App.State.updateStructural(item.id, { offsetCm: next });
      if (!result.ok && typeof App.notify === 'function') App.notify(result.error, 'warning');
      return;
    }
    if (event.key === '0' && !event.ctrlKey && !event.metaKey) {
      fitView(true);
    }
  }

  function onKeyUp(event) {
    if (event.code === 'Space') {
      spaceDown = false;
      updateCursor();
    }
  }

  function onWheel(event) {
    if (!getDesign()) return;
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const sx = event.clientX - rect.left;
    const sy = event.clientY - rect.top;
    const factor = Math.exp(-event.deltaY * 0.0016);
    zoomBy(factor, sx, sy);
  }

  function onPointerDown(event) {
    if (!getDesign()) return;
    if (event.button === 1 || (event.button === 0 && (event.altKey || spaceDown))) {
      event.preventDefault();
      interaction = {
        type: 'pan', pointerId: event.pointerId,
        startX: event.clientX, startY: event.clientY,
        panX: view.panX, panY: view.panY, moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    if (event.button !== 0) return;
    const info = pointerInfo(event);
    if (tool === 'wall') {
      handleWallClick(event, info);
      return;
    }
    if (tool === 'door' || tool === 'window') {
      placeOpeningAtPointer(event);
      return;
    }
    const wallEndpoint = hitTestWallEndpoint(event);
    if (wallEndpoint) {
      interaction = {
        type: 'wall-endpoint', pointerId: event.pointerId, wallId: wallEndpoint.wall.id,
        edge: wallEndpoint.edge, moved: false, historyStarted: false
      };
      canvas.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    if (hitTestRotationHandle(event)) {
      const selected = getSelected();
      const item = getDesign().placedItems.find(function (p) { return p.id === selected.id; });
      const center = planToScreen(item.xCm, item.zCm);
      const startAngle = Math.atan2(info.sy - center.y, info.sx - center.x) * 180 / Math.PI;
      interaction = {
        type: 'rotate', pointerId: event.pointerId, itemId: item.id,
        centerScreen: center, startAngle: startAngle, startRotation: item.rotationDeg
      };
      canvas.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    const resizeHandle = hitTestStructuralResizeHandle(event);
    if (resizeHandle) {
      interaction = {
        type: 'structural-resize', pointerId: event.pointerId, itemId: resizeHandle.item.id,
        edge: resizeHandle.edge, startX: event.clientX, startY: event.clientY,
        moved: false, lastError: null
      };
      canvas.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    const hit = hitTestAt(event);
    if (hit && hit.type === 'structural') {
      App.selectStructural(hit.id);
      interaction = {
        type: 'structural-drag', pointerId: event.pointerId, itemId: hit.id,
        startOffset: hit.item.offsetCm, startX: event.clientX, startY: event.clientY,
        moved: false, lastError: null
      };
      canvas.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    if (hit && hit.type === 'placed') {
      App.selectPlaced(hit.id);
      if (hit.item.locked) {
        updateCursor();
        return;
      }
      interaction = {
        type: 'move', pointerId: event.pointerId, itemId: hit.id,
        startX: event.clientX, startY: event.clientY,
        startCm: info, itemStartX: hit.item.xCm, itemStartZ: hit.item.zCm,
        moved: false
      };
      canvas.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    if (hit && hit.type === 'wall') {
      App.selectWall(hit.id);
      interaction = {
        type: 'wall-move', pointerId: event.pointerId, wallId: hit.id,
        startX: event.clientX, startY: event.clientY,
        startCm: info, start: { x1Cm: hit.wall.x1Cm, z1Cm: hit.wall.z1Cm, x2Cm: hit.wall.x2Cm, z2Cm: hit.wall.z2Cm },
        moved: false, historyStarted: false
      };
      canvas.setPointerCapture(event.pointerId);
      updateCursor();
      return;
    }
    if (typeof App.clearSelection === 'function') App.clearSelection();
  }

  function onPointerMove(event) {
    const info = pointerInfo(event);
    lastMouse = { sx: info.sx, sy: info.sy, x: info.x, z: info.z };
    if (interaction) {
      if (interaction.type === 'pan') {
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) interaction.moved = true;
        view.panX = interaction.panX + dx;
        view.panY = interaction.panY + dy;
        requestDraw();
        return;
      }
      if (interaction.type === 'move') {
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) interaction.moved = true;
        if (!interaction.moved) return;
        const deltaX = info.x - interaction.startCm.x;
        const deltaZ = info.z - interaction.startCm.z;
        const nextX = snapValue(interaction.itemStartX + deltaX);
        const nextZ = snapValue(interaction.itemStartZ + deltaZ);
        App.State.updatePlaced(interaction.itemId, { xCm: nextX, zCm: nextZ });
        return;
      }
      if (interaction.type === 'rotate') {
        const angle = Math.atan2(info.sy - interaction.centerScreen.y, info.sx - interaction.centerScreen.x) * 180 / Math.PI;
        let next = interaction.startRotation + (angle - interaction.startAngle);
        if (event.shiftKey) next = Math.round(next / 15) * 15;
        else next = Math.round(next);
        App.State.updatePlaced(interaction.itemId, { rotationDeg: next });
        return;
      }
      if (interaction.type === 'structural-drag') {
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) interaction.moved = true;
        if (!interaction.moved) return;
        const design = getDesign();
        const item = design.structuralItems.find(function (p) { return p.id === interaction.itemId; });
        if (!item) return;
        const wall = G.getWall(design.room, item.wall);
        if (!wall) return;
        const t = (info.x - wall.start.x) * wall.dir.x + (info.z - wall.start.z) * wall.dir.z;
        const offset = snapValue(U.clamp(t, item.widthCm / 2, wall.lengthCm - item.widthCm / 2));
        if (Math.abs(offset - item.offsetCm) < 0.01) return;
        const result = App.State.updateStructural(item.id, { offsetCm: offset });
        if (!result.ok) interaction.lastError = result.error;
        return;
      }
      if (interaction.type === 'structural-resize') {
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) interaction.moved = true;
        if (!interaction.moved) return;
        const design = getDesign();
        const item = design.structuralItems.find(function (p) { return p.id === interaction.itemId; });
        if (!item) return;
        const wall = G.getWall(design.room, item.wall);
        if (!wall) return;
        const spec = item.type === 'window' ? C.STRUCTURAL.WINDOW : C.STRUCTURAL.DOOR;
        const t = (info.x - wall.start.x) * wall.dir.x + (info.z - wall.start.z) * wall.dir.z;
        const span = G.structuralSpan(item);
        let left = span.left;
        let right = span.right;
        if (interaction.edge === 'left') {
          left = U.clamp(t, 0, right - spec.minWidthCm);
        } else {
          right = U.clamp(t, left + spec.minWidthCm, wall.lengthCm);
        }
        let width = snapValue(U.clamp(right - left, spec.minWidthCm, spec.maxWidthCm));
        if (interaction.edge === 'left') left = right - width;
        else right = left + width;
        if (left < 0) { left = 0; right = width; }
        if (right > wall.lengthCm) { right = wall.lengthCm; left = right - width; }
        const offset = (left + right) / 2;
        if (Math.abs(width - item.widthCm) < 0.01 && Math.abs(offset - item.offsetCm) < 0.01) return;
        const result = App.State.updateStructural(item.id, { widthCm: width, offsetCm: offset });
        if (!result.ok) interaction.lastError = result.error;
        return;
      }
      if (interaction.type === 'wall-endpoint') {
        const design = getDesign();
        if (!design) return;
        const wall = (design.interiorWalls || []).find(function (w) { return w.id === interaction.wallId; });
        if (!wall) return;
        const anchor = interaction.edge === 'start'
          ? { x: Number(wall.x2Cm), z: Number(wall.z2Cm) }
          : { x: Number(wall.x1Cm), z: Number(wall.z1Cm) };
        const snapped = G.snapWallPoint(design, info.x, info.z, {
          anchor: anchor, excludeId: wall.id, toleranceCm: snapEnabled ? 18 : 0, grid: snapEnabled
        });
        const point = event.shiftKey ? orthoPoint(anchor, snapped) : snapped;
        const patch = interaction.edge === 'start'
          ? { x1Cm: point.x, z1Cm: point.z }
          : { x2Cm: point.x, z2Cm: point.z };
        interaction.moved = true;
        if (!interaction.historyStarted) {
          interaction.historyStarted = true;
          if (typeof App.State.beginWallEdit === 'function') App.State.beginWallEdit();
        }
        const result = App.State.updateInteriorWall(wall.id, patch, { silentHistory: true });
        if (!result.ok) interaction.lastError = result.error;
        return;
      }
      if (interaction.type === 'wall-move') {
        const design = getDesign();
        if (!design) return;
        const wall = (design.interiorWalls || []).find(function (w) { return w.id === interaction.wallId; });
        if (!wall) return;
        const dx = event.clientX - interaction.startX;
        const dy = event.clientY - interaction.startY;
        if (Math.abs(dx) + Math.abs(dy) > 2) interaction.moved = true;
        if (!interaction.moved) return;
        const size = G.roomSize(design.room);
        let shiftX = info.x - interaction.startCm.x;
        let shiftZ = info.z - interaction.startCm.z;
        if (snapEnabled) {
          shiftX = Math.round(shiftX / C.SNAP_CM) * C.SNAP_CM;
          shiftZ = Math.round(shiftZ / C.SNAP_CM) * C.SNAP_CM;
        }
        const s = interaction.start;
        shiftX = U.clamp(shiftX, -Math.min(s.x1Cm, s.x2Cm), size.width - Math.max(s.x1Cm, s.x2Cm));
        shiftZ = U.clamp(shiftZ, -Math.min(s.z1Cm, s.z2Cm), size.length - Math.max(s.z1Cm, s.z2Cm));
        if (Math.abs(shiftX) < 0.01 && Math.abs(shiftZ) < 0.01) return;
        if (!interaction.historyStarted) {
          interaction.historyStarted = true;
          if (typeof App.State.beginWallEdit === 'function') App.State.beginWallEdit();
        }
        const result = App.State.updateInteriorWall(wall.id, {
          x1Cm: s.x1Cm + shiftX, z1Cm: s.z1Cm + shiftZ,
          x2Cm: s.x2Cm + shiftX, z2Cm: s.z2Cm + shiftZ
        }, { silentHistory: true });
        if (!result.ok) interaction.lastError = result.error;
        return;
      }
    }
    if (tool === 'wall') {
      const design = getDesign();
      if (design) {
        const anchor = wallDraw ? { x: wallDraw.x1Cm, z: wallDraw.z1Cm } : null;
        const snapped = G.snapWallPoint(design, info.x, info.z, {
          anchor: anchor, toleranceCm: snapEnabled ? 18 : 0, grid: snapEnabled
        });
        const point = anchor && event.shiftKey ? orthoPoint(anchor, snapped) : snapped;
        if (wallDraw) {
          wallDraw.x2Cm = point.x;
          wallDraw.z2Cm = point.z;
        }
        wallHover = { x: point.x, z: point.z, snapped: snapped.snapped };
      }
      updateCursor();
      requestDraw();
      return;
    }
    if (tool === 'door' || tool === 'window') {
      updateStructuralToolGhost(info);
    } else {
      toolGhost = null;
    }
    if (ghost) {
      updateGhost(info);
    }
    updateCursor();
    requestDraw();
  }

  function onPointerUp(event) {
    if (!interaction) return;
    if ((interaction.type === 'structural-drag' || interaction.type === 'structural-resize' ||
      interaction.type === 'wall-endpoint' || interaction.type === 'wall-move') &&
      interaction.lastError && typeof App.notify === 'function') {
      App.notify(interaction.lastError, 'warning');
    }
    try { canvas.releasePointerCapture(interaction.pointerId); } catch (err) { /* ignore */ }
    interaction = null;
    updateCursor();
    requestDraw();
  }

  function onDoubleClick(event) {
    if (!getDesign()) return;
    const hit = hitTestAt(event);
    if (hit && hit.type === 'placed' && typeof App.openProductDetails === 'function') {
      App.openProductDetails(hit.product.id);
    }
  }

  function orthoPoint(anchor, point) {
    const dx = Math.abs(point.x - anchor.x);
    const dz = Math.abs(point.z - anchor.z);
    return dx >= dz ? { x: point.x, z: anchor.z } : { x: anchor.x, z: point.z };
  }

  function handleWallClick(event, info) {
    const design = getDesign();
    if (!design) return;
    if (G.isCircle(design.room)) {
      if (typeof App.notify === 'function') App.notify('Partition walls are not supported in circular rooms in this version.', 'warning');
      setTool('select');
      return;
    }
    if (!wallDraw) {
      const snapped = G.snapWallPoint(design, info.x, info.z, {
        toleranceCm: snapEnabled ? 18 : 0, grid: snapEnabled
      });
      wallDraw = { x1Cm: snapped.x, z1Cm: snapped.z, x2Cm: snapped.x, z2Cm: snapped.z, startSnapped: snapped.snapped };
      if (typeof App.notify === 'function') App.notify('Wall start set. Click the other end, or press Esc to cancel.', 'info', { duration: 3400 });
      requestDraw();
      return;
    }
    const anchor = { x: wallDraw.x1Cm, z: wallDraw.z1Cm };
    const snapped = G.snapWallPoint(design, info.x, info.z, {
      anchor: anchor, toleranceCm: snapEnabled ? 18 : 0, grid: snapEnabled
    });
    const point = event.shiftKey ? orthoPoint(anchor, snapped) : snapped;
    const length = Math.hypot(point.x - anchor.x, point.z - anchor.z);
    if (length < 40) {
      if (typeof App.notify === 'function') App.notify('Walls need to be at least 40 cm long. Click further away, or press Esc to cancel.', 'warning');
      return;
    }
    const result = App.State.addInteriorWall({ x1Cm: anchor.x, z1Cm: anchor.z, x2Cm: point.x, z2Cm: point.z });
    wallDraw = null;
    if (!result.ok) {
      if (typeof App.notify === 'function') App.notify(result.error, 'error');
      requestDraw();
      return;
    }
    if (typeof App.selectWall === 'function') App.selectWall(result.wall.id);
    if (typeof App.notify === 'function') {
      App.notify('Partition wall added (' + U.formatNumber(length, 0) + ' cm). Drag its ends to adjust it.', 'success');
    }
    requestDraw();
  }

  function updateStructuralToolGhost(info) {
    const design = getDesign();
    if (!design || G.isCircle(design.room)) {
      toolGhost = null;
      return;
    }
    const spec = tool === 'window' ? C.STRUCTURAL.WINDOW : C.STRUCTURAL.DOOR;
    const interior = G.nearestInteriorWall(design, info.x, info.z);
    const interiorPx = interior ? interior.distance * view.scale : Infinity;
    const nearest = G.nearestWallPoint(design.room, info.x, info.z);
    const perimeterPx = nearest ? nearest.distance * view.scale : Infinity;
    if (interior && interiorPx <= 40 && interiorPx <= perimeterPx) {
      toolGhost = {
        type: tool, interior: true, wallId: interior.wall.id, offsetCm: interior.offsetCm,
        widthCm: Math.min(spec.defaultWidthCm, G.interiorWallLength(interior.wall)),
        near: true, valid: true
      };
      return;
    }
    if (!nearest) { toolGhost = null; return; }
    toolGhost = {
      type: tool, wall: nearest.wall.id, offsetCm: nearest.offsetCm,
      widthCm: Math.min(spec.defaultWidthCm, nearest.wall.lengthCm),
      near: perimeterPx <= 48, valid: perimeterPx <= 48
    };
  }

  function placeOpeningAtPointer(event) {
    const design = getDesign();
    if (!design) return;
    if (G.isCircle(design.room)) {
      if (typeof App.notify === 'function') App.notify('Doors and windows are not supported on circular walls in this version.', 'warning');
      setTool('select');
      return;
    }
    const info = pointerInfo(event);
    const interior = G.nearestInteriorWall(design, info.x, info.z);
    const interiorPx = interior ? interior.distance * view.scale : Infinity;
    const nearest = G.nearestWallPoint(design.room, info.x, info.z);
    const perimeterPx = nearest ? nearest.distance * view.scale : Infinity;
    if (interior && interiorPx <= 32 && interiorPx <= perimeterPx) {
      const wallResult = App.State.addInteriorOpening(interior.wall.id, interior.offsetCm, tool);
      if (!wallResult.ok) {
        if (typeof App.notify === 'function') App.notify(wallResult.error, 'warning');
        return;
      }
      if (typeof App.selectWall === 'function') App.selectWall(interior.wall.id);
      setTool('select');
      if (typeof App.notify === 'function') {
        App.notify((tool === 'window' ? 'Window' : 'Door') + ' added to the partition wall. Adjust its size in the wall panel.', 'success');
      }
      return;
    }
    if (!nearest || perimeterPx > 48) {
      if (typeof App.notify === 'function') App.notify('Click closer to a wall to place the ' + tool + '.', 'warning');
      return;
    }
    const openingType = tool;
    const result = App.State.addStructural(tool, nearest.wall.id, nearest.offsetCm);
    if (!result.ok) {
      if (typeof App.notify === 'function') App.notify(result.error, 'warning');
      return;
    }
    App.selectStructural(result.item.id);
    setTool('select');
    if (typeof App.notify === 'function') App.notify((openingType === 'window' ? 'Window' : 'Door') + ' added. Adjust its size and position in the panel.', 'success');
  }

  function updateGhost(info) {
    const design = getDesign();
    const product = dragProductId ? App.Catalog.getProduct(dragProductId) : null;
    if (!design || !product) { ghost = null; return; }
    let rotation = 0;
    if (!G.productFitsRoom(design, product, 0) && G.productFitsRoom(design, product, 90)) rotation = 90;
    const inside = G.footprintInsideRoom(design.room, info.x, info.z, product.widthCm, product.lengthCm, rotation, 0);
    let position = { x: info.x, z: info.z };
    if (!inside) {
      const clamped = G.clampCenterToRoom(design.room, product.widthCm, product.lengthCm, rotation, info.x, info.z, 1);
      if (clamped) position = { x: clamped.x, z: clamped.z };
    }
    ghost = {
      productId: product.id, x: position.x, z: position.z, rotationDeg: rotation,
      inside: inside, fits: !!(G.footprintInsideRoom(design.room, position.x, position.z, product.widthCm, product.lengthCm, rotation, 0))
    };
  }

  function onDragOver(event) {
    if (!dragProductId) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    const info = pointerInfo(event);
    updateGhost(info);
    requestDraw();
  }

  function onDragLeave(event) {
    if (event.target === canvas) {
      ghost = null;
      requestDraw();
    }
  }

  function onDrop(event) {
    if (!dragProductId) return;
    event.preventDefault();
    const product = App.Catalog.getProduct(dragProductId);
    const info = pointerInfo(event);
    if (!product) return;
    updateGhost(info);
    const g = ghost;
    dragProductId = null;
    ghost = null;
    if (!g || !g.fits) {
      if (typeof App.notify === 'function') {
        App.notify('This product does not fit inside the room at that position.', 'error');
      }
      requestDraw();
      return;
    }
    const result = App.State.addPlaced(product.id, g.x, g.z, g.rotationDeg, App.Catalog.defaultVariantId(product), 'manual');
    if (!result.ok) {
      if (typeof App.notify === 'function') App.notify(result.error, 'error');
    } else {
      App.selectPlaced(result.item.id);
      if (!g.inside) {
        if (typeof App.notify === 'function') App.notify('The item was moved just inside the room boundary.', 'info');
      }
    }
    requestDraw();
  }

  function drawEmpty() {
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    drawDots();
    ctx.fillStyle = COLORS.muted;
    ctx.font = '500 14px ' + FONT;
    ctx.textAlign = 'center';
    ctx.fillText('Create a room to begin designing.', cssWidth / 2, cssHeight / 2);
  }

  function drawDots() {
    const spacing = 26;
    ctx.fillStyle = COLORS.dot;
    for (let x = 13; x < cssWidth; x += spacing) {
      for (let y = 13; y < cssHeight; y += spacing) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  function draw() {
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssWidth, cssHeight);
    const design = getDesign();
    if (!design) {
      drawEmpty();
      return;
    }
    if (!view.initialized) fitView(false);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, cssWidth, cssHeight);
    drawDots();
    drawScene(ctx, design, view, { interactive: true, ghost: ghost, toolGhost: toolGhost });
    drawPlanLegend(ctx, design, view);
    notifyView();
  }

  /* The plan is the densest part of the app, so name the symbols and give one
     real measurement instead of leaving people to guess at the scale. */
  function drawPlanLegend(context, design, camera) {
    if (cssWidth < 380 || cssHeight < 180) return;
    const items = [
      { color: wallInk(design, 0.2), label: 'Wall' },
      { color: COLORS.door, label: 'Door' },
      { color: COLORS.glass, label: 'Window' },
      { color: COLORS.green, label: 'Furniture' }
    ];
    context.save();
    context.font = '500 10px ' + FONT;
    let width = 14;
    items.forEach(function (item) { width += 15 + context.measureText(item.label).width + 10; });
    const x = cssWidth - 12 - width;
    const y = 12;
    context.fillStyle = 'rgba(255,255,255,0.9)';
    context.strokeStyle = 'rgba(45,59,51,0.14)';
    context.lineWidth = 1;
    roundRectPath(context, x, y, width, 22, 7);
    context.fill();
    context.stroke();
    let cursor = x + 10;
    context.textBaseline = 'middle';
    context.textAlign = 'left';
    items.forEach(function (item) {
      context.fillStyle = item.color;
      context.fillRect(cursor, y + 8, 10, 6);
      cursor += 14;
      context.fillStyle = COLORS.label;
      context.fillText(item.label, cursor, y + 11.5);
      cursor += context.measureText(item.label).width + 10;
    });
    const meter = 100 * camera.scale;
    if (meter > 24) {
      const barY = cssHeight - 16;
      context.strokeStyle = COLORS.label;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(cssWidth - 14 - meter, barY);
      context.lineTo(cssWidth - 14, barY);
      context.moveTo(cssWidth - 14 - meter, barY - 4);
      context.lineTo(cssWidth - 14 - meter, barY + 4);
      context.moveTo(cssWidth - 14, barY - 4);
      context.lineTo(cssWidth - 14, barY + 4);
      context.stroke();
      context.font = '500 9px ' + FONT;
      context.fillStyle = COLORS.muted;
      context.textAlign = 'right';
      context.fillText('1 m', cssWidth - 14, barY - 10);
    }
    context.restore();
  }

  function drawScreenPill(context, x, y, text, options) {
    const opts = options || {};
    const fontSize = opts.fontSize || 11;
    const padX = opts.padX || 7;
    const padY = opts.padY || 4;
    context.save();
    context.font = (opts.weight || '500') + ' ' + fontSize + 'px ' + FONT;
    const metrics = context.measureText(text);
    const width = metrics.width + padX * 2;
    const height = fontSize + padY * 2;
    const left = opts.align === 'center' ? x - width / 2 : opts.align === 'right' ? x - width : x;
    context.fillStyle = opts.background || 'rgba(255,255,255,0.92)';
    context.strokeStyle = opts.border || 'rgba(45,59,51,0.14)';
    context.lineWidth = 1;
    roundRectPath(context, left, y - height / 2, width, height, height / 2);
    context.fill();
    context.stroke();
    context.fillStyle = opts.color || COLORS.label;
    context.textAlign = 'left';
    context.textBaseline = 'middle';
    context.fillText(text, left + padX, y + 0.5);
    context.restore();
    return { left: left, top: y - height / 2, width: width, height: height };
  }

  function roundRectPath(context, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, w / 2, h / 2));
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + w - radius, y);
    context.quadraticCurveTo(x + w, y, x + w, y + radius);
    context.lineTo(x + w, y + h - radius);
    context.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    context.lineTo(x + radius, y + h);
    context.quadraticCurveTo(x, y + h, x, y + h - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  function drawScene(context, design, camera, options) {
    const opts = options || {};
    const s = G.roomSize(design.room);
    const products = getProductsById();
    const forExport = !!opts.forExport;
    const selected = forExport ? null : getSelected();
    context.save();
    context.translate(camera.panX, camera.panY);
    context.scale(camera.scale, camera.scale);

    drawFloor(context, design, camera, opts);
    drawWallsAndOpenings(context, design);

    if (!forExport && camera.scale >= 0.24) {
      drawGrid(context, design);
    }
    context.restore();

    drawRoomDimensions(context, design, camera, forExport);
    drawStructuralOverlays(context, design, camera, selected, forExport);
    drawInteriorWallOverlays(context, design, camera, selected, forExport);
    drawFurniture(context, design, camera, products, opts);
    drawFurnitureOverlays(context, design, camera, products, selected, forExport);
    drawNonSelectedOpeningLabels(context, design, camera, selected, forExport);
    if (!forExport && tool === 'wall') drawWallDrawPreview(context, design, camera);
    if (opts.toolGhost) drawToolGhost(context, design, camera, opts.toolGhost);
    if (opts.ghost) drawCatalogGhost(context, camera, opts.ghost, products);
    if (!forExport && opts.showHints !== false) drawInteractionHints(context, design, camera);
    void s;
  }

  function drawFloor(context, design, camera, opts) {
    const s = G.roomSize(design.room);
    const floor = design.floor;
    const traceRoom = function () {
      context.beginPath();
      if (G.isCircle(design.room)) {
        context.arc(s.width / 2, s.length / 2, s.width / 2, 0, Math.PI * 2);
      } else {
        roundRectPath(context, 0, 0, s.width, s.length, 2);
      }
    };
    let filled = false;
    if (floor && floor.mode === 'texture' && floor.textureKey && App.Media && App.Media.getImageForKey) {
      const img = App.Media.getImageForKey(floor.textureKey);
      if (img) {
        context.save();
        traceRoom();
        context.clip();
        context.fillStyle = floor.color || COLORS.floor;
        context.fillRect(0, 0, s.width, s.length);
        const tile = Math.max(1, U.toNumber(floor.textureScale, 1) * 100);
        for (let x = 0; x < s.width; x += tile) {
          for (let z = 0; z < s.length; z += tile) {
            context.drawImage(img, x, z, tile, tile);
          }
        }
        context.restore();
        filled = true;
      }
    }
    if (!filled) {
      context.save();
      traceRoom();
      context.fillStyle = (floor && floor.color) ? floor.color : COLORS.floor;
      context.fill();
      context.restore();
    }
    context.save();
    context.strokeStyle = COLORS.floorStroke;
    context.lineWidth = 1.2;
    traceRoom();
    context.stroke();
    context.restore();
  }

  function drawGrid(context, design) {
    const s = G.roomSize(design.room);
    const step = 50;
    context.save();
    if (G.isCircle(design.room)) {
      context.beginPath();
      context.arc(s.width / 2, s.length / 2, s.width / 2, 0, Math.PI * 2);
      context.clip();
    } else {
      context.beginPath();
      context.rect(0, 0, s.width, s.length);
      context.clip();
    }
    context.strokeStyle = COLORS.grid;
    context.lineWidth = 0.6;
    context.beginPath();
    for (let x = step; x < s.width; x += step) {
      context.moveTo(x, 0);
      context.lineTo(x, s.length);
    }
    for (let z = step; z < s.length; z += step) {
      context.moveTo(0, z);
      context.lineTo(s.width, z);
    }
    context.stroke();
    context.restore();
  }

  function wallInk(design, darkness) {
    if (!design || !design.wallColor) return COLORS.wall;
    return U.mixColor(design.wallColor, '#0f1512', darkness);
  }

  function drawWallsAndOpenings(context, design) {
    if (G.isCircle(design.room)) {
      const s = G.roomSize(design.room);
      context.save();
      context.strokeStyle = wallInk(design, 0.72);
      context.lineWidth = 10;
      context.beginPath();
      context.arc(s.width / 2, s.length / 2, s.width / 2 + 1.5, 0, Math.PI * 2);
      context.stroke();
      context.strokeStyle = wallInk(design, 0.46);
      context.lineWidth = 1.2;
      context.beginPath();
      context.arc(s.width / 2, s.length / 2, s.width / 2 - 3.5, 0, Math.PI * 2);
      context.stroke();
      context.restore();
      return;
    }
    const walls = G.getWalls(design.room);
    const thickness = C.WALL_THICKNESS_CM;
    context.save();
    context.strokeStyle = wallInk(design, 0.72);
    context.lineCap = 'butt';
    context.lineWidth = thickness;
    walls.forEach(function (wall) {
      const openings = (design.structuralItems || []).filter(function (item) { return item.wall === wall.id; })
        .map(function (item) { return { left: item.offsetCm - item.widthCm / 2, right: item.offsetCm + item.widthCm / 2 }; })
        .sort(function (a, b) { return a.left - b.left; });
      let cursor = 0;
      openings.forEach(function (opening) {
        const left = U.clamp(opening.left, 0, wall.lengthCm);
        const right = U.clamp(opening.right, 0, wall.lengthCm);
        if (left > cursor) drawWallSegment(context, wall, cursor, left);
        cursor = Math.max(cursor, right);
      });
      if (cursor < wall.lengthCm) drawWallSegment(context, wall, cursor, wall.lengthCm);
    });
    const s = G.roomSize(design.room);
    const corners = [{ x: 0, z: 0 }, { x: s.width, z: 0 }, { x: s.width, z: s.length }, { x: 0, z: s.length }];
    context.fillStyle = wallInk(design, 0.72);
    corners.forEach(function (c) {
      context.fillRect(c.x - thickness / 2, c.z - thickness / 2, thickness, thickness);
    });
    context.restore();

    (design.structuralItems || []).forEach(function (item) {
      drawOpeningSymbol(context, design, item);
    });

    drawInteriorWalls(context, design);
  }

  function drawInteriorWalls(context, design) {
    const walls = design.interiorWalls || [];
    if (!walls.length) return;
    context.save();
    context.lineCap = 'butt';
    walls.forEach(function (wall) {
      const thickness = U.clamp(U.toNumber(wall.thicknessCm, C.WALL_THICKNESS_CM), 6, 40);
      context.strokeStyle = wallInk(design, 0.72);
      context.lineWidth = thickness;
      G.interiorWallSegments(wall).forEach(function (segment) {
        const a = G.interiorWallPoint(wall, segment.start);
        const b = G.interiorWallPoint(wall, segment.end);
        context.beginPath();
        context.moveTo(a.x, a.z);
        context.lineTo(b.x, b.z);
        context.stroke();
      });
      G.interiorWallOpenings(wall).forEach(function (opening) {
        drawInteriorOpeningSymbol(context, wall, opening, thickness);
      });
    });
    context.restore();
  }

  function drawInteriorOpeningSymbol(context, wall, opening, thickness) {
    const length = G.interiorWallLength(wall);
    const width = Math.max(10, U.toNumber(opening.widthCm, 90));
    const left = U.clamp(U.toNumber(opening.offsetCm, 0) - width / 2, 0, length);
    const right = U.clamp(U.toNumber(opening.offsetCm, 0) + width / 2, 0, length);
    if (right - left <= 1) return;
    const dir = G.interiorWallDir(wall);
    const normal = { x: -dir.z, z: dir.x };
    const pL = G.interiorWallPoint(wall, left);
    const pR = G.interiorWallPoint(wall, right);
    context.save();
    if (opening.type === 'window') {
      context.strokeStyle = COLORS.glass;
      context.lineWidth = Math.max(4, thickness * 0.7);
      context.beginPath();
      context.moveTo(pL.x, pL.z);
      context.lineTo(pR.x, pR.z);
      context.stroke();
      context.strokeStyle = COLORS.glassStroke;
      context.lineWidth = 1.1;
      context.beginPath();
      context.moveTo(pL.x, pL.z);
      context.lineTo(pR.x, pR.z);
      context.stroke();
    } else {
      context.strokeStyle = COLORS.door;
      context.lineWidth = 2;
      context.beginPath();
      context.moveTo(pL.x, pL.z);
      context.lineTo(pL.x + normal.x * width, pL.z + normal.z * width);
      context.stroke();
      const startAngle = Math.atan2(dir.z, dir.x);
      const endAngle = Math.atan2(normal.z, normal.x);
      let diff = endAngle - startAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      context.strokeStyle = 'rgba(122,95,67,0.5)';
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(pL.x, pL.z, width, startAngle, startAngle + diff, diff < 0);
      context.stroke();
    }
    context.restore();
  }

  function drawWallSegment(context, wall, start, end) {
    const a = G.wallPoint(wall, start);
    const b = G.wallPoint(wall, end);
    context.beginPath();
    context.moveTo(a.x, a.z);
    context.lineTo(b.x, b.z);
    context.stroke();
  }

  function drawOpeningSymbol(context, design, item) {
    const wall = G.getWall(design.room, item.wall);
    if (!wall) return;
    const span = G.structuralSpan(item);
    const left = Math.max(0, span.left);
    const right = Math.min(wall.lengthCm, span.right);
    if (right <= left) return;
    const pL = G.wallPoint(wall, left);
    const pR = G.wallPoint(wall, right);
    context.save();
    if (item.type === 'window') {
      context.strokeStyle = COLORS.glass;
      context.lineWidth = 7;
      context.beginPath();
      context.moveTo(pL.x, pL.z);
      context.lineTo(pR.x, pR.z);
      context.stroke();
      context.strokeStyle = COLORS.glassStroke;
      context.lineWidth = 1.1;
      context.beginPath();
      context.moveTo(pL.x, pL.z);
      context.lineTo(pR.x, pR.z);
      context.stroke();
      context.lineWidth = 0.8;
      const inset = 3;
      context.beginPath();
      context.moveTo(pL.x + wall.inward.x * inset, pL.z + wall.inward.z * inset);
      context.lineTo(pR.x + wall.inward.x * inset, pR.z + wall.inward.z * inset);
      context.stroke();
    } else {
      context.strokeStyle = COLORS.door;
      context.lineWidth = 2;
      const inward = wall.inward;
      context.beginPath();
      context.moveTo(pL.x, pL.z);
      context.lineTo(pL.x + inward.x * item.widthCm, pL.z + inward.z * item.widthCm);
      context.stroke();
      const startAngle = Math.atan2(wall.dir.z, wall.dir.x);
      const endAngle = Math.atan2(inward.z, inward.x);
      let diff = endAngle - startAngle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      context.strokeStyle = 'rgba(122,95,67,0.5)';
      context.lineWidth = 0.8;
      context.beginPath();
      context.arc(pL.x, pL.z, item.widthCm, startAngle, startAngle + diff, diff < 0);
      context.stroke();
      context.strokeStyle = wallInk(design, 0.72);
      context.lineWidth = 1.6;
      context.beginPath();
      context.moveTo(pL.x, pL.z);
      context.lineTo(pL.x - wall.inward.x * 1.5, pL.z - wall.inward.z * 1.5);
      context.moveTo(pR.x, pR.z);
      context.lineTo(pR.x - wall.inward.x * 1.5, pR.z - wall.inward.z * 1.5);
      context.stroke();
    }
    context.restore();
  }

  function drawRoomDimensions(context, design, camera, forExport) {
    const s = G.roomSize(design.room);
    const topLeft = planToScreen(0, 0);
    const bottomRight = planToScreen(s.width, s.length);
    const fontSize = forExport ? 15 : 11;
    const topY = Math.min(topLeft.y - 30, topLeft.y - 30);
    const centerX = (topLeft.x + bottomRight.x) / 2;
    const dimColor = COLORS.muted;
    context.save();
    context.strokeStyle = 'rgba(113,128,120,0.45)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(topLeft.x, topY);
    context.lineTo(bottomRight.x, topY);
    context.moveTo(topLeft.x, topY - 5);
    context.lineTo(topLeft.x, topY + 5);
    context.moveTo(bottomRight.x, topY - 5);
    context.lineTo(bottomRight.x, topY + 5);
    context.stroke();
    drawScreenPill(context, centerX, topY, (G.isCircle(design.room) ? 'Ø ' : '') + U.formatNumber(s.width, 0) + ' cm', {
      fontSize: fontSize, color: dimColor, align: 'center'
    });
    if (!G.isCircle(design.room)) {
      const leftX = Math.min(topLeft.x - 34, topLeft.x - 34);
      const midY = (topLeft.y + bottomRight.y) / 2;
      context.beginPath();
      context.moveTo(leftX, topLeft.y);
      context.lineTo(leftX, bottomRight.y);
      context.moveTo(leftX - 5, topLeft.y);
      context.lineTo(leftX + 5, topLeft.y);
      context.moveTo(leftX - 5, bottomRight.y);
      context.lineTo(leftX + 5, bottomRight.y);
      context.stroke();
      drawScreenPill(context, leftX, midY, U.formatNumber(s.length, 0) + ' cm', {
        fontSize: fontSize, color: dimColor, align: 'center'
      });
    }
    const heightText = 'H ' + U.formatNumber(design.room.heightCm, 0) + ' cm';
    drawScreenPill(context, bottomRight.x - 6, bottomRight.y + 28, heightText, {
      fontSize: fontSize, color: dimColor, align: 'right'
    });
    // north marker
    const nx = topLeft.x + 20;
    const ny = topLeft.y + 24;
    context.strokeStyle = COLORS.muted;
    context.lineWidth = 1.2;
    context.beginPath();
    context.moveTo(nx, ny + 9);
    context.lineTo(nx, ny - 7);
    context.lineTo(nx - 4, ny - 2);
    context.moveTo(nx, ny - 7);
    context.lineTo(nx + 4, ny - 2);
    context.stroke();
    context.font = '600 10px ' + FONT;
    context.fillStyle = COLORS.muted;
    context.textAlign = 'center';
    context.fillText('N', nx, ny - 11);
    context.restore();
  }

  function drawStructuralOverlays(context, design, camera, selected, forExport) {
    const products = getProductsById();
    void products;
    (design.structuralItems || []).forEach(function (item) {
      const wall = G.getWall(design.room, item.wall);
      if (!wall) return;
      const validation = G.validateStructuralItem(design, item);
      const span = G.structuralSpan(item);
      const left = planToScreen.apply(null, wallPointCoords(wall, span.left));
      const right = planToScreen.apply(null, wallPointCoords(wall, span.right));
      const midX = (left.x + right.x) / 2;
      const midY = (left.y + right.y) / 2;
      const isSelected = selected && selected.type === 'structural' && selected.id === item.id;
      if (validation.errors.length) {
        context.save();
        context.strokeStyle = COLORS.danger;
        context.lineWidth = 3;
        context.beginPath();
        context.moveTo(left.x, left.y);
        context.lineTo(right.x, right.y);
        context.stroke();
        context.restore();
      }
      if (isSelected) {
        context.save();
        context.strokeStyle = COLORS.green;
        context.lineWidth = 5;
        context.globalAlpha = 0.4;
        context.beginPath();
        context.moveTo(left.x, left.y);
        context.lineTo(right.x, right.y);
        context.stroke();
        context.globalAlpha = 1;
        context.fillStyle = COLORS.white;
        context.strokeStyle = COLORS.green;
        context.lineWidth = 1.6;
        [left, right].forEach(function (p) {
          context.beginPath();
          context.rect(p.x - 5, p.y - 5, 10, 10);
          context.fill();
          context.stroke();
        });
        context.restore();
      }
      if (forExport || isSelected || camera.scale > 0.6) {
        const label = (item.type === 'door' ? 'Door' : 'Window') + ' ' + U.formatNumber(item.widthCm, 0);
        drawScreenPill(context, midX, midY + (item.type === 'door' ? 24 : -22), label, {
          fontSize: forExport ? 13 : 10,
          color: isSelected ? COLORS.green : COLORS.muted,
          border: isSelected ? 'rgba(15,122,82,0.4)' : undefined,
          align: 'center'
        });
      }
    });
  }

  function drawInteriorWallOverlays(context, design, camera, selected, forExport) {
    if (forExport || !selected || selected.type !== 'wall') return;
    const wall = (design.interiorWalls || []).find(function (w) { return w.id === selected.id; });
    if (!wall) return;
    const thickness = U.clamp(U.toNumber(wall.thicknessCm, C.WALL_THICKNESS_CM), 6, 40);
    const a = planToScreen(wall.x1Cm, wall.z1Cm);
    const b = planToScreen(wall.x2Cm, wall.z2Cm);
    const length = G.interiorWallLength(wall);
    context.save();
    context.strokeStyle = COLORS.green;
    context.globalAlpha = 0.32;
    context.lineWidth = Math.max(5, thickness * camera.scale + 5);
    context.lineCap = 'round';
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.restore();

    context.save();
    context.fillStyle = COLORS.white;
    context.strokeStyle = COLORS.green;
    context.lineWidth = 1.8;
    [a, b].forEach(function (p) {
      context.beginPath();
      context.arc(p.x, p.y, 6, 0, Math.PI * 2);
      context.fill();
      context.stroke();
      context.beginPath();
      context.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
      context.fillStyle = COLORS.green;
      context.fill();
      context.fillStyle = COLORS.white;
    });
    context.restore();

    const midX = (a.x + b.x) / 2;
    const midY = (a.y + b.y) / 2;
    drawScreenPill(context, midX, midY - 20,
      U.formatNumber(length, 0) + ' × ' + U.formatNumber(wall.heightCm, 0) + ' cm · th ' + U.formatNumber(thickness, 0), {
        fontSize: 10, color: COLORS.green, border: 'rgba(15,122,82,0.4)', align: 'center'
      });
    G.interiorWallOpenings(wall).forEach(function (opening) {
      const point = G.interiorWallPoint(wall, opening.offsetCm);
      const p = planToScreen(point.x, point.z);
      drawScreenPill(context, p.x, p.y + 18,
        (opening.type === 'door' ? 'Door' : 'Window') + ' ' + U.formatNumber(opening.widthCm, 0), {
          fontSize: 9, color: COLORS.muted, align: 'center'
        });
    });
  }

  function drawWallDrawPreview(context, design, camera) {
    if (!wallDraw) {
      if (!wallHover) return;
      const p = planToScreen(wallHover.x, wallHover.z);
      context.save();
      context.fillStyle = COLORS.green;
      context.beginPath();
      context.arc(p.x, p.y, 4, 0, Math.PI * 2);
      context.fill();
      context.restore();
      drawScreenPill(context, p.x, p.y - 18, wallHover.snapped ? 'Snapped · click to start' : 'Click to start wall', {
        fontSize: 10, color: COLORS.green, align: 'center'
      });
      return;
    }
    const a = planToScreen(wallDraw.x1Cm, wallDraw.z1Cm);
    const b = planToScreen(wallDraw.x2Cm, wallDraw.z2Cm);
    const length = Math.hypot(wallDraw.x2Cm - wallDraw.x1Cm, wallDraw.z2Cm - wallDraw.z1Cm);
    context.save();
    context.strokeStyle = COLORS.green;
    context.globalAlpha = 0.3;
    context.lineWidth = Math.max(4, C.WALL_THICKNESS_CM * camera.scale);
    context.lineCap = 'butt';
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.globalAlpha = 0.9;
    context.setLineDash([6, 5]);
    context.lineWidth = 1.3;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.setLineDash([]);
    context.fillStyle = COLORS.white;
    context.strokeStyle = COLORS.green;
    context.lineWidth = 1.6;
    [a, b].forEach(function (p) {
      context.beginPath();
      context.arc(p.x, p.y, 5, 0, Math.PI * 2);
      context.fill();
      context.stroke();
    });
    context.restore();
    drawScreenPill(context, (a.x + b.x) / 2, (a.y + b.y) / 2 - 20,
      U.formatNumber(length, 0) + ' cm · ' + (length >= 40 ? 'click to finish' : 'too short'), {
        fontSize: 10, color: length >= 40 ? COLORS.green : COLORS.danger, align: 'center'
      });
  }

  function wallPointCoords(wall, offset) {
    const p = G.wallPoint(wall, offset);
    return [p.x, p.z];
  }

  function drawNonSelectedOpeningLabels() { /* labels are handled in drawStructuralOverlays */ }

  function drawFurniture(context, design, camera, products, opts) {
    const forExport = !!opts.forExport;
    design.placedItems.forEach(function (item) {
      const product = products[item.productId];
      const center = planToScreen(item.xCm, item.zCm);
      if (!product) {
        context.save();
        context.fillStyle = '#f0d8d4';
        context.strokeStyle = COLORS.danger;
        context.lineWidth = 1.4;
        context.setLineDash([5, 4]);
        context.fillRect(center.x - 30, center.y - 20, 60, 40);
        context.strokeRect(center.x - 30, center.y - 20, 60, 40);
        context.restore();
        return;
      }
      context.save();
      context.translate(center.x, center.y);
      context.rotate(U.degToRad(item.rotationDeg));
      context.scale(camera.scale, camera.scale);
      const w = product.widthCm;
      const l = product.lengthCm;
      const topImage = App.Media.getTopImage(product);
      if (topImage) {
        context.drawImage(topImage, -w / 2, -l / 2, w, l);
      } else {
        App.Media.drawTopView(context, product, App.Catalog.colorFor(product, item.variantId));
      }
      context.restore();
      if (!forExport) {
        const valid = G.footprintInsideRoom(design.room, item.xCm, item.zCm, product.widthCm, product.lengthCm, item.rotationDeg, 0);
        if (!valid) {
          const aabb = G.aabbFor(item.xCm, item.zCm, product.widthCm, product.lengthCm, item.rotationDeg);
          const tl = planToScreen(aabb.minX, aabb.minZ);
          const br = planToScreen(aabb.maxX, aabb.maxZ);
          context.save();
          context.fillStyle = COLORS.dangerSoft;
          context.strokeStyle = COLORS.danger;
          context.lineWidth = 1.5;
          context.setLineDash([6, 4]);
          context.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
          context.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
          context.restore();
        }
      }
    });
  }

  function drawFurnitureOverlays(context, design, camera, products, selected, forExport) {
    design.placedItems.forEach(function (item) {
      const product = products[item.productId];
      if (!product) return;
      const aabb = G.aabbFor(item.xCm, item.zCm, product.widthCm, product.lengthCm, item.rotationDeg);
      const tl = planToScreen(aabb.minX, aabb.minZ);
      const br = planToScreen(aabb.maxX, aabb.maxZ);
      const width = br.x - tl.x;
      const height = br.y - tl.y;
      const isSelected = selected && selected.type === 'placed' && selected.id === item.id;
      if (forExport || (camera.scale > 0.32 && width > 48 && height > 22)) {
        const label = product.name;
        context.save();
        context.font = (isSelected || forExport ? '600 ' : '500 ') + (forExport ? 13 : 10) + 'px ' + FONT;
        const maxWidth = Math.max(50, width - 4);
        let text = label;
        if (context.measureText(text).width > maxWidth) {
          while (text.length > 3 && context.measureText(text + '…').width > maxWidth) text = text.slice(0, -1);
          text += '…';
        }
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        const labelY = br.y + (forExport ? 18 : 13);
        if (isSelected) {
          const padding = 3;
          const metrics = context.measureText(text);
          roundRectPath(context, (tl.x + br.x) / 2 - metrics.width / 2 - padding, labelY - 7, metrics.width + padding * 2, 14, 4);
          context.fillStyle = 'rgba(15,122,82,0.94)';
          context.fill();
          context.fillStyle = '#fff';
        } else {
          context.fillStyle = 'rgba(255,255,255,0.82)';
          const metrics = context.measureText(text);
          roundRectPath(context, (tl.x + br.x) / 2 - metrics.width / 2 - 2.5, labelY - 6.5, metrics.width + 5, 13, 3);
          context.fill();
          context.fillStyle = COLORS.label;
        }
        context.fillText(text, (tl.x + br.x) / 2, labelY);
        context.restore();
      }
      if (!forExport && isSelected) {
        const corners = G.cornersFor(item.xCm, item.zCm, product.widthCm, product.lengthCm, item.rotationDeg).map(function (p) {
          return planToScreen(p.x, p.z);
        });
        context.save();
        context.strokeStyle = COLORS.green;
        context.lineWidth = 1.6;
        context.setLineDash([6, 4]);
        context.beginPath();
        corners.forEach(function (p, index) {
          if (index === 0) context.moveTo(p.x, p.y);
          else context.lineTo(p.x, p.y);
        });
        context.closePath();
        context.stroke();
        context.setLineDash([]);
        context.fillStyle = COLORS.white;
        corners.forEach(function (p) {
          context.beginPath();
          context.arc(p.x, p.y, 3.4, 0, Math.PI * 2);
          context.fill();
          context.stroke();
        });
        if (!item.locked) {
          const handle = rotationHandleScreen(item, product);
          context.strokeStyle = COLORS.green;
          context.lineWidth = 1.4;
          context.beginPath();
          context.moveTo((corners[0].x + corners[1].x) / 2, (corners[0].y + corners[1].y) / 2);
          context.lineTo(handle.x, handle.y);
          context.stroke();
          context.fillStyle = COLORS.white;
          context.beginPath();
          context.arc(handle.x, handle.y, 7, 0, Math.PI * 2);
          context.fill();
          context.stroke();
          context.strokeStyle = COLORS.green;
          context.beginPath();
          context.arc(handle.x, handle.y, 3.4, -Math.PI * 0.8, Math.PI * 0.8);
          context.stroke();
        } else {
          drawLockIcon(context, tl.x + 10, tl.y + 10);
        }
        context.restore();
      } else if (!forExport && item.locked) {
        drawLockIcon(context, tl.x + 10, tl.y + 10);
      }
    });
  }

  function drawLockIcon(context, x, y) {
    context.save();
    context.fillStyle = 'rgba(255,255,255,0.9)';
    context.strokeStyle = 'rgba(62,79,70,0.35)';
    context.lineWidth = 1;
    roundRectPath(context, x - 8, y - 8, 16, 16, 4);
    context.fill();
    context.stroke();
    context.strokeStyle = COLORS.label;
    context.lineWidth = 1.3;
    context.beginPath();
    context.arc(x, y - 2, 3, Math.PI, 0);
    context.stroke();
    context.fillStyle = COLORS.label;
    context.fillRect(x - 4, y - 2, 8, 6);
    context.restore();
  }

  function drawCatalogGhost(context, camera, ghostData, products) {
    const product = products[ghostData.productId];
    if (!product) return;
    const center = planToScreen(ghostData.x, ghostData.z);
    context.save();
    context.translate(center.x, center.y);
    context.rotate(U.degToRad(ghostData.rotationDeg));
    context.scale(camera.scale, camera.scale);
    context.globalAlpha = 0.55;
    App.Media.drawTopView(context, product, App.Catalog.defaultVariantId(product) ? App.Catalog.colorFor(product, App.Catalog.defaultVariantId(product)) : null);
    context.globalAlpha = 1;
    context.restore();
    const aabb = G.aabbFor(ghostData.x, ghostData.z, product.widthCm, product.lengthCm, ghostData.rotationDeg);
    const tl = planToScreen(aabb.minX, aabb.minZ);
    const br = planToScreen(aabb.maxX, aabb.maxZ);
    context.save();
    context.strokeStyle = ghostData.fits ? COLORS.green : COLORS.danger;
    context.lineWidth = 1.6;
    context.setLineDash([5, 4]);
    context.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
    context.setLineDash([]);
    context.restore();
    drawScreenPill(context, (tl.x + br.x) / 2, tl.y - 20, product.name, {
      fontSize: 10, color: ghostData.fits ? COLORS.green : COLORS.danger, align: 'center'
    });
  }

  function drawToolGhost(context, design, camera, toolGhostData) {
    if (!toolGhostData) return;
    let a;
    let b;
    if (toolGhostData.interior) {
      const wall = (design.interiorWalls || []).find(function (w) { return w.id === toolGhostData.wallId; });
      if (!wall) return;
      const length = G.interiorWallLength(wall);
      const half = toolGhostData.widthCm / 2;
      const left = U.clamp(toolGhostData.offsetCm - half, 0, length);
      const right = U.clamp(toolGhostData.offsetCm + half, 0, length);
      const pL = G.interiorWallPoint(wall, left);
      const pR = G.interiorWallPoint(wall, right);
      a = planToScreen(pL.x, pL.z);
      b = planToScreen(pR.x, pR.z);
    } else {
      const wall = G.getWall(design.room, toolGhostData.wall);
      if (!wall) return;
      const half = toolGhostData.widthCm / 2;
      const left = Math.max(0, toolGhostData.offsetCm - half);
      const right = Math.min(wall.lengthCm, toolGhostData.offsetCm + half);
      const pL = G.wallPoint(wall, left);
      const pR = G.wallPoint(wall, right);
      a = planToScreen(pL.x, pL.z);
      b = planToScreen(pR.x, pR.z);
    }
    context.save();
    context.strokeStyle = toolGhostData.near ? COLORS.green : COLORS.muted;
    context.lineWidth = 6;
    context.globalAlpha = 0.6;
    context.beginPath();
    context.moveTo(a.x, a.y);
    context.lineTo(b.x, b.y);
    context.stroke();
    context.restore();
    drawScreenPill(context, (a.x + b.x) / 2, (a.y + b.y) / 2 - 22, (toolGhostData.type === 'door' ? 'Door' : 'Window') + ' · ' + (toolGhostData.near ? 'click to place' : 'move closer to a wall'), {
      fontSize: 10, color: toolGhostData.near ? COLORS.green : COLORS.muted, align: 'center'
    });
  }

  function drawInteractionHints(context, design, camera) {
    if (!design.placedItems.length && !design.structuralItems.length && !(design.interiorWalls || []).length) {
      drawScreenPill(context, camera.panX + G.roomSize(design.room).width * camera.scale / 2,
        camera.panY + G.roomSize(design.room).length * camera.scale / 2,
        'Drag a product from the catalog, or use + Add', {
          fontSize: 12, color: COLORS.muted, align: 'center'
        });
    }
  }

  function getCamera() {
    return { scale: view.scale, panX: view.panX, panY: view.panY, initialized: view.initialized };
  }

  function getSelectedScreenInfo() {
    const selected = getSelected();
    if (!selected || selected.type !== 'placed') return null;
    const design = getDesign();
    if (!design) return null;
    const item = design.placedItems.find(function (p) { return p.id === selected.id; });
    const product = item && getPlacedProduct(item);
    if (!item || !product) return null;
    return { handle: rotationHandleScreen(item, product) };
  }

  function renderPlanToCanvas(targetCanvas, design, options) {
    const opts = options || {};
    if (!targetCanvas || !design) throw new Error('No design is available to export.');
    const width = opts.width || 1600;
    const height = opts.height || 1100;
    targetCanvas.width = width;
    targetCanvas.height = height;
    const context = targetCanvas.getContext('2d');
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.fillStyle = COLORS.green;
    context.font = '600 15px ' + FONT;
    context.textAlign = 'left';
    context.textBaseline = 'alphabetic';
    context.fillText('FORMAROOM · FLOOR PLAN', 64, 54);
    context.font = '700 34px ' + FONT;
    context.fillStyle = '#1c2a23';
    context.fillText(design.name, 64, 96);
    const s = G.roomSize(design.room);
    const summary = App.Pricing ? App.Pricing.summarize(design) : null;
    let subtitle = G.roomShapeLabel(design.room) + ' room · ' +
      (G.isCircle(design.room) ? 'Ø ' + U.formatNumber(s.width, 0) + ' cm' : U.formatNumber(s.width, 0) + ' × ' + U.formatNumber(s.length, 0) + ' cm') +
      ' · ceiling ' + U.formatNumber(design.room.heightCm, 0) + ' cm';
    if (summary) {
      subtitle += ' · ' + summary.quantity + ' item' + (summary.quantity === 1 ? '' : 's');
      if (!summary.incomplete) subtitle += ' · ' + U.formatMoney(summary.total);
    }
    context.font = '400 15px ' + FONT;
    context.fillStyle = '#62726a';
    context.fillText(subtitle, 64, 122);
    context.strokeStyle = 'rgba(15,122,82,0.25)';
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(64, 142);
    context.lineTo(width - 64, 142);
    context.stroke();

    const paddingX = 120;
    const availableW = width - paddingX * 2;
    const availableH = height - 142 - 120;
    const scale = Math.min(availableW / s.width, availableH / s.length);
    const camera = {
      scale: scale,
      panX: paddingX + (availableW - s.width * scale) / 2,
      panY: 142 + 50 + (availableH - s.length * scale) / 2,
      initialized: true
    };
    const oldView = view;
    view = camera;
    drawScene(context, design, camera, { forExport: true, showHints: false });
    view = oldView;
    context.save();
    context.fillStyle = '#7c8a82';
    context.font = '400 13px ' + FONT;
    context.textAlign = 'left';
    context.fillText('Created locally with FormaRoom · dimensions in centimetres · furniture footprints use catalog dimensions.', 64, height - 48);
    context.textAlign = 'right';
    context.fillText(U.formatDate(new Date().toISOString()), width - 64, height - 48);
    context.restore();
    return targetCanvas;
  }

  function exportImage(design, options) {
    const offscreen = document.createElement('canvas');
    renderPlanToCanvas(offscreen, design, options);
    return new Promise(function (resolve, reject) {
      try {
        offscreen.toBlob(function (blob) {
          if (!blob) reject(new Error('The browser could not create the PNG.'));
          else resolve(blob);
        }, 'image/png');
      } catch (err) {
        reject(err);
      }
    });
  }

  App.Designer2D = {
    init: init,
    requestDraw: requestDraw,
    fitView: fitView,
    zoomBy: zoomBy,
    setTool: setTool,
    getTool: getTool,
    beginWallTool: beginWallTool,
    setSnap: setSnap,
    toggleSnap: toggleSnap,
    getSnap: getSnap,
    startCatalogDrag: startCatalogDrag,
    endCatalogDrag: endCatalogDrag,
    getCamera: getCamera,
    getSelectedScreenInfo: getSelectedScreenInfo,
    renderPlanToCanvas: renderPlanToCanvas,
    exportImage: exportImage
  };
})(window.App = window.App || {});
