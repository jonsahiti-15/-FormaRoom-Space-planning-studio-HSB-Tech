(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;
  const G = App.Geometry;
  const H = C.HOME;
  const CM = C.CM_TO_M;

  const WALK = {
    eyeHeight: 1.62,
    bodyRadiusCm: 26,
    wallPaddingCm: 4,
    walkSpeed: 1.7,
    runSpeed: 3.4,
    acceleration: 11,
    deceleration: 15,
    maxStep: 0.08,
    lookSensitivity: 0.0021,
    baseFov: 62,
    runFov: 69,
    orbitFov: 52,
    transitionCooldown: 0.45
  };

  const COLORS = {
    wall: 0xf2f0ea,
    floor: 0xe8e3d9,
    ceiling: 0xfaf8f4,
    trim: 0xf7f5f0,
    door: 0x9a7853,
    glass: 0xaed2df,
    slab: 0xd8d4ca,
    link: 0x0f7a52
  };

  const MAX_HOME_ITEMS = H.MAX_HOME_ITEMS;

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
    worldGroup: null,
    rooms: [],
    wallEntries: [],
    signature: '',
    gateCache: {},
    buildToken: 0,
    centerX: 0,
    centerZ: 0,
    ceilingVisible: false,
    cutaway: true,
    focusRoomId: null,
    frameId: null,
    resizeObserver: null,
    lastTime: 0,
    glbCount: 0,
    itemBudgetUsed: 0,
    walker: null,
    transitionCooldown: 0,
    pointerDown: null,
    keys: {},
    walkHint: null,
    locked: false,
    dragging: false,
    lastLookX: 0,
    lastLookY: 0,
    lastBlockedAt: 0,
    lastBlockedGate: null,
    statusTimer: null
  };

  function requestFrame() {
    if (state.frameId || !state.active) return;
    state.frameId = requestAnimationFrame(tick);
  }

  function tick(now) {
    state.frameId = null;
    if (!state.active || !state.renderer) return;
    const dt = Math.min(0.05, state.lastTime ? (now - state.lastTime) / 1000 : 0.016);
    state.lastTime = now;
    if (state.mode === 'first') updateWalk(dt);
    else updateFocusAnimation(dt);
    updateCutaway();
    if (state.mode !== 'first' && state.orbit) state.orbit.update();
    state.renderer.render(state.scene, state.camera);
    if (state.mode === 'first') requestFrame();
  }

  function renderOnce() {
    if (!state.renderer || !state.scene || !state.camera) return;
    updateCutaway();
    if (state.mode !== 'first' && state.orbit) state.orbit.update();
    state.renderer.render(state.scene, state.camera);
    requestFrame();
  }

  /* ------------------------------------------------------------- lifecycle */

  function init(containerEl) {
    if (state.initialized) return true;
    if (!window.THREE) return false;
    state.container = containerEl;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.className = 'home3d-canvas';
    containerEl.appendChild(renderer.domElement);
    state.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xe7ede8);
    scene.fog = new THREE.Fog(0xe7ede8, 26, 90);
    state.scene = scene;

    const camera = new THREE.PerspectiveCamera(WALK.orbitFov, 1, 0.05, 400);
    camera.position.set(9, 8, 11);
    state.camera = camera;

    if (THREE.OrbitControls) {
      const orbit = new THREE.OrbitControls(camera, renderer.domElement);
      orbit.enableDamping = true;
      orbit.dampingFactor = 0.09;
      orbit.maxPolarAngle = Math.PI / 2 - 0.02;
      orbit.minDistance = 1.2;
      orbit.maxDistance = 90;
      state.orbit = orbit;
    }

    const hemi = new THREE.HemisphereLight(0xffffff, 0x8d9a90, 0.72);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff4e2, 0.95);
    sun.position.set(12, 18, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    state._sun = sun;
    const bounce = new THREE.DirectionalLight(0xdfe9ff, 0.22);
    bounce.position.set(-9, 6, -7);
    scene.add(bounce);

    const world = new THREE.Group();
    scene.add(world);
    state.worldGroup = world;

    state.resizeObserver = new ResizeObserver(function () { resize(); });
    state.resizeObserver.observe(containerEl);
    bindPointer();
    bindKeys();
    state.initialized = true;
    resize();
    return true;
  }

  function resize() {
    if (!state.renderer || !state.container) return;
    const rect = state.container.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    state.renderer.setSize(width, height, false);
    state.camera.aspect = width / height;
    state.camera.updateProjectionMatrix();
    renderOnce();
  }

  function setActive(active) {
    state.active = !!active;
    if (state.active) {
      resize();
      const record = App.Home.get();
      const missing = record ? record.rooms.filter(function (room) { return !App.Home.cachedDesign(room.designId); }).length : 0;
      rebuild(true);
      requestFrame();
      if (missing) {
        App.Home.ensureDesigns().then(function () {
          if (!state.active) return;
          rebuild(true);
          resetCamera();
        }).catch(function () {});
      }
    } else if (state.mode === 'first') {
      exitPointerLock();
      setMode('orbit');
    }
  }

  /* ------------------------------------------------------------- modelling */

  function disposeObject(object) {
    if (!object) return;
    object.traverse(function (child) {
      if (child.isMesh && child.geometry && child.userData.ownGeometry !== false) {
        child.geometry.dispose();
      }
      if (child.isMesh && child.material && child.material.dispose && child.userData.ownMaterial !== false) {
        if (Array.isArray(child.material)) child.material.forEach(function (m) { m.dispose(); });
        else child.material.dispose();
      }
    });
  }

  function clearWorld() {
    while (state.worldGroup.children.length) {
      const child = state.worldGroup.children[0];
      state.worldGroup.remove(child);
      disposeObject(child);
    }
    state.rooms = [];
    state.wallEntries = [];
    state.glbCount = 0;
    state.itemBudgetUsed = 0;
    state.gateCache = {};
    state.buildToken++;
  }

  function addBox(parent, w, h, d, x, y, z, material, cast, receive) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.001, w), Math.max(0.001, h), Math.max(0.001, d)), material);
    mesh.position.set(x, y, z);
    mesh.castShadow = cast !== false;
    mesh.receiveShadow = receive !== false;
    parent.add(mesh);
    return mesh;
  }

  function mat(color, roughness, metalness, extra) {
    const options = { color: color, roughness: roughness == null ? 0.9 : roughness, metalness: metalness == null ? 0 : metalness };
    if (extra) Object.keys(extra).forEach(function (key) { options[key] = extra[key]; });
    return new THREE.MeshStandardMaterial(options);
  }

  function worldOf(x, z) {
    return { x: (x - state.centerX) * CM, z: (z - state.centerZ) * CM };
  }

  function buildRoomNode(room) {
    const design = App.Home.cachedDesign(room.designId);
    if (!design) return null;
    const dims = design.room;
    const size = G.roomSize(dims);
    const widthM = size.width * CM;
    const lengthM = size.length * CM;
    const heightM = Math.max(0.5, dims.heightCm * CM);
    const group = new THREE.Group();
    const center = App.Home.centerOf(room);
    const at = worldOf(center.x, center.z);
    group.position.set(at.x, 0, at.z);
    group.rotation.y = -U.degToRad(room.rot);
    group.userData.roomId = room.id;

    const wallColor = design.wallColor ? new THREE.Color(design.wallColor) : new THREE.Color(COLORS.wall);
    const exteriorColor = design.exteriorWallColor ? new THREE.Color(design.exteriorWallColor) : wallColor;
    const wallMat = mat(wallColor, 0.93);
    const exteriorMat = mat(exteriorColor, 0.93);
    const wallMats = [wallMat, wallMat, exteriorMat, exteriorMat, wallMat, exteriorMat];
    const floorMat = mat(design.floor && design.floor.color ? new THREE.Color(design.floor.color) : new THREE.Color(COLORS.floor), 0.85, 0.02);
    const ceilMat = mat(COLORS.ceiling, 0.96, 0, { side: THREE.DoubleSide });
    const bleed = C.WALL_THICKNESS_CM * CM;

    const floor = new THREE.Mesh(new THREE.PlaneGeometry(widthM + bleed, lengthM + bleed), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    group.add(floor);

    const ceilingGroup = new THREE.Group();
    const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(widthM + bleed, lengthM + bleed), ceilMat);
    ceiling.rotation.x = Math.PI / 2;
    ceiling.position.y = heightM - 0.003;
    ceilingGroup.add(ceiling);
    ceilingGroup.visible = false;
    group.add(ceilingGroup);

    if (dims.shape === 'circle') {
      const radius = widthM / 2;
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, heightM, 72, 1, true),
        mat(wallColor, 0.93, 0, { side: THREE.BackSide }));
      shell.position.y = heightM / 2;
      shell.receiveShadow = true;
      group.add(shell);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.05, 8, 72), mat(COLORS.slab, 0.9));
      rim.rotation.x = Math.PI / 2;
      rim.position.y = heightM;
      group.add(rim);
    } else {
      buildRectWalls(group, room, design, dims, size, heightM, wallMat, wallMats);
      buildInteriorWalls(group, room, design, dims, heightM, wallMat);
    }

    buildFurniture(group, room, design);
    state.worldGroup.add(group);
    return {
      room: room,
      group: group,
      ceilingGroup: ceilingGroup,
      heightM: heightM,
      design: design
    };
  }

  function buildRectWalls(group, room, design, dims, size, heightM, wallMat, wallMats) {
    const thickness = C.WALL_THICKNESS_CM * CM;
    const walls = G.getWalls(dims);
    const center = G.roomCenter(dims);
    const openingsByWall = {};
    (design.structuralItems || []).forEach(function (item) {
      if (!openingsByWall[item.wall]) openingsByWall[item.wall] = [];
      openingsByWall[item.wall].push(item);
    });
    walls.forEach(function (wall) {
      const lengthM = wall.lengthCm * CM;
      const wallGroup = new THREE.Group();
      const midX = (wall.start.x + wall.dir.x * wall.lengthCm / 2 - center.x) * CM;
      const midZ = (wall.start.z + wall.dir.z * wall.lengthCm / 2 - center.z) * CM;
      wallGroup.position.set(midX, 0, midZ);
      wallGroup.rotation.y = Math.atan2(-wall.dir.z, wall.dir.x);
      group.add(wallGroup);

      const openings = (openingsByWall[wall.id] || []).map(function (item) {
        const widthM = Math.min(item.widthCm, wall.lengthCm) * CM;
        const offsetM = item.offsetCm * CM;
        const left = U.clamp(offsetM - widthM / 2, 0, lengthM);
        const right = U.clamp(offsetM + widthM / 2, 0, lengthM);
        const sill = item.type === 'door' ? 0 : U.clamp((item.sillCm || 0) * CM, 0, Math.max(0, heightM - 0.1));
        const top = Math.min(heightM, sill + (item.heightCm || 200) * CM);
        return { item: item, left: left, right: right, sill: sill, top: top };
      }).filter(function (o) { return o.right - o.left > 0.08 && o.top - o.sill > 0.08; })
        .sort(function (a, b) { return a.left - b.left; });

      /* Perimeter walls sit just outside the room, but a neighbour that is flush
         against this wall would then have our wall inside its space (and we its
         exterior paint). On shared walls the band moves to our own side so each
         room sees its own inside colour. */
      const zCenter = wallFacesNeighbour(room, wall) ? thickness / 2 : -thickness / 2;
      let cursor = 0;
      function segment(w, h, x, y) {
        addBox(wallGroup, w, h, thickness, x, y, zCenter, wallMats || wallMat);
      }
      openings.forEach(function (opening) {
        if (opening.left > cursor + 0.001) {
          segment(opening.left - cursor, heightM, (cursor + opening.left) / 2 - lengthM / 2, heightM / 2);
        }
        const width = opening.right - opening.left;
        const middle = (opening.left + opening.right) / 2 - lengthM / 2;
        if (opening.sill > 0.001) segment(width, opening.sill + 0.02, middle, (opening.sill + 0.02) / 2);
        if (opening.top < heightM - 0.001) segment(width, heightM - opening.top + 0.02, middle, opening.top + (heightM - opening.top) / 2 - 0.01);
        addOpeningDetail(wallGroup, room, opening, thickness, lengthM, heightM, zCenter);
        cursor = Math.max(cursor, opening.right);
      });
      if (cursor < lengthM - 0.001) {
        segment(lengthM - cursor, heightM, (cursor + lengthM) / 2 - lengthM / 2, heightM / 2);
      }
      const outwardWorld = rotateLevel(wall.outward.x, wall.outward.z, room.rot);
      const poseCenter = App.Home.openingPose(room, { id: 'x', type: 'door', wall: wall.id, offsetCm: wall.lengthCm / 2, widthCm: 1, heightCm: 1 });
      state.wallEntries.push({
        roomId: room.id,
        group: wallGroup,
        center: poseCenter ? worldOf(poseCenter.x, poseCenter.z) : { x: 0, z: 0 },
        outward: outwardWorld,
        hidden: false
      });
    });
  }

  function rotateLevel(x, z, rot) {
    const r = U.degToRad(rot);
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    return { x: x * cos - z * sin, z: x * sin + z * cos };
  }

  /* True when the wall's outward-side band would fall inside another room, i.e.
     the two rooms are docked flush and would otherwise draw two overlapping
     walls (and show each other's outside paint). */
  function wallFacesNeighbour(room, wall) {
    const home = App.Home.get();
    if (!home || !home.rooms || home.rooms.length < 2 || room.shape === 'circle') return false;
    const thickness = C.WALL_THICKNESS_CM;
    const probes = [0.15, 0.5, 0.85];
    for (let i = 0; i < probes.length; i++) {
      const along = wall.lengthCm * probes[i];
      const at = App.Home.toLevel(room,
        wall.start.x + wall.dir.x * along + wall.outward.x * (thickness / 2),
        wall.start.z + wall.dir.z * along + wall.outward.z * (thickness / 2));
      for (let j = 0; j < home.rooms.length; j++) {
        const other = home.rooms[j];
        if (other.id === room.id || other.shape === 'circle') continue;
        const rect = App.Home.rectOf(other);
        if (at.x > rect.x + 1 && at.x < rect.x + rect.w - 1 && at.z > rect.z + 1 && at.z < rect.z + rect.d - 1) return true;
      }
    }
    return false;
  }

  /* Partitions live in the room's own plan coordinates and rotate with the room
     group, exactly like the perimeter walls. */
  function buildInteriorWalls(group, room, design, dims, heightM, wallMat) {
    const center = G.roomCenter(dims);
    const trimMat = mat(COLORS.trim, 0.85);
    const frameMat = mat(COLORS.trim, 0.8);
    const glassMat = mat(COLORS.glass, 0.12, 0.05, { transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide });
    (design.interiorWalls || []).forEach(function (wall) {
      const lengthCm = G.interiorWallLength(wall);
      if (!(lengthCm > 20)) return;
      const dir = G.interiorWallDir(wall);
      const mid = G.interiorWallPoint(wall, lengthCm / 2);
      const lengthM = lengthCm * CM;
      const thickness = U.clamp(U.toNumber(wall.thicknessCm, C.WALL_THICKNESS_CM), 6, 40) * CM;
      const wallHeight = Math.max(0.1, Math.min(heightM, U.toNumber(wall.heightCm, dims.heightCm) * CM));
      const wallGroup = new THREE.Group();
      wallGroup.position.set((mid.x - center.x) * CM, 0, (mid.z - center.z) * CM);
      wallGroup.rotation.y = Math.atan2(-dir.z, dir.x);
      group.add(wallGroup);

      const openings = G.interiorWallOpenings(wall).map(function (opening) {
        const widthM = Math.max(0.2, U.toNumber(opening.widthCm, 90) * CM);
        const offsetM = U.toNumber(opening.offsetCm, lengthCm / 2) * CM;
        const left = U.clamp(offsetM - widthM / 2, 0, lengthM);
        const right = U.clamp(offsetM + widthM / 2, 0, lengthM);
        const sill = opening.type === 'door' ? 0 : U.clamp(U.toNumber(opening.sillCm, 90) * CM, 0, Math.max(0, wallHeight - 0.1));
        const top = Math.min(wallHeight, sill + Math.max(0.3, U.toNumber(opening.heightCm, 210) * CM));
        return { opening: opening, left: left, right: right, sill: sill, top: top };
      }).filter(function (opening) {
        return opening.right - opening.left > 0.08 && opening.top - opening.sill > 0.08;
      }).sort(function (a, b) { return a.left - b.left; });

      function segment(width, height, xCenter, yCenter) {
        addBox(wallGroup, width, height, thickness, xCenter, yCenter, 0, wallMat);
      }

      let cursor = 0;
      openings.forEach(function (opening) {
        if (opening.left > cursor + 0.001) {
          const width = opening.left - cursor;
          const xCenter = (cursor + opening.left) / 2 - lengthM / 2;
          segment(width, wallHeight, xCenter, wallHeight / 2);
          addBox(wallGroup, width, 0.035, thickness + 0.01, xCenter, 0.0175, 0, trimMat, false, true);
        }
        const width = opening.right - opening.left;
        const xCenter = (opening.left + opening.right) / 2 - lengthM / 2;
        if (opening.sill > 0.001) segment(width, opening.sill, xCenter, opening.sill / 2);
        if (opening.top < wallHeight - 0.001) {
          segment(width, wallHeight - opening.top, xCenter, opening.top + (wallHeight - opening.top) / 2);
        }
        const jamb = 0.05;
        addBox(wallGroup, jamb, opening.top - opening.sill, thickness + 0.02, xCenter - width / 2 + jamb / 2, opening.sill + (opening.top - opening.sill) / 2, 0, frameMat);
        addBox(wallGroup, jamb, opening.top - opening.sill, thickness + 0.02, xCenter + width / 2 - jamb / 2, opening.sill + (opening.top - opening.sill) / 2, 0, frameMat);
        addBox(wallGroup, width, jamb, thickness + 0.02, xCenter, opening.top - jamb / 2, 0, frameMat);
        if (opening.opening.type === 'window') {
          addBox(wallGroup, width, jamb, thickness + 0.02, xCenter, opening.sill + jamb / 2, 0, frameMat);
          const glass = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.05, width - jamb * 2), Math.max(0.05, opening.top - opening.sill - jamb * 2)), glassMat);
          glass.position.set(xCenter, opening.sill + (opening.top - opening.sill) / 2, 0);
          wallGroup.add(glass);
        } else {
          addBox(wallGroup, Math.max(0.1, width - jamb), 0.015, thickness + 0.04, xCenter, 0.0075, 0, trimMat, false, true);
        }
        cursor = Math.max(cursor, opening.right);
      });
      if (cursor < lengthM - 0.001) {
        const width = lengthM - cursor;
        const xCenter = (cursor + lengthM) / 2 - lengthM / 2;
        segment(width, wallHeight, xCenter, wallHeight / 2);
        addBox(wallGroup, width, 0.035, thickness + 0.01, xCenter, 0.0175, 0, trimMat, false, true);
      }
      addBox(wallGroup, lengthM, 0.028, thickness + 0.01, 0, wallHeight - 0.014, 0, mat(COLORS.slab, 0.9), false, true);
    });
  }

  function addOpeningDetail(wallGroup, room, opening, thickness, lengthM, heightM, zOffset) {
    const item = opening.item;
    const width = opening.right - opening.left;
    const height = opening.top - opening.sill;
    const xCenter = (opening.left + opening.right) / 2 - lengthM / 2;
    const yCenter = opening.sill + height / 2;
    const zCenter = zOffset == null ? -thickness / 2 : zOffset;
    const link = item.type === 'door' ? App.Home.linkForOpening(room.id, item.id) : null;
    const frameMat = mat(link ? COLORS.link : COLORS.trim, 0.7, link ? 0.15 : 0);

    const jamb = 0.05;
    addBox(wallGroup, jamb, height + jamb, thickness + 0.02, xCenter - width / 2 + jamb / 2, yCenter + jamb / 2, zCenter, frameMat);
    addBox(wallGroup, jamb, height + jamb, thickness + 0.02, xCenter + width / 2 - jamb / 2, yCenter + jamb / 2, zCenter, frameMat);
    addBox(wallGroup, width, jamb, thickness + 0.02, xCenter, opening.top - jamb / 2, zCenter, frameMat);
    if (item.type === 'window') {
      addBox(wallGroup, width, jamb, thickness + 0.02, xCenter, opening.sill + jamb / 2, zCenter, frameMat);
      const glass = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.05, width - jamb * 2), Math.max(0.05, height - jamb * 2)),
        mat(COLORS.glass, 0.12, 0.05, { transparent: true, opacity: 0.34, depthWrite: false, side: THREE.DoubleSide }));
      glass.position.set(xCenter, yCenter, zCenter);
      wallGroup.add(glass);
      return;
    }
    if (link) {
      /* A linked doorway stays open and gets a threshold light so it can be
         found from a distance in walk mode. */
      const plate = new THREE.Mesh(new THREE.BoxGeometry(Math.max(0.1, width - jamb), 0.012, thickness + 0.1),
        mat(COLORS.link, 0.5, 0.1, { transparent: true, opacity: 0.55 }));
      plate.position.set(xCenter, 0.007, zCenter);
      plate.receiveShadow = false;
      wallGroup.add(plate);
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(Math.max(0.1, width - jamb * 2), Math.max(0.1, height - jamb)),
        mat(COLORS.link, 0.4, 0, { transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }));
      glow.position.set(xCenter, yCenter, zCenter);
      wallGroup.add(glow);
      return;
    }
    const leafW = Math.max(0.1, width - jamb * 2 - 0.01);
    const leafH = Math.max(0.1, height - jamb - 0.01);
    const hinge = new THREE.Group();
    hinge.position.set(xCenter - width / 2 + jamb, opening.sill + jamb / 2, zCenter);
    const leafGeo = new THREE.BoxGeometry(leafW, leafH, 0.038);
    leafGeo.translate(leafW / 2, leafH / 2, 0);
    const leaf = new THREE.Mesh(leafGeo, mat(COLORS.door, 0.62, 0.04));
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    hinge.add(leaf);
    hinge.rotation.y = -0.45;
    wallGroup.add(hinge);
    const handle = new THREE.Mesh(new THREE.SphereGeometry(0.026, 10, 8), mat(0x8b8b83, 0.3, 0.7));
    handle.position.set(leafW - 0.08, leafH * 0.5, 0.05);
    hinge.add(handle);
  }

  function buildFurniture(group, room, design) {
    const productsById = App.Catalog.getProductsById();
    const center = G.roomCenter(design.room);
    (design.placedItems || []).forEach(function (item) {
      if (state.itemBudgetUsed >= MAX_HOME_ITEMS) return;
      const product = productsById[item.productId];
      if (!product) return;
      state.itemBudgetUsed++;
      let model;
      try {
        model = App.Viewer3D.buildProductGroup(product, item.variantId);
      } catch (err) {
        return;
      }
      model.position.set((item.xCm - center.x) * CM, 0, (item.zCm - center.z) * CM);
      model.rotation.y = -U.degToRad(item.rotationDeg || 0);
      group.add(model);
      if (App.Viewer3D.hasGlbModel(product) && state.glbCount < C.LIMITS.MAX_GLB_MODELS) {
        state.glbCount++;
        const token = state.buildToken;
        App.Viewer3D.loadProductGroup(product).then(function (clone) {
          if (!clone || !model.parent || token !== state.buildToken) return;
          /* A clone shares geometry and material objects with the cached GLB
             template, so mark it non-owning before clearing the scene. */
          clone.traverse(function (child) {
            child.userData.ownGeometry = false;
            child.userData.ownMaterial = false;
          });
          const parent = model.parent;
          const x = model.position.x;
          const y = model.position.y;
          const z = model.position.z;
          const ry = model.rotation.y;
          parent.remove(model);
          disposeObject(model);
          clone.position.set(x, y, z);
          clone.rotation.y = ry;
          parent.add(clone);
          renderOnce();
        }).catch(function () { state.glbCount--; });
      }
    });
  }

  function buildGround() {
    const bounds = App.Home.homeBounds();
    const width = Math.max(4, (bounds.width + 600) * CM);
    const depth = Math.max(4, (bounds.depth + 600) * CM);
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat(0xdfe6df, 0.98));
    pad.rotation.x = -Math.PI / 2;
    pad.position.y = -0.06;
    pad.receiveShadow = true;
    state.worldGroup.add(pad);
  }

  function homeSignature() {
    const record = App.Home.get();
    if (!record) return '';
    const designs = record.rooms.map(function (room) {
      const design = App.Home.cachedDesign(room.designId);
      if (!design) return room.designId + ':pending';
      let rev = 0;
      (design.placedItems || []).forEach(function (item, i) {
        rev = (rev + i * 7 + Math.round(item.xCm) * 3 + Math.round(item.zCm) * 11 + Math.round(item.rotationDeg || 0)) % 1000000007;
      });
      return [room.designId, (design.placedItems || []).length, (design.structuralItems || []).length,
        JSON.stringify(design.interiorWalls || []),
        design.wallColor || '', design.exteriorWallColor || '', (design.floor && design.floor.color) || '', rev, design.updatedAt || ''].join('~');
    });
    return JSON.stringify([record.rooms, record.links, designs]);
  }

  function rebuild(force) {
    if (!state.initialized) return false;
    const record = App.Home.get();
    const signature = homeSignature();
    if (!force && signature === state.signature) return false;
    state.signature = signature;
    clearWorld();
    if (!record) { renderOnce(); return true; }
    const center = App.Home.centerOfHome();
    state.centerX = center.x;
    state.centerZ = center.z;
    buildGround();
    record.rooms.forEach(function (room) {
      const node = buildRoomNode(room);
      if (node) state.rooms.push(node);
    });
    applyCeilings();
    fitSun();
    if (state.mode === 'first' && state.walker) {
      const standing = App.Home.roomById(state.walker.roomId);
      if (!standing) {
        recoverWalker('room-lost');
      } else {
        /* The home can be edited from the plan while you stand in it, so pull the
           walker back inside the room it is actually standing in. */
        const at = landInRoom(standing, state.walker.x, state.walker.z);
        state.walker.x = at.x;
        state.walker.z = at.z;
      }
    }
    renderOnce();
    return true;
  }

  function fitSun() {
    if (!state._sun) return;
    const bounds = App.Home.homeBounds();
    const extent = Math.max(6, Math.max(bounds.width, bounds.depth) * CM * 0.8);
    state._sun.position.set(extent * 0.7, extent * 1.5, extent * 0.55);
    const cam = state._sun.shadow.camera;
    cam.left = -extent;
    cam.right = extent;
    cam.top = extent;
    cam.bottom = -extent;
    cam.near = 0.5;
    cam.far = extent * 4;
    cam.updateProjectionMatrix();
  }

  function applyCeilings() {
    state.rooms.forEach(function (node) {
      node.ceilingGroup.visible = state.ceilingVisible;
    });
  }

  function updateCutaway() {
    if (!state.camera) return;
    const disabled = !state.cutaway || state.mode === 'first';
    const cam = state.camera.position;
    state.wallEntries.forEach(function (entry) {
      if (disabled) {
        entry.group.visible = true;
        entry.hidden = false;
        return;
      }
      const dot = (cam.x - entry.center.x) * entry.outward.x + (cam.z - entry.center.z) * entry.outward.z;
      const threshold = 0.15;
      if (entry.hidden) {
        if (dot < -threshold) { entry.hidden = false; entry.group.visible = true; }
      } else if (dot > threshold) {
        entry.hidden = true;
        entry.group.visible = false;
      }
    });
  }

  /* ------------------------------------------------------------ navigation */

  function newWalker(room) {
    const center = App.Home.centerOf(room);
    return {
      roomId: room.id,
      x: center.x,
      z: center.z,
      yaw: 0,
      pitch: 0,
      vx: 0,
      vz: 0,
      bob: 0
    };
  }

  function doorGates(room) {
    if (state.gateCache[room.id]) return state.gateCache[room.id];
    const gates = App.Home.openingsOf(room).map(function (item) {
      const pose = App.Home.openingPose(room, item);
      if (!pose) return null;
      const link = App.Home.linkForOpening(room.id, item.id);
      return {
        openingId: item.id,
        x: pose.x,
        z: pose.z,
        alongX: pose.along.x,
        alongZ: pose.along.z,
        inwardX: pose.inward.x,
        inwardZ: pose.inward.z,
        outwardX: pose.outward.x,
        outwardZ: pose.outward.z,
        halfSpan: Math.max(24, pose.widthCm / 2 - 4),
        inwardDeg: pose.inwardDeg,
        link: link
      };
    }).filter(Boolean);
    state.gateCache[room.id] = gates;
    return gates;
  }

  function gateAt(room, x, z) {
    const gates = doorGates(room);
    for (let i = 0; i < gates.length; i++) {
      const gate = gates[i];
      const dx = x - gate.x;
      const dz = z - gate.z;
      const along = dx * gate.alongX + dz * gate.alongZ;
      const across = dx * gate.inwardX + dz * gate.inwardZ;
      if (Math.abs(along) <= gate.halfSpan && Math.abs(across) <= 90) return gate;
    }
    return null;
  }

  function insideRoom(room, x, z, margin) {
    const rect = App.Home.rectOf(room);
    const m = margin == null ? WALK.bodyRadiusCm + WALK.wallPaddingCm : margin;
    return x >= rect.x + m && x <= rect.x + rect.w - m && z >= rect.z + m && z <= rect.z + rect.d - m;
  }

  /* Level rooms are axis-aligned rects, so clamping is the exact way to pull a
     teleported walker back inside a room it landed just outside of. */
  function placeInside(room, x, z) {
    const rect = App.Home.rectOf(room);
    const m = WALK.bodyRadiusCm + WALK.wallPaddingCm;
    return { x: U.clamp(x, rect.x + m, rect.x + rect.w - m), z: U.clamp(z, rect.z + m, rect.z + rect.d - m) };
  }

  /* Where a transition drops the walker: inside the room and off the furniture. */
  function landInRoom(room, x, z) {
    const at = placeInside(room, x, z);
    return findFreeSpot(room, at.x, at.z);
  }

  /* The walker is positioned in level coordinates, but a design stores its
     furniture in the room's own plan coordinates, so convert before testing. */
  function blockedByFurniture(room, x, z) {
    const design = App.Home.cachedDesign(room.designId);
    if (!design) return false;
    const local = App.Home.toDesignPoint(room, x, z);
    if (blockedByInteriorWall(design, local.x, local.z)) return true;
    if (!(design.placedItems || []).length) return false;
    const productsById = App.Catalog.getProductsById();
    for (let i = 0; i < design.placedItems.length; i++) {
      const item = design.placedItems[i];
      const product = productsById[item.productId];
      if (!product || product.category === 'rug') continue;
      if (G.circleOverlapsObb(local.x, local.z, WALK.bodyRadiusCm, item.xCm, item.zCm, product.widthCm, product.lengthCm, item.rotationDeg || 0)) {
        return true;
      }
    }
    return false;
  }

  /* Partition walls block the whole-home walker too; only a door opening wide
     enough for their body lets them through. */
  function blockedByInteriorWall(design, xCm, zCm) {
    const walls = design.interiorWalls || [];
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      if (!(G.interiorWallLength(wall) > 0)) continue;
      if (U.toNumber(wall.heightCm, design.room.heightCm) < 150) continue;
      const projected = G.projectOnInteriorWall(wall, xCm, zCm);
      const reach = U.toNumber(wall.thicknessCm, C.WALL_THICKNESS_CM) / 2 + WALK.bodyRadiusCm + WALK.wallPaddingCm;
      if (projected.distance > reach) continue;
      let passable = false;
      G.interiorWallOpenings(wall).forEach(function (opening) {
        if (opening.type !== 'door') return;
        if (U.toNumber(opening.heightCm, 0) < 170) return;
        const halfSpan = Math.max(0, U.toNumber(opening.widthCm, 90) / 2 - WALK.bodyRadiusCm - WALK.wallPaddingCm - 2);
        if (Math.abs(projected.offsetCm - U.toNumber(opening.offsetCm, 0)) <= halfSpan) passable = true;
      });
      if (!passable) return true;
    }
    return false;
  }

  function headingToYaw(vx, vz) {
    return Math.atan2(-vx, -vz);
  }

  function triggerLink(gate, walker) {
    const partner = App.Home.linkPartner(gate.link, walker.roomId);
    if (!partner) return false;
    const otherRoom = App.Home.roomById(partner.roomId);
    const otherOpening = otherRoom && App.Home.openingInRoom(otherRoom.id, partner.openingId);
    const pose = App.Home.openingPose(otherRoom, otherOpening);
    if (!pose) return false;
    /* Land a little way inside the partner room so the walker is clearly on the
       other side of the wall, then keep their heading relative to the doorway. */
    const inset = 45;
    walker.roomId = otherRoom.id;
    const at = landInRoom(otherRoom, pose.x + pose.inward.x * inset, pose.z + pose.inward.z * inset);
    walker.x = at.x;
    walker.z = at.z;
    const before = headingToYaw(-gate.inwardX, -gate.inwardZ);
    const after = headingToYaw(pose.inward.x, pose.inward.z);
    walker.yaw += after - before;
    state.transitionCooldown = WALK.transitionCooldown;
    if (typeof App.onHomeWalkTransition === 'function') {
      App.onHomeWalkTransition({
        kind: 'door',
        roomName: App.Home.designName(otherRoom) || 'the next room'
      });
    }
    return true;
  }

  function moveWalker(dx, dz) {
    const walker = state.walker;
    if (!walker) return;
    const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / 20));
    for (let i = 0; i < steps; i++) {
      stepWalker(dx / steps, dz / steps);
    }
  }

  /* A teleported walker can land inside a sofa or under a table, and a body
     already overlapping furniture cannot step out of it. Search nearby floor for a
     standable spot; stay put rather than teleporting across the room. */
  function findFreeSpot(room, x, z) {
    if (!blockedByFurniture(room, x, z)) return { x: x, z: z };
    const rect = App.Home.rectOf(room);
    const m = WALK.bodyRadiusCm + WALK.wallPaddingCm;
    let best = null;
    let bestScore = Infinity;
    for (let sx = rect.x + m; sx <= rect.x + rect.w - m; sx += 35) {
      for (let sz = rect.z + m; sz <= rect.z + rect.d - m; sz += 35) {
        const score = Math.hypot(sx - x, sz - z);
        if (score >= bestScore || score > 220) continue;
        if (blockedByFurniture(room, sx, sz)) continue;
        bestScore = score;
        best = { x: sx, z: sz };
      }
    }
    return best || { x: x, z: z };
  }

  /* A room edit can slide the room the walker stands in; carry the body with it
     so the view does not snap back to a stale position on the next frame. */
  function nudgeWalker(dx, dz) {
    const walker = state.walker;
    if (!walker || state.mode !== 'first') return;
    walker.x += dx;
    walker.z += dz;
    const room = App.Home.roomById(walker.roomId);
    if (room) {
      const at = landInRoom(room, walker.x, walker.z);
      walker.x = at.x;
      walker.z = at.z;
    }
    if (state.camera) {
      const at = worldOf(walker.x, walker.z);
      state.camera.position.set(at.x, WALK.eyeHeight, at.z);
    }
  }

  /* A room can be deleted while you are walking, so the walker is dropped into
     whatever is still standing instead of freezing. */
  function recoverWalker(reason) {
    const walker = state.walker;
    if (!walker) return null;
    let room = App.Home.roomById(walker.roomId);
    if (!room) {
      room = startRoom();
      if (!room) { state.walker = null; return null; }
      const center = App.Home.centerOf(room);
      walker.roomId = room.id;
      walker.x = center.x;
      walker.z = center.z;
    }
    const at = landInRoom(room, walker.x, walker.z);
    walker.x = at.x;
    walker.z = at.z;
    state.transitionCooldown = 0;
    if (typeof App.onHomeWalkTransition === 'function') {
      App.onHomeWalkTransition({ kind: reason, roomName: App.Home.designName(room) || 'a room' });
    }
    return room;
  }

  function stepWalker(dx, dz) {
    const walker = state.walker;
    let room = App.Home.roomById(walker.roomId);
    if (!room) {
      room = recoverWalker('room-lost');
      if (!room) return;
    }

    const nx = walker.x + dx;
    const nz = walker.z + dz;
    if (insideRoom(room, nx, nz) && !blockedByFurniture(room, nx, nz)) {
      walker.x = nx;
      walker.z = nz;
      return;
    }
    const gate = gateAt(room, nx, nz);
    if (gate) {
      const across = (nx - gate.x) * gate.inwardX + (nz - gate.z) * gate.inwardZ;
      /* Cross the moment the body reaches the wall line. Walking deeper in and
         teleporting later made the doorway feel like a trap. */
      if (across < 0) {
        if (gate.link && triggerLink(gate, walker)) return;
        holdAtDoor(gate);
        walker.x = nx - across * gate.inwardX;
        walker.z = nz - across * gate.inwardZ;
        return;
      }
      walker.x = nx;
      walker.z = nz;
      return;
    }
    if (insideRoom(room, nx, walker.z) && !blockedByFurniture(room, nx, walker.z)) walker.x = nx;
    if (insideRoom(room, walker.x, nz) && !blockedByFurniture(room, walker.x, nz)) walker.z = nz;
  }

  /* Collision sub-steps run many times per frame, so the "this door is locked"
     message is throttled to avoid spamming the UI with identical events. */
  function holdAtDoor(gate) {
    const now = performance.now();
    if (state.lastBlockedAt && now - state.lastBlockedAt < 900 && state.lastBlockedGate === gate.openingId) return;
    state.lastBlockedAt = now;
    state.lastBlockedGate = gate.openingId;
    if (typeof App.onHomeWalkBlocked === 'function') App.onHomeWalkBlocked(gate);
  }

  function updateWalk(dt) {
    const walker = state.walker;
    if (!walker) return;
    if (state.transitionCooldown > 0) state.transitionCooldown = Math.max(0, state.transitionCooldown - dt);
    /* Furniture can appear under the walker when a room is edited from the plan,
       and a body already inside a piece cannot step out of it, so re-stand it. */
    if (state.transitionCooldown <= 0) {
      const here = App.Home.roomById(walker.roomId);
      if (here && blockedByFurniture(here, walker.x, walker.z)) {
        const at = findFreeSpot(here, walker.x, walker.z);
        walker.x = at.x;
        walker.z = at.z;
      }
    }
    const keys = state.keys;
    const forward = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
    const strafe = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
    const sprinting = !!(keys.ShiftLeft || keys.ShiftRight);
    const moving = forward !== 0 || strafe !== 0;
    let wishX = 0;
    let wishZ = 0;
    if (moving) {
      const sin = Math.sin(walker.yaw);
      const cos = Math.cos(walker.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
      const length = Math.hypot(wishX, wishZ) || 1;
      wishX /= length;
      wishZ /= length;
    }
    const targetSpeed = sprinting ? WALK.runSpeed : WALK.walkSpeed;
    const response = 1 - Math.exp(-(moving ? WALK.acceleration : WALK.deceleration) * dt);
    walker.vx += (wishX * targetSpeed - walker.vx) * response;
    walker.vz += (wishZ * targetSpeed - walker.vz) * response;
    if (!moving && Math.hypot(walker.vx, walker.vz) < 0.01) { walker.vx = 0; walker.vz = 0; }
    const speed = Math.hypot(walker.vx, walker.vz);
    if (speed > 0.02) moveWalker(walker.vx * dt * 100, walker.vz * dt * 100);
    walker.bob = moving && speed > 0.1 ? walker.bob + dt * (5.2 + speed * 1.6) : walker.bob * 0.9;
    const bobOffset = moving && speed > 0.1 ? Math.sin(walker.bob) * 0.014 : 0;
    const at = worldOf(walker.x, walker.z);
    state.camera.position.set(at.x, WALK.eyeHeight + bobOffset, at.z);
    state.camera.up.set(0, 1, 0);
    state.camera.rotation.order = 'YXZ';
    state.camera.rotation.set(walker.pitch, walker.yaw, 0, 'YXZ');
    const targetFov = sprinting && moving ? WALK.runFov : WALK.baseFov;
    if (Math.abs(state.camera.fov - targetFov) > 0.02) {
      state.camera.fov += (targetFov - state.camera.fov) * Math.min(1, dt * 8);
      state.camera.updateProjectionMatrix();
    }
    if (state.frameId === null) requestFrame();
    notifyStatus();
  }

  /* ------------------------------------------------------------- orbit view */

  function resetCamera() {
    if (!state.initialized) return;
    const bounds = App.Home.homeBounds();
    const span = Math.max(6, Math.max(bounds.width, bounds.depth) * CM);
    state.camera.fov = WALK.orbitFov;
    state.camera.updateProjectionMatrix();
    state.camera.position.set(span * 0.55, span * 0.62, span * 0.75);
    if (state.orbit) {
      state.orbit.target.set(0, 1.2, 0);
      state.orbit.update();
    }
    state.focusAnim = null;
    renderOnce();
  }

  function focusRoom(roomId) {
    const room = App.Home.roomById(roomId);
    if (!room || !state.initialized) return;
    state.focusRoomId = roomId || null;
    const center = App.Home.centerOf(room);
    const at = worldOf(center.x, center.z);
    const rect = App.Home.rectOf(room);
    const span = Math.max(rect.w, rect.d) * CM;
    state.focusAnim = {
      t: 0,
      fromPos: state.camera.position.clone(),
      toPos: new THREE.Vector3(at.x + span * 0.75, Math.max(2.4, span * 0.85), at.z + span * 0.75),
      fromTarget: state.orbit ? state.orbit.target.clone() : new THREE.Vector3(),
      toTarget: new THREE.Vector3(at.x, 1, at.z)
    };
    requestFrame();
  }

  function updateFocusAnimation(dt) {
    const anim = state.focusAnim;
    if (!anim) { if (state.mode === 'orbit') renderOnce(); return; }
    anim.t = Math.min(1, anim.t + dt * 1.8);
    const k = anim.t < 0.5 ? 2 * anim.t * anim.t : 1 - Math.pow(-2 * anim.t + 2, 2) / 2;
    state.camera.position.lerpVectors(anim.fromPos, anim.toPos, k);
    if (state.orbit) {
      state.orbit.target.lerpVectors(anim.fromTarget, anim.toTarget, k);
      state.orbit.update();
    }
    renderOnce();
    if (anim.t >= 1) state.focusAnim = null;
  }

  /* --------------------------------------------------------------- controls */

  function bindPointer() {
    const el = state.renderer.domElement;
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup', onPointerUp);
    el.addEventListener('pointercancel', onPointerUp);
    el.addEventListener('pointerleave', function () { stopDrag(); });
    el.addEventListener('contextmenu', function (event) { event.preventDefault(); });
    el.addEventListener('blur', clearWalkInput);
    document.addEventListener('pointerlockchange', onPointerLockChange);
    document.addEventListener('pointerlockerror', onPointerLockError);
    document.addEventListener('mousemove', onLockedMouseMove);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) clearWalkInput();
    });
    window.addEventListener('blur', clearWalkInput);
  }

  function walkElement() {
    return state.renderer ? state.renderer.domElement : null;
  }

  function isWalking() { return state.mode === 'first'; }

  function requestWalkPointerLock(el) {
    if (!el.requestPointerLock) return;
    try {
      const pending = el.requestPointerLock();
      if (pending && typeof pending.catch === 'function') pending.catch(function () { /* drag-to-look stays available */ });
    } catch (err) {
      /* browsers without pointer lock use drag-to-look */
    }
  }

  function onPointerDown(event) {
    const el = walkElement();
    if (!el) return;
    state.pointerDown = { x: event.clientX, y: event.clientY };
    if (!isWalking() || event.button !== 0) return;
    if (event.pointerType !== 'touch' && event.pointerType !== 'pen' && document.pointerLockElement !== el) {
      requestWalkPointerLock(el);
    }
    if (document.pointerLockElement === el) return;
    try { el.setPointerCapture(event.pointerId); } catch (err) { /* ignore */ }
    state.dragging = true;
    state.lastLookX = event.clientX;
    state.lastLookY = event.clientY;
    el.classList.add('is-looking');
  }

  function applyLookDelta(dx, dy) {
    const walker = state.walker;
    if (!walker) return;
    walker.yaw -= dx * WALK.lookSensitivity;
    walker.pitch = U.clamp(walker.pitch - dy * WALK.lookSensitivity * 0.82, -1.15, 1.05);
    requestFrame();
  }

  function onPointerMove(event) {
    const el = walkElement();
    if (!el || !isWalking() || document.pointerLockElement === el) return;
    if (!state.dragging) return;
    const dx = event.clientX - state.lastLookX;
    const dy = event.clientY - state.lastLookY;
    state.lastLookX = event.clientX;
    state.lastLookY = event.clientY;
    applyLookDelta(dx, dy);
  }

  function stopDrag(event) {
    const el = walkElement();
    if (!el || !state.dragging) return;
    state.dragging = false;
    el.classList.remove('is-looking');
    if (event) { try { el.releasePointerCapture(event.pointerId); } catch (err) { /* ignore */ } }
  }

  function onPointerUp(event) {
    stopDrag(event);
    state.pointerDown = null;
  }

  function onPointerLockChange() {
    const el = walkElement();
    const locked = !!el && document.pointerLockElement === el;
    state.locked = locked;
    if (state.container) state.container.classList.toggle('is-pointer-locked', locked && isWalking());
    if (locked && el) {
      state.dragging = false;
      el.classList.remove('is-looking');
    }
    updateWalkTip();
    notifyStatus();
  }

  function onPointerLockError() {
    state.locked = false;
    if (state.container) state.container.classList.remove('is-pointer-locked');
    updateWalkTip();
  }

  function onLockedMouseMove(event) {
    const el = walkElement();
    if (!state.active || !isWalking() || !el || document.pointerLockElement !== el) return;
    applyLookDelta(event.movementX || 0, event.movementY || 0);
  }

  function updateWalkTip() {
    if (!state.container) return;
    const tip = state.container.querySelector('.walk-hud-tip');
    if (!tip) return;
    tip.textContent = state.locked
      ? 'Mouse captured · WASD walk · Shift run · Esc leaves walk mode'
      : 'Click or drag to look · WASD walk · Shift run · Esc leaves walk mode';
  }

  function clearWalkInput() {
    state.keys = {};
    state.dragging = false;
    const el = walkElement();
    if (el) el.classList.remove('is-looking');
    if (state.walker) { state.walker.vx = 0; state.walker.vz = 0; }
  }

  function bindKeys() {
    window.addEventListener('keydown', function (event) {
      if (state.mode !== 'first' || !state.active) return;
      if (U.isTypingTarget(event.target) || document.querySelector('.modal-backdrop')) return;
      if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].indexOf(event.code) >= 0) {
        state.keys[event.code] = true;
        event.preventDefault();
        requestFrame();
      }
      if (event.code === 'Escape' && document.pointerLockElement === state.renderer.domElement) {
        exitPointerLock();
      }
    });
    window.addEventListener('keyup', function (event) {
      state.keys[event.code] = false;
    });
  }

  function exitPointerLock() {
    if (document.pointerLockElement === state.renderer.domElement && document.exitPointerLock) {
      document.exitPointerLock();
    }
  }

  function setMode(next) {
    const mode = next === 'first' ? 'first' : 'orbit';
    if (mode === state.mode) return { ok: true };
    if (mode === 'first') {
      const start = startRoom();
      if (!start) {
        return { ok: false, error: 'Add a room before walking the home.' };
      }
      state.walker = newWalker(start);
      orientWalkerToRoom();
      if (state.orbit) state.orbit.enabled = false;
      state.camera.fov = WALK.baseFov;
      state.camera.updateProjectionMatrix();
      state.mode = 'first';
      requestFrame();
      updateWalkTip();
      if (typeof App.onHomeWalkHint === 'function') App.onHomeWalkHint();
      notifyStatus();
      return { ok: true };
    }
    state.mode = 'orbit';
    state.walker = null;
    state.keys = {};
    state.dragging = false;
    state.locked = false;
    exitPointerLock();
    if (state.container) state.container.classList.remove('is-pointer-locked');
    if (state.orbit) state.orbit.enabled = true;
    resetCamera();
    notifyStatus();
    return { ok: true };
  }

  function orientWalkerToRoom() {
    const walker = state.walker;
    const room = App.Home.roomById(walker.roomId);
    if (!room) return;
    const center = App.Home.centerOf(room);
    walker.x = center.x;
    walker.z = center.z;
    /* The middle of a furnished room is not always standable, so fall back to the
       nearest clear floor when furniture sits on the spawn point. */
    const spot = findFreeSpot(room, walker.x, walker.z);
    walker.x = spot.x;
    walker.z = spot.z;
    /* Face a doorway that actually leads somewhere, so the first thing you see is
       a way out of the room. */
    const gates = doorGates(room).filter(function (gate) { return !!gate.link; });
    const pool = gates.length ? gates : doorGates(room);
    if (!pool.length) { walker.yaw = 0; return; }
    let best = pool[0];
    let bestDist = Infinity;
    pool.forEach(function (gate) {
      const d = Math.hypot(gate.x - walker.x, gate.z - walker.z);
      if (d < bestDist) { bestDist = d; best = gate; }
    });
    walker.yaw = Math.atan2(-(best.x - walker.x), -(best.z - walker.z));
  }

  function startRoom() {
    const rooms = App.Home.rooms();
    if (!rooms.length) return null;
    if (state.focusRoomId) {
      const focused = App.Home.roomById(state.focusRoomId);
      if (focused) return focused;
    }
    const linked = rooms.find(function (room) {
      return App.Home.openingsOf(room).some(function (door) { return !!App.Home.linkForOpening(room.id, door.id); });
    });
    return linked || rooms[0];
  }

  function canWalk() {
    return App.Home.rooms().length > 0;
  }

  function setCeiling(visible) {
    state.ceilingVisible = !!visible;
    applyCeilings();
    renderOnce();
    notifyStatus();
  }

  function setCutaway(enabled) {
    state.cutaway = !!enabled;
    updateCutaway();
    renderOnce();
  }

  function sync() {
    if (!state.initialized) return;
    rebuild(false);
    notifyStatus();
  }

  function homeWallPaint() {
    const faces = [];
    if (state.worldGroup) {
      state.worldGroup.traverse(function (child) {
        if (!child.isMesh || !Array.isArray(child.material)) return;
        faces.push(child.material.map(function (material) {
          return '#' + material.color.getHexString();
        }));
      });
    }
    return faces;
  }

  function getStatus() {
    const record = App.Home.get();
    const room = state.walker ? App.Home.roomById(state.walker.roomId) : null;
    return {
      mode: state.mode,
      rooms: record ? record.rooms.length : 0,
      links: record ? record.links.length : 0,
      canWalk: canWalk(),
      locked: !!state.locked,
      walkRoom: room ? (App.Home.designName(room) || 'Room') : null,
      ceiling: state.ceilingVisible,
      cutaway: state.cutaway,
      walls: state.wallEntries.length,
      hiddenWalls: state.wallEntries.filter(function (entry) { return !entry.group.visible; }).length,
      wallPaint: homeWallPaint(),
      camera: state.camera ? {
        y: U.round(state.camera.position.y, 3),
        yaw: U.round(state.camera.rotation.y, 5),
        pitch: U.round(state.camera.rotation.x, 5)
      } : null
    };
  }

  let lastStatusKey = '';
  function notifyStatus() {
    const status = getStatus();
    const key = status.mode + '|' + status.walkRoom + '|' + status.locked + '|' + status.rooms + '|' + status.links;
    if (key === lastStatusKey) return;
    lastStatusKey = key;
    if (typeof App.onHome3DStatus === 'function') App.onHome3DStatus(status);
  }

  function walkPose() {
    const walker = state.walker;
    if (!walker) return null;
    return { roomId: walker.roomId, x: walker.x, z: walker.z, yCm: 0, yaw: walker.yaw, pitch: walker.pitch };
  }

  App.Home3D = {
    init: init,
    setActive: setActive,
    sync: sync,
    rebuild: function () { rebuild(true); },
    setMode: setMode,
    getMode: function () { return state.mode; },
    setCeiling: setCeiling,
    setCutaway: setCutaway,
    focusRoom: focusRoom,
    resetCamera: resetCamera,
    getStatus: getStatus,
    getWalkPose: walkPose,
    nudgeWalker: nudgeWalker,
    canWalk: canWalk,
    resize: resize
  };
})(window.App = window.App || {});
