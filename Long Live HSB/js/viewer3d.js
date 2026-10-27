(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;
  const G = App.Geometry;
  const CM = C.CM_TO_M;

  const MATERIAL_COLORS = {
    wall: 0xf2f0ea,
    wallTop: 0xdedbd2,
    floor: 0xe8e3d9,
    ceiling: 0xfaf8f4,
    trim: 0xf7f5f0,
    door: 0x9a7853,
    glass: 0xaed2df,
    metal: 0x6d746f,
    rug: 0xd4c8b6
  };

  const WALK = {
    eyeHeight: 1.62,
    bodyRadius: 0.26,
    wallPadding: 0.04,
    walkSpeed: 1.7,
    runSpeed: 3.4,
    acceleration: 11,
    deceleration: 15,
    maxStep: 0.08,
    lookSensitivity: 0.0021,
    baseFov: 62,
    runFov: 69,
    orbitFov: 52
  };

  const state = {
    initialized: false,
    active: false,
    mode: 'orbit',
    container: null,
    renderer: null,
    scene: null,
    camera: null,
    orbit: null,
    clock: null,
    roomGroup: null,
    furnitureGroup: null,
    ceilingGroup: null,
    wallGroups: [],
    itemNodes: new Map(),
    roomSignature: '',
    selection: null,
    selectedId: null,
    highlight: null,
    ceilingVisible: false,
    cutaway: true,
    frameId: null,
    resizeObserver: null,
    onStatus: null,
    statusTimer: null,
    glbCache: new Map(),
    glbUsage: new Map(),
    errors: [],
    lastTime: 0,
    orbitState: null,
    firstPerson: {
      position: { x: 0, y: WALK.eyeHeight, z: 0 },
      velocity: { x: 0, z: 0 },
      yaw: 0,
      pitch: 0,
      keys: {},
      dragging: false,
      pointerLocked: false,
      lastX: 0,
      lastY: 0,
      bobPhase: 0,
      bobOffset: 0,
      distanceWalked: 0
    },
    pointerDown: null,
    raycaster: null,
    pointer: null,
    design: null,
    loadingGlb: 0,
    floorMesh: null,
    floorTextureCache: new Map(),
    appliedFloor: null
  };

  function notifyStatus() {
    if (typeof state.onStatus !== 'function') return;
    if (state.statusTimer) return;
    state.statusTimer = setTimeout(function () {
      state.statusTimer = null;
      try {
        state.onStatus(getStatus());
      } catch (err) {
        console.error('3D status callback failed:', err);
      }
    }, 40);
  }

  /* Reports the paint on both faces of the perimeter walls, straight from the
     materials that are drawn, so the paint can be checked honestly. */
  function wallPaintStatus() {
    const design = state.design;
    const inside = designWallColor(design);
    const outside = (design && design.exteriorWallColor) || inside;
    const faces = [];
    if (state.roomGroup) state.roomGroup.traverse(function (child) {
      if (!child.isMesh || !Array.isArray(child.material)) return;
      faces.push(child.material.map(function (material) {
        return '#' + material.color.getHexString();
      }));
    });
    return {
      inside: String(inside).toLowerCase(),
      outside: String(outside).toLowerCase(),
      faces: faces
    };
  }

  function getStatus() {
    const nodes = Array.from(state.itemNodes.values());
    const glbNodes = nodes.filter(function (node) { return node.modelKind === 'glb'; });
    const expectedGlb = nodes.filter(function (node) { return node.expectsGlb; });
    const procedural = nodes.filter(function (node) { return node.modelKind !== 'glb'; });
    const uniqueGlbProducts = new Set(glbNodes.map(function (node) { return node.productId; }));
    const mismatches = [];
    const errors = state.errors.slice();
    nodes.forEach(function (node) {
      if (node.mismatchMessage && mismatches.indexOf(node.mismatchMessage) === -1) mismatches.push(node.mismatchMessage);
      if (node.errorMessage && errors.indexOf(node.errorMessage) === -1) errors.push(node.errorMessage);
    });
    return {
      initialized: state.initialized,
      active: state.active,
      mode: state.mode,
      ceiling: state.ceilingVisible,
      cutaway: state.cutaway,
      items: nodes.length,
      glbLoaded: glbNodes.length,
      glbProducts: uniqueGlbProducts.size,
      glbExpected: expectedGlb.length,
      glbCap: C.LIMITS.MAX_GLB_MODELS,
      procedural: procedural.length,
      loading: state.loadingGlb,
      mismatches: mismatches,
      errors: errors,
      circular: !!(state.design && state.design.room && state.design.room.shape === 'circle'),
      webgl: !!state.renderer,
      wallPaint: wallPaintStatus(),
      walk: {
        x: U.round(state.firstPerson.position.x, 2),
        z: U.round(state.firstPerson.position.z, 2),
        yaw: U.round(state.firstPerson.yaw, 3),
        pitch: U.round(state.firstPerson.pitch, 3),
        speed: U.round(Math.hypot(state.firstPerson.velocity.x, state.firstPerson.velocity.z), 2),
        pointerLocked: state.firstPerson.pointerLocked
      },
      camera: state.camera ? {
        y: U.round(state.camera.position.y, 3),
        rotation: {
          x: U.round(state.camera.rotation.x, 4),
          y: U.round(state.camera.rotation.y, 4),
          z: U.round(state.camera.rotation.z, 4),
          order: state.camera.rotation.order
        },
        up: {
          x: U.round(state.camera.up.x, 4),
          y: U.round(state.camera.up.y, 4),
          z: U.round(state.camera.up.z, 4)
        }
      } : null
    };
  }

  function reportError(message) {
    if (!message) return;
    if (state.errors.indexOf(message) === -1) state.errors.push(message);
    if (state.errors.length > 8) state.errors.shift();
    notifyStatus();
  }

  function init(containerEl, options) {
    if (state.initialized) {
      resize();
      setActive(true);
      return true;
    }
    const opts = options || {};
    state.container = containerEl;
    state.onStatus = typeof opts.onStatus === 'function' ? opts.onStatus : (typeof App.on3DStatus === 'function' ? App.on3DStatus : null);
    if (!containerEl) return false;
    if (typeof THREE === 'undefined' || !THREE.WebGLRenderer) {
      reportError('Three.js did not load. The 2D planner is still available.');
      renderFailure('The 3D library could not be loaded.');
      return false;
    }
    try {
      state.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      state.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      state.renderer.setSize(1, 1, false);
      state.renderer.shadowMap.enabled = true;
      state.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      state.renderer.outputEncoding = THREE.sRGBEncoding;
      state.renderer.domElement.className = 'viewer3d-canvas';
      state.renderer.domElement.setAttribute('tabindex', '0');
      state.renderer.domElement.setAttribute('aria-label', 'Interactive three dimensional room view');
      containerEl.appendChild(state.renderer.domElement);
    } catch (err) {
      console.error(err);
      reportError('WebGL is unavailable in this browser, so the 3D room cannot render.');
      renderFailure('WebGL is unavailable, so the 3D view cannot start. All 2D planning, pricing, saving and exports still work.');
      return false;
    }

    state.scene = new THREE.Scene();
    state.scene.background = new THREE.Color(0xe9efeb);
    state.camera = new THREE.PerspectiveCamera(52, 1, 0.07, 120);
    state.clock = new THREE.Clock();
    state.raycaster = new THREE.Raycaster();
    state.pointer = new THREE.Vector2();

    setupLights();

    if (THREE.OrbitControls) {
      state.orbit = new THREE.OrbitControls(state.camera, state.renderer.domElement);
      state.orbit.enableDamping = true;
      state.orbit.dampingFactor = 0.08;
      state.orbit.screenSpacePanning = false;
      state.orbit.minDistance = 0.4;
      state.orbit.maxDistance = 45;
      state.orbit.maxPolarAngle = Math.PI / 2 - 0.015;
      state.orbit.target.set(0, 0.5, 0);
      state.orbit.addEventListener('change', function () {});
    }

    state.highlight = new THREE.BoxHelper(new THREE.Object3D(), 0x0f7a52);
    state.highlight.material.depthTest = false;
    state.highlight.material.transparent = true;
    state.highlight.material.opacity = 0.95;
    state.highlight.renderOrder = 5;
    state.highlight.visible = false;
    state.scene.add(state.highlight);

    state.roomGroup = new THREE.Group();
    state.furnitureGroup = new THREE.Group();
    state.ceilingGroup = new THREE.Group();
    state.scene.add(state.roomGroup);
    state.scene.add(state.furnitureGroup);
    state.scene.add(state.ceilingGroup);

    bindEvents(containerEl);
    state.resizeObserver = new ResizeObserver(function () { resize(); });
    state.resizeObserver.observe(containerEl);
    state.initialized = true;
    resize();
    notifyStatus();
    return true;
  }

  function renderFailure(message) {
    if (!state.container) return;
    state.container.classList.add('viewer3d-unavailable');
    const box = document.createElement('div');
    box.className = 'viewer3d-failure';
    box.innerHTML = '<strong>3D view unavailable</strong><p>' + U.escapeHtml(message) + '</p>';
    state.container.appendChild(box);
  }

  function setupLights() {
    const hemi = new THREE.HemisphereLight(0xffffff, 0x7f8e83, 0.62);
    state.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e2, 1.0);
    sun.position.set(4.5, 8.5, 3.5);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.near = 0.2;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -12;
    sun.shadow.camera.right = 12;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    sun.shadow.bias = -0.0005;
    /* Offsetting shadow lookups along the surface normal is what stops the
       self-shadow "acne" that reads as crawling speckles on walls and floors. */
    sun.shadow.normalBias = 0.02;
    state.scene.add(sun);
    state._sun = sun;
    const fill = new THREE.DirectionalLight(0xdfe9ff, 0.2);
    fill.position.set(-6, 5, -4);
    state.scene.add(fill);
    const ambient = new THREE.AmbientLight(0xffffff, 0.12);
    state.scene.add(ambient);
  }

  function resize() {
    if (!state.container || !state.renderer || !state.camera) return;
    const rect = state.container.getBoundingClientRect();
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    if (width < 2 || height < 2) return;
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
    renderOnce();
  }

  function bindEvents(containerEl) {
    const el = state.renderer.domElement;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('pointerleave', function () {
      if (!state.firstPerson.dragging) return;
      state.firstPerson.dragging = false;
      el.classList.remove('is-looking');
    });
    el.addEventListener('contextmenu', function (event) { event.preventDefault(); });
    el.addEventListener('keydown', onKeyDown);
    el.addEventListener('keyup', onKeyUp);
    el.addEventListener('blur', function () { clearWalkInput(true); });
    document.addEventListener('keydown', onDocumentKeyDown);
    document.addEventListener('keyup', onDocumentKeyUp);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    document.addEventListener('mousemove', onLockedMouseMove);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) clearWalkInput(true);
    });
    window.addEventListener('blur', function () { clearWalkInput(true); });
    state._keydownDoc = onDocumentKeyDown;
    state._keyupDoc = onDocumentKeyUp;
    state._containerClick = null;
    containerEl.setAttribute('data-viewer-mode', state.mode);
  }

  function isFirstPerson() { return state.mode === 'first'; }

  const WALK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'];

  function clearWalkInput(zeroVelocity) {
    state.firstPerson.keys = {};
    state.firstPerson.dragging = false;
    if (zeroVelocity) {
      state.firstPerson.velocity.x = 0;
      state.firstPerson.velocity.z = 0;
    }
  }

  function onDocumentKeyDown(event) {
    if (!state.active || !isFirstPerson()) return;
    if (U.isTypingTarget(event.target)) return;
    if (WALK_KEYS.indexOf(event.code) < 0) return;
    state.firstPerson.keys[event.code] = true;
    if (event.code.indexOf('Arrow') === 0) event.preventDefault();
  }

  function onDocumentKeyUp(event) {
    state.firstPerson.keys[event.code] = false;
  }

  function onKeyDown(event) {
    if (!isFirstPerson()) return;
    if (U.isTypingTarget(event.target)) return;
    if (WALK_KEYS.indexOf(event.code) < 0) return;
    state.firstPerson.keys[event.code] = true;
    if (event.code.indexOf('Arrow') === 0) event.preventDefault();
  }

  function onKeyUp(event) {
    state.firstPerson.keys[event.code] = false;
  }

  function onPointerDown(event) {
    if (!state.renderer) return;
    const el = state.renderer.domElement;
    state.pointerDown = { x: event.clientX, y: event.clientY, time: Date.now() };
    if (!isFirstPerson() || event.button !== 0) return;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen' && document.pointerLockElement !== el) {
      requestWalkPointerLock(el);
    }
    if (document.pointerLockElement === el) return;
    el.setPointerCapture && el.setPointerCapture(event.pointerId);
    state.firstPerson.dragging = true;
    state.firstPerson.lastX = event.clientX;
    state.firstPerson.lastY = event.clientY;
    el.classList.add('is-looking');
  }

  function requestWalkPointerLock(el) {
    if (!el.requestPointerLock) return;
    try {
      const pending = el.requestPointerLock();
      if (pending && typeof pending.catch === 'function') pending.catch(function () { /* drag-to-look fallback stays active */ });
    } catch (err) {
      /* browsers without pointer lock use drag-to-look */
    }
  }

  function onPointerLockChange() {
    const el = state.renderer && state.renderer.domElement;
    const locked = !!el && document.pointerLockElement === el;
    state.firstPerson.pointerLocked = locked;
    if (state.container) state.container.classList.toggle('is-pointer-locked', locked && isFirstPerson());
    if (locked) {
      state.firstPerson.dragging = false;
      el.classList.remove('is-looking');
    }
    updateWalkHudTip();
    notifyStatus();
  }

  function updateWalkHudTip() {
    if (!state.container) return;
    const tip = state.container.querySelector('.walk-hud-tip');
    if (!tip) return;
    tip.textContent = state.firstPerson.pointerLocked
      ? 'Mouse captured · WASD walk · Shift run · Esc releases mouse'
      : 'Click or drag to look · WASD walk · Shift run · Esc returns to orbit';
  }

  function onPointerLockError() {
    state.firstPerson.pointerLocked = false;
    if (state.container) state.container.classList.remove('is-pointer-locked');
  }

  function onLockedMouseMove(event) {
    if (!state.active || !isFirstPerson() || !state.firstPerson.pointerLocked) return;
    applyLookDelta(event.movementX || 0, event.movementY || 0);
  }

  function applyLookDelta(dx, dy) {
    state.firstPerson.yaw -= dx * WALK.lookSensitivity;
    state.firstPerson.pitch = U.clamp(state.firstPerson.pitch - dy * WALK.lookSensitivity * 0.82, -1.15, 1.05);
    applyFirstPersonCamera();
    renderOnce();
  }

  function onPointerMove(event) {
    if (!isFirstPerson() || state.firstPerson.pointerLocked) return;
    if (!state.firstPerson.dragging) return;
    const dx = event.clientX - state.firstPerson.lastX;
    const dy = event.clientY - state.firstPerson.lastY;
    state.firstPerson.lastX = event.clientX;
    state.firstPerson.lastY = event.clientY;
    applyLookDelta(dx, dy);
  }

  function onPointerUp(event) {
    if (!state.renderer) return;
    const el = state.renderer.domElement;
    if (state.firstPerson.dragging) {
      state.firstPerson.dragging = false;
      el.classList.remove('is-looking');
      try { el.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    }
    if (!state.pointerDown) return;
    const moved = Math.hypot(event.clientX - state.pointerDown.x, event.clientY - state.pointerDown.y);
    const elapsed = Date.now() - state.pointerDown.time;
    state.pointerDown = null;
    if (moved > 6 || elapsed > 700) return;
    if (!isFirstPerson()) pick(event);
  }

  function pick(event) {
    if (!state.camera || !state.furnitureGroup) return;
    const rect = state.renderer.domElement.getBoundingClientRect();
    state.pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    state.pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const targets = [state.furnitureGroup, state.roomGroup];
    const hits = state.raycaster.intersectObjects(targets, true);
    let placedHit = null;
    let structuralHit = null;
    let wallHit = null;
    for (let i = 0; i < hits.length; i++) {
      let node = hits[i].object;
      while (node && !node.userData.placedInstanceId && !node.userData.structuralId && !node.userData.interiorWallId) node = node.parent;
      if (!node) continue;
      if (node.userData.placedInstanceId && !placedHit) placedHit = hits[i];
      else if (node.userData.structuralId && !structuralHit) structuralHit = hits[i];
      else if (node.userData.interiorWallId && !wallHit) wallHit = hits[i];
      if (placedHit && structuralHit && wallHit) break;
    }
    if (placedHit && (!structuralHit || placedHit.distance <= structuralHit.distance + 0.001)) {
      const placedId = placedInstanceIdOf(placedHit);
      if (placedId && typeof App.selectPlaced === 'function') App.selectPlaced(placedId);
      return;
    }
    if (structuralHit) {
      const structuralId = structuralIdOf(structuralHit);
      if (structuralId && typeof App.selectStructural === 'function') {
        App.selectStructural(structuralId);
        return;
      }
    }
    if (wallHit) {
      const wallId = interiorWallIdOf(wallHit);
      if (wallId && typeof App.selectWall === 'function') {
        App.selectWall(wallId);
        return;
      }
    }
    if (typeof App.clearSelection === 'function') App.clearSelection();
  }

  function placedInstanceIdOf(hit) {
    let node = hit.object;
    while (node && !node.userData.placedInstanceId) node = node.parent;
    return node ? node.userData.placedInstanceId : null;
  }

  function structuralIdOf(hit) {
    let node = hit.object;
    while (node && !node.userData.structuralId) node = node.parent;
    return node ? node.userData.structuralId : null;
  }

  function interiorWallIdOf(hit) {
    let node = hit.object;
    while (node && !node.userData.interiorWallId) node = node.parent;
    return node ? node.userData.interiorWallId : null;
  }

  function renderOnce() {
    if (!state.renderer || !state.scene || !state.camera) return;
    if (!state.active) return;
    updateCutaway();
    state.renderer.render(state.scene, state.camera);
  }

  function setActive(active) {
    state.active = !!active;
    if (state.active) {
      resize();
      if (isFirstPerson()) applyFirstPersonCamera();
      if (!state.frameId) {
        state.clock.start();
        state.frameId = requestAnimationFrame(animate);
      }
      /* orbit controls only receive user input while the canvas is on screen */
      if (state.orbit) state.orbit.enabled = !isFirstPerson();
      notifyStatus();
    } else {
      if (state.frameId) {
        cancelAnimationFrame(state.frameId);
        state.frameId = null;
      }
      clearWalkInput(true);
      if (document.pointerLockElement === state.renderer.domElement && document.exitPointerLock) document.exitPointerLock();
    }
  }

  function animate() {
    state.frameId = null;
    if (!state.active) return;
    const dt = Math.min(0.05, state.clock.getDelta());
    if (isFirstPerson()) updateFirstPerson(dt);
    else if (state.orbit) state.orbit.update();
    updateCutaway();
    state.renderer.render(state.scene, state.camera);
    state.frameId = requestAnimationFrame(animate);
  }

  function setMode(mode) {
    const next = mode === 'first' ? 'first' : 'orbit';
    if (next === state.mode) return;
    if (next === 'first' && !canWalk()) {
      if (typeof App.onWalkUnavailable === 'function') App.onWalkUnavailable();
      notifyStatus();
      return;
    }
    if (next === 'first') {
      state.orbitState = state.camera.position.clone();
      const spawn = spawnPoint();
      state.firstPerson.position = { x: spawn.x, y: spawn.y, z: spawn.z };
      state.firstPerson.velocity.x = 0;
      state.firstPerson.velocity.z = 0;
      state.firstPerson.yaw = spawn.yaw;
      state.firstPerson.pitch = 0;
      state.firstPerson.bobPhase = 0;
      state.firstPerson.bobOffset = 0;
      state.firstPerson.distanceWalked = 0;
      state.firstPerson.keys = {};
      state.camera.fov = WALK.baseFov;
      state.camera.updateProjectionMatrix();
      applyFirstPersonCamera();
      if (state.orbit) state.orbit.enabled = false;
      state.renderer.domElement.focus();
      state.container.classList.add('is-first-person');
    } else {
      clearWalkInput(true);
      state.firstPerson.pitch = 0;
      state.firstPerson.bobOffset = 0;
      if (state.renderer && document.pointerLockElement === state.renderer.domElement && document.exitPointerLock) document.exitPointerLock();
      state.container.classList.remove('is-pointer-locked');
      state.container.classList.remove('is-first-person');
      state.renderer.domElement.classList.remove('is-looking');
      state.camera.fov = WALK.orbitFov;
      state.camera.updateProjectionMatrix();
      if (state.orbit) {
        state.orbit.enabled = true;
        if (state.orbitState) state.camera.position.copy(state.orbitState);
        state.orbit.update();
      }
    }
    state.mode = next;
    state.container.setAttribute('data-viewer-mode', next);
    updateWalkHudTip();
    updateCutaway();
    notifyStatus();
    renderOnce();
  }

  function getMode() { return state.mode; }

  function hasWalkableDoor() {
    const design = state.design;
    if (!design || !design.room || G.isCircle(design.room)) return false;
    return (design.structuralItems || []).some(function (item) { return item.type === 'door'; });
  }

  function canWalk() {
    return hasWalkableDoor();
  }

  function spawnPoint() {
    const design = state.design;
    if (!design || !design.room) return { x: 0, y: WALK.eyeHeight, z: 0, yaw: 0 };
    const room = design.room;
    const center = G.roomCenter(room);
    const size = G.roomSize(room);
    const halfW = size.width * CM / 2;
    const halfL = size.length * CM / 2;
    const limitX = Math.max(0.2, halfW - WALK.bodyRadius - WALK.wallPadding);
    const limitZ = Math.max(0.2, halfL - WALK.bodyRadius - WALK.wallPadding);
    if (!G.isCircle(room)) {
      const door = (design.structuralItems || []).find(function (item) { return item.type === 'door'; });
      if (door) {
        const wall = G.getWall(room, door.wall);
        if (wall) {
          const point = G.wallPoint(wall, door.offsetCm);
          const baseX = (point.x - center.x) * CM;
          const baseZ = (point.z - center.z) * CM;
          const inset = WALK.bodyRadius + 0.12;
          let x = baseX + wall.inward.x * inset;
          let z = baseZ + wall.inward.z * inset;
          if (!canWalkAt(x, z)) {
            for (let step = 0.3; step <= 2.4; step += 0.3) {
              const nx = baseX + wall.inward.x * (inset + step);
              const nz = baseZ + wall.inward.z * (inset + step);
              if (canWalkAt(nx, nz)) { x = nx; z = nz; break; }
            }
          }
          const yaw = Math.atan2(-wall.inward.x, -wall.inward.z);
          return { x: x, y: WALK.eyeHeight, z: z, yaw: yaw };
        }
      }
    }
    const candidates = [];
    candidates.push({ x: 0, z: 0 });
    const ringLimit = Math.max(1, Math.min(limitX, limitZ) * 0.82);
    for (let radius = 0.7; radius <= ringLimit; radius += 0.55) {
      for (let i = 0; i < 12; i++) {
        const angle = (i / 12) * Math.PI * 2;
        candidates.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
      }
    }
    for (let x = -limitX; x <= limitX + 0.001; x += 0.5) {
      for (let z = -limitZ; z <= limitZ + 0.001; z += 0.5) {
        candidates.push({ x: x, z: z });
      }
    }
    let chosen = null;
    for (let i = 0; i < candidates.length; i++) {
      if (canWalkAt(candidates[i].x, candidates[i].z)) {
        chosen = candidates[i];
        break;
      }
    }
    if (!chosen) chosen = { x: 0, z: 0 };
    return { x: chosen.x, y: WALK.eyeHeight, z: chosen.z, yaw: facingYaw(chosen.x, chosen.z) };
  }

  function facingYaw(x, z) {
    return Math.atan2(x, z);
  }

  function applyFirstPersonCamera() {
    if (!state.camera) return;
    const p = state.firstPerson.position;
    state.camera.position.set(p.x, p.y + state.firstPerson.bobOffset, p.z);
    state.camera.up.set(0, 1, 0);
    state.camera.rotation.order = 'YXZ';
    state.camera.rotation.set(state.firstPerson.pitch, state.firstPerson.yaw, 0, 'YXZ');
  }

  function canWalkAt(x, z) {
    const design = state.design;
    if (!design || !design.room) return true;
    const room = design.room;
    const size = G.roomSize(room);
    if (G.isCircle(room)) {
      const limit = Math.max(0.12, size.width * CM / 2 - WALK.bodyRadius - WALK.wallPadding);
      if (Math.hypot(x, z) > limit) return false;
    } else {
      const limitX = Math.max(0.12, size.width * CM / 2 - WALK.bodyRadius - WALK.wallPadding);
      const limitZ = Math.max(0.12, size.length * CM / 2 - WALK.bodyRadius - WALK.wallPadding);
      if (x < -limitX || x > limitX || z < -limitZ || z > limitZ) {
        /* Real walls block, but a door is a real gap: let the walker stand in the
           doorway instead of hitting an invisible line across the opening. */
        if (!inDoorPassage(x, z)) return false;
      }
    }
    const center = G.roomCenter(room);
    const designX = x / CM + center.x;
    const designZ = z / CM + center.z;
    if (blockedByInteriorWall(design, designX, designZ)) return false;
    const productsById = App.Catalog.getProductsById();
    const items = design.placedItems || [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const product = productsById[item.productId];
      if (!product || product.category === 'rug') continue;
      if (!(product.widthCm > 0) || !(product.lengthCm > 0)) continue;
      const footprintX = (item.xCm - center.x) * CM;
      const footprintZ = (item.zCm - center.z) * CM;
      if (G.circleOverlapsObb(x, z, WALK.bodyRadius, footprintX, footprintZ, product.widthCm * CM, product.lengthCm * CM, item.rotationDeg)) {
        return false;
      }
    }
    return true;
  }

  /* Partition walls are solid, except inside a door opening wide enough for the
     walker's body. Coordinates arrive in the room's own plan centimetres. */
  function blockedByInteriorWall(design, designX, designZ) {
    const walls = design.interiorWalls || [];
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      if (!(G.interiorWallLength(wall) > 0)) continue;
      if (U.toNumber(wall.heightCm, design.room.heightCm) < 150) continue;
      const projected = G.projectOnInteriorWall(wall, designX, designZ);
      const halfThickness = U.toNumber(wall.thicknessCm, C.WALL_THICKNESS_CM) / 2;
      const reach = halfThickness + (WALK.bodyRadius + WALK.wallPadding) / CM;
      if (projected.distance > reach) continue;
      let passable = false;
      G.interiorWallOpenings(wall).forEach(function (opening) {
        if (opening.type !== 'door') return;
        if (U.toNumber(opening.heightCm, 0) < 170) return;
        const halfSpan = Math.max(0, U.toNumber(opening.widthCm, 90) / 2 - (WALK.bodyRadius + WALK.wallPadding) / CM - 2);
        if (Math.abs(projected.offsetCm - U.toNumber(opening.offsetCm, 0)) <= halfSpan) passable = true;
      });
      if (!passable) return true;
    }
    return false;
  }

  function inDoorPassage(x, z) {
    const design = state.design;
    if (!design || !design.room || G.isCircle(design.room)) return false;
    const room = design.room;
    const center = G.roomCenter(room);
    const doors = (design.structuralItems || []).filter(function (item) { return item.type === 'door'; });
    for (let i = 0; i < doors.length; i++) {
      const wall = G.getWall(room, doors[i].wall);
      if (!wall) continue;
      const point = G.wallPoint(wall, doors[i].offsetCm);
      const px = (point.x - center.x) * CM;
      const pz = (point.z - center.z) * CM;
      const along = (x - px) * wall.dir.x + (z - pz) * wall.dir.z;
      const across = (x - px) * wall.inward.x + (z - pz) * wall.inward.z;
      const halfSpan = Math.max(0.18, ((Number(doors[i].widthCm) || 90) * CM) / 2 - 0.04);
      if (Math.abs(along) <= halfSpan && across >= -(WALK.bodyRadius + WALK.wallPadding + 0.35) && across <= 0.05) return true;
    }
    return false;
  }

  function moveWalkWithCollisions(dx, dz) {
    const fp = state.firstPerson;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / WALK.maxStep));
    const stepX = dx / steps;
    const stepZ = dz / steps;
    for (let i = 0; i < steps; i++) {
      if (stepX) {
        if (canWalkAt(fp.position.x + stepX, fp.position.z)) fp.position.x += stepX;
        else fp.velocity.x = 0;
      }
      if (stepZ) {
        if (canWalkAt(fp.position.x, fp.position.z + stepZ)) fp.position.z += stepZ;
        else fp.velocity.z = 0;
      }
    }
  }

  function updateWalkBob(dt, speed) {
    const fp = state.firstPerson;
    if (speed > 0.06) {
      fp.bobPhase += dt * (5.4 + speed * 2.1);
      const amplitude = 0.01 + Math.min(0.018, (speed / WALK.runSpeed) * 0.024);
      fp.bobOffset = Math.sin(fp.bobPhase) * amplitude;
    } else {
      fp.bobOffset *= Math.max(0, 1 - dt * 9);
      if (Math.abs(fp.bobOffset) < 0.0004) fp.bobOffset = 0;
    }
  }

  function updateWalkFov(dt, speed, sprinting) {
    const boost = sprinting ? (WALK.runFov - WALK.baseFov) * U.clamp((speed - WALK.walkSpeed) / Math.max(0.1, WALK.runSpeed - WALK.walkSpeed), 0, 1) : 0;
    const target = WALK.baseFov + boost;
    if (Math.abs(state.camera.fov - target) < 0.02) return;
    state.camera.fov += (target - state.camera.fov) * Math.min(1, dt * 9);
    state.camera.updateProjectionMatrix();
  }

  function updateFirstPerson(dt) {
    const fp = state.firstPerson;
    const keys = fp.keys;
    const forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const strafe = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const sprinting = !!(keys.ShiftLeft || keys.ShiftRight);
    const moving = forward !== 0 || strafe !== 0;
    let wishX = 0;
    let wishZ = 0;
    if (moving) {
      const sin = Math.sin(fp.yaw);
      const cos = Math.cos(fp.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
      const length = Math.hypot(wishX, wishZ) || 1;
      wishX /= length;
      wishZ /= length;
    }
    const targetSpeed = sprinting ? WALK.runSpeed : WALK.walkSpeed;
    const targetX = wishX * targetSpeed;
    const targetZ = wishZ * targetSpeed;
    const response = 1 - Math.exp(-(moving ? WALK.acceleration : WALK.deceleration) * dt);
    fp.velocity.x += (targetX - fp.velocity.x) * response;
    fp.velocity.z += (targetZ - fp.velocity.z) * response;
    if (!moving && Math.hypot(fp.velocity.x, fp.velocity.z) < 0.008) {
      fp.velocity.x = 0;
      fp.velocity.z = 0;
    }
    const dx = fp.velocity.x * dt;
    const dz = fp.velocity.z * dt;
    if (dx || dz) {
      const startX = fp.position.x;
      const startZ = fp.position.z;
      moveWalkWithCollisions(dx, dz);
      fp.distanceWalked += Math.hypot(fp.position.x - startX, fp.position.z - startZ);
    }
    const speed = Math.hypot(fp.velocity.x, fp.velocity.z);
    updateWalkBob(dt, speed);
    updateWalkFov(dt, speed, sprinting && moving);
    applyFirstPersonCamera();
  }

  function updateCutaway() {
    if (!state.wallGroups.length || !state.camera) return;
    const disabled = !state.cutaway || isFirstPerson();
    const cam = state.camera.position;
    state.wallGroups.forEach(function (entry) {
      /* Partitions belong inside the room, so the cutaway must never hide them:
         doing that made a freshly drawn wall appear to vanish in 3D. */
      if (disabled || entry.interior) {
        entry.group.visible = true;
        entry.hidden = false;
        return;
      }
      const dot = (cam.x - entry.center.x) * entry.outward.x + (cam.z - entry.center.z) * entry.outward.z;
      /* Two thresholds give the walls a band of tolerance. A single cutoff makes
         a wall flicker in and out while the camera drifts across it. */
      if (entry.hidden) {
        if (dot < -0.06) { entry.hidden = false; entry.group.visible = true; }
      } else if (dot > 0.12) {
        entry.hidden = true;
        entry.group.visible = false;
      } else {
        entry.group.visible = true;
      }
    });
  }

  function roomSignatureFor(design) {
    return JSON.stringify({
      room: design.room,
      structure: design.structuralItems,
      interiorWalls: design.interiorWalls || [],
      wallColor: design.wallColor || C.WALL_DEFAULT_COLOR,
      exteriorWallColor: design.exteriorWallColor || '',
      ceiling: state.ceilingVisible
    });
  }

  function sync(design, selection) {
    if (!state.initialized) return;
    state.design = design || null;
    state.selection = selection || null;
    if (state.mode === 'first' && !canWalk()) {
      setMode('orbit');
      if (typeof App.onWalkBlocked === 'function') App.onWalkBlocked();
    }
    if (!design) {
      clearGroup(state.roomGroup);
      clearGroup(state.ceilingGroup);
      while (state.furnitureGroup.children.length) state.furnitureGroup.remove(state.furnitureGroup.children[0]);
      state.itemNodes.clear();
      state.wallGroups = [];
      state.floorMesh = null;
      state.appliedFloor = null;
      state.selectedId = null;
      state.highlight.visible = false;
      notifyStatus();
      renderOnce();
      return;
    }
    const signature = roomSignatureFor(design);
    if (signature !== state.roomSignature) {
      buildRoom(design);
      state.roomSignature = signature;
    }
    syncFurniture(design);
    applyFloor(design);
    updateSelection(design);
    notifyStatus();
    renderOnce();
  }

  function resolveFloorTexture(key) {
    if (state.floorTextureCache.has(key)) return state.floorTextureCache.get(key);
    const promise = App.Storage.getAsset(key).then(function (record) {
      if (!record || !record.blob) return null;
      return new Promise(function (resolve) {
        const url = URL.createObjectURL(record.blob);
        const image = new Image();
        image.onload = function () {
          const texture = new THREE.Texture(image);
          texture.userData.keep = true;
          texture.needsUpdate = true;
          URL.revokeObjectURL(url);
          resolve(texture);
        };
        image.onerror = function () {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        image.src = url;
      });
    }).catch(function (err) {
      console.warn('Floor texture could not be loaded:', err);
      return null;
    });
    state.floorTextureCache.set(key, promise);
    return promise;
  }

  function applyFloor(design) {
    const floor = design.floor;
    const mesh = state.floorMesh;
    if (!mesh || !floor) return;
    const signature = JSON.stringify(floor);
    if (state.appliedFloor === signature) return;
    state.appliedFloor = signature;
    const mat = mesh.material;
    if (floor.mode !== 'texture' || !floor.textureKey) {
      mat.map = null;
      mat.color.set(floor.color || C.FLOOR_DEFAULT_COLOR);
      mat.polygonOffset = false;
      mat.needsUpdate = true;
      renderOnce();
      return;
    }
    resolveFloorTexture(floor.textureKey).then(function (texture) {
      if (state.appliedFloor !== signature) return;
      if (!texture) {
        mat.map = null;
        mat.color.set(floor.color || C.FLOOR_DEFAULT_COLOR);
        mat.needsUpdate = true;
        renderOnce();
        return;
      }
      const size = G.roomSize(design.room);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      texture.repeat.set(Math.max(0.01, size.width * CM / floor.textureScale), Math.max(0.01, size.length * CM / floor.textureScale));
      texture.anisotropy = state.renderer ? Math.min(8, state.renderer.capabilities.getMaxAnisotropy()) : 1;
      mat.map = texture;
      mat.color.set(0xffffff);
      mat.polygonOffset = true;
      mat.polygonOffsetFactor = 1;
      mat.polygonOffsetUnits = 2;
      mat.needsUpdate = true;
      renderOnce();
    });
  }

  function disposeObject(object) {
    if (!object) return;
    object.traverse(function (child) {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach(function (mat) {
          if (!mat) return;
          Object.keys(mat).forEach(function (key) {
            const value = mat[key];
            if (value && value.isTexture && !(value.userData && value.userData.keep)) value.dispose();
          });
          mat.dispose();
        });
      }
    });
  }

  function clearGroup(group) {
    if (!group) return;
    while (group.children.length) {
      const child = group.children[0];
      group.remove(child);
      disposeObject(child);
    }
  }

  function addBox(parent, width, height, depth, x, y, z, material, cast, receive) {
    const geo = new THREE.BoxGeometry(Math.max(0.001, width), Math.max(0.001, height), Math.max(0.001, depth));
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast !== false;
    mesh.receiveShadow = receive !== false;
    parent.add(mesh);
    return mesh;
  }

  function wallMaterial(color) {
    return new THREE.MeshStandardMaterial({ color: color || MATERIAL_COLORS.wall, roughness: 0.92, metalness: 0.0 });
  }

  /* Perimeter walls are one box with six faces: local +z looks into the room
     and local -z looks outside, so the outside can carry its own paint. The
     narrow end faces and the top read as exterior so a house seen from above
     stays one colour. */
  function wallMaterialPair(interiorColor, exteriorColor) {
    const inside = wallMaterial(interiorColor);
    const outside = wallMaterial(exteriorColor || interiorColor);
    return [inside, inside, outside, outside, inside, outside];
  }

  function designWallColor(design) {
    return (design && design.wallColor) || C.WALL_DEFAULT_COLOR || MATERIAL_COLORS.wall;
  }

  function wallTopColor(color) {
    return U.mixColor(color || C.WALL_DEFAULT_COLOR || '#f2f0ea', '#000000', 0.08);
  }

  function buildRoom(design) {
    clearGroup(state.roomGroup);
    clearGroup(state.ceilingGroup);
    state.wallGroups = [];
    state.floorMesh = null;
    state.appliedFloor = null;
    state.roomSignature = roomSignatureFor(design);
    const room = design.room;
    const size = G.roomSize(room);
    const widthM = size.width * CM;
    const lengthM = size.length * CM;
    const heightM = room.heightCm * CM;
    const wallColor = designWallColor(design);
    const exteriorColor = design.exteriorWallColor || wallColor;
    const floorMat = new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.floor, roughness: 0.82, metalness: 0.02 });
    const ceilMat = new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.ceiling, roughness: 0.96, side: THREE.DoubleSide });

    if (G.isCircle(room)) {
      buildCircularRoom(room, widthM, heightM, floorMat, ceilMat, wallColor);
    } else {
      const bleed = C.WALL_THICKNESS_CM * CM;
      const floorGeo = new THREE.PlaneGeometry(widthM + bleed, lengthM + bleed);
      const floor = new THREE.Mesh(floorGeo, floorMat);
      floor.rotation.x = -Math.PI / 2;
      floor.receiveShadow = true;
      floor.name = 'Room floor';
      state.floorMesh = floor;
      state.roomGroup.add(floor);
      const walls = G.getWalls(room);
      const mat = wallMaterial(wallColor);
      const wallMats = wallMaterialPair(wallColor, exteriorColor);
      walls.forEach(function (wall) {
        const group = buildRectWall(design, wall, heightM, mat, wallMats);
        if (group) state.roomGroup.add(group);
      });
      (design.interiorWalls || []).forEach(function (wall) {
        const group = buildInteriorWall(design, wall, mat);
        if (group) state.roomGroup.add(group);
      });
      const ceilingGeo = new THREE.PlaneGeometry(widthM + bleed, lengthM + bleed);
      const ceiling = new THREE.Mesh(ceilingGeo, ceilMat);
      ceiling.rotation.x = Math.PI / 2;
      ceiling.position.y = heightM - 0.003;
      ceiling.name = 'Ceiling';
      state.ceilingGroup.add(ceiling);
    }
    fitSunToRoom(widthM, lengthM, heightM);
    applyCeilingVisibility();
    updateCutaway();
  }

  function buildCircularRoom(room, diameterM, heightM, floorMat, ceilMat, wallColor) {
    const radius = diameterM / 2;
    const floorGeo = new THREE.CircleGeometry(radius, 96);
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    floor.name = 'Circular room floor';
    state.floorMesh = floor;
    state.roomGroup.add(floor);

    const wallGeo = new THREE.CylinderGeometry(radius, radius, heightM, 96, 1, true);
    const wallMat = new THREE.MeshStandardMaterial({
      color: wallColor || MATERIAL_COLORS.wall, roughness: 0.92, side: THREE.BackSide
    });
    const wall = new THREE.Mesh(wallGeo, wallMat);
    wall.position.y = heightM / 2;
    wall.receiveShadow = true;
    wall.name = 'Circular wall';
    state.roomGroup.add(wall);
    const rimGeo = new THREE.TorusGeometry(radius, 0.055, 8, 96);
    const rimMat = new THREE.MeshStandardMaterial({ color: wallTopColor(wallColor), roughness: 0.9 });
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.rotation.x = Math.PI / 2;
    rim.position.y = heightM;
    rim.castShadow = false;
    state.roomGroup.add(rim);

    const ceilingGeo = new THREE.CircleGeometry(radius, 96);
    const ceiling = new THREE.Mesh(ceilingGeo, ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = heightM;
    ceiling.name = 'Ceiling';
    state.ceilingGroup.add(ceiling);
  }

  function buildRectWall(design, wall, heightM, material, wallMaterials) {
    const wallGroup = new THREE.Group();
    const thickness = C.WALL_THICKNESS_CM * CM;
    const lengthM = wall.lengthCm * CM;
    const startX = (wall.start.x - G.roomCenter(design.room).x) * CM;
    const startZ = (wall.start.z - G.roomCenter(design.room).z) * CM;
    const dirX = wall.dir.x;
    const dirZ = wall.dir.z;
    const midX = startX + dirX * lengthM / 2;
    const midZ = startZ + dirZ * lengthM / 2;
    wallGroup.position.set(midX, 0, midZ);
    wallGroup.rotation.y = Math.atan2(-dirZ, dirX);
    const center = new THREE.Vector3(midX, 0, midZ);
    wallGroup.userData.wall = wall;
    wallGroup.name = wall.label;

    const openings = (design.structuralItems || []).filter(function (item) {
      return item.wall === wall.id;
    }).map(function (item) {
      const widthM = Math.min(item.widthCm, wall.lengthCm) * CM;
      const offsetM = item.offsetCm * CM;
      const left = U.clamp(offsetM - widthM / 2, 0, lengthM);
      const right = U.clamp(offsetM + widthM / 2, 0, lengthM);
      const sill = item.type === 'door' ? 0 : U.clamp(item.sillCm * CM, 0, Math.max(0, heightM - 0.1));
      const top = Math.min(heightM, sill + item.heightCm * CM);
      return {
        item: item,
        left: left,
        right: right,
        sill: sill,
        top: top,
        type: item.type
      };
    }).filter(function (opening) {
      return opening.right - opening.left > 0.08 && opening.top - opening.sill > 0.08;
    }).sort(function (a, b) { return a.left - b.left; });

    const zCenter = -thickness / 2;
    const skin = wallMaterials || material;
    let cursor = 0;
    openings.forEach(function (opening) {
      if (opening.left > cursor + 0.001) {
        addBox(wallGroup, opening.left - cursor, heightM, thickness,
          (cursor + opening.left) / 2 - lengthM / 2, heightM / 2, zCenter, skin);
      }
      if (opening.sill > 0.001) {
        addBox(wallGroup, opening.right - opening.left, opening.sill, thickness,
          (opening.left + opening.right) / 2 - lengthM / 2, opening.sill / 2, zCenter, skin);
      }
      if (opening.top < heightM - 0.001) {
        addBox(wallGroup, opening.right - opening.left, heightM - opening.top, thickness,
          (opening.left + opening.right) / 2 - lengthM / 2, opening.top + (heightM - opening.top) / 2, zCenter, skin);
      }
      if (opening.type === 'door') addDoorDetail(wallGroup, opening, thickness, heightM, lengthM);
      else addWindowDetail(wallGroup, opening, thickness, heightM, lengthM);
      cursor = Math.max(cursor, opening.right);
    });
    if (cursor < lengthM - 0.001) {
      addBox(wallGroup, lengthM - cursor, heightM, thickness,
        (cursor + lengthM) / 2 - lengthM / 2, heightM / 2, zCenter, skin);
    }
    addBox(wallGroup, lengthM, 0.035, thickness + 0.01, 0, 0.0175, zCenter,
      new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.trim, roughness: 0.85 }), false, true);

    state.wallGroups.push({
      group: wallGroup,
      center: center,
      outward: { x: wall.outward.x, z: wall.outward.z },
      hidden: false
    });
    return wallGroup;
  }

  function buildInteriorWall(design, wall, material) {
    const room = design.room;
    const lengthCm = G.interiorWallLength(wall);
    if (!(lengthCm > 20)) return null;
    const center = G.roomCenter(room);
    const dir = G.interiorWallDir(wall);
    const mid = G.interiorWallPoint(wall, lengthCm / 2);
    const lengthM = lengthCm * CM;
    const thickness = U.clamp(U.toNumber(wall.thicknessCm, C.WALL_THICKNESS_CM), 6, 40) * CM;
    const heightM = Math.max(0.1, Math.min(room.heightCm, U.toNumber(wall.heightCm, room.heightCm)) * CM);
    const midX = (mid.x - center.x) * CM;
    const midZ = (mid.z - center.z) * CM;
    const group = new THREE.Group();
    group.position.set(midX, 0, midZ);
    group.rotation.y = Math.atan2(-dir.z, dir.x);
    group.name = 'Partition wall';
    group.userData.wall = wall;

    const trimMat = new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.trim, roughness: 0.85 });
    const topMat = new THREE.MeshStandardMaterial({ color: wallTopColor(designWallColor(design)), roughness: 0.9 });
    const frameMat = new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.trim, roughness: 0.8 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: MATERIAL_COLORS.glass, transparent: true, opacity: 0.3, roughness: 0.08,
      metalness: 0.05, depthWrite: false, side: THREE.DoubleSide
    });

    const openings = G.interiorWallOpenings(wall).map(function (opening) {
      const widthM = Math.max(0.2, U.toNumber(opening.widthCm, 90) * CM);
      const offsetM = U.toNumber(opening.offsetCm, lengthCm / 2) * CM;
      const left = U.clamp(offsetM - widthM / 2, 0, lengthM);
      const right = U.clamp(offsetM + widthM / 2, 0, lengthM);
      const sill = opening.type === 'door' ? 0 : U.clamp(U.toNumber(opening.sillCm, 90) * CM, 0, Math.max(0, heightM - 0.1));
      const top = Math.min(heightM, sill + Math.max(0.3, U.toNumber(opening.heightCm, 210) * CM));
      return { opening: opening, left: left, right: right, sill: sill, top: top };
    }).filter(function (opening) {
      return opening.right - opening.left > 0.08 && opening.top - opening.sill > 0.08;
    }).sort(function (a, b) { return a.left - b.left; });

    function segment(width, height, xCenter, yCenter) {
      addBox(group, width, height, thickness, xCenter, yCenter, 0, material);
    }

    let cursor = 0;
    openings.forEach(function (opening) {
      if (opening.left > cursor + 0.001) {
        const width = opening.left - cursor;
        const xCenter = (cursor + opening.left) / 2 - lengthM / 2;
        segment(width, heightM, xCenter, heightM / 2);
        addBox(group, width, 0.035, thickness + 0.01, xCenter, 0.0175, 0, trimMat, false, true);
      }
      const width = opening.right - opening.left;
      const xCenter = (opening.left + opening.right) / 2 - lengthM / 2;
      if (opening.sill > 0.001) {
        segment(width, opening.sill, xCenter, opening.sill / 2);
      }
      if (opening.top < heightM - 0.001) {
        segment(width, heightM - opening.top, xCenter, opening.top + (heightM - opening.top) / 2);
      }
      const jamb = 0.05;
      addBox(group, jamb, opening.top - opening.sill, thickness + 0.02, xCenter - width / 2 + jamb / 2, opening.sill + (opening.top - opening.sill) / 2, 0, frameMat);
      addBox(group, jamb, opening.top - opening.sill, thickness + 0.02, xCenter + width / 2 - jamb / 2, opening.sill + (opening.top - opening.sill) / 2, 0, frameMat);
      addBox(group, width, jamb, thickness + 0.02, xCenter, opening.top - jamb / 2, 0, frameMat);
      if (opening.opening.type === 'window') {
        addBox(group, width, jamb, thickness + 0.02, xCenter, opening.sill + jamb / 2, 0, frameMat);
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.05, width - jamb * 2), Math.max(0.05, opening.top - opening.sill - jamb * 2)), glassMat);
        glass.position.set(xCenter, opening.sill + (opening.top - opening.sill) / 2, 0);
        glass.receiveShadow = false;
        group.add(glass);
      } else {
        const threshold = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.1, width - jamb), 0.015, thickness + 0.04), trimMat);
        threshold.position.set(xCenter, 0.0075, 0);
        threshold.receiveShadow = true;
        group.add(threshold);
      }
      cursor = Math.max(cursor, opening.right);
    });
    if (cursor < lengthM - 0.001) {
      const width = lengthM - cursor;
      const xCenter = (cursor + lengthM) / 2 - lengthM / 2;
      segment(width, heightM, xCenter, heightM / 2);
      addBox(group, width, 0.035, thickness + 0.01, xCenter, 0.0175, 0, trimMat, false, true);
    }
    addBox(group, lengthM, 0.028, thickness + 0.01, 0, heightM - 0.014, 0, topMat, false, true);

    group.traverse(function (child) {
      if (child.isMesh) child.userData.interiorWallId = wall.id;
    });

    const outwardBase = { x: -dir.z, z: dir.x };
    const sign = (midX * outwardBase.x + midZ * outwardBase.z) >= 0 ? 1 : -1;
    state.wallGroups.push({
      group: group,
      center: new THREE.Vector3(midX, 0, midZ),
      outward: { x: outwardBase.x * sign, z: outwardBase.z * sign },
      hidden: false,
      interior: true
    });
    return group;
  }

  function tagStructural(object, opening) {
    object.userData.structuralId = opening.item.id;
    return object;
  }

  function addDoorDetail(wallGroup, opening, thickness, heightM, lengthM) {
    const frameMat = new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.trim, roughness: 0.8 });
    const doorMat = new THREE.MeshStandardMaterial({ color: MATERIAL_COLORS.door, roughness: 0.62, metalness: 0.03 });
    const panelMat = new THREE.MeshStandardMaterial({ color: darker(MATERIAL_COLORS.door, 0.2), roughness: 0.58, metalness: 0.03 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: MATERIAL_COLORS.glass, transparent: true, opacity: 0.3, roughness: 0.08,
      metalness: 0.05, depthWrite: false, side: THREE.DoubleSide
    });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x8b8b83, metalness: 0.75, roughness: 0.28 });
    const styles = C.STRUCTURAL.DOOR_STYLES;
    const style = styles[opening.item.style] ? opening.item.style : C.STRUCTURAL.DEFAULT_DOOR_STYLE;
    const frame = 0.055;
    const xCenter = (opening.left + opening.right) / 2 - lengthM / 2;
    const width = opening.right - opening.left;
    const height = opening.top - opening.sill;
    const zCenter = -thickness / 2;

    tagStructural(addBox(wallGroup, frame, height, thickness + 0.02, xCenter - width / 2 + frame / 2, opening.sill + height / 2, zCenter, frameMat), opening);
    tagStructural(addBox(wallGroup, frame, height, thickness + 0.02, xCenter + width / 2 - frame / 2, opening.sill + height / 2, zCenter, frameMat), opening);
    tagStructural(addBox(wallGroup, width, frame, thickness + 0.02, xCenter, opening.top - frame / 2, zCenter, frameMat), opening);

    function makeLeaf(w, h, dir) {
      const lw = Math.max(0.1, w);
      const lh = Math.max(0.1, h);
      const leafGeo = new THREE.BoxGeometry(lw, lh, 0.038);
      leafGeo.translate(dir * lw / 2, lh / 2, 0);
      const leaf = new THREE.Mesh(leafGeo, doorMat);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      tagStructural(leaf, opening);
      return leaf;
    }
    function addHandle(parent, x, leafH) {
      const handle = new THREE.Mesh(new THREE.SphereGeometry(0.028, 12, 10), metalMat);
      handle.position.set(x, Math.min(1.0, Math.max(0.35, leafH * 0.52)), 0.05);
      handle.castShadow = true;
      tagStructural(handle, opening);
      parent.add(handle);
    }
    function addGlazedPanel(parent, w, h, cx, cy) {
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.05, w), Math.max(0.05, h)), glassMat);
      glass.position.set(cx, cy, 0.022);
      tagStructural(glass, opening);
      parent.add(glass);
    }
    function addRecessedPanel(parent, w, h, cx, cy) {
      const panel = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.05, w), Math.max(0.05, h), 0.012), panelMat);
      panel.position.set(cx, cy, 0.02);
      panel.castShadow = false;
      panel.receiveShadow = true;
      tagStructural(panel, opening);
      parent.add(panel);
    }

    if (style === 'double') {
      const leafW = (width - frame * 2) / 2 - 0.006;
      const leafH = height - frame * 2 - 0.01;
      const leftHinge = new THREE.Group();
      leftHinge.position.set(xCenter - width / 2 + frame, opening.sill + frame / 2, zCenter);
      leftHinge.add(makeLeaf(leafW, leafH, 1));
      addHandle(leftHinge, leafW - 0.09, leafH);
      leftHinge.rotation.y = -0.22;
      tagStructural(leftHinge, opening);
      const rightHinge = new THREE.Group();
      rightHinge.position.set(xCenter + width / 2 - frame, opening.sill + frame / 2, zCenter);
      rightHinge.add(makeLeaf(leafW, leafH, -1));
      addHandle(rightHinge, -(leafW - 0.09), leafH);
      rightHinge.rotation.y = 0.22;
      tagStructural(rightHinge, opening);
      wallGroup.add(leftHinge);
      wallGroup.add(rightHinge);
      return;
    }

    if (style === 'sliding') {
      tagStructural(addBox(wallGroup, width, 0.05, thickness + 0.03, xCenter, opening.top - frame - 0.01, zCenter, frameMat), opening);
      const leafW = Math.max(0.1, width - frame * 2 - 0.012);
      const leafH = Math.max(0.1, height - frame * 2 - 0.06);
      const slider = new THREE.Group();
      slider.position.set(xCenter - width / 2 + frame - leafW * 0.28, opening.sill + frame / 2 + 0.03, zCenter);
      slider.add(makeLeaf(leafW, leafH, 1));
      addHandle(slider, leafW - 0.08, leafH);
      tagStructural(slider, opening);
      wallGroup.add(slider);
      return;
    }

    const leafW = Math.max(0.1, width - frame * 2 - 0.012);
    const leafH = Math.max(0.1, height - frame * 2 - 0.01);
    const hinge = new THREE.Group();
    hinge.position.set(xCenter - width / 2 + frame, opening.sill + frame / 2, zCenter);
    hinge.add(makeLeaf(leafW, leafH, 1));
    addHandle(hinge, leafW - 0.09, leafH);
    if (style === 'glazed') {
      addGlazedPanel(hinge, leafW * 0.68, leafH * 0.56, leafW / 2, leafH * 0.58);
      addRecessedPanel(hinge, leafW * 0.68, leafH * 0.24, leafW / 2, leafH * 0.15);
      hinge.rotation.y = -0.25;
    } else if (style === 'panel') {
      addRecessedPanel(hinge, leafW * 0.64, leafH * 0.32, leafW / 2, leafH * 0.68);
      addRecessedPanel(hinge, leafW * 0.64, leafH * 0.34, leafW / 2, leafH * 0.28);
      hinge.rotation.y = 0;
    } else {
      hinge.rotation.y = -0.42;
    }
    tagStructural(hinge, opening);
    wallGroup.add(hinge);
  }

  function addWindowDetail(wallGroup, opening, thickness, heightM, lengthM) {
    const frameMat = new THREE.MeshStandardMaterial({ color: 0xf8f7f3, roughness: 0.55, metalness: 0.04 });
    const sashMat = new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.5, metalness: 0.04 });
    const glassMat = new THREE.MeshStandardMaterial({
      color: MATERIAL_COLORS.glass,
      transparent: true,
      opacity: 0.32,
      roughness: 0.08,
      metalness: 0.05,
      depthWrite: false,
      side: THREE.DoubleSide
    });
    const metalMat = new THREE.MeshStandardMaterial({ color: 0x9a9a92, metalness: 0.7, roughness: 0.3 });
    const styles = C.STRUCTURAL.WINDOW_STYLES;
    const style = styles[opening.item.style] ? opening.item.style : C.STRUCTURAL.DEFAULT_WINDOW_STYLE;
    const frame = style === 'panoramic' ? 0.035 : 0.05;
    const width = opening.right - opening.left;
    const height = opening.top - opening.sill;
    const xCenter = (opening.left + opening.right) / 2 - lengthM / 2;
    const yCenter = opening.sill + height / 2;
    const zCenter = -thickness / 2;

    tagStructural(addBox(wallGroup, frame, height, thickness + 0.02, xCenter - width / 2 + frame / 2, yCenter, zCenter, frameMat), opening);
    tagStructural(addBox(wallGroup, frame, height, thickness + 0.02, xCenter + width / 2 - frame / 2, yCenter, zCenter, frameMat), opening);
    tagStructural(addBox(wallGroup, width, frame, thickness + 0.02, xCenter, opening.top - frame / 2, zCenter, frameMat), opening);
    tagStructural(addBox(wallGroup, width, frame, thickness + 0.02, xCenter, opening.sill + frame / 2, zCenter, frameMat), opening);

    const glass = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.05, width - frame * 2), Math.max(0.05, height - frame * 2)), glassMat);
    glass.position.set(xCenter, yCenter, zCenter);
    tagStructural(glass, opening);
    wallGroup.add(glass);

    function vMullion(x, w) {
      tagStructural(addBox(wallGroup, w || 0.028, height - frame * 2, 0.045, x, yCenter, zCenter, sashMat, false, false), opening);
    }
    function hRail(y, h) {
      tagStructural(addBox(wallGroup, width - frame * 2, h || 0.03, 0.045, xCenter, y, zCenter, sashMat, false, false), opening);
    }

    if (style === 'sliding') {
      vMullion(xCenter, 0.05);
      hRail(yCenter + height * 0.18, 0.026);
      hRail(yCenter - height * 0.22, 0.026);
      tagStructural(addBox(wallGroup, 0.03, 0.14, 0.06, xCenter + 0.07, yCenter, zCenter + 0.02, metalMat, false, false), opening);
    } else if (style === 'casement') {
      vMullion(xCenter, 0.05);
      tagStructural(addBox(wallGroup, 0.025, 0.12, 0.055, xCenter - 0.08, yCenter, zCenter, metalMat, false, false), opening);
      tagStructural(addBox(wallGroup, 0.025, 0.12, 0.055, xCenter + 0.08, yCenter, zCenter, metalMat, false, false), opening);
    } else if (style === 'double') {
      hRail(yCenter, 0.05);
      vMullion(xCenter, 0.026);
    } else if (style === 'panoramic') {
      const count = width > 1.8 ? 3 : 2;
      for (let i = 1; i <= count; i++) {
        const x = xCenter - (width - frame * 2) / 2 + (width - frame * 2) * (i / (count + 1));
        vMullion(x, 0.022);
      }
    }

    tagStructural(addBox(wallGroup, 0.16, 0.025, 0.19, xCenter, opening.sill + 0.012, zCenter + 0.085, frameMat, false, false), opening);
  }

  function fitSunToRoom(widthM, lengthM, heightM) {
    if (!state._sun) return;
    const extent = Math.max(widthM, lengthM, heightM, 4);
    state._sun.position.set(extent * 0.65, Math.max(6, extent * 1.65), extent * 0.55);
    const shadowCam = state._sun.shadow.camera;
    shadowCam.left = -extent;
    shadowCam.right = extent;
    shadowCam.top = extent;
    shadowCam.bottom = -extent;
    shadowCam.far = extent * 6;
    shadowCam.updateProjectionMatrix();
  }

  function applyCeilingVisibility() {
    state.ceilingGroup.visible = state.ceilingVisible;
  }

  function setCeiling(visible) {
    state.ceilingVisible = !!visible;
    applyCeilingVisibility();
    notifyStatus();
    renderOnce();
  }

  function setCutaway(enabled) {
    state.cutaway = !!enabled;
    updateCutaway();
    notifyStatus();
    renderOnce();
  }

  function getCeiling() { return state.ceilingVisible; }
  function getCutaway() { return state.cutaway; }

  function syncFurniture(design) {
    const seen = new Set();
    design.placedItems.forEach(function (item) {
      seen.add(item.id);
      let node = state.itemNodes.get(item.id);
      const product = App.Catalog.getProduct(item.productId);
      if (!product) {
        if (node) removeFurnitureNode(item.id);
        return;
      }
      const signature = item.productId + '|' + (item.variantId || '') + '|' + (product.assets.glb ? product.assets.glb.key : '');
      if (!node || node.signature !== signature) {
        if (node) removeFurnitureNode(item.id);
        node = createFurnitureNode(item, product, signature);
        state.itemNodes.set(item.id, node);
        state.furnitureGroup.add(node.group);
      }
      const center = G.roomCenter(design.room);
      node.group.position.set((item.xCm - center.x) * CM, 0, (item.zCm - center.z) * CM);
      node.group.rotation.y = -U.degToRad(item.rotationDeg);
      node.group.userData.placedInstanceId = item.id;
      node.item = item;
    });
    Array.from(state.itemNodes.keys()).forEach(function (id) {
      if (!seen.has(id)) removeFurnitureNode(id);
    });
  }

  function removeFurnitureNode(id) {
    const node = state.itemNodes.get(id);
    if (!node) return;
    state.furnitureGroup.remove(node.group);
    if (node.ownsGeometry) disposeObject(node.group);
    state.itemNodes.delete(id);
  }

  function createFurnitureNode(item, product, signature) {
    const group = new THREE.Group();
    group.name = product.name;
    group.userData.placedInstanceId = item.id;
    const color = App.Catalog.colorFor(product, item.variantId);
    const starter = starterModel(product, color);
    group.add(starter);
    const node = {
      group: group,
      item: item,
      product: product,
      productId: product.id,
      signature: signature,
      modelKind: App.Catalog.usesFallback(product) ? 'placeholder' : 'procedural',
      ownsGeometry: true,
      expectsGlb: !!(product.assets && product.assets.glb && product.assets.glb.key),
      loadToken: 0
    };
    if (node.expectsGlb) scheduleGlb(node);
    return node;
  }

  function scheduleGlb(node) {
    const ref = node.product.assets.glb;
    if (!ref || !ref.key) return;
    const loadedCount = Array.from(state.itemNodes.values()).filter(function (n) { return n.modelKind === 'glb'; }).length;
    const loadedProductKeys = new Set(Array.from(state.itemNodes.values())
      .filter(function (n) { return n.modelKind === 'glb'; })
      .map(function (n) { return n.product.assets.glb ? n.product.assets.glb.key : ''; }));
    const wouldBeNew = !loadedProductKeys.has(ref.key);
    if (wouldBeNew && loadedProductKeys.size >= C.LIMITS.MAX_GLB_MODELS) {
      node.errorMessage = 'GLB model limit reached (' + C.LIMITS.MAX_GLB_MODELS + ' distinct models). "' + node.product.name + '" uses a labeled procedural preview.';
      notifyStatus();
      return;
    }
    node.loadToken++;
    const token = node.loadToken;
    state.loadingGlb++;
    notifyStatus();
    loadProductGLB(node.product).then(function (template) {
      state.loadingGlb = Math.max(0, state.loadingGlb - 1);
      const current = state.itemNodes.get(node.item.id);
      if (!current || current.loadToken !== token) { notifyStatus(); return; }
      const clone = template.holder.clone(true);
      clone.traverse(function (child) {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          child.userData.placedInstanceId = current.item.id;
        }
      });
      const fallback = current.group.children[0];
      if (fallback) {
        current.group.remove(fallback);
        disposeObject(fallback);
      }
      current.group.add(clone);
      current.modelKind = 'glb';
      current.ownsGeometry = false;
      current.mismatchMessage = template.mismatchMessage || null;
      current.errorMessage = null;
      state.furnitureGroup.updateMatrixWorld(true);
      updateSelection(state.design);
      notifyStatus();
      renderOnce();
    }).catch(function (err) {
      state.loadingGlb = Math.max(0, state.loadingGlb - 1);
      const message = 'The GLB model for "' + node.product.name + '" could not be loaded. A named placeholder is shown instead.';
      console.warn('GLB load failed for ' + node.product.id + ':', err);
      const current = state.itemNodes.get(node.item.id);
      if (current) {
        current.glbFailed = true;
        current.errorMessage = message;
      }
      notifyStatus();
    });
  }

  function normalizeLoadedModel(root, product) {
    root.rotation.y += U.degToRad(Number(product.modelRotationDeg) || 0);
    root.updateMatrixWorld(true);
    const bbox = new THREE.Box3().setFromObject(root);
    if (bbox.isEmpty()) throw new Error('The GLB model contains no visible geometry.');
    const size = bbox.getSize(new THREE.Vector3());
    if (size.x <= 0 || size.y <= 0 || size.z <= 0) throw new Error('The GLB model has invalid bounds.');
    const targetWidth = Math.max(0.01, product.widthCm * CM);
    const targetDepth = Math.max(0.01, product.lengthCm * CM);
    const targetHeight = Math.max(0.01, product.heightCm * CM);
    const scale = Math.min(targetWidth / size.x, targetDepth / size.z, targetHeight / size.y);
    if (!Number.isFinite(scale) || scale <= 0) throw new Error('The GLB model could not be scaled correctly.');
    const center = bbox.getCenter(new THREE.Vector3());
    root.position.x -= center.x;
    root.position.z -= center.z;
    root.position.y -= bbox.min.y;
    const holder = new THREE.Group();
    holder.add(root);
    if (product.category === 'rug') holder.position.y = 0.012;
    holder.scale.setScalar(scale);
    const measured = {
      width: size.x * scale,
      height: size.y * scale,
      depth: size.z * scale
    };
    const deviations = {
      width: Math.abs(measured.width - targetWidth) / targetWidth * 100,
      depth: Math.abs(measured.depth - targetDepth) / targetDepth * 100,
      height: Math.abs(measured.height - targetHeight) / targetHeight * 100
    };
    const worst = Math.max(deviations.width, deviations.depth, deviations.height);
    let mismatchMessage = null;
    if (worst > 12) {
      mismatchMessage = '"' + product.name + '" GLB proportions differ from the catalog dimensions by up to ' + Math.round(worst) + '%. The model was fitted uniformly to avoid distortion.';
    }
    return {
      holder: holder,
      measured: measured,
      deviations: deviations,
      mismatchMessage: mismatchMessage
    };
  }

  function loadProductGLB(product) {
    const ref = product.assets.glb;
    const key = ref && ref.key;
    if (!key) return Promise.reject(new Error('No GLB asset is attached to this product.'));
    if (state.glbCache.has(key)) return state.glbCache.get(key);
    const promise = App.Storage.getAsset(key).then(function (record) {
      if (!record || !record.blob) throw new Error('The stored GLB asset is missing.');
      return record.blob.arrayBuffer();
    }).then(function (buffer) {
      return new Promise(function (resolve, reject) {
        if (!THREE.GLTFLoader) { reject(new Error('The GLTF loader did not load.')); return; }
        const loader = new THREE.GLTFLoader();
        try {
          loader.parse(buffer, '', function (gltf) {
            try {
              const root = gltf.scene || (gltf.scenes && gltf.scenes[0]);
              if (!root) { reject(new Error('The GLB file has no scene.')); return; }
              resolve(normalizeLoadedModel(root, product));
            } catch (err) { reject(err); }
          }, function (err) { reject(err || new Error('The GLB file could not be parsed.')); });
        } catch (err) { reject(err); }
      });
    });
    state.glbCache.set(key, promise);
    return promise;
  }

  function materialFor(color, roughness, metalness) {
    return new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: roughness == null ? 0.72 : roughness,
      metalness: metalness == null ? 0.03 : metalness
    });
  }

  function lighter(color, amount) {
    const c = new THREE.Color(color);
    c.lerp(new THREE.Color(0xffffff), amount);
    return '#' + c.getHexString();
  }

  function darker(color, amount) {
    const c = new THREE.Color(color);
    c.lerp(new THREE.Color(0x000000), amount);
    return '#' + c.getHexString();
  }

  function roundedBoxGeometry(width, height, depth, radius, segments) {
    const w = Math.max(0.002, width);
    const h = Math.max(0.002, height);
    const d = Math.max(0.002, depth);
    const limit = Math.min(w, h, d) / 2;
    const r = Math.min(Math.max(0.0006, radius == null ? 0.02 : radius), limit * 0.96);
    const seg = Math.max(1, segments || 4);
    const geo = new THREE.BoxGeometry(w, h, d, seg, seg, seg);
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const hx = w / 2 - r;
    const hy = h / 2 - r;
    const hz = d / 2 - r;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const cx = U.clamp(x, -hx, hx);
      const cy = U.clamp(y, -hy, hy);
      const cz = U.clamp(z, -hz, hz);
      const dx = x - cx;
      const dy = y - cy;
      const dz = z - cz;
      const len = Math.hypot(dx, dy, dz);
      if (len < 1e-6) continue;
      pos.setXYZ(i, cx + (dx / len) * r, cy + (dy / len) * r, cz + (dz / len) * r);
      nor.setXYZ(i, dx / len, dy / len, dz / len);
    }
    pos.needsUpdate = true;
    nor.needsUpdate = true;
    geo.computeBoundingSphere();
    return geo;
  }

  /* Furniture parts are declared as extents so that adjacent surfaces always
     overlap or stand clear of each other. Two faces sharing a plane z-fight,
     which shows up as crawling speckles whenever the camera moves. */
  function addPart(parent, bounds, material, radius, segments, cast, receive) {
    const b = bounds;
    const width = Math.abs(b[3] - b[0]);
    const height = Math.abs(b[4] - b[1]);
    const depth = Math.abs(b[5] - b[2]);
    const mesh = new THREE.Mesh(roundedBoxGeometry(width, height, depth, radius, segments), material);
    mesh.position.set((b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2);
    mesh.castShadow = cast !== false;
    mesh.receiveShadow = receive !== false;
    parent.add(mesh);
    return mesh;
  }

  function addPeg(parent, radiusBottom, radiusTop, height, x, y, z, material, radial, cast) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.002, radiusTop), Math.max(0.002, radiusBottom), Math.max(0.002, height), Math.max(6, radial || 14)), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast !== false;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  function fabricMaterial(color) {
    return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.94, metalness: 0.0 });
  }

  function hashString(text) {
    let h = 2166136261;
    const str = String(text || '');
    for (let i = 0; i < str.length; i++) h = ((h ^ str.charCodeAt(i)) * 16777619) >>> 0;
    return h >>> 0;
  }

  /* Deterministic so a model looks identical every time it is rebuilt. */
  function makeRandom(seed) {
    let x = seed || 2463534242;
    return function () {
      x = (x * 1664525 + 1013904223) >>> 0;
      return x / 4294967296;
    };
  }

  function buildSofa(group, w, d, h, M) {
    const legH = 0.085;
    const seatTop = Math.min(h * 0.54, 0.47);
    const armW = U.clamp(w * 0.085, 0.13, 0.24);
    const armTop = Math.min(h - 0.03, seatTop + 0.26);
    const backT = U.clamp(d * 0.24, 0.15, 0.26);
    const inner0 = -w / 2 + armW;
    const inner1 = w / 2 - armW;
    const seatZ0 = -d / 2 + 0.022;
    const seatZ1 = d / 2 - backT + 0.014;
    const cushionCount = U.clamp(Math.round(w / 0.82), 1, 3);
    const gap = 0.016;
    const span = inner1 - inner0 - gap * (cushionCount - 1);
    const unit = span / cushionCount;
    addPart(group, [-w / 2 + 0.006, legH - 0.015, -d / 2 + 0.014, w / 2 - 0.006, seatTop - 0.02, d / 2 - 0.01], M.frame, 0.03, 3);
    addPart(group, [-w / 2, legH - 0.015, -d / 2 + 0.014, inner0 + 0.012, armTop, d / 2 - 0.012], M.body, 0.05, 4);
    addPart(group, [inner1 - 0.012, legH - 0.015, -d / 2 + 0.014, w / 2, armTop, d / 2 - 0.012], M.body, 0.05, 4);
    addPart(group, [-w / 2 + armW * 0.45, seatTop - 0.07, d / 2 - backT - 0.006, w / 2 - armW * 0.45, h, d / 2 - 0.004], M.body, 0.045, 4);
    for (let i = 0; i < cushionCount; i++) {
      const x0 = inner0 + gap / 2 + i * (unit + gap);
      addPart(group, [x0, seatTop - 0.2, seatZ0, x0 + unit, seatTop + 0.012, seatZ1], M.cushion, 0.05, 5);
      addPart(group, [x0, seatTop + 0.006, d / 2 - 0.038, x0 + unit, h - 0.02, d / 2 - backT + 0.03], M.cushion, 0.05, 5);
    }
    if (inner1 - inner0 > 1.05) {
      const pillow = addPart(group, [-0.18, -0.17, -0.06, 0.18, 0.17, 0.06], M.accent, 0.06, 5);
      pillow.position.set(inner0 + 0.28, seatTop + 0.14, d / 2 - backT - 0.13);
      pillow.rotation.set(-0.32, 0.16, 0.2);
      const pillow2 = addPart(group, [-0.17, -0.16, -0.055, 0.17, 0.16, 0.055], M.accent2, 0.06, 5);
      pillow2.position.set(inner1 - 0.29, seatTop + 0.13, d / 2 - backT - 0.16);
      pillow2.rotation.set(-0.3, -0.22, -0.16);
    }
    [[-w / 2 + 0.1, -d / 2 + 0.1], [w / 2 - 0.1, -d / 2 + 0.1], [-w / 2 + 0.1, d / 2 - 0.1], [w / 2 - 0.1, d / 2 - 0.1]].forEach(function (pos) {
      addPeg(group, 0.022, 0.03, legH + 0.02, pos[0], (legH + 0.02) / 2, pos[1], M.wood, 12);
    });
  }

  function buildWardrobe(group, w, d, h, M) {
    const plinthTop = 0.08;
    const sideT = 0.022;
    const doorZ1 = -d / 2 + 0.016;
    const doorZ0 = doorZ1 - 0.023;
    const doorY0 = plinthTop + 0.014;
    const doorY1 = h - 0.032;
    addPart(group, [-w / 2, 0, -d / 2 + 0.06, w / 2, plinthTop + 0.008, d / 2 - 0.012], M.plinth, 0.01, 3);
    addPart(group, [w / 2 - sideT, plinthTop - 0.006, -d / 2 + 0.01, w / 2, h - 0.004, d / 2 - 0.002], M.body, 0.008, 3);
    addPart(group, [-w / 2, plinthTop - 0.006, -d / 2 + 0.01, -w / 2 + sideT, h - 0.004, d / 2 - 0.002], M.body, 0.008, 3);
    addPart(group, [-w / 2 + sideT - 0.01, h - 0.026, -d / 2 + 0.014, w / 2 - sideT + 0.01, h - 0.006, d / 2 - 0.008], M.panel, 0.006, 3);
    addPart(group, [-w / 2 + sideT - 0.01, plinthTop, -d / 2 + 0.016, w / 2 - sideT + 0.01, plinthTop + 0.02, d / 2 - 0.01], M.panel, 0.006, 3);
    addPart(group, [-w / 2 + sideT - 0.008, plinthTop + 0.012, d / 2 - 0.02, w / 2 - sideT + 0.008, h - 0.014, d / 2 - 0.007], M.panel, 0.004, 2);
    const doorCount = w > 1.95 ? 4 : w >= 1.3 ? 3 : 2;
    const front0 = -w / 2 + 0.005;
    const front1 = w / 2 - 0.005;
    const doorGap = 0.007;
    const doorW = (front1 - front0 - doorGap * (doorCount - 1)) / doorCount;
    for (let i = 0; i < doorCount; i++) {
      const x0 = front0 + i * (doorW + doorGap);
      const x1 = x0 + doorW;
      const stileW = U.clamp(doorW * 0.14, 0.026, 0.05);
      const railH = 0.055;
      addPart(group, [x0, doorY0, doorZ0, x0 + stileW, doorY1, doorZ1], M.door, 0.006, 3);
      addPart(group, [x1 - stileW, doorY0, doorZ0, x1, doorY1, doorZ1], M.door, 0.006, 3);
      addPart(group, [x0 - 0.004, doorY1 - railH, doorZ0 - 0.0015, x1 + 0.004, doorY1, doorZ1], M.door, 0.006, 3);
      addPart(group, [x0 - 0.004, doorY0, doorZ0 - 0.0015, x1 + 0.004, doorY0 + railH, doorZ1], M.door, 0.006, 3);
      addPart(group, [x0 + stileW - 0.006, doorY0 + railH - 0.006, doorZ0 + 0.011, x1 - stileW + 0.006, doorY1 - railH + 0.006, doorZ1 + 0.005], M.panel, 0.004, 2);
      const handleH = U.clamp((doorY1 - doorY0) * 0.26, 0.14, 0.32);
      const handleY = doorY0 + (doorY1 - doorY0) * 0.48;
      function addHandle(edge) {
        addPeg(group, 0.011, 0.011, handleH, edge, handleY, doorZ0 - 0.017, M.metal, 10);
        addPart(group, [edge - 0.013, handleY - handleH / 2 - 0.013, doorZ0 - 0.012, edge + 0.013, handleY - handleH / 2, doorZ1], M.metal, 0.003, 2, false, false);
        addPart(group, [edge - 0.013, handleY + handleH / 2, doorZ0 - 0.012, edge + 0.013, handleY + handleH / 2 + 0.013, doorZ1], M.metal, 0.003, 2, false, false);
      }
      /* Handles sit in pairs either side of every door gap, the way a real
         cupboard is meant to be pulled open. */
      if (i > 0) addHandle(x0 + stileW + 0.026);
      if (i < doorCount - 1) addHandle(x1 - stileW - 0.026);
    }
    addPart(group, [-w / 2 - 0.014, h - 0.052, -d / 2 - 0.01, w / 2 + 0.014, h, d / 2 + 0.006], M.cornice, 0.012, 3);
  }

  function buildBed(group, w, d, h, M) {
    const legH = 0.11;
    const frameTop = 0.3;
    const mattressT = 0.23;
    const headH = Math.min(h, 1.15);
    addPart(group, [-w / 2, legH - 0.01, -d / 2, w / 2, frameTop, d / 2], M.frame, 0.02, 3);
    addPart(group, [-w / 2 + 0.035, frameTop - 0.02, -d / 2 + 0.04, w / 2 - 0.035, frameTop + mattressT, d / 2 - 0.03], M.sheet, 0.05, 5);
    addPart(group, [-w / 2 + 0.06, frameTop + mattressT - 0.05, -d / 2 + 0.07, w / 2 - 0.06, frameTop + mattressT - 0.01, d * 0.14], M.body, 0.045, 4);
    addPart(group, [-w / 2 + 0.09, frameTop + mattressT - 0.062, d * 0.12, w / 2 - 0.09, frameTop + mattressT + 0.004, d * 0.2], M.accent, 0.03, 4);
    addPart(group, [-w / 2 + 0.05, legH + 0.02, d / 2 - 0.1, w / 2 - 0.05, headH, d / 2 - 0.026], M.body, 0.035, 4);
    addPart(group, [-w / 2 + 0.02, legH - 0.01, d / 2 - 0.026, w / 2 - 0.02, headH * 0.5, d / 2 - 0.006], M.frame, 0.02, 3);
    const pillowW = Math.min(0.62, w * 0.3);
    [-1, 1].forEach(function (side) {
      const p = addPart(group, [-pillowW / 2, -0.065, -0.2, pillowW / 2, 0.065, 0.2], M.sheet, 0.055, 5);
      p.position.set(side * (pillowW * 0.62), frameTop + mattressT + 0.03, d * 0.27);
      p.rotation.set(-0.16, 0, side * 0.04);
    });
    [[-w / 2 + 0.08, -d / 2 + 0.08], [w / 2 - 0.08, -d / 2 + 0.08], [-w / 2 + 0.08, d / 2 - 0.08], [w / 2 - 0.08, d / 2 - 0.08]].forEach(function (pos) {
      addPeg(group, 0.026, 0.032, legH + 0.02, pos[0], (legH + 0.02) / 2, pos[1], M.wood, 12);
    });
  }

  function buildChair(group, w, d, h, M) {
    const seatH = Math.min(0.46, h * 0.56);
    const legR = Math.min(0.022, w * 0.05);
    const armT = 0.075;
    addPart(group, [-w / 2, seatH - armT - 0.01, -d / 2, w / 2, seatH - 0.005, d / 2 - 0.005], M.frame, 0.015, 3);
    addPart(group, [-w / 2 + 0.012, seatH - 0.02, -d / 2 + 0.012, w / 2 - 0.012, seatH + 0.06, d / 2 - 0.02], M.cushion, 0.03, 4);
    const backTop = h;
    addPart(group, [-w / 2 + 0.02, seatH + 0.02, d / 2 - 0.07, w / 2 - 0.02, backTop, d / 2 - 0.025], M.body, 0.028, 4);
    addPart(group, [-w / 2 + 0.05, seatH + 0.06, d / 2 - 0.09, w / 2 - 0.05, backTop - 0.03, d / 2 - 0.065], M.cushion, 0.022, 4);
    [[-w / 2 + legR * 2, -d / 2 + legR * 2], [w / 2 - legR * 2, -d / 2 + legR * 2], [-w / 2 + legR * 2, d / 2 - legR * 2], [w / 2 - legR * 2, d / 2 - legR * 2]].forEach(function (pos) {
      addPeg(group, legR * 0.7, legR, seatH - 0.005, pos[0], (seatH - 0.005) / 2, pos[1], M.wood, 10);
    });
  }

  function buildTable(group, w, d, h, M, rounded) {
    const topT = Math.min(0.05, h * 0.12);
    const apronH = Math.min(0.16, h * 0.2);
    const legR = Math.min(0.045, w * 0.05);
    addPart(group, [-w / 2, h - topT, -d / 2, w / 2, h, d / 2], M.body, rounded ? 0.012 : 0.02, 4);
    addPart(group, [-w / 2 + legR * 2.4, h - topT - apronH, -d / 2 + 0.03, w / 2 - legR * 2.4, h - topT + 0.012, -d / 2 + 0.055], M.frame, 0.008, 2);
    addPart(group, [-w / 2 + legR * 2.4, h - topT - apronH, d / 2 - 0.055, w / 2 - legR * 2.4, h - topT + 0.012, d / 2 - 0.03], M.frame, 0.008, 2);
    addPart(group, [-w / 2 + 0.03, h - topT - apronH, -d / 2 + legR * 2.4, -w / 2 + 0.055, h - topT + 0.012, d / 2 - legR * 2.4], M.frame, 0.008, 2);
    addPart(group, [w / 2 - 0.055, h - topT - apronH, -d / 2 + legR * 2.4, w / 2 - 0.03, h - topT + 0.012, d / 2 - legR * 2.4], M.frame, 0.008, 2);
    [[-w / 2 + legR * 2, -d / 2 + legR * 2], [w / 2 - legR * 2, -d / 2 + legR * 2], [-w / 2 + legR * 2, d / 2 - legR * 2], [w / 2 - legR * 2, d / 2 - legR * 2]].forEach(function (pos) {
      addPeg(group, legR * 0.68, legR, h - topT + 0.014, pos[0], (h - topT + 0.014) / 2, pos[1], M.wood, 12);
    });
  }

  function buildDesk(group, w, d, h, M) {
    const topT = 0.04;
    const panelT = 0.032;
    addPart(group, [-w / 2, h - topT, -d / 2, w / 2, h, d / 2], M.body, 0.012, 4);
    addPart(group, [-w / 2 + 0.02, 0.0, -d / 2 + 0.04, -w / 2 + 0.02 + panelT, h - topT + 0.008, d / 2 - 0.04], M.frame, 0.008, 2);
    addPart(group, [w / 2 - 0.02 - panelT, 0, -d / 2 + 0.04, w / 2 - 0.02, h - topT + 0.008, d / 2 - 0.04], M.frame, 0.008, 2);
    const drawerW = Math.min(w * 0.3, 0.5);
    const rows = 3;
    const stackH = (h - topT - 0.06) * 0.72;
    const rowH = stackH / rows;
    addPart(group, [w / 2 - 0.06 - drawerW, 0.02, -d * 0.32, w / 2 - 0.05, 0.02 + stackH, d * 0.32], M.frame, 0.01, 2);
    for (let r = 0; r < rows; r++) {
      const y0 = 0.03 + r * rowH;
      addPart(group, [w / 2 - 0.05 - drawerW + 0.006, y0, -d * 0.32 - 0.014, w / 2 - 0.056, y0 + rowH - 0.012, -d * 0.32 + 0.006], M.panel, 0.006, 3);
      addPeg(group, 0.009, 0.009, drawerW * 0.42, w / 2 - 0.053 - drawerW / 2, y0 + (rowH - 0.012) / 2, -d * 0.32 - 0.032, M.metal, 10).rotation.z = Math.PI / 2;
    }
    addPart(group, [-w / 2 + 0.08, h - topT - 0.005, d / 2 - 0.075, w / 2 - 0.08, h + Math.min(0.34, h * 0.16), d / 2 - 0.05], M.panel, 0.008, 2);
  }

  function buildShelf(group, w, d, h, M, seed) {
    const sideT = 0.026;
    const panelT = 0.022;
    addPart(group, [-w / 2, 0, -d / 2, -w / 2 + sideT, h, d / 2 - 0.004], M.body, 0.008, 3);
    addPart(group, [w / 2 - sideT, 0, -d / 2, w / 2, h, d / 2 - 0.004], M.body, 0.008, 3);
    const backT = 0.014;
    addPart(group, [-w / 2 + sideT - 0.006, 0.01, d / 2 - backT - 0.008, w / 2 - sideT + 0.006, h - 0.01, d / 2 - 0.006], M.panel, 0.003, 2);
    const levels = Math.max(3, Math.round(h / 0.38));
    const random = makeRandom(hashString(seed));
    const bookColors = [M.accent, M.accent2, M.frame, M.cushion];
    for (let i = 0; i <= levels; i++) {
      const y = Math.min(h - panelT, 0.02 + i * ((h - 0.04) / levels));
      addPart(group, [-w / 2 + sideT - 0.008, y, -d / 2 + 0.01, w / 2 - sideT + 0.008, y + panelT, d / 2 - 0.012], M.panel, 0.005, 2);
      if (i === levels || random() < 0.42) continue;
      let x = -w / 2 + sideT + 0.012;
      const limit = w / 2 - sideT - 0.012;
      const shelfTop = y + panelT + 0.004;
      const room = Math.max(0.12, (h - 0.04) / levels - panelT - 0.03);
      while (x < limit - 0.03) {
        const bw = 0.022 + random() * 0.03;
        const bh = room * (0.62 + random() * 0.36);
        if (x + bw > limit) break;
        addPart(group, [x, shelfTop, -d * 0.16, x + bw, shelfTop + bh, d / 2 - backT - 0.02], bookColors[Math.floor(random() * bookColors.length)], 0.004, 2, true, false);
        x += bw + 0.005;
        if (random() < 0.14) x += 0.05;
      }
    }
  }

  function buildStorage(group, w, d, h, M) {
    const plinthTop = 0.03;
    addPart(group, [-w / 2 + 0.02, 0, -d / 2 + 0.03, w / 2 - 0.02, plinthTop + 0.006, d / 2 - 0.02], M.plinth, 0.008, 2);
    addPart(group, [-w / 2, plinthTop, -d / 2 + 0.008, w / 2, h, d / 2 - 0.004], M.body, 0.012, 3);
    addPart(group, [-w / 2 - 0.008, h - 0.03, -d / 2 - 0.006, w / 2 + 0.008, h + 0.002, d / 2 + 0.004], M.cornice, 0.01, 3);
    const rows = h > 0.75 ? 3 : 2;
    const faceZ0 = -d / 2 + 0.008 - 0.018;
    const span = (h - plinthTop - 0.05) / rows;
    for (let r = 0; r < rows; r++) {
      const y0 = plinthTop + 0.02 + r * span;
      addPart(group, [-w / 2 + 0.018, y0, faceZ0, w / 2 - 0.018, y0 + span - 0.014, -d / 2 + 0.014], M.panel, 0.008, 3);
      addPeg(group, 0.009, 0.009, w * 0.24, 0, y0 + (span - 0.014) / 2, faceZ0 - 0.02, M.metal, 10).rotation.z = Math.PI / 2;
    }
  }

  function buildRug(group, w, d, h, M) {
    const base = addPart(group, [-w / 2, -0.01, -d / 2, w / 2, 0.016, d / 2], M.body, 0.006, 3, false, true);
    base.castShadow = false;
    addPart(group, [-w / 2 + w * 0.06, 0.015, -d / 2 + d * 0.06, w / 2 - w * 0.06, 0.021, d / 2 - d * 0.06], M.accent, 0.004, 2, false, true);
    addPart(group, [-w / 2 + w * 0.14, 0.02, -d / 2 + d * 0.14, w / 2 - w * 0.14, 0.025, d / 2 - d * 0.14], M.cushion, 0.003, 2, false, true);
  }

  function buildLighting(group, w, d, h, M) {
    const baseH = 0.035;
    const shadeH = Math.min(0.3, h * 0.24);
    const shadeBottom = h - shadeH;
    addPeg(group, w * 0.3, w * 0.34, baseH, 0, baseH / 2, 0, M.metal, 24);
    addPeg(group, 0.014, 0.016, shadeBottom - baseH + 0.01, 0, baseH + (shadeBottom - baseH) / 2, 0, M.metal, 12);
    const shade = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(0.2, w * 0.55), Math.min(0.31, w * 0.78), shadeH, 28, 1, true), new THREE.MeshStandardMaterial({
      color: new THREE.Color(M.linen.color), roughness: 0.9, side: THREE.DoubleSide, emissive: new THREE.Color(0x3a2f18), emissiveIntensity: 0.35
    }));
    shade.position.set(0, shadeBottom + shadeH / 2 - 0.005, 0);
    shade.castShadow = false;
    group.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(Math.min(0.055, shadeH * 0.3), 14, 10), new THREE.MeshStandardMaterial({
      color: 0xfff2d0, emissive: 0xffdca6, emissiveIntensity: 0.9, roughness: 0.4
    }));
    bulb.position.set(0, shadeBottom + shadeH * 0.34, 0);
    group.add(bulb);
    const glow = new THREE.PointLight(0xffe7b5, 0.5, 3.2);
    glow.position.set(0, shadeBottom + shadeH * 0.3, 0);
    group.add(glow);
  }

  function buildDecor(group, w, d, h, M, seed) {
    const potH = Math.min(0.34, h * 0.3);
    const potR = Math.min(w, d) * 0.32;
    addPeg(group, potR, potR * 0.78, potH, 0, potH / 2, 0, M.pot, 22);
    addPeg(group, potR * 0.94, potR * 0.9, 0.02, 0, potH - 0.005, 0, M.soil, 20, false);
    const random = makeRandom(hashString(seed));
    const foliage = new THREE.MeshStandardMaterial({ color: new THREE.Color(M.leaf.color), roughness: 0.88, metalness: 0.0 });
    const stemMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5c6b4b'), roughness: 0.85 });
    const clusters = 4 + Math.floor(random() * 3);
    if (h > 0.9) addPeg(group, 0.016, 0.024, h - potH - 0.16, 0, potH + (h - potH - 0.16) / 2, 0, stemMat, 8);
    for (let i = 0; i < clusters; i++) {
      const size = Math.min(0.2, h * 0.14) + random() * 0.06;
      const leaf = new THREE.Mesh(roundedBoxGeometry(size * 1.6, size * 0.5, size * 1.1, size * 0.22, 3), foliage);
      const angle = (i / clusters) * Math.PI * 2 + random();
      const lift = h * (0.5 + (i % 3) * 0.16);
      leaf.position.set(Math.cos(angle) * (0.04 + size * (0.5 + random() * 0.7)), lift, Math.sin(angle) * (0.04 + size * (0.5 + random() * 0.7)));
      leaf.rotation.set(random() * 0.5 - 0.25, angle, random() * 0.5 - 0.2);
      leaf.castShadow = true;
      leaf.receiveShadow = true;
      group.add(leaf);
    }
  }

  function buildStaircase(group, w, d, h, M) {
    const steps = U.clamp(Math.round(h / 0.19), 8, 18);
    const rise = h / steps;
    const run = d / steps;
    for (let i = 0; i < steps; i++) {
      const y0 = i * rise;
      const z0 = -d / 2 + i * run;
      addPart(group, [-w / 2 + 0.012, y0, z0, w / 2 - 0.012, y0 + rise + 0.024, z0 + run + 0.012], M.body, 0.006, 2);
      addPart(group, [-w / 2 + 0.03, y0, z0 + run - 0.006, w / 2 - 0.03, y0 + rise - 0.01, z0 + run + 0.004], M.frame, 0.004, 2);
    }
    [-1, 1].forEach(function (side) {
      const stringer = addPart(group, [
        side * (w / 2 - 0.02) - 0.02, 0, -d / 2,
        side * (w / 2 - 0.02) + 0.02, h * 0.55, d / 2
      ], M.wood, 0.004, 2);
      stringer.rotation.x = -Math.atan2(h * 0.55, d);
      const rail = addPart(group, [
        side * (w / 2 - 0.05) - 0.018, h * 0.92, -d / 2,
        side * (w / 2 - 0.05) + 0.018, h * 0.92 + 0.07, d / 2
      ], M.frame, 0.008, 3);
      rail.rotation.x = -0.32;
      [0, 1, 2].forEach(function (index) {
        const t = 0.2 + index * 0.3;
        addPeg(group, 0.012, 0.012, h * 0.42, side * (w / 2 - 0.05), h * (0.46 + t * 0.22), -d / 2 + d * t, M.metal, 8);
      });
    });
  }

  function buildDoorPanel(group, w, d, h, M) {
    const frameT = Math.max(0.035, w * 0.055);
    addPart(group, [-w / 2, 0, -d / 2, -w / 2 + frameT, h, d / 2], M.frame, 0.006, 2);
    addPart(group, [w / 2 - frameT, 0, -d / 2, w / 2, h, d / 2], M.frame, 0.006, 2);
    addPart(group, [-w / 2, h - frameT, -d / 2, w / 2, h, d / 2], M.frame, 0.006, 2);
    addPart(group, [-w / 2 + frameT, 0.006, -d / 2 + 0.012, w / 2 - frameT, h - frameT, d / 2 - 0.012], M.door, 0.008, 3);
    addPart(group, [-w / 2 + frameT + 0.05, h * 0.14, -d / 2 + 0.002, w / 2 - frameT - 0.05, h * 0.42, -d / 2 + 0.016], M.panel, 0.004, 2);
    addPart(group, [-w / 2 + frameT + 0.05, h * 0.48, -d / 2 + 0.002, w / 2 - frameT - 0.05, h * 0.84, -d / 2 + 0.016], M.panel, 0.004, 2);
    addPeg(group, 0.014, 0.014, 0.11, w * 0.3, h * 0.47, -d / 2 - 0.025, M.metal, 10);
    addPeg(group, 0.012, 0.012, 0.02, w * 0.3, h * 0.47, -d / 2 - 0.01, M.metal, 8);
  }

  function buildWindowPanel(group, w, d, h, M) {
    const frameT = Math.max(0.04, Math.min(w, h) * 0.05);
    const glassMat = new THREE.MeshStandardMaterial({
      color: 0xaed2df, roughness: 0.08, metalness: 0.08, transparent: true, opacity: 0.42
    });
    addPart(group, [-w / 2, 0, -d / 2, -w / 2 + frameT, h, d / 2], M.frame, 0.006, 2);
    addPart(group, [w / 2 - frameT, 0, -d / 2, w / 2, h, d / 2], M.frame, 0.006, 2);
    addPart(group, [-w / 2, 0, -d / 2, w / 2, frameT, d / 2], M.frame, 0.006, 2);
    addPart(group, [-w / 2, h - frameT, -d / 2, w / 2, h, d / 2], M.frame, 0.006, 2);
    addPart(group, [-0.014, frameT, -d / 2, 0.014, h - frameT, d / 2], M.frame, 0.003, 2);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.02, w - frameT * 2), Math.max(0.02, h - frameT * 2), 0.012), glassMat);
    glass.position.set(0, h / 2, 0);
    glass.castShadow = false;
    group.add(glass);
  }

  function labelTexture(text) {
    const canvas = document.createElement('canvas');
    canvas.width = 1024;
    canvas.height = 384;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '700 120px ' + '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    const maxWidth = canvas.width - 44;
    const words = String(text || 'Product').split(/\s+/).filter(Boolean);
    const lines = [''];
    words.forEach(function (word) {
      const candidate = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + word : word;
      if (context.measureText(candidate).width > maxWidth && lines[lines.length - 1]) {
        if (lines.length < 2) lines.push(word);
        else lines[lines.length - 1] += ' ' + word;
      } else {
        lines[lines.length - 1] = candidate;
      }
    });
    while (lines.length === 1 && context.measureText(lines[0]).width > maxWidth) {
      lines[0] = lines[0].slice(0, -1);
    }
    const last = lines[lines.length - 1];
    if (context.measureText(last).width > maxWidth) {
      let trimmed = last;
      while (trimmed.length > 1 && context.measureText(trimmed + '…').width > maxWidth) trimmed = trimmed.slice(0, -1);
      lines[lines.length - 1] = trimmed.replace(/\s+$/, '') + '…';
    }
    const lineHeight = 132;
    lines.slice(0, 2).forEach(function (line, index) {
      const offset = (index - (Math.min(lines.length, 2) - 1) / 2) * lineHeight;
      context.fillText(line, canvas.width / 2, canvas.height / 2 + offset);
    });
    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = state.renderer ? Math.min(8, state.renderer.capabilities.getMaxAnisotropy()) : 1;
    texture.needsUpdate = true;
    return texture;
  }

  /* Named black placeholder for products that have no GLB and no built-in
     demo model. Keeping it inside the item group means placement, rotation,
     selection and the GLB hand-off all behave exactly like a real model. */
  function buildFallbackModel(product) {
    const group = new THREE.Group();
    group.userData.fallback = true;
    const w = Math.max(0.02, product.widthCm * CM);
    const d = Math.max(0.02, product.lengthCm * CM);
    const h = Math.max(0.02, product.heightCm * CM);
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: 0x0b0b0b, roughness: 0.55, metalness: 0.04 })
    );
    box.position.y = h / 2;
    box.castShadow = true;
    box.receiveShadow = true;
    box.userData.fallback = true;
    group.add(box);
    const texture = labelTexture(product.name);
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const faces = [
      { width: w, x: 0, z: d / 2 + 0.004, rotation: 0 },
      { width: w, x: 0, z: -d / 2 - 0.004, rotation: Math.PI },
      { width: d, x: w / 2 + 0.004, z: 0, rotation: Math.PI / 2 },
      { width: d, x: -w / 2 - 0.004, z: 0, rotation: -Math.PI / 2 }
    ];
    faces.forEach(function (face) {
      const planeW = Math.max(0.02, face.width * 0.94);
      const planeH = Math.min(h * 0.6, Math.max(0.02, planeW * 384 / 1024));
      const plane = new THREE.Mesh(new THREE.PlaneGeometry(planeW, planeH), material);
      plane.position.set(face.x, h * 0.54, face.z);
      plane.rotation.y = face.rotation;
      plane.renderOrder = 2;
      plane.userData.fallback = true;
      group.add(plane);
    });
    /* Orbit view looks down on the block, so the top face repeats the name,
       turned along the longer side where the text has room to stay readable. */
    const longAlongX = w >= d;
    const availableW = (longAlongX ? w : d) * 0.9;
    const availableD = (longAlongX ? d : w) * 0.78;
    let topW = availableW;
    let topH = topW * 384 / 1024;
    if (topH > availableD) {
      topH = availableD;
      topW = topH * 1024 / 384;
    }
    const top = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.02, topW), Math.max(0.02, topH)), material);
    top.rotation.x = -Math.PI / 2;
    top.rotation.z = longAlongX ? 0 : Math.PI / 2;
    top.position.set(0, h + 0.004, 0);
    top.renderOrder = 2;
    top.userData.fallback = true;
    group.add(top);
    group.position.y = -0.002;
    return group;
  }

  function starterModel(product, color) {
    if (App.Catalog.usesFallback(product)) return buildFallbackModel(product);
    return buildProceduralModel(product, color);
  }

  function buildProceduralModel(product, color) {
    const group = new THREE.Group();
    group.userData.procedural = true;
    const w = Math.max(0.1, product.widthCm * CM);
    const d = Math.max(0.1, product.lengthCm * CM);
    const h = Math.max(0.05, product.heightCm * CM);
    const seed = product.id + '|' + (color || '');
    const M = {
      body: materialFor(color, 0.8, 0.02),
      frame: materialFor(darker(color, 0.24), 0.74, 0.03),
      panel: materialFor(lighter(color, 0.14), 0.8, 0.02),
      door: materialFor(lighter(color, 0.05), 0.72, 0.03),
      plinth: materialFor(darker(color, 0.3), 0.76, 0.03),
      cornice: materialFor(lighter(color, 0.08), 0.78, 0.02),
      cushion: fabricMaterial(lighter(color, 0.2)),
      sheet: fabricMaterial(lighter(color, 0.62)),
      accent: fabricMaterial(lighter(color, 0.44)),
      accent2: fabricMaterial(darker(color, 0.1)),
      wood: materialFor(darker(color, 0.34), 0.66, 0.04),
      metal: materialFor(0x9aa0a6, 0.3, 0.62),
      linen: materialFor(0xf2ead8, 0.9, 0.0),
      pot: materialFor(darker(color, 0.1), 0.84, 0.02),
      soil: materialFor(0x3b3128, 0.95, 0.0),
      leaf: materialFor(product.category === 'decor' ? '#4f7358' : lighter(color, 0.1), 0.88, 0.0)
    };
    switch (product.category) {
      case 'bed': buildBed(group, w, d, h, M); break;
      case 'sofa': buildSofa(group, w, d, h, M); break;
      case 'wardrobe': buildWardrobe(group, w, d, h, M); break;
      case 'chair': buildChair(group, w, d, h, M); break;
      case 'table': buildTable(group, w, d, h, M, true); break;
      case 'desk': buildDesk(group, w, d, h, M); break;
      case 'shelf': buildShelf(group, w, d, h, M, seed); break;
      case 'storage': buildStorage(group, w, d, h, M); break;
      case 'rug': buildRug(group, w, d, h, M); break;
      case 'lighting': buildLighting(group, w, d, h, M); break;
      case 'decor': buildDecor(group, w, d, h, M, seed); break;
      case 'staircase': buildStaircase(group, w, d, h, M); break;
      case 'door': buildDoorPanel(group, w, d, h, M); break;
      case 'window': buildWindowPanel(group, w, d, h, M); break;
      default: addPart(group, [-w / 2, 0, -d / 2, w / 2, h, d / 2], M.body, Math.min(w, d, h) * 0.1, 4);
    }
    /* Sinking each model 2 mm into the floor keeps the two surfaces out of the
       same plane, which is where the crawling speckles come from. */
    group.position.y = -0.002;
    return group;
  }

  function updateSelection(design) {
    const sel = state.selection;
    let highlightId = null;
    if (sel && sel.type === 'placed' && state.itemNodes.has(sel.id)) highlightId = sel.id;
    const node = highlightId ? state.itemNodes.get(highlightId) : null;
    if (node) {
      state.highlight.visible = true;
      state.highlight.setFromObject(node.group);
      state.highlight.update();
      state.selectedId = highlightId;
    } else {
      state.highlight.visible = false;
      state.selectedId = null;
    }
    renderOnce();
  }

  function resetCamera() {
    const design = state.design;
    const room = design && design.room;
    let width = 4;
    let length = 5;
    let height = 2.8;
    if (room) {
      const size = G.roomSize(room);
      width = size.width * CM;
      length = size.length * CM;
      height = room.heightCm * CM;
    }
    const extent = Math.max(width, length, 3);
    const distance = extent * 1.05 + 1.4;
    state.camera.position.set(distance * 0.72, Math.max(2.4, height * 1.15), distance * 0.8);
    if (state.orbit) {
      state.orbit.target.set(0, Math.min(1.2, height * 0.35), 0);
      state.orbit.update();
    } else {
      state.camera.lookAt(0, height * 0.3, 0);
    }
    if (isFirstPerson()) {
      const spawn = spawnPoint();
      state.firstPerson.position = { x: spawn.x, y: spawn.y, z: spawn.z };
      state.firstPerson.velocity.x = 0;
      state.firstPerson.velocity.z = 0;
      state.firstPerson.yaw = spawn.yaw;
      state.firstPerson.pitch = 0;
      state.firstPerson.bobOffset = 0;
      state.firstPerson.bobPhase = 0;
      state.camera.fov = WALK.baseFov;
      state.camera.updateProjectionMatrix();
      applyFirstPersonCamera();
    }
    renderOnce();
  }

  function previewProduct(containerEl, product, options) {
    const opts = options || {};
    if (!containerEl || !product) return null;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (err) {
      containerEl.innerHTML = '<div class="preview3d-failure">WebGL is unavailable, so this model cannot be previewed.</div>';
      return { dispose: function () {} };
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.setClearColor(0x000000, 0);
    renderer.domElement.className = 'preview3d-canvas';
    containerEl.innerHTML = '';
    containerEl.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.03, 50);
    const width = Math.max(0.3, product.widthCm * CM);
    const depth = Math.max(0.3, product.lengthCm * CM);
    const height = Math.max(0.2, product.heightCm * CM);
    const extent = Math.max(width, depth, height);
    camera.position.set(extent * 1.35, extent * 1.05, extent * 1.7);

    const controls = THREE.OrbitControls ? new THREE.OrbitControls(camera, renderer.domElement) : null;
    if (controls) {
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.target.set(0, height * 0.45, 0);
      controls.minDistance = extent * 0.9;
      controls.maxDistance = extent * 5;
      controls.enablePan = false;
      controls.maxPolarAngle = Math.PI / 2 - 0.05;
      controls.update();
    }
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8b968d, 0.95));
    const key = new THREE.DirectionalLight(0xfff4e5, 0.95);
    key.position.set(2.5, 4, 2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 14;
    key.shadow.camera.left = -extent * 2;
    key.shadow.camera.right = extent * 2;
    key.shadow.camera.top = extent * 2;
    key.shadow.camera.bottom = -extent * 2;
    key.shadow.camera.updateProjectionMatrix();
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.01;
    scene.add(key);
    const ground = new THREE.Mesh(new THREE.CircleGeometry(extent * 1.7, 48),
      new THREE.MeshStandardMaterial({ color: 0xdde4dc, roughness: 0.95, transparent: true, opacity: 0.8 }));
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    const group = new THREE.Group();
    const placeholder = App.Catalog.usesFallback(product);
    const starter = starterModel(product, App.Catalog.colorFor(product, opts.variantId));
    group.add(starter);
    scene.add(group);
    let disposed = false;
    let frameId = null;
    let status = product.assets && product.assets.glb ? 'loading' : (placeholder ? 'placeholder' : 'procedural');
    let mismatchMessage = null;
    if (typeof opts.onStatus === 'function' && status !== 'loading') opts.onStatus({ status: status, mismatch: null });

    function resizePreview() {
      if (disposed) return;
      const rect = containerEl.getBoundingClientRect();
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height || 240));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }
    const observer = new ResizeObserver(resizePreview);
    observer.observe(containerEl);
    resizePreview();

    if (product.assets && product.assets.glb) {
      loadProductGLB(product).then(function (template) {
        if (disposed) return;
        const clone = template.holder.clone(true);
        clone.traverse(function (child) {
          if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        group.remove(starter);
        disposeObject(starter);
        group.add(clone);
        status = 'glb';
        mismatchMessage = template.mismatchMessage;
        if (typeof opts.onStatus === 'function') opts.onStatus({ status: status, mismatch: mismatchMessage });
      }).catch(function () {
        if (disposed) return;
        status = 'procedural-fallback';
        if (typeof opts.onStatus === 'function') opts.onStatus({ status: status, mismatch: null });
      });
    }

    function animatePreview() {
      if (disposed) return;
      if (controls) controls.update();
      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animatePreview);
    }
    animatePreview();

    return {
      dispose: function () {
        disposed = true;
        if (frameId) cancelAnimationFrame(frameId);
        observer.disconnect();
        if (controls) controls.dispose();
        disposeObject(group);
        ground.geometry.dispose();
        ground.material.dispose();
        renderer.dispose();
        if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement);
      },
      getStatus: function () { return { status: status, mismatch: mismatchMessage }; }
    };
  }

  App.Viewer3D = {
    init: init,
    sync: sync,
    setActive: setActive,
    resize: resize,
    setMode: setMode,
    getMode: getMode,
    setCeiling: setCeiling,
    getCeiling: getCeiling,
    setCutaway: setCutaway,
    getCutaway: getCutaway,
    resetCamera: resetCamera,
    getStatus: getStatus,
    canWalk: canWalk,
    previewProduct: previewProduct,
    buildProductGroup: function (product, variantId) {
      return starterModel(product, App.Catalog.colorFor(product, variantId));
    },
    loadProductGroup: function (product) {
      return loadProductGLB(product).then(function (template) {
        const clone = template.holder.clone(true);
        clone.traverse(function (child) {
          if (child.isMesh) { child.castShadow = true; child.receiveShadow = true; }
        });
        return clone;
      });
    },
    hasGlbModel: function (product) {
      return !!(product && product.assets && product.assets.glb && product.assets.glb.key);
    }
  };
})(window.App = window.App || {});
