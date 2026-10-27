(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;

  const ui = {
    booted: false,
    isOpen: false,
    view: 'plan',
    planReady: false,
    threeReady: false,
    threeFailed: false,
    selectedRoomId: null,
    saveTimer: null,
    saveBusy: false,
    saveAgain: false,
    lastSavedAt: null,
    loading: false,
    threeWasActive: false,
    selectedLinkId: null,
    restoredFrom: null
  };

  const els = {};
  const IDS = [
    'homeOverlay', 'homeOpenBtn', 'homeCloseBtn', 'homeNameInput',
    'homeAddRoomBtn', 'homeArrangeBtn', 'homeAutoLinkBtn', 'homeFitBtn', 'homeZoomInBtn', 'homeZoomOutBtn',
    'homeViewPlanBtn', 'homeView3dBtn', 'homeModeOrbitBtn', 'homeModeWalkBtn', 'homeCeilingToggle',
    'homeCutawayToggle', 'homeResetViewBtn', 'homeTools', 'homeHint', 'homeSaveStatus',
    'homePlanWrap', 'homePlanCanvas', 'homeEmpty', 'homeEmptyAddBtn', 'homeEmptyDesignsBtn',
    'homeViewer3d', 'homeSide', 'homeWalkHud',
    'homeExportBtn', 'homeImportBtn', 'homeImportInput'
  ];

  function find(id) { return document.getElementById(id); }

  function cacheElements() {
    IDS.forEach(function (id) { els[id] = find(id); });
  }

  function available() {
    return !!(els.homeOverlay && App.Home && App.HomePlan);
  }

  /* ------------------------------------------------------------------ boot */

  function boot() {
    if (ui.booted) return;
    cacheElements();
    if (!available()) return;
    ui.booted = true;
    bindControls();
    restore();
    App.onHomePlanSelect = onPlanSelect;
    App.onHomePlanHint = onPlanHint;
    App.onHomePlanAction = onPlanAction;
    App.onHome3DStatus = on3DStatus;
    App.onHomeWalkTransition = onWalkTransition;
    App.onHomeWalkBlocked = onWalkBlocked;
    App.onHomeWalkHint = onWalkHint;
    if (els.homeOpenBtn) els.homeOpenBtn.addEventListener('click', function () { open(); });
    App.openWholeHome = open;
    App.isWholeHomeOpen = function () { return ui.isOpen; };
  }

  async function restore() {
    try {
      const loaded = await App.Storage.loadHome();
      if (loaded && loaded.home) {
        const normalized = App.Home.normalizeHome(loaded.home);
        if (normalized.home) {
          App.Home.init(normalized.home);
          ui.lastSavedAt = loaded.savedAt ? new Date(loaded.savedAt) : null;
          ui.restoredFrom = loaded.source;
          App.Home.subscribe(onHomeChanged);
          updateSaveStatus('saved');
          if (normalized.warnings && normalized.warnings.length) {
            U.showToast('Whole Home restored with notes: ' + normalized.warnings.join(' '), 'warning', { duration: 8000 });
          }
          return;
        }
        if (normalized.warnings && normalized.warnings.length) {
          U.showToast('The saved Whole Home could not be validated: ' + normalized.warnings.join(' '), 'warning', { duration: 8000 });
        }
      }
    } catch (err) {
      console.error('Whole Home restore failed:', err);
      U.showToast('The saved Whole Home could not be read. Existing browser data was not deleted.', 'warning', { duration: 7000 });
    }
    App.Home.subscribe(onHomeChanged);
  }

  function ensureHome() {
    if (App.Home.get()) return;
    const current = App.State ? App.State.get() : null;
    App.Home.init(App.Home.create({ name: current && current.name ? current.name + ' · home' : 'My whole home' }));
    if (current && current.id) App.Home.primeDesign(current.id, current);
  }

  /* --------------------------------------------------------------- opening */

  function open() {
    if (!available()) {
      U.showToast('The Whole Home view did not load in this browser.', 'error');
      return;
    }
    ensureHome();
    ui.threeWasActive = !!(App.isThreeViewActive && App.isThreeViewActive());
    if (ui.threeWasActive && App.Viewer3D) App.Viewer3D.setActive(false);
    els.homeOverlay.hidden = false;
    document.body.classList.add('whole-home-open');
    ui.isOpen = true;
    if (!ui.planReady) {
      App.HomePlan.init(els.homePlanCanvas, els.homePlanWrap);
      ui.planReady = true;
    }
    renderSide();
    applyView();
    refreshDesigns();
    setTimeout(function () {
      App.HomePlan.fitView();
      if (els.homeNameInput) els.homeNameInput.focus();
    }, 30);
  }

  function close() {
    if (!ui.isOpen) return;
    ui.isOpen = false;
    els.homeOverlay.hidden = true;
    document.body.classList.remove('whole-home-open');
    if (ui.threeReady) App.Home3D.setActive(false);
    saveNow();
    if (ui.threeWasActive) {
      ui.threeWasActive = false;
      if (App.resumeThreeView) App.resumeThreeView();
    }
  }

  async function refreshDesigns() {
    if (ui.loading) return;
    const rooms = App.Home.rooms();
    if (!rooms.length) { renderSide(); return; }
    ui.loading = true;
    try {
      rooms.forEach(function (room) { App.Home.invalidateDesign(room.designId); });
      await App.Home.ensureDesigns();
      App.Home.syncRoomDimensions();
    } catch (err) {
      console.error('Whole Home room refresh failed:', err);
    } finally {
      ui.loading = false;
      renderSide();
      App.HomePlan.afterChange();
      if (ui.view === 'three' && ui.threeReady) App.Home3D.rebuild();
    }
  }

  /* ------------------------------------------------------------ persistence */

  function scheduleSave() {
    updateSaveStatus('dirty');
    clearTimeout(ui.saveTimer);
    ui.saveTimer = setTimeout(saveNow, 700);
  }

  async function saveNow() {
    const home = App.Home.get();
    if (!home) return;
    clearTimeout(ui.saveTimer);
    if (ui.saveBusy) { ui.saveAgain = true; return; }
    ui.saveBusy = true;
    updateSaveStatus('saving');
    try {
      const result = await App.Storage.saveHome(home);
      if (result.ok) {
        ui.lastSavedAt = result.savedAt ? new Date(result.savedAt) : new Date();
        updateSaveStatus('saved');
      } else {
        updateSaveStatus('error');
      }
    } catch (err) {
      console.error(err);
      updateSaveStatus('error');
    } finally {
      ui.saveBusy = false;
      if (ui.saveAgain) { ui.saveAgain = false; saveNow(); }
    }
  }

  function flushSave() {
    const home = App.Home.get();
    if (!home) return;
    try { App.Storage.saveHomeSync(home); } catch (err) { /* storage may be blocked */ }
  }

  function updateSaveStatus(kind) {
    const el = els.homeSaveStatus;
    if (!el) return;
    el.classList.remove('is-saved', 'is-saving', 'is-error', 'is-dirty');
    if (kind === 'dirty') {
      el.classList.add('is-dirty');
      el.innerHTML = '<span class="save-dot"></span> Unsaved';
    } else if (kind === 'saving') {
      el.classList.add('is-saving');
      el.innerHTML = '<span class="save-dot"></span> Saving…';
    } else if (kind === 'error') {
      el.classList.add('is-error');
      el.innerHTML = '<span class="save-dot"></span> Not saved';
      el.title = 'Browser storage is unavailable. Export a backup so the home is not lost.';
    } else {
      el.classList.add('is-saved');
      el.innerHTML = '<span class="save-dot"></span> ' + (ui.lastSavedAt ? 'Saved ' + U.formatTime(ui.lastSavedAt.toISOString()) : 'Saved locally');
    }
  }

  function onHomeChanged(home, reason) {
    if (!ui.isOpen) {
      if (reason !== 'init') scheduleSave();
      return;
    }
    App.HomePlan.afterChange();
    renderSide();
    updateEmptyState();
    if (ui.view === 'three' && ui.threeReady) App.Home3D.sync();
    if (reason !== 'init') scheduleSave();
  }

  /* ------------------------------------------------------------ view + tools */

  function applyView() {
    const plan = ui.view !== 'three';
    els.homePlanWrap.hidden = plan === false;
    els.homeViewer3d.hidden = plan;
    if (els.homeViewPlanBtn) {
      els.homeViewPlanBtn.classList.toggle('is-active', plan);
      els.homeViewPlanBtn.setAttribute('aria-selected', plan ? 'true' : 'false');
    }
    if (els.homeView3dBtn) {
      els.homeView3dBtn.classList.toggle('is-active', !plan);
      els.homeView3dBtn.setAttribute('aria-selected', !plan ? 'true' : 'false');
    }
    if (els.homeTools) {
      els.homeTools.querySelectorAll('[data-home-tool]').forEach(function (btn) {
        btn.hidden = !plan;
      });
    }
    if (els.homeZoomInBtn) els.homeZoomInBtn.hidden = !plan;
    if (els.homeZoomOutBtn) els.homeZoomOutBtn.hidden = !plan;
    if (els.homeFitBtn) els.homeFitBtn.hidden = !plan;
    updateEmptyState();
    if (plan) {
      App.HomePlan.afterChange();
    } else {
      activate3D();
    }
    updateModeButtons();
  }

  function updateEmptyState() {
    if (!els.homeEmpty) return;
    const hasRooms = App.Home.rooms().length > 0;
    els.homeEmpty.hidden = hasRooms || ui.view === 'three';
  }

  function activate3D() {
    if (!ui.threeReady && !ui.threeFailed) {
      const ok = App.Home3D.init(els.homeViewer3d);
      if (!ok) {
        ui.threeFailed = true;
        els.homeViewer3d.innerHTML = '<div class="home3d-failure"><strong>3D is unavailable</strong>' +
          '<p>This browser could not start WebGL, so the whole-home 3D view cannot render. The 2D plan still works.</p></div>';
        setHint('3D could not start in this browser.');
        return;
      }
      ui.threeReady = true;
    }
    if (!ui.threeReady) return;
    App.Home3D.setActive(true);
    App.Home3D.resize();
    updateModeButtons();
  }

  function setViewMode(view) {
    ui.view = view === 'three' ? 'three' : 'plan';
    if (ui.view === 'plan' && ui.threeReady) App.Home3D.setActive(false);
    applyView();
    if (ui.view === 'plan') setTimeout(function () { App.HomePlan.fitView(); }, 20);
  }

  function setTool(tool) {
    App.HomePlan.setTool(tool);
    if (els.homeTools) {
      els.homeTools.querySelectorAll('[data-home-tool]').forEach(function (btn) {
        const active = btn.getAttribute('data-home-tool') === tool;
        btn.classList.toggle('is-active', active);
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      });
    }
  }

  function currentTool() { return App.HomePlan.getTool(); }

  /* ------------------------------------------------------------- room picker */

  function openRoomPicker() {
    const inHome = {};
    App.Home.rooms().forEach(function (room) { inHome[room.designId] = true; });
    App.Storage.listDesigns().then(function (envs) {
      const options = (envs || []).filter(function (env) { return env && env.design && env.design.id; });
      const free = options.filter(function (env) { return !inHome[env.design.id]; });
      if (!options.length) {
        U.showToast('Nothing saved yet. Design a room, then use Save design before adding it here.', 'warning', { duration: 6500 });
        return;
      }
      const body = []
        .concat(free.map(function (env) { return { env: env, used: false }; }))
        .concat(options.filter(function (env) { return inHome[env.design.id]; }).map(function (env) { return { env: env, used: true }; }));
      let html = '<p class="home-picker-note">Pick a saved room design to place in this home.' +
        ' Rooms already in the home are listed last — use Duplicate on the room card to place a second copy.</p>';
      html += '<div class="home-picker-list">';
      body.forEach(function (row) {
        const d = row.env.design;
        html += '<label class="home-pick-row' + (row.used ? ' is-used' : '') + '">' +
          (row.used
            ? '<span class="home-pick-radio" aria-hidden="true">✓</span>'
            : '<input type="radio" name="homePick" value="' + U.escapeHtml(d.id) + '">') +
          '<span class="home-pick-copy"><strong>' + U.escapeHtml(d.name || 'Untitled') + '</strong>' +
          '<small>' + U.formatRoomDims(d.room) + ' · ' + (d.placedItems || []).length + ' item(s) · ' +
          (row.used ? 'already in the home' : (C.ROOM_USES[d.roomUse] ? C.ROOM_USES[d.roomUse].label : 'saved design')) + '</small></span></label>';
      });
      html += '</div>';
      U.openModal({
        title: 'Add a saved room',
        eyebrow: 'Whole home',
        wide: true,
        bodyHtml: html,
        actions: [
          { label: 'Cancel', kind: 'secondary', value: 'cancel' },
          {
            label: 'Add room', kind: 'primary', busyLabel: 'Adding…', onClick: function () {
              const checked = document.querySelector('.modal-body input[name="homePick"]:checked');
              if (!checked) { U.showToast('Choose a room design first.', 'warning'); return false; }
              return addRoomFromDesign(checked.value).then(function (room) {
                if (!room) return false;
                setHint('');
                U.showToast('Room added. Drag it into place on the plan.', 'success');
              });
            }
          }
        ]
      });
    }).catch(function (err) {
      console.error(err);
      U.showToast('Saved designs could not be listed.', 'error');
    });
  }

  function addRoomFromDesign(designId) {
    return App.Home.loadDesign(designId).then(function (design) {
      if (!design) {
        U.showToast('That saved design could not be read from this browser.', 'error');
        return null;
      }
      const result = App.Home.addRoom({ designId: designId });
      if (!result.ok) {
        U.showToast(result.error, 'warning', { duration: 6000 });
        return null;
      }
      ui.selectedRoomId = result.room.id;
      App.HomePlan.setSelected({ type: 'room', id: result.room.id });
      renderSide();
      App.HomePlan.afterChange();
      if (ui.view === 'three' && ui.threeReady) App.Home3D.sync();
      return result.room;
    });
  }

  /* --------------------------------------------------------- plan callbacks */

  function onPlanSelect(zone) {
    if (!zone) {
      ui.selectedRoomId = null;
      renderSide();
      return;
    }
    if (zone.type === 'room') {
      ui.selectedRoomId = zone.id;
    } else if (zone.type === 'door' || zone.type === 'window') {
      ui.selectedRoomId = zone.roomId;
      const room = App.Home.roomById(zone.roomId);
      const name = room ? (App.Home.designName(room) || 'this room') : 'a room';
      if (zone.type === 'window') setHint('A window in ' + name + ' — light, not a way through.');
      else setHint(zone.linked ? 'A linked door in ' + name + ': walk through it in 3D.' : 'An unlinked door in ' + name + ': use Link doors to join it to another room.');
    } else if (zone.type === 'link') {
      ui.selectedLinkId = zone.id;
    }
    renderSide();
  }

  function onPlanHint(text) { setHint(text); }

  function onPlanAction(action, result) {
    if (!result) return;
    if (action === 'remove-room') { confirmRemoveRoom(result.roomId); return; }
    if (action === 'opening-in-design') { editOpeningInDesign(result); return; }
    if (result.ok === false && result.error && result.error !== 'blocked') {
      U.showToast(result.error, 'warning');
    }
    if (action === 'link' && result.ok) U.showToast('Doors linked. You can now walk between those rooms.', 'success');
    if (action === 'connect-door' && result.ok) {
      const name = App.Home.designName(result.room) || 'the next room';
      const notes = [];
      if (result.created) notes.push('A matching door was cut into its facing wall.');
      if (result.moved) notes.push('The room was moved against the doorway.');
      U.showToast('Door connected to ' + name + '. ' + notes.join(' '), 'success', { duration: 6500 });
    }
  }

  function editOpeningInDesign(payload) {
    const room = App.Home.roomById(payload.roomId);
    if (!room) return;
    const name = App.Home.designName(room) || 'this room';
    const kind = payload.kind === 'window' ? 'window' : 'door';
    U.confirmDialog('Open ' + name + ' in the planner?',
      'Doors and windows live inside a room design, so the planner will open ' + name +
      ' so you can move or resize the ' + kind + '. Save the design afterwards to update the home.',
      { confirmLabel: 'Open in planner' }).then(function (yes) {
        if (!yes) return;
        close();
        if (App.openRoomDesignFromHome) App.openRoomDesignFromHome(room.designId);
      });
  }

  function confirmRemoveRoom(id) {
    const room = App.Home.roomById(id);
    if (!room) return;
    const name = App.Home.designName(room) || 'this room';
    U.confirmDialog('Remove ' + name + '?', 'The saved design stays in My designs; only this copy leaves the home.')
      .then(function (yes) {
        if (!yes) return;
        const result = App.Home.removeRoom(id);
        if (!result.ok) { U.showToast(result.error, 'error'); return; }
        if (ui.selectedRoomId === id) ui.selectedRoomId = null;
        App.HomePlan.setSelected(null);
        renderSide();
        if (ui.view === 'three' && ui.threeReady) App.Home3D.sync();
      });
  }

  function setHint(text) {
    if (els.homeHint) els.homeHint.textContent = text || '';
  }

  /* --------------------------------------------------------------- side panel */

  function checklist() {
    const home = App.Home.get();
    const rooms = home ? home.rooms.length : 0;
    const links = home ? home.links.length : 0;
    const unlinked = home ? App.Home.issues().filter(function (i) { return i.code === 'unlinked'; }).length : 0;
    return [
      { done: rooms > 0, label: 'Add saved rooms', detail: rooms ? rooms + ' placed' : 'Use Add saved room' },
      { done: rooms > 1, label: 'Arrange them on the plan', detail: 'Drag rooms, R rotates the selected one' },
      { done: rooms > 0 && links > 0 && unlinked === 0, label: 'Link doors between rooms', detail: links ? links + ' linked, ' + unlinked + ' still dead-ended' : 'Door tool, then click two doors' },
      { done: rooms > 0 && links > 0, label: 'Walk the home in 3D', detail: 'Switch to 3D and press Walk' }
    ];
  }

  function renderSide() {
    const side = els.homeSide;
    if (!side) return;
    const home = App.Home.get();
    if (!home) { side.innerHTML = ''; return; }
    const stats = App.Home.stats();
    const issues = App.Home.issues();
    const html = [];

    html.push('<section class="home-side-card home-side-guide">');
    html.push('<h3>Build the whole home</h3>');
    html.push('<ol class="home-checklist">');
    checklist().forEach(function (item) {
      html.push('<li class="' + (item.done ? 'is-done' : '') + '"><span class="home-check-dot" aria-hidden="true">' +
        (item.done ? '✓' : '') + '</span><span><strong>' + U.escapeHtml(item.label) + '</strong><small>' +
        U.escapeHtml(item.detail) + '</small></span></li>');
    });
    html.push('</ol></section>');

    html.push('<section class="home-side-card"><div class="home-side-head"><h3>Rooms</h3>' +
      '<button type="button" class="btn btn-small btn-secondary" data-home-action="add-room">Add saved room</button></div>');
    if (!home.rooms.length) {
      html.push('<p class="home-side-empty">Nothing here yet. Save a room design from the planner, then add it to this home.</p>');
    }
    home.rooms.forEach(function (room) {
      const design = App.Home.cachedDesign(room.designId);
      const items = design ? (design.placedItems || []).length : 0;
      const doors = design ? App.Home.openingsOf(room).length : 0;
      const selected = room.id === ui.selectedRoomId;
      html.push('<article class="home-room-card' + (selected ? ' is-selected' : '') + '" data-room-id="' + U.escapeHtml(room.id) + '">');
      html.push('<div class="home-room-card-top"><strong>' + U.escapeHtml(App.Home.designName(room) || 'Room') + '</strong>');
      html.push('<span class="home-room-dims">' + Math.round(room.widthCm) + ' × ' + Math.round(room.lengthCm) + ' cm</span></div>');
      html.push('<p class="home-room-meta">' + items + ' item' + (items === 1 ? '' : 's') + ' · ' + doors + ' door' + (doors === 1 ? '' : 's') +
        ' · ' + (room.shape === 'circle' ? 'round' : 'rect') + '</p>');
      html.push('<div class="home-room-actions">');
      html.push('<button type="button" class="btn btn-tiny btn-secondary" data-home-action="focus-room" data-id="' + U.escapeHtml(room.id) + '" title="Center the plan on this room">Focus</button>');
      html.push('<button type="button" class="btn btn-tiny btn-secondary" data-home-action="rotate-room" data-id="' + U.escapeHtml(room.id) + '" title="Rotate 90°">Rotate</button>');
      html.push('<button type="button" class="btn btn-tiny btn-secondary" data-home-action="duplicate-room" data-id="' + U.escapeHtml(room.id) + '" title="Place a second copy of this design">Duplicate</button>');
      html.push('<button type="button" class="btn btn-tiny btn-danger-text" data-home-action="remove-room" data-id="' + U.escapeHtml(room.id) + '" title="Remove from the home">Remove</button>');
      html.push('</div></article>');
    });
    html.push('</section>');

    html.push('<section class="home-side-card"><div class="home-side-head"><h3>Connections</h3>' +
      '<div class="home-side-head-actions"><button type="button" class="btn btn-tiny btn-secondary" data-home-action="auto-link">Auto-link doors</button></div></div>');
    if (!home.links.length) {
      html.push('<p class="home-side-empty">No links yet. Doors stay shut until you connect them with the Link doors tool or Auto-link.</p>');
    }
    home.links.forEach(function (link) {
      const a = App.Home.roomById(link.fromRoomId);
      const b = App.Home.roomById(link.toRoomId);
      html.push('<div class="home-conn-row"><span>' + U.escapeHtml(App.Home.designName(a) || 'Room') + ' ↔ ' + U.escapeHtml(App.Home.designName(b) || 'Room') + '</span>' +
        '<button type="button" class="link-button" data-home-action="remove-link" data-id="' + U.escapeHtml(link.id) + '">Unlink</button></div>');
    });
    html.push('</section>');

    html.push('<section class="home-side-card"><h3>Checks</h3>');
    if (!issues.length) {
      html.push('<p class="home-side-ok">Nothing blocking a walk-through of this home.</p>');
    } else {
      html.push('<ul class="home-issue-list">');
      issues.slice(0, 12).forEach(function (issue) {
        html.push('<li class="is-' + issue.severity + '">' + U.escapeHtml(issue.message) + '</li>');
      });
      if (issues.length > 12) html.push('<li>… ' + (issues.length - 12) + ' more</li>');
      html.push('</ul>');
    }
    html.push('</section>');

    html.push('<section class="home-side-card home-side-stats"><h3>Whole home</h3><dl>');
    html.push('<div><dt>Rooms</dt><dd>' + stats.rooms + '</dd></div>');
    html.push('<div><dt>Floor area</dt><dd>' + U.formatNumber(stats.areaSqm, 1) + ' m²</dd></div>');
    html.push('<div><dt>Furniture</dt><dd>' + stats.items + '</dd></div>');
    html.push('<div><dt>Catalog total</dt><dd>' + U.formatMoney(stats.price) + '</dd></div>');
    html.push('</dl></section>');

    side.innerHTML = html.join('');
  }

  /* ----------------------------------------------------------- side actions */

  function onSideClick(event) {
    const btn = event.target.closest('[data-home-action]');
    if (!btn) return;
    const action = btn.getAttribute('data-home-action');
    const id = btn.getAttribute('data-id');
    if (action === 'add-room') { openRoomPicker(); return; }
    if (action === 'focus-room') { focusRoom(id); return; }
    if (action === 'rotate-room') {
      const result = App.Home.rotateRoom(id, 90);
      if (!result.ok) { U.showToast(result.error, 'warning'); return; }
      App.HomePlan.afterChange();
      renderSide();
      return;
    }
    if (action === 'duplicate-room') {
      const result = App.Home.duplicateRoom(id);
      if (!result.ok) { U.showToast(result.error, 'warning'); return; }
      ui.selectedRoomId = result.room.id;
      App.HomePlan.afterChange();
      renderSide();
      U.showToast('Second copy placed. Drag it to its own spot.', 'success');
      return;
    }
    if (action === 'remove-room') {
      const room = App.Home.roomById(id);
      const name = room ? (App.Home.designName(room) || 'this room') : 'this room';
      U.confirmDialog('Remove ' + name + '?', 'The saved design stays in My designs; only this copy leaves the home.')
        .then(function (yes) {
          if (!yes) return;
          const result = App.Home.removeRoom(id);
          if (!result.ok) { U.showToast(result.error, 'error'); return; }
          if (ui.selectedRoomId === id) ui.selectedRoomId = null;
          App.HomePlan.setSelected(null);
          renderSide();
          if (ui.view === 'three' && ui.threeReady) App.Home3D.sync();
        });
      return;
    }
    if (action === 'remove-link') {
      const result = App.Home.removeLink(id);
      if (!result.ok) { U.showToast(result.error, 'error'); return; }
      renderSide();
      return;
    }
    if (action === 'auto-link') {
      const result = App.Home.autoLink();
      if (!result.ok) { U.showToast(result.error, 'warning'); return; }
      U.showToast(autoLinkSummary(result), result.created ? 'success' : 'warning', { duration: 6500 });
      return;
    }
  }

  function autoLinkSummary(result) {
    if (!result || !result.created) {
      return 'No doors faced each other closely enough, and every room already had a way in. Drag rooms together or use the Link doors tool.';
    }
    const parts = [result.created + (result.created === 1 ? ' doorway linked' : ' doorways linked')];
    if (result.addedDoors) parts.push(result.addedDoors + (result.addedDoors === 1 ? ' new door cut into a wall' : ' new doors cut into walls'));
    if (result.moved) parts.push(result.moved + (result.moved === 1 ? ' room moved against its doorway' : ' rooms moved against their doorways'));
    return parts.join(' · ') + '.';
  }

  function focusRoom(id) {
    const room = App.Home.roomById(id);
    if (!room) return;
    ui.selectedRoomId = id;
    App.HomePlan.setSelected({ type: 'room', id: id });
    App.HomePlan.focusRoom(id);
    if (ui.view === 'three' && ui.threeReady) App.Home3D.focusRoom(id);
    renderSide();
  }

  /* ------------------------------------------------------------- 3D + walk */

  function setMode(mode) {
    if (!ui.threeReady) { U.showToast('Open the 3D view first.', 'warning'); return; }
    if (mode === 'first') ensureWalkableDoors();
    const result = App.Home3D.setMode(mode);
    if (!result.ok) { U.showToast(result.error, 'warning', { duration: 6000 }); return; }
    updateModeButtons();
  }

  /* A door that leads nowhere makes a walk feel broken. Offer the one-click fix
     before the walker starts rather than rewriting the plan on its own. */
  function ensureWalkableDoors() {
    const home = App.Home.get();
    if (!home || home.rooms.length < 2) return null;
    const stray = home.rooms.some(function (room) {
      return App.Home.openingsOf(room).some(function (door) {
        return !App.Home.linkForOpening(room.id, door.id);
      });
    });
    if (!stray) return null;
    U.showToast('Some doors still lead nowhere, so a walk would hit a dead end. Connect them now?', 'warning', {
      duration: 9000,
      actionLabel: 'Connect doors',
      onAction: function () {
        const result = App.Home.autoLink();
        if (!result.ok) { U.showToast(result.error, 'warning'); return; }
        U.showToast(autoLinkSummary(result), result.created ? 'success' : 'warning', { duration: 6500 });
        setHint('Doorways joined. Walk through a doorway to reach the next room.');
      }
    });
    return null;
  }

  function toggleChipHidden(input, hidden) {
    if (!input) return;
    const chip = input.closest('.toggle-chip');
    if (chip) chip.hidden = !!hidden;
  }

  function updateModeButtons() {
    const three = ui.view === 'three';
    const mode = three && ui.threeReady ? App.Home3D.getMode() : 'orbit';
    if (els.homeModeOrbitBtn) {
      els.homeModeOrbitBtn.hidden = !three;
      els.homeModeOrbitBtn.classList.toggle('is-active', mode === 'orbit');
      els.homeModeOrbitBtn.setAttribute('aria-pressed', mode === 'orbit' ? 'true' : 'false');
    }
    if (els.homeModeWalkBtn) {
      els.homeModeWalkBtn.hidden = !three;
      els.homeModeWalkBtn.classList.toggle('is-active', mode === 'first');
      els.homeModeWalkBtn.setAttribute('aria-pressed', mode === 'first' ? 'true' : 'false');
      els.homeModeWalkBtn.disabled = three && ui.threeReady ? !App.Home3D.canWalk() : true;
      els.homeModeWalkBtn.title = App.Home.get() && App.Home.rooms().length ? 'Walk through linked doors' : 'Add rooms before walking';
    }
    if (els.homeResetViewBtn) els.homeResetViewBtn.hidden = !three;
    toggleChipHidden(els.homeCeilingToggle, !three);
    toggleChipHidden(els.homeCutawayToggle, !three);
    if (els.homeWalkHud) els.homeWalkHud.classList.toggle('is-on', three && mode === 'first');
    if (three) {
      setHint(mode === 'first'
        ? 'Walk mode: click or drag to look, W A S D to move, Shift to run. Linked doors take you into the next room.'
        : 'Orbit mode: drag to rotate, scroll to zoom, right-drag to pan. Click a room in the list to focus it.');
    }
  }

  function on3DStatus(status) {
    if (!status) return;
    updateModeButtons();
    if (status.mode === 'first' && status.walkRoom) {
      setHint('Walking in ' + status.walkRoom + '. Linked doors take you into the next room.');
    }
  }

  function onWalkTransition(info) {
    if (!info) return;
    if (info.kind === 'door') {
      setHint('Through the door into ' + info.roomName + '.');
      return;
    }
    setHint('That room left the home — you are now in ' + info.roomName + '.');
  }

  function onWalkBlocked(gate) {
    U.showToast('This door leads nowhere yet. Connect it to the nearest room?', 'warning', {
      duration: 8000,
      actionLabel: 'Connect door',
      onAction: function () { connectBlockedDoor(gate); }
    });
  }

  function connectBlockedDoor(gate) {
    const pose = App.Home3D.getWalkPose();
    const room = pose ? App.Home.roomById(pose.roomId) : null;
    if (!room || !gate) return;
    const opening = App.Home.openingInRoom(room.id, gate.openingId);
    if (!opening) return;
    const candidates = App.Home.nearestRoomsFor(room, opening, 4);
    if (!candidates.length) {
      U.showToast('Add a second room before this door can lead anywhere.', 'warning', { duration: 6000 });
      return;
    }
    /* A diagonal neighbour may have no wall facing the door, so keep trying the
       next closest room instead of stopping at the first refusal. */
    let result = null;
    for (let i = 0; i < candidates.length; i++) {
      result = App.Home.connectDoor(room.id, opening.id, candidates[i].room.id);
      if (result.ok) break;
    }
    if (!result || !result.ok) {
      U.showToast((result && result.error) || 'That door could not be connected.', 'warning', { duration: 6500 });
      return;
    }
    const name = App.Home.designName(result.room) || 'the next room';
    U.showToast('Connected to ' + name + ' — walk through the doorway now.', 'success', { duration: 6000 });
    setHint('A doorway into ' + name + ' is open. Walk forward through it.');
  }

  function onWalkHint() {
    setHint('Click or drag inside the 3D scene to look around, then W A S D to walk. Shift runs.');
  }

  /* ------------------------------------------------------------------ backup */

  async function exportHome() {
    const home = App.Home.get();
    if (!home || !home.rooms.length) { U.showToast('Add at least one room before exporting the home.', 'warning'); return; }
    updateSaveStatus('saving');
    try {
      const result = await App.Export.downloadHomeBackup();
      updateSaveStatus('saved');
      const note = result.missingCount
        ? ' ' + result.missingCount + ' room design(s) are missing from this browser and were not included.'
        : '';
      U.showToast('Exported ' + result.roomCount + ' room(s) and ' + result.designCount + ' design(s).' + note,
        result.missingCount ? 'warning' : 'success', { duration: 6500 });
    } catch (err) {
      updateSaveStatus('error');
      console.error('Whole Home export failed:', err);
      U.showToast(err.message || 'The home could not be exported.', 'error', { duration: 7000 });
    }
  }

  async function importHome(file) {
    if (!file) return;
    let parsed = null;
    let normalized = null;
    try {
      parsed = App.Storage.parseHomeBackup(await U.readFileAsText(file));
      normalized = App.Home.normalizeHome(parsed.home);
    } catch (err) {
      console.error('Whole Home import failed:', err);
      const message = err && err.name === 'SyntaxError' ? 'This file is not valid JSON.' : (err.message || 'The backup could not be read.');
      U.showToast(message, 'error', { duration: 8000 });
      return;
    }
    if (!normalized.home) {
      U.showToast('The backup contains no valid home: ' + normalized.warnings.join(' '), 'error', { duration: 9000 });
      return;
    }
    const current = App.Home.get();
    const hasCurrent = !!(current && current.rooms.length);
    const confirmed = await U.confirm('Replace this home?',
      'The backup holds ' + normalized.home.rooms.length + ' room(s) and ' + parsed.designs.length + ' saved design(s).' +
      (hasCurrent ? ' Your current home (' + current.rooms.length + ' room(s)) will be replaced, and any saved design with the same ID will be overwritten.' : '') +
      ' Catalog photos and 3D model files are not part of a backup.',
      { confirmLabel: 'Import home', danger: true });
    if (!confirmed) return;
    try {
      for (let i = 0; i < parsed.designs.length; i++) {
        await App.Storage.saveDesign(parsed.designs[i]);
      }
      parsed.designs.forEach(function (design) { App.Home.invalidateDesign(design.id); });
      App.Home.init(normalized.home);
      ui.selectedLinkId = null;
      if (els.homeNameInput) els.homeNameInput.value = normalized.home.name;
      renderSide();
      updateEmptyState();
      await refreshDesigns();
      App.HomePlan.fitView();
      if (ui.view === 'three' && ui.threeReady) App.Home3D.sync();
      await saveNow();
      U.showToast('Home “' + normalized.home.name + '” imported.' +
        (normalized.warnings.length ? ' ' + normalized.warnings.join(' ') : ''),
        normalized.warnings.length ? 'warning' : 'success', { duration: 8000 });
    } catch (err) {
      console.error('Whole Home import failed:', err);
      U.showToast((err && err.message) || 'The backup could not be applied.', 'error', { duration: 8000 });
    }
  }

  /* ---------------------------------------------------------------- binding */

  function bindControls() {
    if (els.homeCloseBtn) els.homeCloseBtn.addEventListener('click', close);
    if (els.homeNameInput) {
      els.homeNameInput.addEventListener('change', function () {
        const result = App.Home.setName(els.homeNameInput.value);
        if (result && result.ok === false) { U.showToast(result.error || 'Name not saved.', 'warning'); return; }
        scheduleSave();
      });
    }
    if (els.homeTools) {
      els.homeTools.addEventListener('click', function (event) {
        const btn = event.target.closest('[data-home-tool]');
        if (!btn) return;
        setTool(btn.getAttribute('data-home-tool'));
      });
    }
    if (els.homeAddRoomBtn) els.homeAddRoomBtn.addEventListener('click', openRoomPicker);
    if (els.homeEmptyAddBtn) els.homeEmptyAddBtn.addEventListener('click', openRoomPicker);
    if (els.homeEmptyDesignsBtn) els.homeEmptyDesignsBtn.addEventListener('click', function () { close(); if (App.openSavedDesigns) App.openSavedDesigns(); });
    if (els.homeArrangeBtn) {
      els.homeArrangeBtn.addEventListener('click', function () {
        const result = App.Home.relayout();
        if (!result || result.ok === false) { U.showToast((result && result.error) || 'Nothing to arrange.', 'warning'); return; }
        App.HomePlan.fitView();
        setHint('Rooms auto-arranged. Drag any of them to fine-tune.');
      });
    }
    if (els.homeAutoLinkBtn) {
      els.homeAutoLinkBtn.addEventListener('click', function () {
        const result = App.Home.autoLink();
        if (!result.ok) { U.showToast(result.error, 'warning'); return; }
        U.showToast(autoLinkSummary(result), result.created ? 'success' : 'warning', { duration: 6500 });
        App.HomePlan.fitView();
      });
    }
    if (els.homeExportBtn) els.homeExportBtn.addEventListener('click', exportHome);
    if (els.homeImportBtn) els.homeImportBtn.addEventListener('click', function () { els.homeImportInput.click(); });
    if (els.homeImportInput) {
      els.homeImportInput.addEventListener('change', function () {
        const file = els.homeImportInput.files && els.homeImportInput.files[0];
        els.homeImportInput.value = '';
        importHome(file);
      });
    }
    if (els.homeFitBtn) els.homeFitBtn.addEventListener('click', function () { App.HomePlan.fitView(); });
    if (els.homeZoomInBtn) els.homeZoomInBtn.addEventListener('click', function () { App.HomePlan.zoomBy(1.25, els.homePlanWrap.clientWidth / 2, els.homePlanWrap.clientHeight / 2); });
    if (els.homeZoomOutBtn) els.homeZoomOutBtn.addEventListener('click', function () { App.HomePlan.zoomBy(0.8, els.homePlanWrap.clientWidth / 2, els.homePlanWrap.clientHeight / 2); });
    if (els.homeViewPlanBtn) els.homeViewPlanBtn.addEventListener('click', function () { setViewMode('plan'); });
    if (els.homeView3dBtn) els.homeView3dBtn.addEventListener('click', function () { setViewMode('three'); });
    if (els.homeModeOrbitBtn) els.homeModeOrbitBtn.addEventListener('click', function () { setMode('orbit'); });
    if (els.homeModeWalkBtn) els.homeModeWalkBtn.addEventListener('click', function () { setMode('first'); });
    if (els.homeResetViewBtn) els.homeResetViewBtn.addEventListener('click', function () { if (ui.threeReady) App.Home3D.resetCamera(); });
    if (els.homeCeilingToggle) els.homeCeilingToggle.addEventListener('change', function () { if (ui.threeReady) App.Home3D.setCeiling(els.homeCeilingToggle.checked); });
    if (els.homeCutawayToggle) els.homeCutawayToggle.addEventListener('change', function () { if (ui.threeReady) App.Home3D.setCutaway(els.homeCutawayToggle.checked); });
    if (els.homeSide) {
      els.homeSide.addEventListener('click', onSideClick);
    }
    document.addEventListener('keydown', function (event) {
      if (!ui.isOpen) return;
      if (event.key === 'Escape' && !document.querySelector('.modal-backdrop') && !U.isTypingTarget(event.target)) {
        if (ui.threeReady && App.Home3D.getMode() === 'first') { setMode('orbit'); return; }
        close();
      }
    });
    window.addEventListener('beforeunload', flushSave);
    window.addEventListener('pagehide', flushSave);
    window.addEventListener('resize', function () { if (ui.isOpen && ui.view === 'three' && ui.threeReady) App.Home3D.resize(); });
    setTool('select');
  }

  App.HomeUI = {
    boot: boot,
    open: open,
    close: close,
    isOpen: function () { return ui.isOpen; },
    saveNow: saveNow,
    isReady: function () { return ui.booted && available(); }
  };
})(window.App = window.App || {});
