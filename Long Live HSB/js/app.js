(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;
  const G = App.Geometry;
  const P = App.Pricing;

  const ui = {
    selection: null,
    view: 'plan',
    inspectorTab: 'item',
    workflowStep: 'room',
    catalogQuery: '',
    catalogCategory: 'all',
    catalogSort: 'featured',
    itemRenderKey: null,
    aiSelections: {},
    aiTemplate: 'balanced',
    aiReport: null,
    aiSnapshot: null,
    aiSnapshotDesignId: null,
    floorPending: null,
    chatLog: [],
    autoSaveTimer: null,
    autoSaveBusy: false,
    autoSaveAgain: false,
    lastAutoSaveAt: null,
    storageHealth: null,
    viewerReady: false,
    viewerCameraInit: false,
    last3DStatus: null,
    fatal: false,
    booted: false
  };

  const els = {};

  const WORKFLOW_STEPS = {
    room: {
      title: 'Define the real space',
      hint: 'Set real dimensions and a wall colour. The plan and 3D room share the same geometry.'
    },
    furnish: {
      title: 'Choose the furniture',
      hint: 'Pick products from the catalog, or open the Assistant to generate an editable starting arrangement.'
    },
    openings: {
      title: 'Add doors and windows',
      hint: 'Use the Door or Window tool, then click a wall in the plan. Openings are cut into the real 3D walls.'
    },
    style: {
      title: 'Style the shell',
      hint: 'Pick a wall colour and a floor finish. Both are stored with this design and used again in the Whole Home view.'
    },
    review: {
      title: 'Check, price and save',
      hint: 'Review the room checks and budget, then save the design or export a plan and product list.'
    },
    home: {
      title: 'Join every room into one home',
      hint: 'Place your saved rooms side by side and link matching doors so you can walk between them.'
    }
  };
  const WORKFLOW_ORDER = ['room', 'furnish', 'openings', 'style', 'review', 'home'];

  function findProduct(id) { return App.Catalog.getProduct(id); }

  function getDesign() { return App.State.get(); }

  function boot() {
    initElements();
    installAppApi();
    bindEvents();
    start().catch(function (err) {
      console.error(err);
      fatalBoot(err);
    });
  }

  async function start() {
    let health = null;
    try {
      health = await App.Storage.init();
    } catch (err) {
      console.error('Storage initialisation failed:', err);
      health = App.Storage.getHealth();
    }
    ui.storageHealth = health;
    try {
      await App.Catalog.init();
    } catch (err) {
      console.error('Catalog initialisation failed:', err);
      throw new Error('The product catalog could not be loaded: ' + (err.message || 'unknown error'));
    }

    let restored = null;
    try {
      const loaded = await App.Storage.loadCurrent();
      if (loaded && loaded.design) {
        const normalized = App.State.normalizeLoadedDesign(loaded.design);
        if (normalized.design) {
          App.State.init(normalized.design);
          restored = { savedAt: loaded.savedAt, source: loaded.source, warnings: normalized.warnings };
        } else {
          U.showToast('A saved autosave could not be validated and was left untouched: ' + normalized.warnings.join(' '), 'warning', { duration: 9000 });
        }
      }
    } catch (err) {
      console.error('Autosave restore failed:', err);
      U.showToast('The last autosave could not be restored. Existing browser data was not deleted.', 'warning', { duration: 8000 });
    }

    App.Media.onAssetLoaded = function () {
      App.Designer2D.requestDraw();
      refreshInspector(true);
    };
    App.Designer2D.init(els.planCanvas, els.planWrap);
    App.State.subscribe(onStateChanged);
    try {
      if (App.HomeUI) App.HomeUI.boot();
    } catch (err) {
      console.error('Whole Home init failed:', err);
    }

    applyStorageHealth();
    renderCatalog();
    updateHeader();
    updateEmptyState();
    refreshInspector(true);
    updateIssuesBadge();
    ui.workflowStep = restored ? 'furnish' : 'room';
    if (restored && getDesign() && getDesign().mode === 'ai' && !getDesign().placedItems.length) setInspectorTab('ai', true);
    renderWorkflow();
    updateSaveIndicator(restored ? 'restored' : 'idle');
    updateStageChrome();
    setView('plan');
    if (restored) {
      ui.lastAutoSaveAt = restored.savedAt ? new Date(restored.savedAt) : null;
      const parts = [];
      if (restored.warnings && restored.warnings.length) parts.push(restored.warnings.join(' '));
      if (restored.source === 'idb') parts.push('Restored from the local backup database.');
      U.showToast('Your last design was restored' + (restored.savedAt ? ' from ' + U.formatTime(restored.savedAt) : '') + (parts.length ? '. ' + parts.join(' ') : '.'), parts.length ? 'warning' : 'success', { duration: 7000 });
    }
    const finishBoot = function () {
      if (ui.booted) return;
      if (StateHasDesign()) App.Designer2D.fitView();
      ui.booted = true;
      document.body.classList.add('is-ready');
      hideBootScreen();
      window.__FORMAROOM_READY__ = true;
    };
    requestAnimationFrame(finishBoot);
    setTimeout(finishBoot, 260);
  }

  function StateHasDesign() { return !!getDesign(); }

  function initElements() {
    const ids = [
      'bootScreen', 'fatalError', 'designNameInput', 'designRoomMeta', 'designStats',
      'saveIndicator', 'newRoomBtn', 'openDesignsBtn', 'saveDesignBtn', 'exportBtn', 'helpBtn',
      'storageBanner', 'catalogSearch', 'categoryFilter', 'sortSelect', 'catalogInfo', 'catalogList',
      'workflowBar', 'workflowTitle', 'workflowHint', 'workflowNextBtn', 'workflowAuxBtn',
      'manageCatalogBtn', 'viewPlanBtn', 'viewThreeBtn', 'planTools', 'threeTools',
      'toolSelectBtn', 'toolWallBtn', 'toolDoorBtn', 'toolWindowBtn', 'snapToggle', 'fitViewBtn',
      'zoomInBtn', 'zoomOutBtn', 'planScaleLabel', 'issuesBtn', 'planView', 'threeView',
      'planCanvas', 'planWrap', 'emptyState', 'emptyCreateBtn', 'emptyHelpBtn',
      'viewer3d', 'viewerStatus', 'threeCameraOrbitBtn', 'threeCameraWalkBtn', 'threeResetBtn',
      'ceilingToggle', 'cutawayToggle', 'threeHint', 'inspectorBody',
      'inspectorTabs'
    ];
    ids.forEach(function (id) { els[id] = document.getElementById(id); });
  }

  function installAppApi() {
    App.getSelection = function () {
      const design = getDesign();
      if (!design || !ui.selection) return null;
      if (ui.selection.type === 'placed') {
        const item = design.placedItems.find(function (p) { return p.id === ui.selection.id; });
        if (!item) return null;
        return { type: 'placed', id: item.id, item: item, product: findProduct(item.productId) };
      }
      if (ui.selection.type === 'structural') {
        const item = design.structuralItems.find(function (p) { return p.id === ui.selection.id; });
        if (!item) return null;
        return { type: 'structural', id: item.id, item: item, product: null };
      }
      if (ui.selection.type === 'wall') {
        const wall = (design.interiorWalls || []).find(function (w) { return w.id === ui.selection.id; });
        if (!wall) return null;
        return { type: 'wall', id: wall.id, wall: wall };
      }
      return null;
    };
    App.selectPlaced = function (id) {
      const design = getDesign();
      if (!design || !design.placedItems.some(function (p) { return p.id === id; })) return;
      setSelection({ type: 'placed', id: id });
    };
    App.selectStructural = function (id) {
      const design = getDesign();
      if (!design || !design.structuralItems.some(function (p) { return p.id === id; })) return;
      setSelection({ type: 'structural', id: id });
    };
    App.selectWall = function (id) {
      const design = getDesign();
      if (!design || !(design.interiorWalls || []).some(function (w) { return w.id === id; })) return;
      setSelection({ type: 'wall', id: id });
    };
    App.clearSelection = function () {
      if (!ui.selection) return;
      ui.selection = null;
      App.Designer2D.requestDraw();
      refreshInspector(true);
      if (ui.viewerReady) App.Viewer3D.sync(getDesign(), null);
    };
    App.notify = function (message, type, options) { U.showToast(message, type, options); };
    App.deleteSelection = deleteSelection;
    App.duplicateSelection = duplicateSelection;
    App.openProductDetails = openProductDetails;
    App.onCatalogChange = handleCatalogChange;
    App.onCatalogManagerClose = handleCatalogManagerClose;
    App.on3DStatus = on3DStatus;
    App.onWalkUnavailable = function () {
      U.showToast('Walk mode needs a door. Add a door to a wall first, then walk through it.', 'warning', { duration: 5200 });
    };
    App.onWalkBlocked = function () {
      U.showToast('The last door was removed, so walk mode was turned off.', 'warning');
      updateThreeModeButtons();
      updateEmptyState();
    };
    App.onPlanViewChange = function (scale) {
      if (els.planScaleLabel) els.planScaleLabel.textContent = '1 cm ≈ ' + Number(scale).toFixed(2) + ' px';
    };
    App.onPlanToolChange = function () { updateToolButtons(); };
    App.isPlanShortcutBlocked = function () {
      if (App.isWholeHomeOpen && App.isWholeHomeOpen()) return true;
      return ui.view === 'three';
    };
    App.openSavedDesigns = openSavedDesigns;
    App.openRoomDesignFromHome = function (designId) {
      return App.Storage.getDesign(designId).then(function (envelope) {
        if (!envelope) {
          U.showToast('That saved room could not be found in My designs.', 'error');
          return false;
        }
        return loadDesignFromEnvelope(envelope, null).then(function () { return true; });
      }).catch(function (err) {
        console.error(err);
        U.showToast(err.message || 'The room design could not be opened.', 'error');
        return false;
      });
    };
    App.isThreeViewActive = function () { return ui.view === 'three' && ui.viewerReady; };
    App.resumeThreeView = function () {
      if (ui.view === 'three') setView('three');
    };
  }

  function bindEvents() {
    els.newRoomBtn.addEventListener('click', function () { openRoomWizard(); });
    els.emptyCreateBtn.addEventListener('click', function () { openRoomWizard(); });
    els.emptyHelpBtn.addEventListener('click', openHelp);
    els.helpBtn.addEventListener('click', openHelp);
    els.openDesignsBtn.addEventListener('click', openSavedDesigns);
    els.saveDesignBtn.addEventListener('click', saveDesignToLibrary);
    els.exportBtn.addEventListener('click', openExportModal);
    els.manageCatalogBtn.addEventListener('click', function () { App.ProductManager.open(); });

    if (els.workflowBar) {
      els.workflowBar.addEventListener('click', function (event) {
        const stepBtn = event.target.closest('[data-workflow-step]');
        if (!stepBtn || stepBtn.disabled) return;
        setWorkflowStep(stepBtn.getAttribute('data-workflow-step'));
      });
    }
    if (els.workflowNextBtn) els.workflowNextBtn.addEventListener('click', onWorkflowPrimary);
    if (els.workflowAuxBtn) els.workflowAuxBtn.addEventListener('click', onWorkflowAux);

    els.designNameInput.addEventListener('change', commitDesignName);
    els.designNameInput.addEventListener('keydown', function (event) {
      if (event.key === 'Enter') { event.preventDefault(); els.designNameInput.blur(); }
      if (event.key === 'Escape') { els.designNameInput.value = getDesign() ? getDesign().name : ''; els.designNameInput.blur(); }
    });

    els.catalogSearch.addEventListener('input', function () {
      ui.catalogQuery = els.catalogSearch.value;
      renderCatalog(true);
    });
    els.categoryFilter.addEventListener('change', function () {
      ui.catalogCategory = els.categoryFilter.value;
      renderCatalog();
    });
    els.sortSelect.addEventListener('change', function () {
      ui.catalogSort = els.sortSelect.value;
      renderCatalog();
    });
    els.catalogList.addEventListener('click', onCatalogClick);
    els.catalogList.addEventListener('dragstart', onCatalogDragStart);
    els.catalogList.addEventListener('dragend', onCatalogDragEnd);
    els.catalogList.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const card = event.target.closest('.product-card');
      if (!card || event.target.closest('button')) return;
      event.preventDefault();
      openProductDetails(card.getAttribute('data-product-id'));
    });
    const footerManager = document.querySelector('.catalog-panel [data-open-manager-from]');
    if (footerManager) footerManager.addEventListener('click', function () { App.ProductManager.open(); });

    els.viewPlanBtn.addEventListener('click', function () { setView('plan'); });
    els.viewThreeBtn.addEventListener('click', function () { setView('three'); });
    els.toolSelectBtn.addEventListener('click', function () { App.Designer2D.setTool('select'); updateToolButtons(); });
    if (els.toolWallBtn) els.toolWallBtn.addEventListener('click', function () {
      if (!getDesign()) { promptCreateRoom('Add a room before drawing partition walls.'); return; }
      if (App.Designer2D.getTool() === 'wall') {
        App.Designer2D.setTool('select');
      } else {
        App.Designer2D.beginWallTool();
        setView('plan');
      }
      updateToolButtons();
    });
    els.toolDoorBtn.addEventListener('click', function () {
      if (!getDesign()) { promptCreateRoom('Add a room before placing a door.'); return; }
      const next = App.Designer2D.getTool() === 'door' ? 'select' : 'door';
      App.Designer2D.setTool(next);
      if (next === 'door') {
        setWorkflowStep('openings', { keepTab: true });
        setView('plan');
      }
      updateToolButtons();
    });
    els.toolWindowBtn.addEventListener('click', function () {
      if (!getDesign()) { promptCreateRoom('Add a room before placing a window.'); return; }
      const next = App.Designer2D.getTool() === 'window' ? 'select' : 'window';
      App.Designer2D.setTool(next);
      if (next === 'window') {
        setWorkflowStep('openings', { keepTab: true });
        setView('plan');
      }
      updateToolButtons();
    });
    els.snapToggle.addEventListener('change', function () {
      App.Designer2D.setSnap(els.snapToggle.checked);
    });
    els.fitViewBtn.addEventListener('click', function () { App.Designer2D.fitView(); });
    els.zoomInBtn.addEventListener('click', function () { App.Designer2D.zoomBy(1.25, els.planWrap.clientWidth / 2, els.planWrap.clientHeight / 2); });
    els.zoomOutBtn.addEventListener('click', function () { App.Designer2D.zoomBy(0.8, els.planWrap.clientWidth / 2, els.planWrap.clientHeight / 2); });
    els.issuesBtn.addEventListener('click', function () { setInspectorTab('room'); });
    els.threeCameraOrbitBtn.addEventListener('click', function () { setThreeCameraMode('orbit'); });
    els.threeCameraWalkBtn.addEventListener('click', function () { setThreeCameraMode('first'); });
    els.threeResetBtn.addEventListener('click', function () {
      if (ui.viewerReady) App.Viewer3D.resetCamera();
    });
    els.ceilingToggle.addEventListener('change', function () {
      if (ui.viewerReady) App.Viewer3D.setCeiling(els.ceilingToggle.checked);
    });
    els.cutawayToggle.addEventListener('change', function () {
      if (ui.viewerReady) App.Viewer3D.setCutaway(els.cutawayToggle.checked);
    });

    els.inspectorTabs.addEventListener('click', function (event) {
      const btn = event.target.closest('[data-inspector-tab]');
      if (!btn) return;
      setInspectorTab(btn.getAttribute('data-inspector-tab'));
    });
    els.inspectorBody.addEventListener('click', onInspectorClick);
    els.inspectorBody.addEventListener('change', onInspectorChange);
    els.inspectorBody.addEventListener('input', onInspectorInput);
    els.inspectorBody.addEventListener('submit', onInspectorSubmit);

    document.addEventListener('keydown', onGlobalKeyDown);
    window.addEventListener('beforeunload', flushAutoSave);
    window.addEventListener('pagehide', flushAutoSave);
    window.addEventListener('resize', debounce(function () { updateToolButtons(); }, 150));
  }

  function debounce(fn, wait) {
    let timer = null;
    return function () {
      clearTimeout(timer);
      timer = setTimeout(fn, wait);
    };
  }

  function onGlobalKeyDown(event) {
    if (event.key !== 's' && event.key !== 'S') {
      if (event.key === 'Escape' && ui.view === 'three' && ui.viewerReady && App.Viewer3D.getMode() === 'first') {
        setThreeCameraMode('orbit');
        return;
      }
      return;
    }
    if (!(event.ctrlKey || event.metaKey)) return;
    if (document.querySelector('.modal-backdrop') || U.isTypingTarget(event.target)) return;
    event.preventDefault();
    if (App.isWholeHomeOpen && App.isWholeHomeOpen()) {
      if (App.HomeUI) App.HomeUI.saveNow();
      return;
    }
    saveDesignToLibrary();
  }

  function onStateChanged(design, reason) {
    if (reason === 'init') {
      updateHeader();
      updateEmptyState();
      refreshInspector(true);
      updateIssuesBadge();
      renderWorkflow();
      return;
    }
    updateHeader();
    updateEmptyState();
    updateIssuesBadge();
    renderWorkflow();
    scheduleAutoSave();
    App.Designer2D.requestDraw();
    if (ui.viewerReady) App.Viewer3D.sync(design, App.getSelection());
    refreshInspector(false, reason);
    updateStageChrome();
  }

  function setSelection(next) {
    ui.selection = next;
    if (next) setInspectorTab('item', true);
    else refreshInspector(true);
    App.Designer2D.requestDraw();
    if (ui.viewerReady) App.Viewer3D.sync(getDesign(), App.getSelection());
  }

  function deleteSelection() {
    const selected = App.getSelection();
    if (!selected) return;
    if (selected.type === 'placed') {
      if (selected.item.locked) {
        U.showToast('This item is locked. Unlock it before deleting it.', 'warning');
        return;
      }
      const productName = selected.product ? selected.product.name : 'Item';
      const result = App.State.removePlaced(selected.id);
      if (!result.ok) { U.showToast(result.error, 'error'); return; }
      ui.selection = null;
      App.Designer2D.requestDraw();
      refreshInspector(true);
      if (ui.viewerReady) App.Viewer3D.sync(getDesign(), null);
      U.showToast(productName + ' removed from the design.', 'info');
      return;
    }
    if (selected.type === 'structural') {
      const label = selected.item.type === 'door' ? 'Door' : 'Window';
      const result = App.State.removeStructural(selected.id);
      if (!result.ok) { U.showToast(result.error, 'error'); return; }
      ui.selection = null;
      App.Designer2D.requestDraw();
      refreshInspector(true);
      if (ui.viewerReady) App.Viewer3D.sync(getDesign(), null);
      U.showToast(label + ' removed. The wall opening has been closed.', 'info');
      return;
    }
    if (selected.type === 'wall') {
      const result = App.State.removeInteriorWall(selected.id);
      if (!result.ok) { U.showToast(result.error, 'error'); return; }
      ui.selection = null;
      App.Designer2D.requestDraw();
      refreshInspector(true);
      if (ui.viewerReady) App.Viewer3D.sync(getDesign(), null);
      U.showToast('Partition wall removed. Ctrl+Z restores it.', 'info');
    }
  }

  function duplicateSelection() {
    const selected = App.getSelection();
    if (!selected || selected.type !== 'placed') return;
    const result = App.State.duplicatePlaced(selected.id);
    if (!result.ok) { U.showToast(result.error, 'error'); return; }
    setSelection({ type: 'placed', id: result.item.id });
    U.showToast('Item duplicated. It is selected and can be moved.', 'success');
  }

  function promptCreateRoom(message) {
    U.showToast(message || 'Create a room first.', 'warning', {
      actionLabel: 'Create room',
      onAction: function () { openRoomWizard(); }
    });
  }

  function scheduleAutoSave() {
    if (!getDesign()) return;
    updateSaveIndicator('dirty');
    clearTimeout(ui.autoSaveTimer);
    ui.autoSaveTimer = setTimeout(runAutoSave, 550);
  }

  async function runAutoSave() {
    if (ui.autoSaveBusy) { ui.autoSaveAgain = true; return; }
    const design = getDesign();
    if (!design) return;
    ui.autoSaveBusy = true;
    updateSaveIndicator('saving');
    try {
      const result = await App.Storage.saveCurrent(design);
      if (result.ok) {
        ui.lastAutoSaveAt = result.savedAt ? new Date(result.savedAt) : new Date();
        updateSaveIndicator('saved');
      } else {
        updateSaveIndicator('error');
        if (!ui.storageWarningShown) {
          ui.storageWarningShown = true;
          U.showToast('This browser did not allow the design to be saved. Use Export → Backup before closing the tab.', 'error', { duration: 9000 });
        }
      }
    } catch (err) {
      console.error(err);
      updateSaveIndicator('error');
    } finally {
      ui.autoSaveBusy = false;
      if (ui.autoSaveAgain) {
        ui.autoSaveAgain = false;
        scheduleAutoSave();
      }
    }
  }

  function flushAutoSave() {
    const design = getDesign();
    if (!design) return;
    try { App.Storage.saveCurrentSync(design); } catch (err) { /* storage may be blocked */ }
  }

  function updateSaveIndicator(kind) {
    if (!els.saveIndicator) return;
    els.saveIndicator.classList.remove('is-saved', 'is-saving', 'is-error', 'is-dirty', 'is-restored');
    if (kind === 'dirty') {
      els.saveIndicator.classList.add('is-dirty');
      els.saveIndicator.innerHTML = '<span class="save-dot"></span> Unsaved changes';
      els.saveIndicator.title = 'Changes are saved automatically in a moment.';
    } else if (kind === 'saving') {
      els.saveIndicator.classList.add('is-saving');
      els.saveIndicator.innerHTML = '<span class="save-dot"></span> Saving locally…';
      els.saveIndicator.title = 'Writing to browser storage.';
    } else if (kind === 'saved') {
      els.saveIndicator.classList.add('is-saved');
      els.saveIndicator.innerHTML = '<span class="save-dot"></span> Saved ' + (ui.lastAutoSaveAt ? U.formatTime(ui.lastAutoSaveAt.toISOString()) : 'locally');
      els.saveIndicator.title = 'Autosaved in this browser. Use Save design to add it to My designs.';
    } else if (kind === 'error') {
      els.saveIndicator.classList.add('is-error');
      els.saveIndicator.innerHTML = '<span class="save-dot"></span> Not saved';
      els.saveIndicator.title = 'Browser storage is unavailable or full. Export a backup to avoid losing the design.';
    } else if (kind === 'restored') {
      els.saveIndicator.classList.add('is-restored');
      els.saveIndicator.innerHTML = '<span class="save-dot"></span> Autosave restored';
      els.saveIndicator.title = 'The last design was restored from local browser storage.';
    } else {
      els.saveIndicator.classList.add('is-dirty');
      els.saveIndicator.innerHTML = getDesign() ? '<span class="save-dot"></span> Not saved yet' : '<span class="save-dot"></span> No design';
    }
  }

  function applyStorageHealth() {
    const health = ui.storageHealth || App.Storage.getHealth();
    if (!health.persistent) {
      els.storageBanner.hidden = false;
      els.storageBanner.innerHTML = '<strong>Storage blocked:</strong> this browser will not retain designs between visits. ' +
        'Export a JSON backup after designing. ' + (health.errors[0] ? U.escapeHtml(health.errors[0]) : '');
      U.showToast('Browser storage is unavailable. Designs will not persist after this tab closes. Export a backup to keep your work.', 'error', { duration: 11000 });
    } else {
      els.storageBanner.hidden = true;
    }
  }

  async function saveDesignToLibrary() {
    const design = getDesign();
    if (!design) { promptCreateRoom('Create a room before saving.'); return; }
    if (els.saveDesignBtn.classList.contains('is-busy')) return;
    els.saveDesignBtn.classList.add('is-busy');
    els.saveDesignBtn.disabled = true;
    try {
      const result = await App.Storage.saveDesign(design);
      const current = await App.Storage.saveCurrent(design);
      if (!result.ok && !current.ok) {
        U.showToast('The design could not be saved because browser storage is unavailable. Export a backup instead.', 'error', { duration: 9000 });
        updateSaveIndicator('error');
        return;
      }
      ui.lastAutoSaveAt = new Date();
      updateSaveIndicator('saved');
      if (App.Home && App.Home.primeDesign) App.Home.primeDesign(design.id, design);
      U.showToast('“' + design.name + '” saved to My designs.', 'success');
    } catch (err) {
      console.error(err);
      U.showToast(err.message || 'The design could not be saved.', 'error');
    } finally {
      els.saveDesignBtn.classList.remove('is-busy');
      els.saveDesignBtn.disabled = false;
    }
  }

  function commitDesignName() {
    const design = getDesign();
    if (!design) return;
    const result = App.State.setName(els.designNameInput.value);
    if (!result.ok) {
      els.designNameInput.value = design.name;
      U.showToast(result.error, 'error');
    }
  }

  function updateHeader() {
    const design = getDesign();
    if (!design) {
      if (document.activeElement !== els.designNameInput) els.designNameInput.value = '';
      els.designNameInput.disabled = true;
      els.designRoomMeta.textContent = 'No room created yet';
      els.designStats.textContent = '';
      els.saveDesignBtn.disabled = true;
      els.exportBtn.disabled = true;
      document.title = C.APP_NAME + ' · Furniture room planner';
      return;
    }
    els.designNameInput.disabled = false;
    if (document.activeElement !== els.designNameInput) els.designNameInput.value = design.name;
    els.designRoomMeta.textContent = G.roomShapeLabel(design.room) + ' room · ' + U.formatRoomDims(design.room);
    const summary = P.summarize(design, App.Catalog.getProductsById());
    const budgetText = summary.hasBudget ? (summary.incomplete ? 'Budget set' : U.formatMoney(summary.total) + ' of ' + U.formatMoney(summary.budget)) : U.formatMoney(summary.total);
    els.designStats.innerHTML = '<span><strong>' + summary.quantity + '</strong> item' + (summary.quantity === 1 ? '' : 's') + '</span><span class="dot-sep"></span><span>' + U.escapeHtml(budgetText) + '</span>';
    els.saveDesignBtn.disabled = false;
    els.exportBtn.disabled = false;
    document.title = design.name + ' · ' + C.APP_NAME;
  }

  function updateEmptyState() {
    const hasDesign = !!getDesign();
    const design = getDesign();
    els.emptyState.hidden = hasDesign;
    if (els.viewerStatus) els.viewerStatus.hidden = !hasDesign;
    if (els.threeHint) els.threeHint.hidden = !hasDesign || ui.view !== 'three';
    els.viewThreeBtn.disabled = !hasDesign;
    if (!hasDesign && ui.view === 'three') setView('plan');
    els.toolSelectBtn.disabled = !hasDesign;
    if (els.toolWallBtn) els.toolWallBtn.disabled = !hasDesign;
    els.toolDoorBtn.disabled = !hasDesign;
    els.toolWindowBtn.disabled = !hasDesign;
    els.fitViewBtn.disabled = !hasDesign;
    els.snapToggle.disabled = !hasDesign;
    els.zoomInBtn.disabled = !hasDesign;
    els.zoomOutBtn.disabled = !hasDesign;
    els.threeCameraOrbitBtn.disabled = !hasDesign;
    const canWalk = hasDesign && !G.isCircle(design.room) &&
      design.structuralItems.some(function (item) { return item.type === 'door'; });
    els.threeCameraWalkBtn.disabled = !canWalk;
    els.threeCameraWalkBtn.title = canWalk
      ? 'Walk through the room starting at the door'
      : hasDesign
        ? (G.isCircle(design.room) ? 'Walk mode needs a straight wall with a door.' : 'Add a door to a wall to enable walk mode.')
        : 'Create a room first.';
    els.threeResetBtn.disabled = !hasDesign;
    els.ceilingToggle.disabled = !hasDesign;
    els.cutawayToggle.disabled = !hasDesign;
    els.issuesBtn.hidden = !hasDesign || !ui.currentIssueCount;
  }

  function styleIsCustom(design) {
    const wall = String(design.wallColor || '').toLowerCase() !== C.WALL_DEFAULT_COLOR.toLowerCase();
    const floor = design.floor || {};
    const floorSet = floor.mode === 'texture' ||
      String(floor.color || '').toLowerCase() !== C.FLOOR_DEFAULT_COLOR.toLowerCase();
    return wall || floorSet;
  }

  function homeRoomCount() {
    const home = App.Home ? App.Home.get() : null;
    return home ? home.rooms.length : 0;
  }

  function workflowCompletion(step, design) {
    if (step === 'home') return homeRoomCount() > 1;
    if (!design) return false;
    if (step === 'room') return true;
    if (step === 'furnish') return design.placedItems.length > 0;
    if (step === 'openings') return design.structuralItems.length > 0 || G.isCircle(design.room);
    if (step === 'style') return styleIsCustom(design);
    return design.placedItems.length > 0 && !ui.currentIssueCount;
  }

  function workflowStepTitle(step, design) {
    if (step === 'home') {
      const count = homeRoomCount();
      if (App.isWholeHomeOpen && App.isWholeHomeOpen()) return 'The Whole Home view is already open.';
      return count ? 'Open the Whole Home view. ' + count + ' room' + (count === 1 ? '' : 's') + ' placed.' : 'Add saved rooms to the home, then walk through the linked doors.';
    }
    if (!design) return 'Create a room to unlock this step.';
    if (step === 'room') return 'Room dimensions and wall colour.';
    if (step === 'furnish') return design.placedItems.length ? design.placedItems.length + ' furniture item' + (design.placedItems.length === 1 ? '' : 's') + ' placed.' : 'Add furniture to complete this step.';
    if (step === 'openings') {
      if (G.isCircle(design.room)) return 'Not applicable: circular walls cannot hold openings in this version.';
      return design.structuralItems.length ? design.structuralItems.length + ' opening' + (design.structuralItems.length === 1 ? '' : 's') + ' placed.' : 'Add a door or window, or skip to style.';
    }
    if (step === 'style') {
      return styleIsCustom(design) ? 'Wall colour and floor finish chosen.' : 'Choose a wall colour and floor finish, or skip to review.';
    }
    return ui.currentIssueCount ? ui.currentIssueCount + ' placement issue' + (ui.currentIssueCount === 1 ? '' : 's') + ' to review.' : 'No placement issues detected.';
  }

  function workflowActionFor(step, design) {
    if (step === 'home') {
      return { primary: { label: 'Open whole home', title: 'Arrange every saved room in one plan and walk through it.' } };
    }
    if (!design) return { primary: { label: 'Create room', title: 'Start by defining the real room.' } };
    if (step === 'furnish') {
      return {
        primary: { label: 'Assistant', title: 'Open the assistant for layout and product help.' },
        aux: { label: 'Next: openings', title: 'Continue to doors and windows.' }
      };
    }
    if (step === 'openings') {
      const circle = G.isCircle(design.room);
      return {
        primary: {
          label: circle ? 'No openings on curves' : 'Add a door',
          disabled: circle,
          title: circle ? 'Door and window openings are not supported on circular walls in this version.' : 'Place a door on a wall in the plan.'
        },
        aux: { label: 'Next: style', title: 'Continue to walls and floor.' }
      };
    }
    if (step === 'style') {
      return {
        primary: { label: 'Choose wall colour', title: 'Open the wall colour and floor finish picker.' },
        aux: { label: 'Next: review', title: 'Continue to checks and saving.' }
      };
    }
    if (step === 'review') {
      return {
        primary: { label: 'Save design', title: 'Save this design to My designs.' },
        aux: { label: 'Next: whole home', title: 'Join this room with the others and walk through it.' }
      };
    }
    return { primary: { label: 'New room', title: 'Start a new design. The current one is preserved first.' } };
  }

  function setWorkflowButton(button, config) {
    if (!button) return;
    if (!config) {
      button.hidden = true;
      return;
    }
    button.hidden = false;
    button.textContent = config.label;
    button.disabled = !!config.disabled;
    button.title = config.title || '';
  }

  function renderWorkflow() {
    if (!els.workflowBar) return;
    const design = getDesign();
    if (!design && ui.workflowStep !== 'room' && ui.workflowStep !== 'home') ui.workflowStep = 'room';
    const step = WORKFLOW_STEPS[ui.workflowStep] ? ui.workflowStep : 'room';
    const info = WORKFLOW_STEPS[step];
    const stepIndex = WORKFLOW_ORDER.indexOf(step);
    document.body.setAttribute('data-workflow-step', step);
    els.workflowBar.querySelectorAll('[data-workflow-step]').forEach(function (button) {
      const id = button.getAttribute('data-workflow-step');
      const active = id === step;
      button.classList.toggle('is-active', active);
      button.classList.toggle('is-complete', WORKFLOW_ORDER.indexOf(id) <= stepIndex && workflowCompletion(id, design));
      button.disabled = !design && id !== 'room' && id !== 'home';
      if (active) button.setAttribute('aria-current', 'step');
      else button.removeAttribute('aria-current');
      button.title = workflowStepTitle(id, design);
    });
    if (els.workflowTitle) els.workflowTitle.textContent = info.title;
    if (els.workflowHint) els.workflowHint.textContent = info.hint;
    const actions = workflowActionFor(step, design);
    setWorkflowButton(els.workflowNextBtn, actions.primary);
    setWorkflowButton(els.workflowAuxBtn, actions.aux);
  }

  function setWorkflowStep(step, options) {
    const opts = options || {};
    if (!WORKFLOW_STEPS[step]) return;
    const design = getDesign();
    const next = (design || step === 'home') ? step : 'room';
    ui.workflowStep = next;
    renderWorkflow();
    if (next === 'home') {
      if (App.openWholeHome) App.openWholeHome();
      else U.showToast('The Whole Home view is not available in this build.', 'error');
      return;
    }
    if (opts.keepTab !== true) {
      let tab = 'item';
      if (next === 'room' || next === 'style' || next === 'openings' || next === 'review') tab = 'room';
      else if (design && design.mode === 'ai' && !design.placedItems.length) tab = 'ai';
      setInspectorTab(tab, true);
    }
    if (next !== 'openings') {
      const tool = App.Designer2D.getTool();
      if (tool === 'door' || tool === 'window') {
        App.Designer2D.setTool('select');
        updateToolButtons();
      }
    }
    if (next === 'openings' && ui.view !== 'plan') setView('plan');
  }

  function beginOpeningTool(type) {
    const design = getDesign();
    if (!design) { promptCreateRoom('Create a room before adding doors or windows.'); return; }
    if (G.isCircle(design.room)) {
      U.showToast('Door and window openings are not supported on circular walls in this version.', 'warning', { duration: 6000 });
      return;
    }
    setWorkflowStep('openings', { keepTab: true });
    if (ui.view !== 'plan') setView('plan');
    App.Designer2D.setTool(type === 'window' ? 'window' : 'door');
    updateToolButtons();
    U.showToast('Click a wall in the plan to place the ' + (type === 'window' ? 'window' : 'door') + '.', 'info');
  }

  function onWorkflowPrimary() {
    if (ui.workflowStep === 'home') {
      if (App.openWholeHome) App.openWholeHome();
      return;
    }
    const design = getDesign();
    if (!design) { openRoomWizard(); return; }
    if (ui.workflowStep === 'furnish') { setInspectorTab('ai'); return; }
    if (ui.workflowStep === 'openings') { beginOpeningTool('door'); return; }
    if (ui.workflowStep === 'style') {
      setInspectorTab('room');
      const card = els.inspectorBody.querySelector('.wall-color-card');
      if (card) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      return;
    }
    if (ui.workflowStep === 'review') { saveDesignToLibrary(); return; }
    openRoomWizard();
  }

  function onWorkflowAux() {
    if (ui.workflowStep === 'furnish') { setWorkflowStep('openings'); return; }
    if (!getDesign()) return;
    if (ui.workflowStep === 'openings') setWorkflowStep('style');
    else if (ui.workflowStep === 'style') setWorkflowStep('review');
    else if (ui.workflowStep === 'review') setWorkflowStep('home');
  }

  function updateIssuesBadge() {
    const design = getDesign();
    const issues = design ? G.designIssues(design, App.Catalog.getProductsById()) : [];
    ui.currentIssueCount = issues.length;
    const errors = issues.filter(function (issue) { return issue.severity === 'error'; }).length;
    if (!design || !issues.length) {
      els.issuesBtn.hidden = true;
      return;
    }
    els.issuesBtn.hidden = false;
    els.issuesBtn.classList.toggle('has-errors', errors > 0);
    els.issuesBtn.innerHTML = '<span class="issues-symbol">!</span> ' + issues.length + ' issue' + (issues.length === 1 ? '' : 's');
    els.issuesBtn.title = issues.map(function (issue) { return issue.message; }).join('\n');
  }

  function setView(view) {
    ui.view = view === 'three' ? 'three' : 'plan';
    els.planView.hidden = ui.view !== 'plan';
    els.threeView.hidden = ui.view !== 'three';
    updateStageChrome();
    if (ui.view === 'three') {
      if (ui.viewerReady) App.Viewer3D.setActive(false);
      if (!getDesign()) return;
      const activate = function () {
        if (ui.view !== 'three') return;
        if (!ui.viewerReady) {
          const ok = App.Viewer3D.init(els.viewer3d, { onStatus: on3DStatus });
          if (!ok) {
            els.viewer3d.setAttribute('data-failed', 'true');
            return;
          }
          ui.viewerReady = true;
          App.Viewer3D.sync(getDesign(), App.getSelection());
          App.Viewer3D.resetCamera();
          ui.viewerCameraInit = true;
          els.ceilingToggle.checked = App.Viewer3D.getCeiling();
          els.cutawayToggle.checked = App.Viewer3D.getCutaway();
        } else {
          App.Viewer3D.sync(getDesign(), App.getSelection());
        }
        App.Viewer3D.setActive(true);
        App.Viewer3D.resize();
        updateThreeModeButtons();
      };
      requestAnimationFrame(activate);
      setTimeout(activate, 220);
    } else {
      if (ui.viewerReady) App.Viewer3D.setActive(false);
      requestAnimationFrame(function () { App.Designer2D.requestDraw(); });
    }
  }

  function updateStageChrome() {
    if (!els) return;
    els.viewPlanBtn.classList.toggle('is-active', ui.view === 'plan');
    els.viewThreeBtn.classList.toggle('is-active', ui.view === 'three');
    els.viewPlanBtn.setAttribute('aria-selected', ui.view === 'plan' ? 'true' : 'false');
    els.viewThreeBtn.setAttribute('aria-selected', ui.view === 'three' ? 'true' : 'false');
    els.planTools.hidden = ui.view !== 'plan';
    els.threeTools.hidden = ui.view !== 'three';
    els.issuesBtn.classList.toggle('in-three', ui.view === 'three');
    updateToolButtons();
    updateThreeModeButtons();
    if (els.threeHint) els.threeHint.hidden = !getDesign() || ui.view !== 'three';
  }

  function updateToolButtons() {
    if (!els.toolSelectBtn) return;
    const tool = App.Designer2D ? App.Designer2D.getTool() : 'select';
    els.toolSelectBtn.classList.toggle('is-active', tool === 'select');
    if (els.toolWallBtn) {
      els.toolWallBtn.classList.toggle('is-active', tool === 'wall');
      els.toolWallBtn.setAttribute('aria-pressed', tool === 'wall' ? 'true' : 'false');
    }
    els.toolDoorBtn.classList.toggle('is-active', tool === 'door');
    els.toolWindowBtn.classList.toggle('is-active', tool === 'window');
    els.toolSelectBtn.setAttribute('aria-pressed', tool === 'select' ? 'true' : 'false');
    els.toolDoorBtn.setAttribute('aria-pressed', tool === 'door' ? 'true' : 'false');
    els.toolWindowBtn.setAttribute('aria-pressed', tool === 'window' ? 'true' : 'false');
  }

  function setThreeCameraMode(mode) {
    if (!ui.viewerReady) {
      U.showToast('The 3D view is not ready yet.', 'warning');
      return;
    }
    if (mode === 'first') {
      const design = getDesign();
      const canWalk = design && !G.isCircle(design.room) && design.structuralItems.some(function (item) { return item.type === 'door'; });
      if (!canWalk) {
        U.showToast('Walk mode needs a door. Add a door to a wall first.', 'warning');
        return;
      }
    }
    App.Viewer3D.setMode(mode);
    updateThreeModeButtons();
  }

  function updateThreeModeButtons() {
    if (!ui.viewerReady) return;
    const mode = App.Viewer3D.getMode();
    els.threeCameraOrbitBtn.classList.toggle('is-active', mode === 'orbit');
    els.threeCameraWalkBtn.classList.toggle('is-active', mode === 'first');
    els.threeCameraOrbitBtn.setAttribute('aria-pressed', mode === 'orbit' ? 'true' : 'false');
    els.threeCameraWalkBtn.setAttribute('aria-pressed', mode === 'first' ? 'true' : 'false');
    if (els.threeHint) {
      els.threeHint.innerHTML = mode === 'first'
        ? '<strong>Walk mode:</strong> click or drag to look · W A S D / arrows walk · Shift to run · walls and furniture block you · Esc returns to orbit.'
        : '<strong>Orbit mode:</strong> drag to orbit · scroll to zoom · right-drag to pan · click furniture to select. Cut-away walls keep the room visible. Switch to Walk to step inside.';
    }
  }

  function on3DStatus(status) {
    ui.last3DStatus = status;
    if (!els.viewerStatus) return;
    if (!getDesign()) { els.viewerStatus.hidden = true; return; }
    els.viewerStatus.hidden = false;
    const parts = [];
    if (status.items === 0) {
      parts.push('<div class="viewer-status-line"><span class="status-dot"></span>Room shell only · no furniture in this design.</div>');
    } else if (status.loading) {
      parts.push('<div class="viewer-status-line"><span class="status-dot is-loading"></span>Loading ' + status.loading + ' GLB model' + (status.loading === 1 ? '' : 's') + '…</div>');
    } else if (status.glbLoaded > 0) {
      parts.push('<div class="viewer-status-line"><span class="status-dot is-ok"></span><strong>' + status.glbLoaded + '</strong> item' + (status.glbLoaded === 1 ? '' : 's') + ' using real GLB model' + (status.glbLoaded === 1 ? '' : 's') + '.' +
        (status.procedural ? ' ' + status.procedural + ' using labeled procedural previews.' : '') + '</div>');
    } else {
      parts.push('<div class="viewer-status-line"><span class="status-dot"></span><strong>' + status.items + '</strong> item' + (status.items === 1 ? '' : 's') + ' using clearly labeled procedural previews — no GLB is attached to these products.</div>');
    }
    if (status.circular) {
      parts.push('<div class="viewer-warning">Circular room: the wall is a true curved surface. Doors and windows are not supported on circular walls in this version.</div>');
    }
    if (status.mismatches && status.mismatches.length) {
      parts.push('<details class="viewer-warning"><summary>' + status.mismatches.length + ' GLB proportion warning' + (status.mismatches.length === 1 ? '' : 's') + '</summary><ul>' +
        status.mismatches.map(function (message) { return '<li>' + U.escapeHtml(message) + '</li>'; }).join('') + '</ul></details>');
    }
    if (status.errors && status.errors.length) {
      parts.push('<details class="viewer-warning is-error"><summary>' + status.errors.length + ' 3D model notice' + (status.errors.length === 1 ? '' : 's') + '</summary><ul>' +
        status.errors.map(function (message) { return '<li>' + U.escapeHtml(message) + '</li>'; }).join('') + '</ul></details>');
    }
    els.viewerStatus.innerHTML = parts.join('');
  }

  function setInspectorTab(tab, forceRender) {
    const allowed = ['item', 'budget', 'ai', 'room'];
    if (allowed.indexOf(tab) < 0) return;
    if (ui.inspectorTab === tab && !forceRender) return;
    ui.inspectorTab = tab;
    els.inspectorTabs.querySelectorAll('[data-inspector-tab]').forEach(function (btn) {
      const active = btn.getAttribute('data-inspector-tab') === tab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    refreshInspector(true);
  }

  function refreshInspector(force, reason) {
    if (!els.inspectorBody) return;
    const design = getDesign();
    updateInspectorTabState();
    if (!design) {
      ui.itemRenderKey = null;
      if (ui.inspectorTab === 'ai') renderAIPanel();
      else if (ui.inspectorTab === 'room') renderRoomPanel();
      else if (ui.inspectorTab === 'budget') renderBudgetPanel();
      else renderItemPanel();
      return;
    }
    if (ui.inspectorTab === 'item') {
      const selected = App.getSelection();
      const key = selected ? selected.type + ':' + selected.id : 'none';
      if (!force && ui.itemRenderKey === key && reason !== 'catalog-refresh') {
        updateItemPanelLive();
      } else {
        renderItemPanel();
      }
    } else if (ui.inspectorTab === 'budget') {
      renderBudgetPanel();
    } else if (ui.inspectorTab === 'ai') {
      renderAIPanel();
    } else if (ui.inspectorTab === 'room') {
      renderRoomPanel();
    }
  }

  function updateInspectorTabState() {
    if (!els.inspectorTabs) return;
    els.inspectorTabs.querySelectorAll('[data-inspector-tab]').forEach(function (btn) {
      const active = btn.getAttribute('data-inspector-tab') === ui.inspectorTab;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderCatalog(refocusSearch) {
    const all = App.Catalog.getProducts();
    const categories = App.Catalog.getCategories();
    const counts = { all: all.length };
    categories.forEach(function (cat) { counts[cat.id] = 0; });
    all.forEach(function (product) { counts[product.category] = (counts[product.category] || 0) + 1; });

    els.categoryFilter.innerHTML = '<option value="all">All categories (' + all.length + ')</option>' +
      categories.map(function (cat) {
        return '<option value="' + U.escapeHtml(cat.id) + '">' + U.escapeHtml(cat.label) + ' (' + (counts[cat.id] || 0) + ')</option>';
      }).join('');
    if (!categories.some(function (cat) { return cat.id === ui.catalogCategory; }) && ui.catalogCategory !== 'all') ui.catalogCategory = 'all';
    els.categoryFilter.value = ui.catalogCategory;
    els.sortSelect.value = ui.catalogSort;

    let list = all.filter(function (product) {
      if (ui.catalogCategory !== 'all' && product.category !== ui.catalogCategory) return false;
      if (!ui.catalogQuery) return true;
      const haystack = (product.name + ' ' + product.id + ' ' + product.description + ' ' + App.Catalog.getCategoryLabel(product.category)).toLowerCase();
      return haystack.indexOf(ui.catalogQuery.toLowerCase()) >= 0;
    });
    if (ui.catalogSort === 'price-asc') list.sort(function (a, b) { return a.price - b.price; });
    else if (ui.catalogSort === 'price-desc') list.sort(function (a, b) { return b.price - a.price; });
    else if (ui.catalogSort === 'name') list.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else list.sort(function (a, b) { return all.indexOf(a) - all.indexOf(b); });

    els.catalogInfo.innerHTML = '<strong>' + list.length + '</strong> product' + (list.length === 1 ? '' : 's') +
      (ui.catalogQuery || ui.catalogCategory !== 'all' ? ' matching' : '') +
      ' · <span class="catalog-source">' + (C.DEMO_CATALOG ? 'demo catalog' : 'catalog') + '</span>' +
      ' · <button type="button" class="link-button" data-open-manager>Manage catalog</button>';
    els.catalogList.innerHTML = list.map(function (product) {
      const hasMain = !!(product.assets && product.assets.main);
      return '' +
        '<article class="product-card" draggable="true" data-product-id="' + U.escapeHtml(product.id) + '" tabindex="0" aria-label="' + U.escapeHtml(product.name + ', ' + U.formatMoney(product.price) + '. Open details.') + '">' +
          '<div class="product-thumb">' +
            '<canvas width="96" height="72"></canvas>' +
            '<span class="product-category-chip" style="--chip-color:' + U.escapeHtml(App.Catalog.getCategoryColor(product.category)) + '">' + U.escapeHtml(App.Catalog.getCategoryLabel(product.category)) + '</span>' +
            (product.demo ? '<span class="product-demo-chip" title="Illustrative demo catalog data">Demo</span>' : '') +
          '</div>' +
          '<div class="product-card-body">' +
            '<div class="product-card-topline"><span class="product-code">' + U.escapeHtml(product.id) + '</span><span class="product-price">' + U.formatMoney(product.price) + '</span></div>' +
            '<h3 class="product-name">' + U.escapeHtml(product.name) + '</h3>' +
            '<div class="product-dims">' + U.formatDims(product) + '</div>' +
            '<div class="product-card-actions">' +
              '<button type="button" class="btn btn-small btn-primary" data-add-product="' + U.escapeHtml(product.id) + '">+ Add to room</button>' +
              '<span class="product-open">Details</span>' +
            '</div>' +
          '</div>' +
        '</article>';
    }).join('') || '<div class="catalog-empty"><p>No products match this search.</p><button type="button" class="btn btn-small btn-secondary" data-reset-filters>Clear filters</button></div>';

    els.catalogList.querySelectorAll('.product-card').forEach(function (card) {
      const id = card.getAttribute('data-product-id');
      const product = findProduct(id);
      const canvas = card.querySelector('canvas');
      if (product && canvas) App.Media.drawThumb(canvas, product);
      const main = product && product.assets && product.assets.display || product && product.assets && product.assets.main;
      if (main && main.key) {
        App.Media.getAssetObjectURL(main.key).then(function (url) {
          if (!url || !card.isConnected) return;
          const img = document.createElement('img');
          img.className = 'product-thumb-photo';
          img.alt = '';
          img.src = url;
          img.onerror = function () { img.remove(); };
          card.querySelector('.product-thumb').appendChild(img);
        }).catch(function () {});
      }
    });
    const manageBtn = els.catalogInfo.querySelector('[data-open-manager]');
    if (manageBtn) manageBtn.addEventListener('click', function () { App.ProductManager.open(); });
    const resetBtn = els.catalogList.querySelector('[data-reset-filters]');
    if (resetBtn) resetBtn.addEventListener('click', function () {
      ui.catalogQuery = '';
      ui.catalogCategory = 'all';
      els.catalogSearch.value = '';
      renderCatalog();
    });
    if (refocusSearch) {
      els.catalogSearch.focus();
      const len = els.catalogSearch.value.length;
      try { els.catalogSearch.setSelectionRange(len, len); } catch (err) { /* ignore */ }
    }
  }

  function onCatalogClick(event) {
    const addBtn = event.target.closest('[data-add-product]');
    if (addBtn) {
      event.stopPropagation();
      addProductSmart(addBtn.getAttribute('data-add-product'));
      return;
    }
    const card = event.target.closest('.product-card');
    if (card) openProductDetails(card.getAttribute('data-product-id'));
  }

  function onCatalogDragStart(event) {
    const card = event.target.closest('.product-card');
    if (!card) return;
    if (!getDesign()) {
      event.preventDefault();
      promptCreateRoom('Create a room before dragging products into it.');
      return;
    }
    const id = card.getAttribute('data-product-id');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'copy';
      try { event.dataTransfer.setData('text/plain', id); } catch (err) { /* ignore */ }
    }
    card.classList.add('is-dragging');
    App.Designer2D.startCatalogDrag(id);
    if (ui.view !== 'plan') setView('plan');
  }

  function onCatalogDragEnd(event) {
    const card = event.target.closest('.product-card');
    if (card) card.classList.remove('is-dragging');
    App.Designer2D.endCatalogDrag();
  }

  function findOpeningPlacement(design, product, kind) {
    const walls = G.getWalls(design.room);
    const gap = C.STRUCTURAL.OPENING_GAP_CM;
    for (let i = 0; i < walls.length; i++) {
      const wall = walls[i];
      const width = Math.min(product.widthCm, wall.lengthCm - 10);
      if (width < 40) continue;
      const sill = kind === 'window' ? Math.min(90, Math.max(0, design.room.heightCm - 40)) : 0;
      const height = Math.min(product.heightCm, design.room.heightCm - sill);
      const candidates = [wall.lengthCm / 2];
      for (let off = width / 2 + gap; off + width / 2 <= wall.lengthCm - gap; off += width / 2 + gap) {
        candidates.push(off, wall.lengthCm - off);
      }
      for (let c = 0; c < candidates.length; c++) {
        const probe = {
          id: '__opening-probe', type: kind, wall: wall.id, offsetCm: candidates[c],
          widthCm: width, heightCm: height, sillCm: sill
        };
        if (!G.validateStructuralItem(design, probe).errors.length) {
          return { wall: wall.id, offsetCm: candidates[c], widthCm: width, heightCm: height, sillCm: sill };
        }
      }
    }
    return null;
  }

  function addProductSmart(productId, variantId) {
    if (!getDesign()) { promptCreateRoom('Create a room before adding products.'); return false; }
    const product = findProduct(productId);
    if (!product) { U.showToast('That product is no longer available.', 'error'); return false; }
    const kind = App.Catalog.structuralKind(product);
    if (kind) {
      if (G.isCircle(getDesign().room)) {
        U.showToast('Doors and windows cannot be cut into circular walls in this version.', 'error');
        return false;
      }
      const placement = findOpeningPlacement(getDesign(), product, kind);
      if (!placement) {
        U.showToast('Every wall is already taken by other openings. Move or remove an opening, then try again.', 'error', { duration: 6500 });
        return false;
      }
      const result = App.State.addStructural(kind, placement.wall, placement.offsetCm, {
        widthCm: placement.widthCm,
        heightCm: placement.heightCm,
        sillCm: placement.sillCm,
        price: product.price,
        productId: product.id,
        name: product.name
      });
      if (!result.ok) { U.showToast(result.error, 'error'); return false; }
      setWorkflowStep('openings', { keepTab: true });
      if (ui.view !== 'plan') setView('plan');
      App.selectStructural(result.item.id);
      U.showToast(product.name + ' cut into the selected wall. Adjust its position and size in the panel.', 'success');
      return true;
    }
    const spot = G.findFreeSpot(getDesign(), product, App.Catalog.getProductsById(), {});
    if (!spot) {
      U.showToast('There is no clear floor space for “' + product.name + '” at its real size. Move furniture, remove items, or enlarge the room.', 'error', { duration: 6500 });
      return false;
    }
    const variant = variantId || App.Catalog.defaultVariantId(product);
    const result = App.State.addPlaced(product.id, spot.xCm, spot.zCm, spot.rotationDeg, variant, 'manual');
    if (!result.ok) { U.showToast(result.error, 'error'); return false; }
    setWorkflowStep('furnish', { keepTab: true });
    if (ui.view !== 'plan') setView('plan');
    setSelection({ type: 'placed', id: result.item.id });
    U.showToast(product.name + ' added at its catalog size. Drag it to fine-tune the position.', 'success');
    return true;
  }

  function renderItemPanel() {
    const design = getDesign();
    if (!design) {
      ui.itemRenderKey = null;
      els.inspectorBody.innerHTML = '' +
        '<div class="inspector-empty">' +
          '<div class="empty-icon">⌂</div>' +
          '<h3>Start with a room</h3>' +
          '<p>Create a room with real dimensions before placing furniture. The same room geometry drives the 2D plan and the 3D view.</p>' +
          '<button type="button" class="btn btn-primary" data-item-action="create-room">Create a room</button>' +
        '</div>';
      return;
    }
    const selected = App.getSelection();
    ui.itemRenderKey = selected ? selected.type + ':' + selected.id : 'none';
    if (!selected) {
      renderNothingSelected(design);
      return;
    }
    if (selected.type === 'structural') {
      renderStructuralPanel(design, selected);
      return;
    }
    if (selected.type === 'wall') {
      renderWallPanel(design, selected);
      return;
    }
    renderPlacedPanel(design, selected);
  }

  function renderNothingSelected(design) {
    const items = design.placedItems.slice().reverse();
    const openings = design.structuralItems.slice();
    const walls = (design.interiorWalls || []).slice();
    const itemRows = items.map(function (item, reverseIndex) {
      const product = findProduct(item.productId);
      return '<button type="button" class="object-row" data-select-instance="' + U.escapeHtml(item.id) + '">' +
        '<span class="object-dot" style="background:' + U.escapeHtml(App.Catalog.getCategoryColor(product ? product.category : '')) + '"></span>' +
        '<span class="object-row-main"><strong>' + U.escapeHtml(product ? product.name : 'Unavailable product') + '</strong>' +
        '<small>Layer ' + (design.placedItems.length - reverseIndex) + ' · ' + U.formatMoney(product ? product.price : null) + '</small></span>' +
        (item.locked ? '<span class="object-lock" title="Locked">●</span>' : '') +
        '<span class="object-chevron">›</span>' +
      '</button>';
    }).join('');
    const openingRows = openings.map(function (item) {
      return '<button type="button" class="object-row" data-select-opening="' + U.escapeHtml(item.id) + '">' +
        '<span class="object-dot is-opening"></span>' +
        '<span class="object-row-main"><strong>' + (item.type === 'door' ? 'Door' : 'Window') + ' · ' + U.formatNumber(item.widthCm, 0) + ' cm</strong>' +
        '<small>' + U.escapeHtml(item.wall.charAt(0).toUpperCase() + item.wall.slice(1)) + ' wall · offset ' + U.formatNumber(item.offsetCm, 0) + ' cm</small></span>' +
        '<span class="object-chevron">›</span>' +
      '</button>';
    }).join('');
    const wallRows = walls.map(function (wall) {
      const length = G.interiorWallLength(wall);
      const openCount = G.interiorWallOpenings(wall).length;
      return '<button type="button" class="object-row" data-select-wall="' + U.escapeHtml(wall.id) + '">' +
        '<span class="object-dot is-wall"></span>' +
        '<span class="object-row-main"><strong>Partition wall · ' + U.formatNumber(length, 0) + ' cm</strong>' +
        '<small>' + U.formatNumber(wall.heightCm, 0) + ' cm high · ' + U.formatNumber(wall.thicknessCm, 0) + ' cm thick' +
        (openCount ? ' · ' + openCount + ' opening' + (openCount === 1 ? '' : 's') : '') + '</small></span>' +
        '<span class="object-chevron">›</span>' +
      '</button>';
    }).join('');
    els.inspectorBody.innerHTML = '' +
      '<div class="inspector-intro">' +
        '<div class="empty-icon">↖</div>' +
        '<h3>Select something to edit it</h3>' +
        '<p>Click furniture, a door or window, or a partition wall in the plan. Drag furniture to move it, drag wall ends to reshape walls, and use the Wall tool to divide the room.</p>' +
      '</div>' +
      '<div class="inspector-summary-grid">' +
        '<div><span>' + U.formatNumber(G.roomAreaSqm(design.room), 1) + ' m²</span><small>floor area</small></div>' +
        '<div><span>' + design.placedItems.length + '</span><small>furniture items</small></div>' +
        '<div><span>' + (walls.length + design.structuralItems.length) + '</span><small>walls & openings</small></div>' +
      '</div>' +
      (itemRows || openingRows || wallRows
        ? '<div class="object-list-wrap"><div class="section-label">Furniture <span>' + design.placedItems.length + '</span></div><div class="object-list">' + (itemRows || '<p class="muted-note">No furniture yet. Add from the catalog or use the Assistant.</p>') + '</div>' +
          (wallRows ? '<div class="section-label">Partition walls <span>' + walls.length + '</span></div><div class="object-list">' + wallRows + '</div>' : '') +
          (openingRows ? '<div class="section-label">Doors & windows <span>' + design.structuralItems.length + '</span></div><div class="object-list">' + openingRows + '</div>' : '') + '</div>'
        : '<div class="notice notice-neutral">Nothing in the room yet. Add a product from the catalog, draw a partition wall, or generate a starting layout with the Assistant tab.</div>') +
      '<div class="shortcut-hint"><kbd>Del</kbd> remove · <kbd>Ctrl</kbd>+<kbd>Z</kbd> undo wall · <kbd>Ctrl</kbd>+<kbd>D</kbd> duplicate · <kbd>arrows</kbd> nudge · <kbd>Shift</kbd> + drag / arrows for finer control</div>';
  }

  function renderPlacedPanel(design, selected) {
    const item = selected.item;
    const product = selected.product;
    const index = design.placedItems.findIndex(function (p) { return p.id === item.id; });
    const validation = product ? G.validatePlacedItem(design, item, product, App.Catalog.getProductsById()) : { errors: ['This product is unavailable in the catalog.'], warnings: [] };
    const variantOptions = product && product.variants && product.variants.length
      ? product.variants.map(function (variant) {
        return '<option value="' + U.escapeHtml(variant.id) + '"' + (item.variantId === variant.id ? ' selected' : '') + '>' + U.escapeHtml(variant.name) + '</option>';
      }).join('')
      : '<option value="">No variants</option>';
    const locked = !!item.locked;
    els.inspectorBody.innerHTML = '' +
      '<div class="selection-header">' +
        '<div class="selection-thumb"><canvas id="selectedItemThumb" width="84" height="68"></canvas></div>' +
        '<div class="selection-title">' +
          '<span class="eyebrow">' + U.escapeHtml(product ? App.Catalog.getCategoryLabel(product.category) : 'Unavailable product') + '</span>' +
          '<h3>' + U.escapeHtml(product ? product.name : 'Unavailable product') + '</h3>' +
          '<div class="selection-meta"><code>' + U.escapeHtml(item.productId) + '</code><span>' + (product ? U.formatMoney(product.price) : 'No price') + '</span></div>' +
        '</div>' +
      '</div>' +
      (product ? '' : '<div class="notice notice-error">This product is no longer in the catalog. The placed item is preserved, but its price and footprint cannot be calculated. Re-create the product with the same ID or remove the item.</div>') +
      (validation.errors.length ? '<div class="notice notice-error">' + validation.errors.map(U.escapeHtml).join('<br>') + '</div>' : '') +
      (validation.warnings.length ? '<div class="notice notice-warning">' + validation.warnings.map(U.escapeHtml).join('<br>') + '</div>' : '') +
      '<div class="control-group">' +
        '<div class="section-label">Placement</div>' +
        '<div class="field-row">' +
          '<label class="field"><span>X position (cm from left)</span><input type="number" step="0.5" value="' + U.escapeHtml(U.round(item.xCm, 1)) + '" data-item-field="xCm" ' + (locked || !product ? 'disabled' : '') + '></label>' +
          '<label class="field"><span>Z position (cm from north)</span><input type="number" step="0.5" value="' + U.escapeHtml(U.round(item.zCm, 1)) + '" data-item-field="zCm" ' + (locked || !product ? 'disabled' : '') + '></label>' +
        '</div>' +
        '<label class="field"><span>Rotation <strong id="rotationValue">' + U.formatNumber(item.rotationDeg, 1) + '°</strong></span>' +
          '<div class="range-row"><input type="range" min="0" max="359" step="1" value="' + U.escapeHtml(Math.round(item.rotationDeg)) + '" data-item-rotation-range ' + (locked ? 'disabled' : '') + '>' +
          '<input type="number" min="0" max="359" step="1" value="' + U.escapeHtml(Math.round(item.rotationDeg)) + '" data-item-field="rotationDeg" class="range-number" ' + (locked ? 'disabled' : '') + '></div>' +
          '<div class="inline-actions"><button type="button" class="btn btn-tiny btn-secondary" data-rotate-by="-15" ' + (locked ? 'disabled' : '') + '>−15°</button><button type="button" class="btn btn-tiny btn-secondary" data-rotate-by="15" ' + (locked ? 'disabled' : '') + '>+15°</button><span class="field-note">Shift while dragging the circular handle in the plan snaps to 15°.</span></div>' +
        '</label>' +
        (product && product.variants && product.variants.length ? '<label class="field"><span>Variant</span><select data-item-variant>' + variantOptions + '</select></label>' : '') +
      '</div>' +
      '<div class="control-group">' +
        '<div class="section-label">Layer & protection</div>' +
        '<div class="inline-actions spread">' +
          '<span class="layer-label">Layer ' + (index + 1) + ' of ' + design.placedItems.length + '</span>' +
          '<div class="inline-actions">' +
            '<button type="button" class="btn btn-tiny btn-secondary" data-move-layer="down" ' + (index <= 0 ? 'disabled' : '') + '>Send back</button>' +
            '<button type="button" class="btn btn-tiny btn-secondary" data-move-layer="up" ' + (index >= design.placedItems.length - 1 ? 'disabled' : '') + '>Bring front</button>' +
          '</div>' +
        '</div>' +
        '<label class="switch-row"><input type="checkbox" data-toggle-lock ' + (locked ? 'checked' : '') + '><span class="switch"></span><span><strong>' + (locked ? 'Locked' : 'Unlocked') + '</strong><small>Locked items cannot be moved, rotated or deleted.</small></span></label>' +
      '</div>' +
      '<div class="selection-actions">' +
        '<button type="button" class="btn btn-secondary" data-duplicate-item>Duplicate</button>' +
        '<button type="button" class="btn btn-ghost btn-danger-text" data-delete-item ' + (locked ? 'disabled' : '') + '>Remove</button>' +
      '</div>' +
      (product ? '<button type="button" class="detail-link" data-open-product-id="' + U.escapeHtml(product.id) + '">View full product details →</button>' : '') +
      '<div class="shortcut-hint">Selected instance <code>' + U.escapeHtml(item.id) + '</code> · product ' + U.escapeHtml(item.productId) + '</div>';
    drawSelectedThumb(product, item);
  }

  function drawSelectedThumb(product, item) {
    const canvas = document.getElementById('selectedItemThumb');
    if (!canvas || !product) return;
    canvas.width = 84;
    canvas.height = 68;
    App.Media.drawThumb(canvas, product, App.Catalog.colorFor(product, item.variantId));
  }

  function updateItemPanelLive() {
    const selected = App.getSelection();
    if (!selected) { renderItemPanel(); return; }
    if (selected.type === 'structural') { renderStructuralPanel(getDesign(), selected); return; }
    if (selected.type === 'wall') { updateWallPanelLive(selected); return; }
    const item = selected.item;
    const design = getDesign();
    els.inspectorBody.querySelectorAll('[data-item-field]').forEach(function (input) {
      if (document.activeElement === input) return;
      const field = input.getAttribute('data-item-field');
      if (field === 'rotationDeg') input.value = Math.round(item.rotationDeg);
      else input.value = U.round(item[field], 1);
    });
    const range = els.inspectorBody.querySelector('[data-item-rotation-range]');
    if (range && document.activeElement !== range) range.value = Math.round(item.rotationDeg);
    const rotationValue = document.getElementById('rotationValue');
    if (rotationValue) rotationValue.textContent = U.formatNumber(item.rotationDeg, 1) + '°';
    const variant = els.inspectorBody.querySelector('[data-item-variant]');
    if (variant && item.variantId && document.activeElement !== variant) variant.value = item.variantId;
    const warningsBox = els.inspectorBody.querySelector('.notice-dynamic');
    if (warningsBox) warningsBox.remove();
    const validation = selected.product ? G.validatePlacedItem(design, item, selected.product, App.Catalog.getProductsById()) : { errors: ['Product unavailable.'], warnings: [] };
    if (validation.errors.length || validation.warnings.length) {
      const box = document.createElement('div');
      box.className = 'notice ' + (validation.errors.length ? 'notice-error' : 'notice-warning') + ' notice-dynamic';
      box.innerHTML = validation.errors.concat(validation.warnings).map(U.escapeHtml).join('<br>');
      const header = els.inspectorBody.querySelector('.selection-header');
      if (header && header.nextSibling) els.inspectorBody.insertBefore(box, header.nextSibling);
      else els.inspectorBody.prepend(box);
    }
    const layerLabel = els.inspectorBody.querySelector('.layer-label');
    const index = design.placedItems.findIndex(function (p) { return p.id === item.id; });
    if (layerLabel) layerLabel.textContent = 'Layer ' + (index + 1) + ' of ' + design.placedItems.length;
    const lockLabel = els.inspectorBody.querySelector('[data-toggle-lock]');
    if (lockLabel && lockLabel.checked !== !!item.locked) lockLabel.checked = !!item.locked;
    if (selected.product) drawSelectedThumb(selected.product, item);
  }

  function renderStructuralPanel(design, selected) {
    const item = selected.item;
    const walls = G.getWalls(design.room);
    const wall = G.getWall(design.room, item.wall);
    const validation = G.validateStructuralItem(design, item);
    if (G.isCircle(design.room)) {
      els.inspectorBody.innerHTML = '<div class="notice notice-warning">Doors and windows are not supported in circular rooms in this version. Remove this opening by switching the room shape or use a rectangular room.</div>';
      return;
    }
    const wallOptions = walls.map(function (w) {
      return '<option value="' + w.id + '"' + (item.wall === w.id ? ' selected' : '') + '>' + w.label + ' · ' + U.formatNumber(w.lengthCm, 0) + ' cm</option>';
    }).join('');
    const maxHeight = Math.max(40, design.room.heightCm - item.sillCm);
    const styleList = item.type === 'window' ? C.STRUCTURAL.WINDOW_STYLES : C.STRUCTURAL.DOOR_STYLES;
    const currentStyle = item.style && styleList[item.style] ? item.style : (item.type === 'window' ? C.STRUCTURAL.DEFAULT_WINDOW_STYLE : C.STRUCTURAL.DEFAULT_DOOR_STYLE);
    const styleOptions = Object.keys(styleList).map(function (key) {
      return '<option value="' + key + '"' + (currentStyle === key ? ' selected' : '') + '>' + U.escapeHtml(styleList[key].label) + '</option>';
    }).join('');
    const catalogProduct = item.productId ? findProduct(item.productId) : null;
    const title = item.name || (catalogProduct ? catalogProduct.name : (item.type === 'door' ? 'Door' : 'Window'));
    els.inspectorBody.innerHTML = '' +
      '<div class="selection-header structural">' +
        '<div class="structural-icon">' + (item.type === 'door' ? '⌷' : '▤') + '</div>' +
        '<div class="selection-title"><span class="eyebrow">' + (item.productId ? 'Catalog opening' : 'Wall opening') + '</span><h3>' + U.escapeHtml(title) + '</h3>' +
        '<div class="selection-meta"><span>' + (item.productId ? U.formatMoney(item.price) + ' · ' : '') + 'Cut into real wall geometry</span></div></div>' +
      '</div>' +
      (item.productId && !catalogProduct ? '<div class="notice notice-warning">The catalog product behind this opening is no longer available. The opening and its saved price are kept.</div>' : '') +
      (validation.errors.length ? '<div class="notice notice-error">' + validation.errors.map(U.escapeHtml).join('<br>') + '</div>' : '') +
      (validation.warnings.length ? '<div class="notice notice-warning">' + validation.warnings.map(U.escapeHtml).join('<br>') + '</div>' : '') +
      '<div class="control-group">' +
        '<div class="section-label">Opening</div>' +
        '<label class="field"><span>Wall</span><select data-opening-field="wall">' + wallOptions + '</select></label>' +
        '<label class="field"><span>Style</span><select data-opening-field="style">' + styleOptions + '</select><small>' + U.escapeHtml(styleList[currentStyle].description) + '</small></label>' +
        '<label class="field"><span>Offset from wall start (cm)</span><input type="number" min="0" step="1" value="' + U.escapeHtml(U.round(item.offsetCm, 1)) + '" data-opening-field="offsetCm"></label>' +
        '<div class="field-row">' +
          '<label class="field"><span>Width (cm)</span><input type="number" min="' + (item.type === 'door' ? C.STRUCTURAL.DOOR.minWidthCm : C.STRUCTURAL.WINDOW.minWidthCm) + '" max="' + (item.type === 'door' ? C.STRUCTURAL.DOOR.maxWidthCm : C.STRUCTURAL.WINDOW.maxWidthCm) + '" step="1" value="' + U.escapeHtml(U.round(item.widthCm, 1)) + '" data-opening-field="widthCm"></label>' +
          '<label class="field"><span>Height (cm)</span><input type="number" min="' + (item.type === 'door' ? C.STRUCTURAL.DOOR.minHeightCm : C.STRUCTURAL.WINDOW.minHeightCm) + '" max="' + U.escapeHtml(Math.round(maxHeight)) + '" step="1" value="' + U.escapeHtml(U.round(item.heightCm, 1)) + '" data-opening-field="heightCm"></label>' +
        '</div>' +
        (item.type === 'window' ? '<label class="field"><span>Sill height from floor (cm)</span><input type="number" min="0" max="' + U.escapeHtml(Math.round(design.room.heightCm - 40)) + '" step="1" value="' + U.escapeHtml(U.round(item.sillCm, 1)) + '" data-opening-field="sillCm"></label>' : '') +
        '<p class="field-note">' + (item.type === 'door' ? 'The door creates a real opening with a lintel above it. Its 100 cm swing clearance is marked in the plan.' : 'The window creates a real opening with a sill below and lintel above, and glass in the 3D wall.') + '</p>' +
      '</div>' +
      '<div class="selection-actions single"><button type="button" class="btn btn-ghost btn-danger-text" data-delete-opening>Remove opening</button></div>' +
      '<div class="shortcut-hint">' + (wall ? U.escapeHtml(wall.label) : 'Wall') + ' · use <strong>Door</strong> or <strong>Window</strong> in the plan toolbar to add another.</div>';
  }

  function renderWallPanel(design, selected) {
    const wall = selected.wall;
    const length = G.interiorWallLength(wall);
    const openings = G.interiorWallOpenings(wall);
    const thickness = U.toNumber(wall.thicknessCm, C.WALL_THICKNESS_CM);
    const height = U.toNumber(wall.heightCm, design.room.heightCm);
    const openingRows = openings.map(function (opening) {
      const isDoor = opening.type === 'door';
      return '<div class="wall-opening-row">' +
        '<div class="inline-actions spread"><strong>' + (isDoor ? 'Door' : 'Window') + ' opening</strong>' +
          '<button type="button" class="btn btn-tiny btn-ghost btn-danger-text" data-wall-remove-opening="' + U.escapeHtml(opening.id) + '">Remove</button></div>' +
        '<div class="field-row">' +
          '<label class="field"><span>Offset from wall start (cm)</span><input type="number" step="1" min="0" value="' + U.escapeHtml(U.round(opening.offsetCm, 1)) + '" data-iopen-field="offsetCm" data-iopen-id="' + U.escapeHtml(opening.id) + '"></label>' +
          '<label class="field"><span>Width (cm)</span><input type="number" step="1" min="40" max="' + U.escapeHtml(U.round(Math.max(40, length - 10), 0)) + '" value="' + U.escapeHtml(U.round(opening.widthCm, 1)) + '" data-iopen-field="widthCm" data-iopen-id="' + U.escapeHtml(opening.id) + '"></label>' +
        '</div>' +
        '<div class="field-row">' +
          '<label class="field"><span>Height (cm)</span><input type="number" step="1" min="40" max="' + U.escapeHtml(U.round(height, 0)) + '" value="' + U.escapeHtml(U.round(opening.heightCm, 1)) + '" data-iopen-field="heightCm" data-iopen-id="' + U.escapeHtml(opening.id) + '"></label>' +
          (isDoor ? '' : '<label class="field"><span>Sill height (cm)</span><input type="number" step="1" min="0" max="' + U.escapeHtml(U.round(height, 0)) + '" value="' + U.escapeHtml(U.round(opening.sillCm, 1)) + '" data-iopen-field="sillCm" data-iopen-id="' + U.escapeHtml(opening.id) + '"></label>') +
        '</div>' +
      '</div>';
    }).join('');
    els.inspectorBody.innerHTML = '' +
      '<div class="selection-header structural">' +
        '<div class="structural-icon">▥</div>' +
        '<div class="selection-title"><span class="eyebrow">Partition wall</span><h3>' + U.formatNumber(length, 0) + ' cm long</h3>' +
        '<div class="selection-meta"><span>' + U.formatNumber(height, 0) + ' cm high · ' + U.formatNumber(thickness, 0) + ' cm thick · ' + openings.length + ' opening' + (openings.length === 1 ? '' : 's') + '</span></div></div>' +
      '</div>' +
      '<div class="control-group">' +
        '<div class="section-label">Endpoints <span id="wallLengthLabel">' + U.formatNumber(length, 0) + ' cm</span></div>' +
        '<div class="field-row">' +
          '<label class="field"><span>Start X (cm)</span><input type="number" step="1" min="0" max="' + U.escapeHtml(U.round(G.roomSize(design.room).width, 0)) + '" value="' + U.escapeHtml(U.round(wall.x1Cm, 1)) + '" data-wall-field="x1Cm"></label>' +
          '<label class="field"><span>Start Z (cm)</span><input type="number" step="1" min="0" max="' + U.escapeHtml(U.round(G.roomSize(design.room).length, 0)) + '" value="' + U.escapeHtml(U.round(wall.z1Cm, 1)) + '" data-wall-field="z1Cm"></label>' +
        '</div>' +
        '<div class="field-row">' +
          '<label class="field"><span>End X (cm)</span><input type="number" step="1" min="0" max="' + U.escapeHtml(U.round(G.roomSize(design.room).width, 0)) + '" value="' + U.escapeHtml(U.round(wall.x2Cm, 1)) + '" data-wall-field="x2Cm"></label>' +
          '<label class="field"><span>End Z (cm)</span><input type="number" step="1" min="0" max="' + U.escapeHtml(U.round(G.roomSize(design.room).length, 0)) + '" value="' + U.escapeHtml(U.round(wall.z2Cm, 1)) + '" data-wall-field="z2Cm"></label>' +
        '</div>' +
        '<div class="inline-actions"><button type="button" class="btn btn-tiny btn-secondary" data-wall-rotate="-15">−15°</button><button type="button" class="btn btn-tiny btn-secondary" data-wall-rotate="15">+15°</button><span class="field-note">Rotates the wall around its midpoint. Drag an end in the plan for free adjustment.</span></div>' +
        '<div class="field-row">' +
          '<label class="field"><span>Height (cm)</span><input type="number" step="1" min="100" max="' + U.escapeHtml(U.round(design.room.heightCm, 0)) + '" value="' + U.escapeHtml(U.round(height, 1)) + '" data-wall-field="heightCm"></label>' +
          '<label class="field"><span>Thickness (cm)</span><input type="number" step="1" min="6" max="40" value="' + U.escapeHtml(U.round(thickness, 1)) + '" data-wall-field="thicknessCm"></label>' +
        '</div>' +
      '</div>' +
      '<div class="control-group">' +
        '<div class="section-label">Doors & windows <span>' + openings.length + '</span></div>' +
        (openingRows || '<p class="muted-note">No openings on this wall yet. Add a doorway so people and the walk camera can pass through.</p>') +
        '<div class="inline-actions"><button type="button" class="btn btn-tiny btn-secondary" data-wall-add-opening="door">+ Doorway</button><button type="button" class="btn btn-tiny btn-secondary" data-wall-add-opening="window">+ Window</button></div>' +
      '</div>' +
      '<div class="selection-actions single"><button type="button" class="btn btn-ghost btn-danger-text" data-delete-wall>Remove wall</button></div>' +
      '<div class="shortcut-hint"><kbd>Ctrl</kbd>+<kbd>Z</kbd> undoes the last wall change · <kbd>Del</kbd> removes the wall · endpoints snap to corners and other walls.</div>';
  }

  function updateWallPanelLive(selected) {
    const wall = selected.wall;
    if (!wall) return;
    const design = getDesign();
    els.inspectorBody.querySelectorAll('[data-wall-field]').forEach(function (input) {
      if (document.activeElement === input) return;
      const field = input.getAttribute('data-wall-field');
      input.value = U.round(wall[field], 1);
    });
    const lengthLabel = document.getElementById('wallLengthLabel');
    if (lengthLabel) lengthLabel.textContent = U.formatNumber(G.interiorWallLength(wall), 0) + ' cm';
    const title = els.inspectorBody.querySelector('.selection-title h3');
    if (title) title.textContent = U.formatNumber(G.interiorWallLength(wall), 0) + ' cm long';
    if (design && !els.inspectorBody.querySelector('[data-iopen-field]')) {
      const openingCount = G.interiorWallOpenings(wall).length;
      const meta = els.inspectorBody.querySelector('.selection-meta span');
      if (meta) {
        meta.textContent = U.formatNumber(wall.heightCm, 0) + ' cm high · ' +
          U.formatNumber(wall.thicknessCm, 0) + ' cm thick · ' + openingCount + ' opening' + (openingCount === 1 ? '' : 's');
      }
    }
  }
  function onInspectorSubmit(event) {
    if (event.target.id === 'budgetForm') { event.preventDefault(); applyBudget(); return; }
    if (event.target.id === 'aiChatForm') { event.preventDefault(); submitChat(); return; }
    if (event.target.id === 'roomSettingsForm') { event.preventDefault(); applyRoomSettings(); }
  }

  function onInspectorClick(event) {
    const target = event.target.closest('button, label, [data-budget-instance], [data-select-instance], [data-select-opening], [data-select-wall], [data-ai-template]');
    if (!target) return;
    if (target.getAttribute('data-item-action') === 'create-room') { openRoomWizard(); return; }
    if (target.hasAttribute('data-select-instance')) { App.selectPlaced(target.getAttribute('data-select-instance')); return; }
    if (target.hasAttribute('data-select-opening')) { App.selectStructural(target.getAttribute('data-select-opening')); return; }
    if (target.hasAttribute('data-select-wall')) { App.selectWall(target.getAttribute('data-select-wall')); return; }
    if (target.hasAttribute('data-duplicate-item')) { duplicateSelection(); return; }
    if (target.hasAttribute('data-delete-item') || target.hasAttribute('data-delete-opening') || target.hasAttribute('data-delete-wall')) { deleteSelection(); return; }
    if (target.hasAttribute('data-wall-rotate')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'wall') return;
      const wall = selected.wall;
      const angle = U.degToRad(Number(target.getAttribute('data-wall-rotate')) || 0);
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const mx = (wall.x1Cm + wall.x2Cm) / 2;
      const mz = (wall.z1Cm + wall.z2Cm) / 2;
      function turn(x, z) {
        const dx = x - mx;
        const dz = z - mz;
        return { x: mx + dx * cos - dz * sin, z: mz + dx * sin + dz * cos };
      }
      const p1 = turn(wall.x1Cm, wall.z1Cm);
      const p2 = turn(wall.x2Cm, wall.z2Cm);
      const result = App.State.updateInteriorWall(wall.id, { x1Cm: p1.x, z1Cm: p1.z, x2Cm: p2.x, z2Cm: p2.z });
      if (!result.ok) U.showToast(result.error, 'warning');
      return;
    }
    if (target.hasAttribute('data-wall-add-opening')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'wall') return;
      const kind = target.getAttribute('data-wall-add-opening');
      const wall = selected.wall;
      const length = G.interiorWallLength(wall);
      const spec = kind === 'window' ? C.STRUCTURAL.WINDOW : C.STRUCTURAL.DOOR;
      const width = Math.min(spec.defaultWidthCm, Math.max(40, length - 10));
      const gaps = G.interiorWallSegments(wall)
        .map(function (segment) { return { start: segment.start, end: segment.end, size: segment.end - segment.start }; })
        .filter(function (gap) { return gap.size >= width + 12; })
        .sort(function (a, b) { return b.size - a.size; });
      if (!gaps.length) {
        U.showToast('There is not enough free wall left for a ' + U.formatNumber(width, 0) + ' cm ' +
          (kind === 'window' ? 'window' : 'doorway') + '. Widen the wall, remove another opening, or make this one narrower.', 'warning', { duration: 6000 });
        return;
      }
      const gap = gaps[0];
      const result = App.State.addInteriorOpening(selected.id, (gap.start + gap.end) / 2, kind);
      if (!result.ok) { U.showToast(result.error, 'warning'); return; }
      refreshInspector(true);
      U.showToast((kind === 'window' ? 'Window' : 'Doorway') + ' added to the partition wall. Adjust it below.', 'success');
      return;
    }
    if (target.hasAttribute('data-wall-remove-opening')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'wall') return;
      const result = App.State.removeInteriorOpening(selected.id, target.getAttribute('data-wall-remove-opening'));
      if (!result.ok) { U.showToast(result.error, 'warning'); return; }
      refreshInspector(true);
      U.showToast('Opening removed from the partition wall.', 'info');
      return;
    }
    if (target.hasAttribute('data-rotate-by')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'placed') return;
      const delta = Number(target.getAttribute('data-rotate-by'));
      App.State.updatePlaced(selected.id, { rotationDeg: selected.item.rotationDeg + delta });
      return;
    }
    if (target.hasAttribute('data-move-layer')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'placed') return;
      const result = App.State.moveLayer(selected.id, target.getAttribute('data-move-layer'));
      if (!result.ok) U.showToast(result.error, 'warning');
      return;
    }
    if (target.hasAttribute('data-toggle-lock')) return;
    if (target.hasAttribute('data-open-product-id')) { openProductDetails(target.getAttribute('data-open-product-id')); return; }
    if (target.hasAttribute('data-budget-instance')) { App.selectPlaced(target.getAttribute('data-budget-instance')); return; }
    if (target.hasAttribute('data-open-manager-from')) {
      App.ProductManager.open();
      return;
    }
    if (target.hasAttribute('data-budget-clear')) {
      App.State.setBudget(null);
      return;
    }
    if (target.hasAttribute('data-room-issue-select')) {
      const type = target.getAttribute('data-issue-type');
      const id = target.getAttribute('data-issue-id');
      if (type === 'placed') App.selectPlaced(id);
      else if (type === 'structural') App.selectStructural(id);
      return;
    }
    if (target.hasAttribute('data-start-ai')) { setInspectorTab('ai'); return; }
    if (target.hasAttribute('data-ai-generate')) { generateAILayout(); return; }
    if (target.hasAttribute('data-ai-undo')) { undoAILayout(); return; }
    if (target.hasAttribute('data-ai-step')) {
      stepAIQuantity(target.getAttribute('data-ai-step'), Number(target.getAttribute('data-direction')));
      return;
    }
    if (target.hasAttribute('data-ai-clear')) {
      ui.aiSelections = {};
      renderAIPanel();
      return;
    }
    if (target.hasAttribute('data-ai-remove')) {
      delete ui.aiSelections[target.getAttribute('data-ai-remove')];
      ui.aiReport = null;
      renderAIPanel();
      return;
    }
    if (target.hasAttribute('data-ai-starter')) {
      const design = getDesign();
      if (!design) return;
      const roomUse = C.ROOM_USES[design.roomUse] ? design.roomUse : 'living';
      ui.aiSelections = starterSelectionsFor(roomUse, design.room);
      ui.aiReport = null;
      renderAIPanel();
      U.showToast(C.ROOM_USES[roomUse].label + ' starter mix loaded. Review the product images and quantities, then generate.', 'success', { duration: 5200 });
      return;
    }
    if (target.hasAttribute('data-ai-use-current')) {
      const design = getDesign();
      if (!design) return;
      const map = {};
      design.placedItems.forEach(function (item) { map[item.productId] = (map[item.productId] || 0) + 1; });
      ui.aiSelections = map;
      renderAIPanel();
      return;
    }
    if (target.hasAttribute('data-open-door-tool')) { beginOpeningTool('door'); return; }
    if (target.hasAttribute('data-open-window-tool')) { beginOpeningTool('window'); return; }
    if (target.hasAttribute('data-wall-color')) {
      const result = App.State.setWallColor(target.getAttribute('data-wall-color'));
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.hasAttribute('data-wall-reset')) {
      App.State.setWallColor(C.WALL_DEFAULT_COLOR);
      return;
    }
    if (target.hasAttribute('data-exterior-wall-color')) {
      const result = App.State.setExteriorWallColor(target.getAttribute('data-exterior-wall-color'));
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.hasAttribute('data-exterior-wall-inherit')) {
      const result = App.State.setExteriorWallColor(null);
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.hasAttribute('data-floor-mode')) {
      const mode = target.getAttribute('data-floor-mode');
      const design = getDesign();
      if (mode === 'texture' && design && !design.floor.textureKey && !ui.floorPending) {
        U.showToast('Upload a texture image first, then switch to texture mode.', 'warning');
        return;
      }
      const result = App.State.setFloor({ mode: mode });
      if (!result.ok) U.showToast(result.error, 'warning');
      return;
    }
    if (target.hasAttribute('data-floor-color')) {
      const result = App.State.setFloor({ color: target.getAttribute('data-floor-color') });
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.hasAttribute('data-floor-apply-texture')) { applyPendingFloorTexture(); return; }
    if (target.hasAttribute('data-floor-reset')) {
      ui.floorPending = null;
      const result = App.State.resetFloor();
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.hasAttribute('data-ai-action')) { executeChatAction(target.getAttribute('data-ai-action')); return; }
    if (target.hasAttribute('data-ai-say')) { submitChat(target.getAttribute('data-ai-say')); return; }
    if (target.hasAttribute('data-ai-model-save')) {
      const urlEl = document.getElementById('aiModelUrl');
      const modelEl = document.getElementById('aiModelName');
      const statusEl = document.getElementById('aiModelStatus');
      try {
        const saved = App.AIAssistant.setModelConfig({
          url: urlEl ? urlEl.value : '',
          model: modelEl ? modelEl.value : ''
        });
        if (saved.url) {
          U.showToast('Model endpoint saved. The browser never stores a key — keep it on your server.', 'success', { duration: 6000 });
        } else {
          U.showToast('No endpoint saved. The local assistant is active.', 'info');
        }
        refreshInspector(true);
      } catch (err) {
        if (statusEl) statusEl.textContent = err && err.message ? err.message : 'That endpoint could not be saved.';
      }
      return;
    }
    if (target.hasAttribute('data-ai-model-clear')) {
      App.AIAssistant.setModelConfig({ url: '', model: '' });
      U.showToast('Disconnected from the model endpoint. Local rules only.', 'info');
      refreshInspector(true);
      return;
    }
  }

  function onInspectorChange(event) {
    const target = event.target;
    if (target.matches('[data-toggle-lock]')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'placed') return;
      const result = App.State.updatePlaced(selected.id, { locked: target.checked });
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.matches('[data-item-field]')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'placed') return;
      const field = target.getAttribute('data-item-field');
      const raw = Number(target.value);
      if (!Number.isFinite(raw)) { U.showToast('Enter a valid number.', 'error'); refreshInspector(true); return; }
      const result = App.State.updatePlaced(selected.id, field === 'rotationDeg' ? { rotationDeg: raw } : { [field]: raw });
      if (!result.ok) { U.showToast(result.error, 'warning'); refreshInspector(true); }
      return;
    }
    if (target.matches('[data-item-variant]')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'placed') return;
      const result = App.State.updatePlaced(selected.id, { variantId: target.value });
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.matches('[data-wall-field]')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'wall') return;
      const field = target.getAttribute('data-wall-field');
      const raw = Number(target.value);
      if (!Number.isFinite(raw)) { U.showToast('Enter a valid number for the wall.', 'error'); refreshInspector(true); return; }
      const patch = {};
      patch[field] = raw;
      const result = App.State.updateInteriorWall(selected.id, patch);
      if (!result.ok) U.showToast(result.error, 'warning');
      refreshInspector(true);
      return;
    }
    if (target.matches('[data-iopen-field]')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'wall') return;
      const field = target.getAttribute('data-iopen-field');
      const openingId = target.getAttribute('data-iopen-id');
      const raw = Number(target.value);
      if (!Number.isFinite(raw)) { U.showToast('Enter a valid opening measurement.', 'error'); refreshInspector(true); return; }
      const patch = {};
      patch[field] = raw;
      const result = App.State.updateInteriorOpening(selected.id, openingId, patch);
      if (!result.ok) { U.showToast(result.error, 'warning'); refreshInspector(true); }
      return;
    }
    if (target.matches('[data-opening-field]')) {
      commitOpeningField(target);
      return;
    }
    if (target.matches('#roomShape')) {
      updateRoomFormVisibility();
      return;
    }
    if (target.matches('[data-wall-color-picker]')) {
      const result = App.State.setWallColor(target.value);
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.matches('[data-exterior-wall-picker]')) {
      const result = App.State.setExteriorWallColor(target.value);
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.matches('[data-floor-color-picker]')) {
      const result = App.State.setFloor({ color: target.value });
      if (!result.ok) U.showToast(result.error, 'error');
      return;
    }
    if (target.matches('[data-floor-file]')) {
      stageFloorTextureFile(target);
      return;
    }
    if (target.matches('[data-ai-template]')) {
      ui.aiTemplate = target.value;
      updateAITemplateUI();
      return;
    }
    if (target.matches('[data-ai-qty]')) {
      syncAIQuantity(target);
    }
  }

  function onInspectorInput(event) {
    const target = event.target;
    if (target.matches('[data-item-rotation-range]')) {
      const selected = App.getSelection();
      if (!selected || selected.type !== 'placed') return;
      App.State.updatePlaced(selected.id, { rotationDeg: Number(target.value) });
      return;
    }
    if (target.matches('[data-floor-scale]')) {
      const result = App.State.setFloor({ textureScale: Number(target.value) });
      if (!result.ok) U.showToast(result.error, 'warning');
      const label = document.getElementById('floorScaleValue');
      if (label) label.textContent = U.formatNumber(Number(target.value), 2) + ' m';
      return;
    }
    if (target.matches('[data-ai-qty]')) {
      syncAIQuantity(target, true);
      return;
    }
  }

  function stageFloorTextureFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    if (file.size > C.FLOOR_TEXTURE.MAX_BYTES) {
      U.showToast('That image is too large — the maximum is ' + U.formatFileSize(C.FLOOR_TEXTURE.MAX_BYTES) + '.', 'error');
      input.value = '';
      return;
    }
    if (!/^image\/(png|jpe?g)$/i.test(file.type)) {
      U.showToast('Choose a PNG or JPG image for the floor texture.', 'error');
      input.value = '';
      return;
    }
    const reader = new FileReader();
    reader.onload = function () {
      ui.floorPending = { file: file, dataUrl: String(reader.result || ''), name: file.name || 'texture.png' };
      refreshInspector(true);
    };
    reader.onerror = function () { U.showToast('The image could not be read.', 'error'); };
    reader.readAsDataURL(file);
  }

  async function applyPendingFloorTexture() {
    const pending = ui.floorPending;
    if (!pending) return;
    try {
      U.showToast('Storing the floor texture…', 'info', { duration: 1800 });
      const saved = await App.Storage.saveAsset(pending.file, { name: pending.name, type: pending.file.type || 'image/png' });
      const result = App.State.setFloor({ mode: 'texture', textureKey: saved.key });
      if (!result.ok) { U.showToast(result.error, 'error'); return; }
      ui.floorPending = null;
      U.showToast('Floor texture applied. It is stored with this design and appears in both views.', 'success');
    } catch (err) {
      U.showToast('The texture could not be stored: ' + (err && err.message ? err.message : err), 'error');
    }
  }

  function commitOpeningField(target) {
    const selected = App.getSelection();
    if (!selected || selected.type !== 'structural') return;
    const field = target.getAttribute('data-opening-field');
    let value = target.value;
    if (field !== 'wall' && field !== 'style') {
      value = Number(value);
      if (!Number.isFinite(value)) { U.showToast('Enter a valid number for the opening.', 'error'); refreshInspector(true); return; }
    }
    const patch = {};
    patch[field] = value;
    const result = App.State.updateStructural(selected.id, patch);
    if (!result.ok) {
      U.showToast(result.error, 'warning');
      refreshInspector(true);
    }
  }

  function renderBudgetPanel() {
    const design = getDesign();
    if (!design) {
      els.inspectorBody.innerHTML = '<div class="inspector-empty"><div class="empty-icon">€</div><h3>No budget yet</h3><p>Create a room and add products to see live pricing from the catalog.</p><button type="button" class="btn btn-primary" data-item-action="create-room">Create a room</button></div>';
      return;
    }
    const summary = P.summarize(design, App.Catalog.getProductsById());
    const percent = summary.hasBudget && summary.budget > 0 ? Math.min(100, (summary.total / summary.budget) * 100) : (summary.total > 0 ? 100 : 0);
    const over = summary.over;
    const lines = summary.lines.map(function (line) {
      const selector = line.firstInstanceId
        ? (line.instanceType === 'structural' ? 'data-select-opening="' + U.escapeHtml(line.firstInstanceId) + '"' : 'data-budget-instance="' + U.escapeHtml(line.firstInstanceId) + '"')
        : '';
      return '<button type="button" class="budget-line" ' + selector + ' ' + (line.firstInstanceId ? '' : 'disabled') + '>' +
        '<span class="budget-line-info"><strong>' + U.escapeHtml(line.name) + '</strong><small>' + line.quantity + ' × ' + U.formatMoney(line.unitPrice) + (line.priceValid ? '' : ' · price unavailable') + '</small></span>' +
        '<span class="budget-line-total">' + U.formatMoney(line.subtotal) + '</span>' +
      '</button>';
    }).join('');
    els.inspectorBody.innerHTML = '' +
      '<div class="budget-hero ' + (over ? 'is-over' : '') + '">' +
        '<span class="eyebrow">Estimated room cost</span>' +
        '<div class="budget-total">' + (summary.incomplete ? 'At least ' : '') + U.formatMoney(summary.total) + '</div>' +
        '<div class="budget-sub">' + summary.quantity + ' item' + (summary.quantity === 1 ? '' : 's') + ' · from the current product catalog</div>' +
        (summary.hasBudget
          ? '<div class="budget-track"><span style="width:' + percent.toFixed(1) + '%"></span></div><div class="budget-budget-row"><span>Budget ' + U.formatMoney(summary.budget) + '</span><strong>' + (over ? U.formatMoney(Math.abs(summary.remaining)) + ' over' : U.formatMoney(summary.remaining) + ' left') + '</strong></div>'
          : '<p class="budget-no-limit">No budget set yet.</p>') +
      '</div>' +
      (over ? '<div class="notice notice-error">This design is over budget by ' + U.formatMoney(Math.abs(summary.remaining)) + '. Prices update from the catalog, not from manually entered figures.</div>' : '') +
      (summary.incomplete ? '<div class="notice notice-warning">Some placed products are missing from the catalog, so the total is incomplete. All totals use catalog prices only.</div>' : '') +
      '<form id="budgetForm" class="budget-form"><label class="field"><span>Budget (EUR)</span><div class="inline-actions"><input type="number" id="budgetInput" min="0" step="10" value="' + (summary.hasBudget ? U.escapeHtml(summary.budget) : '') + '" placeholder="No budget"><button type="submit" class="btn btn-secondary">Apply</button><button type="button" class="btn btn-ghost" data-budget-clear>Clear</button></div></label></form>' +
      '<div class="section-label">Product list <span>' + summary.quantity + '</span></div>' +
      '<div class="budget-lines">' + (lines || '<p class="muted-note">No products placed yet. Add from the catalog to see costs here.</p>') + '</div>' +
      '<div class="budget-footer-notes"><span>Doors and windows: ' + summary.structuralCount + '</span><span>Prices include no taxes or delivery.</span></div>';
  }

  function applyBudget() {
    const design = getDesign();
    if (!design) return;
    const input = document.getElementById('budgetInput');
    if (!input) return;
    const value = input.value.trim() === '' ? null : Number(input.value);
    const result = App.State.setBudget(value);
    if (!result.ok) U.showToast(result.error, 'error');
    else U.showToast(value === null ? 'Budget removed.' : 'Budget updated. Prices remain driven by the catalog.', 'success');
  }

  function wallColorName(value) {
    const match = C.WALL_COLORS.find(function (entry) { return entry.value.toLowerCase() === String(value || '').toLowerCase(); });
    return match ? match.label : 'Custom';
  }

  function floorColorName(value) {
    const match = C.FLOOR_COLORS.find(function (entry) { return entry.value.toLowerCase() === String(value || '').toLowerCase(); });
    return match ? match.label : 'Custom';
  }

  function floorCardHtml(design) {
    const floor = design.floor;
    const floorSwatches = C.FLOOR_COLORS.map(function (entry) {
      const selected = entry.value.toLowerCase() === floor.color.toLowerCase();
      return '<button type="button" class="wall-swatch' + (selected ? ' is-selected' : '') + '" style="--swatch:' + U.escapeHtml(entry.value) + '" data-floor-color="' + U.escapeHtml(entry.value) + '" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-label="' + U.escapeHtml(entry.label) + '" title="' + U.escapeHtml(entry.label) + '"><span class="wall-swatch-check" aria-hidden="true">✓</span></button>';
    }).join('');
    const pending = ui.floorPending;
    const pendingHtml = pending
      ? '<div class="floor-pending"><img src="' + U.escapeHtml(pending.dataUrl) + '" alt="Texture preview"><div class="floor-pending-info"><strong>' + U.escapeHtml(pending.name) + '</strong><small>Ready to apply</small></div><button type="button" class="btn btn-primary btn-small" data-floor-apply-texture>Use this texture</button></div>'
      : '';
    const textureControls = floor.mode === 'texture'
      ? '<label class="field"><span>Tile size · <strong id="floorScaleValue">' + U.formatNumber(floor.textureScale, 2) + ' m</strong> per tile</span>' +
        '<input type="range" min="' + C.FLOOR_TEXTURE.MIN_SCALE_M + '" max="' + C.FLOOR_TEXTURE.MAX_SCALE_M + '" step="0.05" value="' + floor.textureScale + '" data-floor-scale aria-label="Floor texture tile size in metres"></label>'
      : '';
    return '' +
      '<div class="floor-card">' +
        '<div class="wall-color-head"><div><strong>Floor</strong><small>Solid colour or a tiled PNG/JPG texture — applied to the 2D plan and the real 3D floor</small></div><span class="wall-color-current"><i style="background:' + U.escapeHtml(floor.color) + '"></i>' + U.escapeHtml(floorColorName(floor.color)) + '</span></div>' +
        '<div class="seg" role="group" aria-label="Floor mode">' +
          '<button type="button" class="seg-btn' + (floor.mode === 'color' ? ' is-active' : '') + '" data-floor-mode="color" aria-pressed="' + (floor.mode === 'color' ? 'true' : 'false') + '">Solid colour</button>' +
          '<button type="button" class="seg-btn' + (floor.mode === 'texture' ? ' is-active' : '') + '" data-floor-mode="texture" aria-pressed="' + (floor.mode === 'texture' ? 'true' : 'false') + '">Texture</button>' +
        '</div>' +
        '<div class="floor-body' + (floor.mode === 'texture' ? ' is-texture' : '') + '">' +
          '<div class="floor-panel floor-color-panel">' +
            '<div class="wall-swatches" role="group" aria-label="Floor colour presets">' + floorSwatches + '</div>' +
            '<div class="wall-color-custom">' +
              '<label class="wall-color-picker"><input type="color" value="' + U.escapeHtml(floor.color) + '" data-floor-color-picker aria-label="Choose a custom floor colour"><span>Custom colour</span></label>' +
            '</div>' +
          '</div>' +
          '<div class="floor-panel floor-texture-panel">' +
            (floor.textureKey
              ? '<div class="notice notice-success">A texture is stored with this design. It renders in both views and survives reloads and backups.</div>'
              : '<p class="muted-note">No texture stored yet. Upload one below, then apply it — texture mode activates automatically.</p>') +
            textureControls +
          '</div>' +
          '<label class="field floor-upload-field"><span>Texture image (PNG or JPG · max ' + U.formatFileSize(C.FLOOR_TEXTURE.MAX_BYTES) + ')</span><input type="file" accept="image/png,image/jpeg" data-floor-file class="floor-file"></label>' +
          pendingHtml +
        '</div>' +
        '<button type="button" class="btn btn-tiny btn-ghost" data-floor-reset>Reset to default floor</button>' +
      '</div>';
  }

  function renderRoomPanel() {
    const design = getDesign();
    if (!design) {
      els.inspectorBody.innerHTML = '<div class="inspector-empty"><div class="empty-icon">⌂</div><h3>No room to edit</h3><p>Create a room to change its shape, dimensions and ceiling height.</p><button type="button" class="btn btn-primary" data-item-action="create-room">Create a room</button></div>';
      return;
    }
    const room = design.room;
    const isCircle = room.shape === 'circle';
    const issues = G.designIssues(design, App.Catalog.getProductsById());
    const issueRows = issues.map(function (issue) {
      const type = issue.instanceId ? 'placed' : issue.structuralId ? 'structural' : '';
      const id = issue.instanceId || issue.structuralId || '';
      return '<div class="issue-row ' + (issue.severity === 'error' ? 'is-error' : '') + '">' +
        '<span class="issue-mark">' + (issue.severity === 'error' ? '!' : '·') + '</span>' +
        '<span class="issue-text">' + U.escapeHtml(issue.message) + '</span>' +
        (type ? '<button type="button" class="btn btn-tiny btn-secondary" data-room-issue-select data-issue-type="' + type + '" data-issue-id="' + U.escapeHtml(id) + '">Show</button>' : '') +
      '</div>';
    }).join('');
    const wallColor = design.wallColor || C.WALL_DEFAULT_COLOR;
    const swatches = C.WALL_COLORS.map(function (entry) {
      const selected = entry.value.toLowerCase() === wallColor.toLowerCase();
      return '<button type="button" class="wall-swatch' + (selected ? ' is-selected' : '') + '" style="--swatch:' + U.escapeHtml(entry.value) + '" data-wall-color="' + U.escapeHtml(entry.value) + '" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-label="' + U.escapeHtml(entry.label) + '" title="' + U.escapeHtml(entry.label) + '"><span class="wall-swatch-check" aria-hidden="true">✓</span></button>';
    }).join('');
    const exteriorWallColor = design.exteriorWallColor || '';
    const exteriorEffective = exteriorWallColor || wallColor;
    const exteriorInherited = !exteriorWallColor;
    const exteriorSwatches = C.WALL_COLORS.map(function (entry) {
      const selected = !exteriorInherited && entry.value.toLowerCase() === exteriorWallColor.toLowerCase();
      return '<button type="button" class="wall-swatch' + (selected ? ' is-selected' : '') + '" style="--swatch:' + U.escapeHtml(entry.value) + '" data-exterior-wall-color="' + U.escapeHtml(entry.value) + '" aria-pressed="' + (selected ? 'true' : 'false') + '" aria-label="Outside: ' + U.escapeHtml(entry.label) + '" title="Outside: ' + U.escapeHtml(entry.label) + '"><span class="wall-swatch-check" aria-hidden="true">✓</span></button>';
    }).join('');
    const exteriorSection = isCircle
      ? '<div class="wall-color-section"><div class="wall-color-head"><div><strong>Outside walls</strong><small>Round rooms use one paint colour on both faces of the curved wall in this version.</small></div></div></div>'
      : '<div class="wall-color-section">' +
        '<div class="wall-color-head"><div><strong>Outside walls</strong><small>The street side of the perimeter walls in 3D</small></div><span class="wall-color-current"><i style="background:' + U.escapeHtml(exteriorEffective) + '"></i>' + (exteriorInherited ? 'Same as inside' : U.escapeHtml(wallColorName(exteriorEffective))) + '</span></div>' +
        '<div class="wall-swatches" role="group" aria-label="Outside wall colour presets">' + exteriorSwatches + '</div>' +
        '<div class="wall-color-custom">' +
          '<button type="button" class="wall-inherit-btn' + (exteriorInherited ? ' is-active' : '') + '" data-exterior-wall-inherit aria-pressed="' + (exteriorInherited ? 'true' : 'false') + '">Same as inside</button>' +
          '<label class="wall-color-picker"><input type="color" value="' + U.escapeHtml(exteriorEffective) + '" data-exterior-wall-picker aria-label="Choose a custom outside wall colour"><span>Custom outside</span></label>' +
        '</div>' +
        '<p class="wall-color-note">Outside paint is saved with this design and shows on the exterior faces in 3D. Doors and windows stay cut through both faces.</p>' +
      '</div>';
    els.inspectorBody.innerHTML = '' +
      '<div class="room-summary-card">' +
        '<span class="eyebrow">Room geometry</span><h3>' + U.escapeHtml(G.roomShapeLabel(room)) + ' room</h3>' +
        '<p>' + U.escapeHtml(U.formatRoomDims(room)) + ' · ' + U.formatNumber(G.roomAreaSqm(room), 1) + ' m²</p>' +
        '<div class="room-summary-chips"><span>' + design.placedItems.length + ' items</span><span>' + design.structuralItems.length + ' openings</span><span>H ' + U.formatNumber(room.heightCm, 0) + ' cm</span><span>' + U.escapeHtml(wallColorName(wallColor)) + ' walls</span></div>' +
      '</div>' +
      '<div class="wall-color-card">' +
        '<div class="wall-color-head"><div><strong>Inside walls</strong><small>Applied to the 2D plan and the inside faces of the 3D walls</small></div><span class="wall-color-current"><i style="background:' + U.escapeHtml(wallColor) + '"></i>' + U.escapeHtml(wallColorName(wallColor)) + '</span></div>' +
        '<div class="wall-swatches" role="group" aria-label="Inside wall colour presets">' + swatches + '</div>' +
        '<div class="wall-color-custom">' +
          '<label class="wall-color-picker"><input type="color" value="' + U.escapeHtml(wallColor) + '" data-wall-color-picker aria-label="Choose a custom inside wall colour"><span>Custom inside</span></label>' +
          '<button type="button" class="btn btn-tiny btn-ghost" data-wall-reset>Reset inside</button>' +
        '</div>' +
        exteriorSection +
        '<p class="wall-color-note">Both colours are stored with this design and are included in autosave and backups.</p>' +
      '</div>' +
      floorCardHtml(design) +
      '<form id="roomSettingsForm" class="room-form">' +
        '<div class="section-label">Edit dimensions</div>' +
        '<label class="field"><span>Room shape</span><select name="shape" id="roomShape"><option value="rectangle"' + (room.shape === 'rectangle' ? ' selected' : '') + '>Rectangular</option><option value="square"' + (room.shape === 'square' ? ' selected' : '') + '>Square</option><option value="circle"' + (isCircle ? ' selected' : '') + '>Circular</option></select></label>' +
        '<div class="field-row">' +
          '<label class="field" data-room-field="width"><span id="roomWidthLabel">Width (cm)</span><input name="widthCm" type="number" min="' + C.ROOM.MIN_DIM_CM + '" max="' + C.ROOM.MAX_DIM_CM + '" step="1" value="' + U.escapeHtml(room.widthCm) + '"></label>' +
          '<label class="field" data-room-field="length"><span>Length (cm)</span><input name="lengthCm" type="number" min="' + C.ROOM.MIN_DIM_CM + '" max="' + C.ROOM.MAX_DIM_CM + '" step="1" value="' + U.escapeHtml(room.lengthCm) + '"></label>' +
          '<label class="field" data-room-field="diameter"><span>Diameter (cm)</span><input name="diameterCm" type="number" min="' + C.ROOM.MIN_DIM_CM + '" max="' + C.ROOM.MAX_DIM_CM + '" step="1" value="' + U.escapeHtml(room.diameterCm || room.widthCm) + '"></label>' +
        '</div>' +
        '<label class="field"><span>Ceiling height (cm)</span><input name="heightCm" type="number" min="' + C.ROOM.MIN_HEIGHT_CM + '" max="' + C.ROOM.MAX_HEIGHT_CM + '" step="1" value="' + U.escapeHtml(room.heightCm) + '"><small>The 3D walls, door and window openings all use this height.</small></label>' +
        (isCircle ? '<div class="notice notice-warning">Circular rooms use a true circular floor and curved wall. Door and window openings are not supported on curved walls in this version.</div>' : '') +
        '<div class="room-form-message" id="roomFormMessage"></div>' +
        '<button type="submit" class="btn btn-primary">Apply room changes</button>' +
        '<p class="field-note">Changing dimensions never resizes furniture. Items that no longer fit are kept and marked outside the room.</p>' +
      '</form>' +
      '<div class="section-label">Checks <span>' + issues.length + '</span></div>' +
      (issueRows || '<div class="notice notice-success">No placement problems detected. All furniture is inside the room and clear of doors.</div>') +
      (issues.length ? '<p class="muted-note">Errors prevent safe placement; warnings point out overlaps or door clearances. They are derived from the actual geometry.</p>' : '') +
      (isCircle ? '' : '<div class="room-tools"><button type="button" class="btn btn-secondary btn-small" data-open-door-tool>Add a door</button><button type="button" class="btn btn-secondary btn-small" data-open-window-tool>Add a window</button></div>');
    updateRoomFormVisibility();
  }

  function updateRoomFormVisibility() {
    const select = document.getElementById('roomShape');
    if (!select) return;
    const shape = select.value;
    const body = els.inspectorBody;
    const width = body.querySelector('[data-room-field="width"]');
    const length = body.querySelector('[data-room-field="length"]');
    const diameter = body.querySelector('[data-room-field="diameter"]');
    if (width) width.hidden = shape === 'circle';
    if (length) length.hidden = shape === 'circle' || shape === 'square';
    if (diameter) diameter.hidden = shape !== 'circle';
    const label = document.getElementById('roomWidthLabel');
    if (label) label.textContent = shape === 'square' ? 'Side (cm)' : 'Width (cm)';
  }

  async function applyRoomSettings() {
    const design = getDesign();
    if (!design) return;
    const form = document.getElementById('roomSettingsForm');
    if (!form) return;
    const message = document.getElementById('roomFormMessage');
    const shape = form.elements.shape.value;
    const height = Number(form.elements.heightCm.value);
    let width = Number(form.elements.widthCm.value);
    let length = Number(form.elements.lengthCm.value);
    const diameter = Number(form.elements.diameterCm.value);
    if (!Number.isFinite(height) || height < C.ROOM.MIN_HEIGHT_CM || height > C.ROOM.MAX_HEIGHT_CM) {
      message.textContent = 'Ceiling height must be between ' + C.ROOM.MIN_HEIGHT_CM + ' and ' + C.ROOM.MAX_HEIGHT_CM + ' cm.';
      return;
    }
    if (shape === 'circle') {
      if (!Number.isFinite(diameter) || diameter < C.ROOM.MIN_DIM_CM || diameter > C.ROOM.MAX_DIM_CM) {
        message.textContent = 'Diameter must be between ' + C.ROOM.MIN_DIM_CM + ' and ' + C.ROOM.MAX_DIM_CM + ' cm.';
        return;
      }
      width = diameter;
      length = diameter;
    } else {
      if (!Number.isFinite(width) || width < C.ROOM.MIN_DIM_CM || width > C.ROOM.MAX_DIM_CM) {
        message.textContent = 'Width must be between ' + C.ROOM.MIN_DIM_CM + ' and ' + C.ROOM.MAX_DIM_CM + ' cm.';
        return;
      }
      if (shape === 'square') length = width;
      if (!Number.isFinite(length) || length < C.ROOM.MIN_DIM_CM || length > C.ROOM.MAX_DIM_CM) {
        message.textContent = 'Length must be between ' + C.ROOM.MIN_DIM_CM + ' and ' + C.ROOM.MAX_DIM_CM + ' cm.';
        return;
      }
    }
    const removingOpenings = shape === 'circle' && design.structuralItems.length > 0;
    if (removingOpenings) {
      const confirmed = await App.UI.confirm('Remove openings for a circular room?',
        'Circular walls do not support door or window openings in this version. Converting this room to a circle will remove its ' +
        design.structuralItems.length + ' opening' + (design.structuralItems.length === 1 ? '' : 's') + '. Furniture and your saved data will be kept.',
        { confirmLabel: 'Convert to circular room', danger: true });
      if (!confirmed) return;
    }
    const result = App.State.setRoom({ shape: shape, widthCm: width, lengthCm: length, diameterCm: diameter, heightCm: height });
    if (!result.ok) {
      message.textContent = result.error;
      return;
    }
    if (removingOpenings) {
      design.structuralItems.slice().forEach(function (item) { App.State.removeStructural(item.id); });
    }
    ui.selection = null;
    const warnings = G.roomChangeWarnings(design, design.room);
    const structuralProblems = G.validateStructuralItems(design);
    if (structuralProblems.length) warnings.push(structuralProblems.length + ' door/window placement' + (structuralProblems.length === 1 ? '' : 's') + ' became invalid.');
    if (warnings.length) {
      U.showToast('Room updated. ' + warnings.join(' '), 'warning', { duration: 7000 });
    } else {
      U.showToast('Room dimensions updated. The 2D plan and 3D room use the new size.', 'success');
    }
    requestAnimationFrame(function () { App.Designer2D.fitView(); });
    refreshInspector(true);
  }

  function starterFor(category, options) {
    const opts = options || {};
    const list = App.Catalog.getProducts().filter(function (product) {
      if (product.category !== category) return false;
      const longSide = Math.max(product.widthCm, product.lengthCm);
      if (opts.minLongSide && longSide < opts.minLongSide) return false;
      if (opts.maxLongSide && longSide > opts.maxLongSide) return false;
      return true;
    });
    if (!list.length) return null;
    list.sort(function (a, b) {
      const areaA = a.widthCm * a.lengthCm;
      const areaB = b.widthCm * b.lengthCm;
      if (areaA !== areaB) return opts.strategy === 'largest' ? areaB - areaA : areaA - areaB;
      return String(a.name).localeCompare(String(b.name));
    });
    return list[0];
  }

  function starterSelectionsFor(roomUse, room) {
    const use = C.ROOM_USES[roomUse] ? roomUse : 'living';
    const area = G.roomAreaSqm(room);
    const size = G.roomSize(room);
    const minDim = Math.min(size.width, size.length);
    const selections = {};
    function put(product, qty) {
      if (!product || !qty) return;
      const limit = C.LIMITS.CATEGORY_LIMITS[product.category] || 1;
      const next = Math.min(limit, (selections[product.id] || 0) + qty);
      if (next > 0) selections[product.id] = next;
    }
    if (use === 'bedroom') {
      put(starterFor('bed', { strategy: area >= 15 ? 'largest' : 'smallest' }), 1);
      const bedside = starterFor('storage', { maxLongSide: 60, strategy: 'smallest' }) || starterFor('storage', { strategy: 'smallest' });
      put(bedside, (area >= 12 && minDim >= 300) ? 2 : 1);
      if (area >= 9) put(starterFor('wardrobe', { strategy: area >= 15 ? 'largest' : 'smallest' }), 1);
      if (area >= 17) {
        const dresser = starterFor('storage', { minLongSide: 90, strategy: 'smallest' });
        if (dresser && (!bedside || dresser.id !== bedside.id)) put(dresser, 1);
      }
      if (area >= 8) put(starterFor('lighting'), 1);
      if (area >= 13) put(starterFor('rug'), 1);
      if (area >= 10) put(starterFor('decor'), 1);
      return selections;
    }
    if (use === 'office') {
      put(starterFor('desk'), 1);
      put(starterFor('chair', { minLongSide: 65 }), 1);
      if (area >= 9) put(starterFor('shelf'), 1);
      if (area >= 11) put(starterFor('storage', { strategy: 'smallest' }), 1);
      if (area >= 8) put(starterFor('lighting'), 1);
      if (area >= 13) put(starterFor('rug'), 1);
      if (area >= 10) put(starterFor('decor'), 1);
      return selections;
    }
    if (use === 'dining') {
      const diningTable = starterFor('table', { minLongSide: 140, strategy: 'smallest' });
      put(diningTable, 1);
      if (diningTable) {
        const chair = starterFor('chair', { maxLongSide: 65 }) || starterFor('chair');
        if (chair) put(chair, area >= 18 ? 6 : area >= 11 ? 4 : 2);
      }
      if (area >= 13) put(starterFor('storage', { minLongSide: 100, strategy: 'smallest' }) || starterFor('storage', { strategy: 'smallest' }), 1);
      if (area >= 8) put(starterFor('lighting'), 1);
      if (area >= 13) put(starterFor('rug'), 1);
      if (area >= 10) put(starterFor('decor'), 1);
      return selections;
    }
    put(starterFor('sofa', { strategy: area >= 17 ? 'largest' : 'smallest' }), 1);
    put(starterFor('table', { maxLongSide: 140 }), 1);
    if (area >= 11) put(starterFor('storage', { minLongSide: 100, strategy: 'largest' }) || starterFor('storage', { strategy: 'smallest' }), 1);
    if (area >= 13) put(starterFor('chair', { minLongSide: 65 }), 1);
    if (area >= 8) put(starterFor('lighting'), 1);
    if (area >= 9) put(starterFor('rug'), 1);
    if (area >= 10) put(starterFor('decor'), 1);
    return selections;
  }

  function aiSelectionEntries() {
    const products = App.Catalog.getProductsById();
    const entries = [];
    Object.keys(ui.aiSelections).forEach(function (id) {
      const qty = Number(ui.aiSelections[id]) || 0;
      const product = products[id];
      if (qty > 0 && product) entries.push({ product: product, quantity: qty });
    });
    return entries;
  }

  function aiSelectionMediaHtml(product, quantity, compact) {
    const id = U.escapeHtml(product.id);
    return '<span class="' + (compact ? 'ai-pick-thumb' : 'ai-product-thumb') + '" data-ai-thumb="' + id + '">' +
      '<canvas width="' + (compact ? 168 : 132) + '" height="' + (compact ? 120 : 104) + '" aria-hidden="true"></canvas>' +
      '<span class="ai-thumb-qty" data-ai-thumb-qty="' + id + '">' + (quantity ? quantity : '') + '</span>' +
    '</span>';
  }

  function decorateAIMedia(scope) {
    if (!scope) return;
    scope.querySelectorAll('[data-ai-thumb]').forEach(function (holder) {
      const product = findProduct(holder.getAttribute('data-ai-thumb'));
      if (!product) return;
      const canvas = holder.querySelector('canvas');
      if (canvas) App.Media.drawThumb(canvas, product);
      const imageRef = product.assets && (product.assets.display || product.assets.main);
      if (!imageRef || !imageRef.key) return;
      App.Media.getAssetObjectURL(imageRef.key).then(function (url) {
        if (!url || !holder.isConnected) return;
        if (holder.querySelector('img.ai-thumb-photo')) return;
        const img = document.createElement('img');
        img.className = 'ai-thumb-photo';
        img.alt = '';
        img.src = url;
        img.onerror = function () { img.remove(); };
        holder.appendChild(img);
      }).catch(function () {});
    });
  }

  function aiPickedHtml() {
    const entries = aiSelectionEntries();
    if (!entries.length) {
      return '<p class="ai-picked-empty">Nothing selected yet. Load the suggested mix or add products from the catalog below — each one shows its real preview and dimensions.</p>';
    }
    return entries.map(function (entry) {
      return '<div class="ai-pick-card" title="' + U.escapeHtml(entry.product.name) + '">' +
        aiSelectionMediaHtml(entry.product, entry.quantity, true) +
        '<button type="button" class="ai-pick-remove" data-ai-remove="' + U.escapeHtml(entry.product.id) + '" aria-label="Remove ' + U.escapeHtml(entry.product.name) + '">×</button>' +
        '<span class="ai-pick-copy"><strong>' + U.escapeHtml(entry.product.name) + '</strong>' +
        '<small>' + entry.quantity + ' × ' + U.formatMoney(entry.product.price) + '</small></span>' +
      '</div>';
    }).join('');
  }

  function renderAIPickedStrip() {
    const holder = document.getElementById('aiPickedStrip');
    if (!holder) return;
    holder.innerHTML = aiPickedHtml();
    decorateAIMedia(holder);
    const count = document.getElementById('aiSelectedCount');
    if (count) count.textContent = totalAISelected() + ' / ' + C.LIMITS.MAX_AI_SELECTION;
    updateAIGenerateState();
  }

  function aiStarterInfo(design) {
    const roomUse = C.ROOM_USES[design.roomUse] ? design.roomUse : 'living';
    const selections = starterSelectionsFor(roomUse, design.room);
    const products = App.Catalog.getProductsById();
    let units = 0;
    let cost = 0;
    let priced = true;
    let productCount = 0;
    Object.keys(selections).forEach(function (id) {
      const qty = selections[id];
      const product = products[id];
      if (!product || !qty) return;
      productCount++;
      units += qty;
      if (Number.isFinite(product.price)) cost += product.price * qty;
      else priced = false;
    });
    return { roomUse: roomUse, selections: selections, productCount: productCount, units: units, cost: cost, priced: priced, label: C.ROOM_USES[roomUse].label };
  }

  function aiTemplateIcon(key) {
    const icons = {
      balanced: '<svg viewBox="0 0 28 24" aria-hidden="true"><rect x="3" y="4" width="9" height="7" rx="1.4"/><rect x="16" y="4" width="9" height="7" rx="1.4"/><rect x="6" y="14" width="16" height="6" rx="1.4"/></svg>',
      wall: '<svg viewBox="0 0 28 24" aria-hidden="true"><rect x="3" y="3" width="22" height="4" rx="1.2"/><rect x="3" y="9" width="4" height="12" rx="1.2"/><rect x="17" y="15" width="8" height="6" rx="1.2"/></svg>',
      center: '<svg viewBox="0 0 28 24" aria-hidden="true"><rect x="8" y="7" width="15" height="10" rx="1.7"/><circle cx="4.5" cy="5" r="1.6"/><circle cx="23.5" cy="19" r="1.6"/></svg>',
      space: '<svg viewBox="0 0 28 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="14" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="14" width="7" height="7" rx="1.2"/><rect x="14" y="14" width="7" height="7" rx="1.2"/></svg>'
    };
    return icons[key] || icons.balanced;
  }

  function aiGenerateLabel() {
    const template = C.TEMPLATES[ui.aiTemplate] || C.TEMPLATES.balanced;
    return totalAISelected() ? 'Generate ' + template.label + ' layout' : 'Choose products to generate';
  }

  function updateAIGenerateState() {
    if (!els.inspectorBody) return;
    const button = els.inspectorBody.querySelector('[data-ai-generate]');
    if (!button) return;
    button.disabled = totalAISelected() === 0;
    button.textContent = aiGenerateLabel();
  }

  function updateAITemplateUI() {
    if (!els.inspectorBody) return;
    els.inspectorBody.querySelectorAll('.ai-template-card').forEach(function (card) {
      const input = card.querySelector('[data-ai-template]');
      card.classList.toggle('is-selected', !!input && input.value === ui.aiTemplate);
    });
    const hint = document.getElementById('aiTemplateHint');
    const template = C.TEMPLATES[ui.aiTemplate] || C.TEMPLATES.balanced;
    if (hint) hint.textContent = template.description;
    updateAIGenerateState();
  }

  function renderAIPanel() {
    const design = getDesign();
    if (!design) {
      els.inspectorBody.innerHTML = '<div class="inspector-empty"><div class="empty-icon">✦</div><h3>AI-assisted layout</h3><p>Create a room and choose the products and quantities you need. Every product is shown with its image, and the local placement engine then generates an editable starting layout.</p><button type="button" class="btn btn-primary" data-item-action="create-room">Create a room</button></div>';
      return;
    }
    const products = App.Catalog.getProducts();
    Object.keys(ui.aiSelections).forEach(function (id) { if (!findProduct(id)) delete ui.aiSelections[id]; });
    const groups = {};
    products.forEach(function (product) {
      if (!groups[product.category]) groups[product.category] = [];
      groups[product.category].push(product);
    });
    const categories = App.Catalog.getCategories();
    const firstCategory = categories.find(function (category) { return groups[category.id] && groups[category.id].length; });
    const hasSelection = aiSelectionEntries().length > 0;
    const openCategory = hasSelection
      ? categories.find(function (category) {
        return (groups[category.id] || []).some(function (product) { return (ui.aiSelections[product.id] || 0) > 0; });
      })
      : firstCategory;
    const categorySections = categories.map(function (category) {
      const list = groups[category.id];
      if (!list || !list.length) return '';
      const selectedInCategory = list.filter(function (product) { return (ui.aiSelections[product.id] || 0) > 0; }).length;
      const open = openCategory && openCategory.id === category.id;
      const rows = list.slice().sort(function (a, b) { return a.price - b.price; }).map(function (product) {
        const qty = ui.aiSelections[product.id] || 0;
        const max = C.LIMITS.CATEGORY_LIMITS[product.category] || 1;
        return '<div class="ai-product-row' + (qty ? ' has-qty' : '') + '">' +
          aiSelectionMediaHtml(product, qty, false) +
          '<div class="ai-product-name"><strong>' + U.escapeHtml(product.name) + '</strong><small>' + U.formatDims(product) + ' · ' + U.formatMoney(product.price) + '</small></div>' +
          '<div class="qty-stepper">' +
            '<button type="button" class="qty-btn" data-ai-step="' + U.escapeHtml(product.id) + '" data-direction="-1" aria-label="Decrease quantity of ' + U.escapeHtml(product.name) + '">−</button>' +
            '<input type="number" min="0" max="' + max + '" step="1" value="' + qty + '" data-ai-qty="' + U.escapeHtml(product.id) + '" aria-label="Quantity for ' + U.escapeHtml(product.name) + '">' +
            '<button type="button" class="qty-btn" data-ai-step="' + U.escapeHtml(product.id) + '" data-direction="1" aria-label="Increase quantity of ' + U.escapeHtml(product.name) + '">+</button>' +
          '</div>' +
        '</div>';
      }).join('');
      return '<details class="ai-cat"' + (open ? ' open' : '') + '>' +
        '<summary class="ai-cat-head">' +
          '<span class="ai-cat-dot" style="background:' + U.escapeHtml(App.Catalog.getCategoryColor(category.id)) + '"></span>' +
          '<span class="ai-cat-label">' + U.escapeHtml(category.label) + '</span>' +
          '<small>' + (selectedInCategory ? selectedInCategory + ' selected · ' : '') + list.length + '</small>' +
          '<span class="ai-cat-chevron" aria-hidden="true">›</span>' +
        '</summary>' +
        '<div class="ai-cat-body">' + rows + '</div>' +
      '</details>';
    }).join('');
    const templates = Object.keys(C.TEMPLATES).map(function (key) {
      return '<label class="ai-template-card' + (ui.aiTemplate === key ? ' is-selected' : '') + '">' +
        '<input type="radio" name="aiTemplate" value="' + key + '" data-ai-template ' + (ui.aiTemplate === key ? 'checked' : '') + '>' +
        '<span class="ai-template-icon">' + aiTemplateIcon(key) + '</span>' +
        '<span class="ai-template-body"><strong>' + U.escapeHtml(C.TEMPLATES[key].label) + '</strong></span>' +
      '</label>';
    }).join('');
    const starter = aiStarterInfo(design);
    const starterProducts = Object.keys(starter.selections).map(function (id) { return { product: findProduct(id), quantity: starter.selections[id] }; })
      .filter(function (entry) { return !!entry.product; });
    const starterThumbs = starterProducts.slice(0, 6).map(function (entry) {
      return aiSelectionMediaHtml(entry.product, entry.quantity, false);
    }).join('');
    const total = totalAISelected();
    const canUndo = ui.aiSnapshot && ui.aiSnapshotDesignId === design.id;
    const template = C.TEMPLATES[ui.aiTemplate] || C.TEMPLATES.balanced;
    els.inspectorBody.innerHTML = '' +
      '<div class="ai-intro">' +
        '<span class="eyebrow">Design assistant</span><h3>Products, styling and layouts</h3>' +
        '<p>Describe a product or a change and review the draft before it saves. Below, pick products, choose a style and generate a full layout from real catalog dimensions.</p>' +
      '</div>' +
      '<div class="ai-chat">' +
        '<div class="ai-chat-head"><strong>Design assistant</strong><small>Product drafts, styling and layout — always against the real design</small></div>' +
        '<div class="ai-chat-log" id="aiChatLog">' + chatLogHtml() + '</div>' +
        '<form class="ai-chat-form" id="aiChatForm">' +
          '<input type="text" id="aiChatInput" placeholder="Try: create a 140 × 70 × 75 cm oak desk for €450" autocomplete="off" maxlength="240" aria-label="Message the design assistant">' +
          '<button type="submit" class="btn btn-primary btn-small">Send</button>' +
        '</form>' +
        '<div class="ai-chat-chips">' +
          '<button type="button" class="ai-chip" data-ai-say="make it more spacious">More spacious</button>' +
          '<button type="button" class="ai-chip" data-ai-say="make the floor wooden">Wooden floor</button>' +
          '<button type="button" class="ai-chip" data-ai-say="make it brighter">Brighter</button>' +
          '<button type="button" class="ai-chip" data-ai-say="move the sofa against the wall">Sofa to wall</button>' +
        '</div>' +
      '</div>' +
      aiModelConfigHtml() +
      '<div class="ai-quick-card">' +
        '<div class="ai-quick-head"><div><span class="eyebrow">Suggested for this ' + U.escapeHtml(starter.label.toLowerCase()) + '</span>' +
          '<strong>' + starter.productCount + ' product' + (starter.productCount === 1 ? '' : 's') + ' · ' + starter.units + ' item' + (starter.units === 1 ? '' : 's') + '</strong>' +
          '<small>' + (starter.productCount ? (starter.priced ? '≈ ' + U.formatMoney(starter.cost) + ' from the catalog' : 'Some prices unavailable') : 'No matching products in the catalog yet') + '</small></div>' +
          '<button type="button" class="btn btn-primary btn-small" data-ai-starter ' + (starter.productCount ? '' : 'disabled') + '>Load mix</button>' +
        '</div>' +
        (starterThumbs ? '<div class="ai-quick-thumbs">' + starterThumbs + '</div>' : '') +
        '<div class="ai-quick-links"><button type="button" class="btn btn-tiny btn-ghost" data-ai-use-current>Use current furniture</button><button type="button" class="btn btn-tiny btn-ghost" data-ai-clear>Clear selection</button></div>' +
      '</div>' +
      '<div class="section-label">1 · Your products <span id="aiSelectedCount">' + total + ' / ' + C.LIMITS.MAX_AI_SELECTION + '</span></div>' +
      '<div class="ai-picked" id="aiPickedStrip">' + aiPickedHtml() + '</div>' +
      '<div class="section-label">2 · Browse the catalog <span>' + products.length + ' products</span></div>' +
      '<div class="ai-browser">' + (categorySections || '<p class="muted-note">No catalog products.</p>') + '</div>' +
      '<div class="section-label">3 · Layout style</div>' +
      '<div class="ai-template-grid">' + templates + '</div>' +
      '<p class="ai-template-hint" id="aiTemplateHint">' + U.escapeHtml(template.description) + '</p>' +
      '<details class="ai-explainer"><summary>How this AI decides placement</summary><p>This is a deterministic local rules engine, not a cloud model. It scores real footprints against wall space, walkways, door swings and windows, and anchors related pieces such as a chair at a desk, a coffee table at a sofa and a rug under a table. Products that cannot fit are reported with a reason and are never invented or silently dropped.</p></details>' +
      '<div class="ai-generate-bar">' +
        '<div class="ai-summary" id="aiSummaryLine">' + aiSummaryText() + '</div>' +
        '<button type="button" class="btn btn-primary btn-block" data-ai-generate ' + (total ? '' : 'disabled') + '>' + U.escapeHtml(aiGenerateLabel()) + '</button>' +
        '<p class="ai-generate-note">Replaces the current furniture after confirmation. The room, doors, windows and catalog stay unchanged.</p>' +
        '<div id="aiReport">' + (ui.aiReport ? renderAIReport(ui.aiReport) : '') + '</div>' +
        (canUndo ? '<button type="button" class="btn btn-secondary btn-block btn-small" data-ai-undo>Restore pre-AI layout</button>' : '') +
      '</div>';
    decorateAIMedia(els.inspectorBody);
    renderChatLog();
  }

  function chatLogHtml() {
    if (!ui.chatLog.length) {
      return '<div class="ai-chat-empty">Ask for styling or layout changes in plain language, or describe a new catalog product ("create a 120 × 60 × 75 cm oak desk for €450"). Product drafts are shown for review and are only saved when you confirm. Everything else changes the real design immediately.</div>';
    }
    return ui.chatLog.map(function (entry) {
      let html = '<div class="ai-msg ai-msg-' + entry.role + '"><div class="ai-msg-text">' + U.escapeHtml(entry.text) + '</div>';
      if (entry.actions && entry.actions.length) {
        html += '<div class="ai-msg-actions">' + entry.actions.map(function (action) {
          return '<button type="button" class="ai-chip" data-ai-action="' + U.escapeHtml(action.id) + '">' + U.escapeHtml(action.label) + '</button>';
        }).join('') + '</div>';
      }
      html += '</div>';
      return html;
    }).join('');
  }

  function aiModelConfigHtml() {
    const cfg = App.AIAssistant && App.AIAssistant.getModelConfig ? App.AIAssistant.getModelConfig() : { url: '', model: '' };
    const connected = !!cfg.url;
    return '<details class="ai-model-config"' + (connected ? ' open' : '') + '>' +
      '<summary><span class="ai-model-dot' + (connected ? ' is-on' : '') + '"></span>Model connection' +
        '<small>' + (connected ? 'Connected' + (cfg.model ? ' · ' + U.escapeHtml(cfg.model) : '') : 'Optional · local rules active') + '</small></summary>' +
      '<p class="ai-model-note">Point this at your own server endpoint that adds the API key server-side. The browser never stores or sends a key. When the endpoint is unreachable or unset, the local assistant answers and says so.</p>' +
      '<input class="text-input ai-model-input" id="aiModelUrl" type="url" spellcheck="false" placeholder="https://your-server.example/api/assistant" value="' + U.escapeHtml(cfg.url) + '" aria-label="Model endpoint URL">' +
      '<input class="text-input ai-model-input" id="aiModelName" type="text" spellcheck="false" placeholder="Model name (optional)" value="' + U.escapeHtml(cfg.model) + '" aria-label="Model name">' +
      '<div class="ai-model-actions">' +
        '<button type="button" class="btn btn-secondary btn-small" data-ai-model-save>Save endpoint</button>' +
        (connected ? '<button type="button" class="btn btn-ghost btn-small" data-ai-model-clear>Disconnect</button>' : '') +
      '</div>' +
      '<div class="ai-model-status" id="aiModelStatus" aria-live="polite"></div>' +
    '</details>';
  }

  function renderChatLog() {
    const log = document.getElementById('aiChatLog');
    if (!log) return;
    log.innerHTML = chatLogHtml();
    log.scrollTop = log.scrollHeight;
  }

  function appendChat(role, text, actions) {
    ui.chatLog.push({ role: role, text: text, actions: actions || null });
    if (ui.chatLog.length > 60) ui.chatLog.splice(0, ui.chatLog.length - 60);
    renderChatLog();
  }

  function buildAIContext() {
    return {
      design: getDesign(),
      products: App.Catalog.getProducts(),
      productsById: App.Catalog.getProductsById(),
      state: App.State,
      notify: function (message, kind) { U.showToast(message, kind || 'info'); }
    };
  }

  function removeChatEntry(entry) {
    const index = ui.chatLog.indexOf(entry);
    if (index >= 0) ui.chatLog.splice(index, 1);
    renderChatLog();
  }

  async function submitChat(text) {
    const design = getDesign();
    if (!design) return;
    const input = document.getElementById('aiChatInput');
    const value = String(text != null ? text : (input ? input.value : '')).trim();
    if (!value) return;
    if (input) input.value = '';
    appendChat('user', value);
    let result;
    try {
      result = App.AIAssistant.interpret(value, buildAIContext());
    } catch (err) {
      console.error(err);
      appendChat('assistant', 'Something went wrong while reading that request. The design was not changed.');
      return;
    }
    if (result.confirmDraft) {
      await executeChatAction('ai-product-confirm');
      return;
    }
    if (result.unmatched && App.AIAssistant.hasModel && App.AIAssistant.hasModel()) {
      const busy = { role: 'assistant', text: 'Checking the connected model…', actions: null };
      ui.chatLog.push(busy);
      renderChatLog();
      try {
        const modelResult = await App.AIAssistant.modelInterpret(value, buildAIContext());
        removeChatEntry(busy);
        if (modelResult && modelResult.reply) appendChat('assistant', modelResult.reply, modelResult.actions || null);
        else appendChat('assistant', 'The connected model returned an empty answer. The design was not changed.');
      } catch (err) {
        removeChatEntry(busy);
        appendChat('assistant', 'The connected model did not answer (' + (err && err.message ? err.message : 'unknown error') + '). I answered with the local assistant instead.');
        appendChat('assistant', result.reply, result.actions);
      }
      return;
    }
    appendChat('assistant', result.reply, result.actions);
  }

  async function executeChatAction(actionId) {
    const design = getDesign();
    if (!design || !App.AIAssistant) return;
    let outcome;
    try {
      outcome = await App.AIAssistant.execute(actionId, buildAIContext());
    } catch (err) {
      console.error(err);
      appendChat('assistant', 'That action failed unexpectedly. The design was not changed.');
      return;
    }
    if (outcome && outcome.message) appendChat('assistant', outcome.message, outcome.actions || null);
  }

  function totalAISelected() {
    let total = 0;
    Object.keys(ui.aiSelections).forEach(function (id) { total += Number(ui.aiSelections[id]) || 0; });
    return total;
  }

  function aiSummaryText() {
    const products = App.Catalog.getProductsById();
    let total = 0;
    let cost = 0;
    let invalid = false;
    Object.keys(ui.aiSelections).forEach(function (id) {
      const qty = Number(ui.aiSelections[id]) || 0;
      if (!qty) return;
      total += qty;
      const product = products[id];
      if (product && Number.isFinite(product.price)) cost += product.price * qty;
      else invalid = true;
    });
    if (!total) return '<span class="muted-note">Choose quantities above. Up to ' + C.LIMITS.MAX_AI_SELECTION + ' items can be generated at once.</span>';
    return '<span><strong>' + total + '</strong> item' + (total === 1 ? '' : 's') + ' selected</span><span>' + (invalid ? 'Some prices unavailable' : 'Estimated ' + U.formatMoney(cost)) + '</span>';
  }

  function syncAIQuantity(input, isInput) {
    const id = input.getAttribute('data-ai-qty');
    const product = findProduct(id);
    if (!product) return;
    let qty = Math.floor(Number(input.value));
    if (!Number.isFinite(qty) || qty < 0) qty = 0;
    const max = C.LIMITS.CATEGORY_LIMITS[product.category] || C.LIMITS.MAX_AI_SELECTION;
    if (qty > max) {
      qty = max;
      if (isInput) input.value = qty;
      U.showToast(App.Catalog.getCategoryLabel(product.category) + ' are limited to ' + max + ' items.', 'warning');
    }
    ui.aiSelections[id] = qty;
    const row = input.closest('.ai-product-row');
    if (row) row.classList.toggle('has-qty', qty > 0);
    const badge = row && row.querySelector('[data-ai-thumb-qty]');
    if (badge) badge.textContent = qty ? qty : '';
    const count = document.getElementById('aiSelectedCount');
    if (count) count.textContent = totalAISelected() + ' / ' + C.LIMITS.MAX_AI_SELECTION;
    const summary = document.getElementById('aiSummaryLine');
    if (summary) summary.innerHTML = aiSummaryText();
    renderAIPickedStrip();
  }

  function stepAIQuantity(id, direction) {
    if (!editingStillActive()) return;
    const input = els.inspectorBody.querySelector('[data-ai-qty="' + id + '"]');
    if (!input) return;
    const value = (Number(input.value) || 0) + direction;
    input.value = Math.max(0, value);
    syncAIQuantity(input, true);
  }

  function editingStillActive() { return !!getDesign(); }

  async function generateAILayout() {
    const design = getDesign();
    if (!design) { promptCreateRoom('Create a room before generating a layout.'); return; }
    const selections = App.AI.normalizeSelections(ui.aiSelections).filter(function (entry) { return entry.quantity > 0; });
    if (!selections.length) {
      U.showToast('Choose at least one product and quantity first.', 'warning');
      return;
    }
    const template = C.TEMPLATES[ui.aiTemplate] ? ui.aiTemplate : 'balanced';
    const preview = App.AI.validateSelections(design, selections, App.Catalog.getProductsById(), template);
    if (preview.errors.length) {
      ui.aiReport = { ok: false, errors: preview.errors, warnings: [], unplaced: [], stats: null, template: template };
      renderAIPanel();
      U.showToast(preview.errors[0], 'error');
      return;
    }
    if (design.placedItems.length) {
      const confirmed = await App.UI.confirm('Replace furniture with a generated layout?',
        'The ' + C.TEMPLATES[template].label + ' template will replace the current ' + design.placedItems.length +
        ' furniture item' + (design.placedItems.length === 1 ? '' : 's') + '. Room dimensions, doors and windows stay unchanged. You can restore the previous furniture once immediately afterwards.',
        { confirmLabel: 'Generate layout' });
      if (!confirmed) return;
    }
    const result = App.AI.generateLayout({ design: design, productsById: App.Catalog.getProductsById(), selections: selections, template: template });
    ui.aiReport = result;
    if (!result.ok) {
      renderAIPanel();
      U.showToast(result.errors[0] || 'The layout could not be generated.', 'error');
      return;
    }
    if (!result.items.length) {
      renderAIPanel();
      U.showToast('No items could be placed with the current selections. Your existing furniture was left unchanged.', 'warning', { duration: 7000 });
      return;
    }
    const snapshot = App.State.capturePlacedItems();
    const replacement = App.State.replacePlacedItems(result.items, { addedVia: 'ai', reason: 'ai-layout' });
    if (!replacement.ok) {
      renderAIPanel();
      U.showToast(replacement.error, 'error');
      return;
    }
    ui.aiSnapshot = snapshot;
    ui.aiSnapshotDesignId = design.id;
    ui.selection = null;
    setWorkflowStep('furnish', { keepTab: true });
    App.Designer2D.requestDraw();
    if (ui.viewerReady) App.Viewer3D.sync(getDesign(), null);
    renderAIPanel();
    setView('plan');
    const unplacedCount = result.unplaced.reduce(function (sum, entry) { return sum + entry.quantity; }, 0);
    U.showToast('Generated ' + result.stats.placed + ' item' + (result.stats.placed === 1 ? '' : 's') + (unplacedCount ? '; ' + unplacedCount + ' could not be placed (see report).' : '.') + ' The layout is editable.',
      unplacedCount ? 'warning' : 'success', {
        duration: 6500,
        actionLabel: 'Undo',
        onAction: undoAILayout
      });
  }

  function renderAIReport(report) {
    if (!report) return '<div class="ai-report-empty">The last generation result will appear here, including any products that could not be placed.</div>';
    const parts = [];
    if (!report.ok) {
      parts.push('<div class="notice notice-error">' + (report.errors || []).map(U.escapeHtml).join('<br>') + '</div>');
      return parts.join('');
    }
    const placedUnits = report.stats.placed || 0;
    const metrics = [];
    if (report.stats.anchored) metrics.push(report.stats.anchored + ' anchored fit' + (report.stats.anchored === 1 ? '' : 's'));
    if (Number.isFinite(report.stats.coverage)) metrics.push('≈' + report.stats.coverage + '% floor covered');
    parts.push('<div class="ai-report-card">' +
      '<div class="ai-report-head"><strong>Last result · ' + U.escapeHtml(C.TEMPLATES[report.template] ? C.TEMPLATES[report.template].label : report.template) + '</strong>' +
      '<span>' + placedUnits + ' placed' + (report.stats.failed ? ' · ' + report.stats.failed + ' unplaced' : '') + '</span></div>' +
      (metrics.length ? '<p class="ai-report-metrics">' + metrics.join(' · ') + '</p>' : '') +
      (report.unplaced && report.unplaced.length
        ? '<ul class="ai-unplaced-list">' + report.unplaced.map(function (entry) {
          return '<li><strong>' + U.escapeHtml(entry.name) + ' ×' + entry.quantity + '</strong><span>' + U.escapeHtml(entry.reason) + '</span></li>';
        }).join('') + '</ul>'
        : '<p class="ai-report-ok">All selected products were placed with clear floor space and door clearance.</p>') +
      '</div>');
    return parts.join('');
  }

  async function undoAILayout() {
    const design = getDesign();
    if (!design || !ui.aiSnapshot || ui.aiSnapshotDesignId !== design.id) {
      U.showToast('The previous layout is no longer available to restore.', 'warning');
      return;
    }
    const confirmed = await App.UI.confirm('Restore the pre-AI layout?', 'The generated furniture arrangement will be replaced with the layout that existed before the last AI generation. Changes made since then will be lost.', { confirmLabel: 'Restore layout', danger: true });
    if (!confirmed) return;
    const result = App.State.replacePlacedItems(ui.aiSnapshot, { addedVia: 'manual', reason: 'ai-undo' });
    if (!result.ok) { U.showToast(result.error, 'error'); return; }
    ui.selection = null;
    ui.aiSnapshot = null;
    ui.aiSnapshotDesignId = null;
    ui.aiReport = null;
    App.Designer2D.requestDraw();
    if (ui.viewerReady) App.Viewer3D.sync(getDesign(), null);
    refreshInspector(true);
    U.showToast('Pre-AI furniture layout restored.', 'success');
  }

  function handleCatalogChange(force) {
    renderCatalog();
    if (force !== false) updateHeader();
    updateIssuesBadge();
    refreshInspector(true, 'catalog-refresh');
    if (getDesign() && ui.viewerReady) {
      const design = getDesign();
      App.Viewer3D.sync(design, App.getSelection());
    }
    updateEmptyState();
  }

  function handleCatalogManagerClose() {
    handleCatalogChange();
  }

  function openProductDetails(productId) {
    const product = findProduct(productId);
    if (!product) { U.showToast('That product is no longer available.', 'error'); return; }
    const imageRef = product.assets.display || product.assets.main;
    const glb = product.assets.glb;
    const variants = product.variants && product.variants.length
      ? '<label class="field"><span>Variant</span><select id="detailVariant">' + product.variants.map(function (variant) {
        return '<option value="' + U.escapeHtml(variant.id) + '">' + U.escapeHtml(variant.name) + '</option>';
      }).join('') + '</select></label>'
      : '<p class="field-note">No variant options are defined for this product.</p>';
    const body = '' +
      '<div class="product-detail-layout">' +
        '<div class="product-detail-gallery">' +
          '<div class="product-detail-image" id="detailImageWrap"><canvas id="detailImageCanvas" width="460" height="330"></canvas><span class="image-source-label" id="detailImageSource">Built-in catalog illustration</span></div>' +
          '<div class="detail-3d-block"><div class="detail-3d-head"><strong>3D model preview</strong><span class="badge badge-model">' + (glb ? 'Attached GLB' : (App.Catalog.usesFallback(product) ? 'Named placeholder' : 'Built-in model')) + '</span></div><div id="detail3d" class="detail-3d-viewport"></div><div class="detail-3d-note" id="detail3dNote">' + (glb ? 'Loading the stored GLB…' : 'Preparing the model preview…') + '</div></div>' +
        '</div>' +
        '<div class="product-detail-info">' +
          '<span class="eyebrow">' + U.escapeHtml(App.Catalog.getCategoryLabel(product.category)) + (product.demo ? ' · demo catalog' : ' · local catalog') + '</span>' +
          '<h3>' + U.escapeHtml(product.name) + '</h3>' +
          '<div class="detail-price">' + U.formatMoney(product.price) + '</div>' +
          '<p class="detail-description">' + U.escapeHtml(product.description || 'No description supplied for this product.') + '</p>' +
          '<div class="detail-specs">' +
            '<div><span>Width</span><strong>' + U.formatNumber(product.widthCm, 0) + ' cm</strong></div>' +
            '<div><span>Length / depth</span><strong>' + U.formatNumber(product.lengthCm, 0) + ' cm</strong></div>' +
            '<div><span>Height</span><strong>' + U.formatNumber(product.heightCm, 0) + ' cm</strong></div>' +
            '<div><span>Product ID</span><strong>' + U.escapeHtml(product.id) + '</strong></div>' +
            '<div><span>Availability</span><strong>' + U.escapeHtml(product.availability || 'Not supplied') + '</strong></div>' +
            '<div><span>Brand</span><strong>' + U.escapeHtml(product.brand || C.COMPANY_NAME) + '</strong></div>' +
          '</div>' +
          '<div class="detail-materials"><span>Materials</span><p>' + U.escapeHtml(product.materials || 'Not supplied for this product.') + '</p></div>' +
          variants +
          (App.Catalog.structuralKind(product)
            ? '<p class="field-note">Adds a real opening to the first free wall. You can then move it along the wall and resize it in the panel.</p>'
            : '<p class="field-note">Adds the product at its real catalog footprint. You can then drag, rotate and re-variant it.</p>') +
          (App.Catalog.usesFallback(product) ? '<div class="notice">No 3D file is attached yet, so this product appears as a named black block in the room. Attach a GLB in Manage catalog and every existing placement updates in place.</div>' : '') +
          (product.demo ? '<div class="notice notice-demo">This is illustrative demo catalog data supplied with the app. It is not a real manufacturer claim or price.</div>' : '') +
        '</div>' +
      '</div>';
    let preview = null;
    App.UI.modal({
      title: product.name,
      eyebrow: 'Product details',
      bodyHtml: body,
      wide: true,
      actions: [
        { label: 'Close', value: 'close', kind: 'secondary' },
        {
          label: 'Add to design',
          kind: 'primary',
          onClick: function () {
            const variantSelect = document.getElementById('detailVariant');
            const variantId = variantSelect ? variantSelect.value : null;
            const added = addProductSmart(productId, variantId);
            if (!added) return false;
          }
        }
      ],
      onMount: function (bodyEl) {
        const canvas = bodyEl.querySelector('#detailImageCanvas');
        if (canvas) App.Media.drawThumb(canvas, product);
        if (imageRef && imageRef.key) {
          App.Media.getAssetObjectURL(imageRef.key).then(function (url) {
            if (!url || !bodyEl.isConnected) return;
            const wrap = bodyEl.querySelector('#detailImageWrap');
            if (!wrap) return;
            const img = document.createElement('img');
            img.src = url;
            img.alt = product.name;
            img.onerror = function () { img.remove(); };
            wrap.appendChild(img);
            const source = bodyEl.querySelector('#detailImageSource');
            if (source) source.textContent = 'Supplier image · ' + (imageRef.name || 'attached asset');
          }).catch(function () {});
        }
        const viewport = bodyEl.querySelector('#detail3d');
        if (viewport && App.Viewer3D && App.Viewer3D.previewProduct) {
          preview = App.Viewer3D.previewProduct(viewport, product, {
            onStatus: function (status) {
              const note = bodyEl.querySelector('#detail3dNote');
              if (!note) return;
              if (status.status === 'glb') {
                note.textContent = 'Stored GLB model, scaled to the catalog dimensions. Drag to rotate.';
                note.classList.add('is-ok');
                if (status.mismatch) {
                  note.textContent += ' ' + status.mismatch;
                  note.classList.add('is-warning');
                }
              } else if (status.status === 'placeholder') {
                note.textContent = 'Named black placeholder at the real catalog size. Attach a GLB file in Manage catalog to replace it everywhere.';
              } else if (status.status === 'procedural') {
                note.textContent = 'Built-in procedural model shown at the real catalog size. Drag to rotate.';
              } else if (status.status === 'procedural-fallback') {
                note.textContent = 'The attached GLB could not be loaded, so the built-in model is shown instead.';
                note.classList.add('is-warning');
              }
            }
          });
        }
      }
    }).then(function () {
      if (preview) preview.dispose();
    });
  }

  function openHelp() {
    App.UI.modal({
      title: 'How FormaRoom works',
      eyebrow: 'Local B2B furniture planner',
      bodyHtml: '' +
        '<div class="help-layout">' +
          '<section><h3>Step-by-step workflow</h3><p>The bar above the workspace walks you through six steps, ticks each one when its work is really done, and shows the next useful action. Steps that need a room stay disabled until one exists.</p><ol class="numbered-list">' +
            '<li><strong>Room.</strong> Create a rectangular, square or circular room with real dimensions and choose <em>AI-assisted</em> or <em>Manual</em> furnishing.</li>' +
            '<li><strong>Furnish.</strong> This is the only step that shows the catalog. Add products from the catalog, or open the AI tab for an image-led starter mix and generate an editable layout.</li>' +
            '<li><strong>Openings.</strong> Use the Door or Window tool and click a wall in the plan, or use the buttons in the Room tab. Openings are cut into the real 3D walls. The <em>Wall</em> tool draws partition walls first: click a start and an end point (endpoints snap to corners and other walls), then add doors or windows to them the same way.</li>' +
            '<li><strong>Style.</strong> Pick a wall colour and a floor finish in the Room tab. Both are stored with the design and reused when the room is placed in the Whole Home view.</li>' +
            '<li><strong>Review.</strong> Check the room checks for out-of-room items, overlaps and door clearance, review the budget, then save the design to My designs.</li>' +
            '<li><strong>Whole home.</strong> Open <em>Whole home</em> in the header, add your saved rooms, arrange them side by side and link matching doors. Linked doors become walk-through doorways — in orbit and in walk mode. Staircases are ordinary catalog products you can place like any other item.</li>' +
          '</ol></section>' +
          '<section><h3>What is real</h3><ul class="plain-list">' +
            '<li>Room shapes and dimensions create actual floor and wall geometry, including circular rooms.</li>' +
            '<li>2D furniture footprints use catalog width and depth, not image pixels.</li>' +
            '<li>Doors and windows are cut into the 3D rectangular walls with real sills and lintels.</li>' +
            '<li>The selected wall colour is painted onto the real 3D wall geometry, echoed in the plan drawing and stored with the design.</li>' +
            '<li>Authentic GLB files attached in the catalog are loaded from local browser storage and fitted uniformly to the catalog dimensions.</li>' +
            '<li>Pricing comes from the shipped catalog and the placed instances only.</li>' +
          '</ul></section>' +
          '<section><h3>Clear limitations</h3><ul class="plain-list">' +
            '<li><strong>Demo catalog:</strong> the 43 included Northline Living products are clearly labeled demo data. Their imagery, prices and dimensions are illustrative. Add or edit products with authentic assets in Manage catalog.</li>' +
            '<li><strong>Missing GLB:</strong> a custom product without an attached model is shown as a black box sized to its real dimensions with the product name in white. The shipped demo products use labelled procedural models. Neither is a fake “real model”; attach a GLB later and every existing placement updates.</li>' +
            '<li><strong>Circular openings:</strong> door and window openings are not supported on curved walls in this version; the 3D room still has true circular geometry.</li>' +
            '<li><strong>Local only:</strong> no accounts, server, payments or cloud storage. Designs live in this browser.</li>' +
            '<li><strong>3D export, VR/AR, photo reconstruction:</strong> out of scope for this version. The 2D PNG and CSV export are real files.</li>' +
            '<li><strong>Whole home catalog load:</strong> the home view builds every placed item, so it stops adding models at ' + C.HOME.MAX_HOME_ITEMS + ' items (GLB first). Rooms beyond that still show walls, footprints and colours.</li>' +
            '<li><strong>Whole home doors:</strong> walk-through needs two doors linked door-to-door; auto-link only pairs doors that are within 260 cm of each other, so use <em>Link doors</em> to pick the pair yourself. Circular rooms cannot host doors, so they cannot be linked.</li>' +
            '<li><strong>One home per browser:</strong> the Whole Home is a single autosaved record. <em>Export home</em> writes the home plus every room design it uses into one JSON file, and <em>Import home</em> restores it — but catalog photos and GLB model files are not inside that file.</li>' +
          '</ul></section>' +
          '<section><h3>Storage and files</h3><p>This app runs directly from <code>index.html</code> without a server. The design autosave and My designs use browser storage. Uploaded catalog images and GLB files are stored locally in IndexedDB. A downloaded JSON backup contains the room, furniture, openings and product references — not the product image/GLB files themselves.</p><p>If browser storage is unavailable, the app warns you and keeps working only for the current tab. Export a backup before closing.</p></section>' +
          '<section><h3>Keyboard and pointer</h3><ul class="shortcut-list">' +
            '<li><kbd>Del</kbd> / <kbd>Backspace</kbd> remove selection</li>' +
            '<li><kbd>Ctrl</kbd> + <kbd>D</kbd> duplicate</li>' +
            '<li><kbd>Arrows</kbd> nudge 5 cm · <kbd>Shift</kbd> + <kbd>Arrows</kbd> nudge 1 cm</li>' +
            '<li><kbd>0</kbd> fit the plan · scroll to zoom · Alt-drag or middle-drag to pan</li>' +
            '<li><kbd>Ctrl</kbd> + <kbd>S</kbd> save to My designs</li>' +
            '<li>3D orbit: drag to orbit · scroll to zoom · right-drag to pan · click furniture to select.</li>' +
            '<li>3D walk: click the room to capture the mouse (or drag to look) · <kbd>WASD</kbd> / arrows walk · <kbd>Shift</kbd> run · <kbd>Esc</kbd> returns to orbit. Walls and furniture have real collision, and the eye-level camera stays level without rolling.</li>' +
            '<li>Whole home: the plan toolbar has <em>Arrange · Link doors · Erase</em>; click two facing doors to link them. In whole-home walk mode a linked door takes you into the next room. <kbd>Ctrl</kbd> + <kbd>S</kbd> saves the home.</li>' +
          '</ul></section>' +
          '<section><h3>AI-assisted design</h3><p>The Assistant tab combines two things. The design assistant works in plain language against the real design: it can prepare catalog product drafts, edit products, place or move furniture, restyle floors and walls, set budgets and undo. Product drafts are always shown for review and are only saved when you confirm them. The layout generator is a deterministic local engine, not a cloud model: it scores real footprints against wall centres, walkways, doors, windows and other furniture, anchors related pieces, lists anything that cannot fit, and the result stays fully editable. An optional server endpoint can add an LLM conversation layer — the browser stores only the endpoint URL and model name, never an API key.</p></section>' +
        '</div>' +
        '<p class="help-footer">FormaRoom v' + C.APP_VERSION + ' · Catalog company: ' + U.escapeHtml(C.COMPANY_NAME) + ' · Runs locally in your browser.</p>',
      wide: 'xl',
      actions: [{ label: 'Got it', value: 'close', kind: 'primary' }]
    });
  }

  function openExportModal() {
    const design = getDesign();
    if (!design) { promptCreateRoom('Create a room before exporting.'); return; }
    App.UI.modal({
      title: 'Save and export',
      eyebrow: 'Local files',
      bodyHtml: '' +
        '<div class="export-grid">' +
          '<div class="export-card"><div class="export-icon">PNG</div><h3>Floor plan image</h3><p>A high-resolution top-down plan with room dimensions, furniture footprints, openings, labels, item count and current estimate.</p><button type="button" class="btn btn-primary" data-export-plan>Download floor plan (PNG)</button></div>' +
          '<div class="export-card"><div class="export-icon">CSV</div><h3>Product list</h3><p>A spreadsheet-ready quantity and price list with product IDs, dimensions, variants and totals. Prices come from the catalog.</p><button type="button" class="btn btn-secondary" data-export-csv ' + (design.placedItems.length ? '' : 'disabled') + '>Download product list (CSV)</button>' + (design.placedItems.length ? '' : '<p class="field-note">Add at least one product to export a product list.</p>') + '</div>' +
          '<div class="export-card"><div class="export-icon">JSON</div><h3>Design backup</h3><p>The complete design data for import later: room, dimensions, furniture instances, openings and budget. Product references rely on the local catalog; image and GLB files are not embedded.</p><button type="button" class="btn btn-secondary" data-export-backup>Download backup (JSON)</button></div>' +
        '</div>' +
        '<div class="notice notice-info">Downloads are generated in your browser from this design. The PNG and CSV are real files; no server upload occurs.</div>',
      wide: true,
      actions: [{ label: 'Close', kind: 'secondary' }],
      onMount: function (bodyEl) {
        bodyEl.querySelector('[data-export-plan]').addEventListener('click', async function (event) {
          downloadFromButton(event.currentTarget, async function () {
            await App.Export.downloadPlan(getDesign());
            U.showToast('Floor plan PNG downloaded.', 'success');
          });
        });
        bodyEl.querySelector('[data-export-csv]').addEventListener('click', async function (event) {
          downloadFromButton(event.currentTarget, async function () {
            await App.Export.downloadProducts(getDesign());
            U.showToast('Product list CSV downloaded.', 'success');
          });
        });
        bodyEl.querySelector('[data-export-backup]').addEventListener('click', async function (event) {
          downloadFromButton(event.currentTarget, async function () {
            await App.Export.downloadBackup(getDesign());
            U.showToast('Design backup JSON downloaded.', 'success');
          });
        });
      }
    });
  }

  async function downloadFromButton(button, task) {
    if (button.disabled || button.classList.contains('is-busy')) return;
    button.disabled = true;
    button.classList.add('is-busy');
    try {
      await task();
    } catch (err) {
      console.error(err);
      U.showToast(err.message || 'The export could not be created.', 'error');
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.classList.remove('is-busy');
      }
    }
  }

  async function openSavedDesigns() {
    let api = null;
    let listBody = null;
    const modal = App.UI.modal({
      title: 'My designs',
      eyebrow: 'Saved locally in this browser',
      bodyHtml: '<div class="saved-designs-body"><div class="saved-toolbar"><p>Saved designs store the room, furniture, openings and budget. The autosave in the workspace is separate.</p><label class="btn btn-small btn-secondary pm-file-btn">Import backup<input type="file" id="importDesignInput" accept=".json,application/json"></label></div><div id="savedDesignList"><div class="saved-loading">Loading saved designs…</div></div></div>',
      wide: true,
      actions: [{ label: 'Close', kind: 'secondary' }],
      onMount: function (body, modalApi) {
        api = modalApi;
        listBody = body.querySelector('#savedDesignList');
        body.querySelector('#importDesignInput').addEventListener('change', function (event) {
          const file = event.target.files && event.target.files[0];
          if (file) importDesignFile(file, api);
        });
        renderSavedList(listBody, api);
      }
    });
    return modal;
  }

  async function renderSavedList(container, api) {
    if (!container) return;
    let designs = [];
    try {
      designs = await App.Storage.listDesigns();
    } catch (err) {
      container.innerHTML = '<div class="notice notice-error">Saved designs could not be read: ' + U.escapeHtml(err.message || 'unknown error') + '</div>';
      return;
    }
    if (!container.isConnected) return;
    if (!designs.length) {
      container.innerHTML = '<div class="saved-empty"><div class="empty-icon">▤</div><h3>No saved designs yet</h3><p>Use <strong>Save design</strong> in the header to add the current workspace to My designs. Autosave already protects your latest workspace.</p></div>';
      return;
    }
    container.innerHTML = designs.map(function (envelope) {
      const design = envelope.design;
      const room = design.room || {};
      const itemCount = Array.isArray(design.placedItems) ? design.placedItems.length : 0;
      const summary = P.summarize(design, App.Catalog.getProductsById());
      const current = getDesign() && getDesign().id === design.id;
      return '<div class="saved-card" data-saved-id="' + U.escapeHtml(design.id) + '">' +
        '<div class="saved-card-main"><div class="saved-card-title"><h3>' + U.escapeHtml(design.name || 'Untitled room') + '</h3>' + (current ? '<span class="badge badge-current">In workspace</span>' : '') + '</div>' +
          '<p>' + U.escapeHtml(G.roomShapeLabel(room)) + ' · ' + U.escapeHtml(U.formatRoomDims(room)) + ' · ' + itemCount + ' item' + (itemCount === 1 ? '' : 's') + (summary.incomplete ? ' · pricing incomplete' : '') + '</p>' +
          '<small>Saved ' + U.escapeHtml(U.formatDateTime(envelope.savedAt)) + ' · ' + U.escapeHtml(U.formatMoney(summary.total)) + '</small></div>' +
        '<div class="saved-card-actions"><button type="button" class="btn btn-small btn-primary" data-load-design="' + U.escapeHtml(design.id) + '">Open</button><button type="button" class="btn btn-small btn-ghost btn-danger-text" data-delete-design="' + U.escapeHtml(design.id) + '">Delete</button></div>' +
      '</div>';
    }).join('');
    container.querySelectorAll('[data-load-design]').forEach(function (button) {
      button.addEventListener('click', async function () {
        const id = button.getAttribute('data-load-design');
        const envelope = await App.Storage.getDesign(id);
        if (!envelope) { U.showToast('That saved design could not be found.', 'error'); return; }
        await loadDesignFromEnvelope(envelope, api);
      });
    });
    container.querySelectorAll('[data-delete-design]').forEach(function (button) {
      button.addEventListener('click', async function () {
        const id = button.getAttribute('data-delete-design');
        const confirmed = await App.UI.confirm('Delete saved design?', 'This removes this saved copy from My designs. The autosaved workspace is separate and will not be changed.', { confirmLabel: 'Delete saved copy', danger: true });
        if (!confirmed) return;
        await App.Storage.deleteDesign(id);
        U.showToast('Saved design deleted.', 'info');
        renderSavedList(container, api);
      });
    });
  }

  async function loadDesignFromEnvelope(envelope, modalApi) {
    const normalized = App.State.normalizeLoadedDesign(envelope.design);
    if (!normalized.design) {
      U.showToast('This saved design could not be validated: ' + normalized.warnings.join(' '), 'error', { duration: 9000 });
      return;
    }
    try {
      const preserved = await preserveWorkspaceForReplacement(normalized.design.id, 'loading another design');
      if (!preserved.ok) return;
    } catch (err) {
      U.showToast(err.message || 'The current workspace could not be preserved, so nothing was changed.', 'error', { duration: 9000 });
      return;
    }
    applyLoadedDesign(normalized.design, normalized.warnings, modalApi);
  }

  async function importDesignFile(file, modalApi) {
    try {
      const text = await U.readFileAsText(file);
      const raw = App.Storage.parseDesignBackup(text);
      const normalized = App.State.normalizeLoadedDesign(raw);
      if (!normalized.design) {
        U.showToast('The backup contains no valid design: ' + normalized.warnings.join(' '), 'error', { duration: 9000 });
        return;
      }
      const preserved = await preserveWorkspaceForReplacement(normalized.design.id, 'importing a backup');
      if (!preserved.ok) return;
      applyLoadedDesign(normalized.design, normalized.warnings, modalApi);
    } catch (err) {
      console.error(err);
      const message = err && err.name === 'SyntaxError' ? 'This file is not valid JSON.' : (err.message || 'The backup could not be imported.');
      U.showToast(message, 'error', { duration: 8000 });
    }
  }

  function applyLoadedDesign(design, warnings, modalApi) {
    ui.selection = null;
    ui.aiSnapshot = null;
    ui.aiSnapshotDesignId = null;
    ui.aiReport = null;
    ui.aiSelections = {};
    App.State.init(design);
    updateHeader();
    updateEmptyState();
    updateIssuesBadge();
    ui.workflowStep = 'furnish';
    renderWorkflow();
    setInspectorTab(design.mode === 'ai' && !design.placedItems.length ? 'ai' : 'item', true);
    renderCatalog();
    setView('plan');
    requestAnimationFrame(function () { App.Designer2D.fitView(); });
    App.Storage.saveCurrent(design).catch(function () {});
    updateSaveIndicator('saved');
    if (modalApi) modalApi.close('loaded');
    const warningText = warnings && warnings.length ? ' Adjustments: ' + warnings.join(' ') : '';
    U.showToast('Design “' + design.name + '” loaded.' + warningText, warnings && warnings.length ? 'warning' : 'success', { duration: warnings && warnings.length ? 8000 : 4200 });
    if (ui.viewerReady) App.Viewer3D.sync(design, null);
  }

  async function preserveWorkspaceForReplacement(nextDesignId, activity) {
    const design = getDesign();
    if (!design) return { ok: true };
    const hasContent = design.placedItems.length > 0 || design.structuralItems.length > 0;
    if (!hasContent) return { ok: true };
    let copy = U.deepClone(design);
    let note = null;
    if (nextDesignId && design.id === nextDesignId) {
      copy.id = U.uid('design');
      copy.name = (design.name + ' (recovered)').slice(0, 80);
      note = 'Your current version was saved as “' + copy.name + '” in My designs.';
    } else {
      note = 'Your current design was saved to My designs before ' + activity + '.';
    }
    let result;
    try {
      result = await App.Storage.saveDesign(copy);
    } catch (err) {
      throw new Error('Could not preserve the current design: ' + (err.message || 'storage error') + '. Nothing was changed.');
    }
    if (!result || !result.ok) {
      U.showToast('The current workspace could not be saved to My designs because browser storage is unavailable. To avoid losing it, download a JSON backup first.', 'error', { duration: 9000 });
      return { ok: false };
    }
    if (note) U.showToast(note, 'info', { duration: 7000 });
    return { ok: true, savedCopy: copy };
  }

  function wizardRoomSnapshot(form) {
    const shape = form.elements.shape.value;
    const width = Number(form.elements.widthCm.value) || C.ROOM.DEFAULT_WIDTH_CM;
    const length = Number(form.elements.lengthCm.value) || C.ROOM.DEFAULT_LENGTH_CM;
    const diameter = Number(form.elements.diameterCm.value) || C.ROOM.DEFAULT_WIDTH_CM;
    if (shape === 'circle') return { shape: 'circle', widthCm: diameter, lengthCm: diameter, diameterCm: diameter };
    return {
      shape: shape,
      widthCm: width,
      lengthCm: shape === 'square' ? width : length,
      diameterCm: diameter
    };
  }

  function wizardStarterPreviewHtml(roomUse, room) {
    const entries = [];
    const selections = starterSelectionsFor(roomUse, room);
    const products = App.Catalog.getProductsById();
    Object.keys(selections).forEach(function (id) {
      if (selections[id] > 0 && products[id]) entries.push({ product: products[id], quantity: selections[id] });
    });
    if (!entries.length) {
      return { html: '<p class="wizard-starter-empty">The catalog has no matching products for this room type yet. You can still create the room and add products manually.</p>', meta: 'No products available' };
    }
    let total = 0;
    let cost = 0;
    let priced = true;
    entries.forEach(function (entry) {
      total += entry.quantity;
      if (Number.isFinite(entry.product.price)) cost += entry.product.price * entry.quantity;
      else priced = false;
    });
    const html = entries.map(function (entry) {
      return '<span class="wizard-starter-item" data-ai-thumb="' + U.escapeHtml(entry.product.id) + '" title="' + U.escapeHtml(entry.product.name + ' ×' + entry.quantity) + '">' +
        '<canvas width="120" height="96" aria-hidden="true"></canvas>' +
        '<span class="ai-thumb-qty">' + entry.quantity + '</span>' +
      '</span>';
    }).join('');
    return {
      html: html,
      meta: entries.length + ' product' + (entries.length === 1 ? '' : 's') + ' · ' + total + ' item' + (total === 1 ? '' : 's') + ' · ' + (priced ? '~' + U.formatMoney(cost) : 'some prices unavailable')
    };
  }

  function openRoomWizard() {
    const existing = getDesign();
    const defaults = existing ? {
      shape: existing.room.shape,
      width: existing.room.widthCm,
      length: existing.room.lengthCm,
      diameter: existing.room.diameterCm,
      height: existing.room.heightCm,
      roomUse: existing.roomUse || 'living'
    } : {
      shape: 'rectangle',
      width: C.ROOM.DEFAULT_WIDTH_CM,
      length: C.ROOM.DEFAULT_LENGTH_CM,
      diameter: C.ROOM.DEFAULT_WIDTH_CM,
      height: C.ROOM.DEFAULT_HEIGHT_CM,
      roomUse: 'living'
    };
    const useCards = Object.keys(C.ROOM_USES).map(function (key) {
      const use = C.ROOM_USES[key];
      return '<label class="wizard-use-card' + (defaults.roomUse === key ? ' is-selected' : '') + '" data-wizard-use-card="' + key + '" role="radio" aria-checked="' + (defaults.roomUse === key ? 'true' : 'false') + '">' +
        '<input type="radio" name="wizardRoomUse" value="' + key + '" ' + (defaults.roomUse === key ? 'checked' : '') + '>' +
        '<span class="wizard-use-copy"><strong>' + U.escapeHtml(use.label) + '</strong><small>' + U.escapeHtml(use.description) + '</small></span>' +
      '</label>';
    }).join('');
    const body = '' +
      '<div class="room-wizard-intro"><div class="wizard-mark">⌂</div><div><h3>Set up the actual space</h3><p>Room dimensions are stored in centimetres. The plan, 3D walls and price planning all use these exact measurements.</p></div></div>' +
      '<form id="roomWizardForm" class="room-wizard-form" novalidate>' +
        '<label class="field"><span>Design name</span><input name="name" value="' + U.escapeHtml(existing ? existing.name : 'My living room') + '" maxlength="80" required></label>' +
        '<label class="field"><span>Room shape</span><select name="shape" id="wizardShape"><option value="rectangle"' + (defaults.shape === 'rectangle' ? ' selected' : '') + '>Rectangular room</option><option value="square"' + (defaults.shape === 'square' ? ' selected' : '') + '>Square room</option><option value="circle"' + (defaults.shape === 'circle' ? ' selected' : '') + '>Circular room</option></select></label>' +
        '<div class="field-row">' +
          '<label class="field" data-wizard-field="width"><span id="wizardWidthLabel">Width (cm)</span><input name="widthCm" type="number" min="' + C.ROOM.MIN_DIM_CM + '" max="' + C.ROOM.MAX_DIM_CM + '" step="1" value="' + U.escapeHtml(defaults.width) + '"></label>' +
          '<label class="field" data-wizard-field="length"><span>Length (cm)</span><input name="lengthCm" type="number" min="' + C.ROOM.MIN_DIM_CM + '" max="' + C.ROOM.MAX_DIM_CM + '" step="1" value="' + U.escapeHtml(defaults.length) + '"></label>' +
          '<label class="field" data-wizard-field="diameter"><span>Diameter (cm)</span><input name="diameterCm" type="number" min="' + C.ROOM.MIN_DIM_CM + '" max="' + C.ROOM.MAX_DIM_CM + '" step="1" value="' + U.escapeHtml(defaults.diameter) + '"></label>' +
        '</div>' +
        '<div class="field-row">' +
          '<label class="field"><span>Ceiling height (cm)</span><input name="heightCm" type="number" min="' + C.ROOM.MIN_HEIGHT_CM + '" max="' + C.ROOM.MAX_HEIGHT_CM + '" step="1" value="' + U.escapeHtml(defaults.height) + '"></label>' +
          '<label class="field"><span>Budget (EUR)</span><input name="budget" type="number" min="0" step="10" value="' + (existing && existing.budget !== null ? existing.budget : C.DEFAULT_BUDGET) + '"><small>Leave empty for no budget.</small></label>' +
        '</div>' +
        '<div class="wizard-approach">' +
          '<div class="wizard-approach-head"><div class="section-label">How do you want to furnish it?</div><p>Choose now — the AI panel stays available either way.</p></div>' +
          '<div class="wizard-mode-grid" role="radiogroup" aria-label="Furnishing approach">' +
            '<label class="wizard-mode-card is-selected" data-wizard-mode-card="ai" role="radio" aria-checked="true">' +
              '<input type="radio" name="wizardMode" value="ai" checked>' +
              '<span class="wizard-mode-icon">✦</span>' +
              '<span class="wizard-mode-copy"><strong>AI-assisted</strong><small>Preload a starter mix with product images, then generate an editable layout.</small></span>' +
            '</label>' +
            '<label class="wizard-mode-card" data-wizard-mode-card="manual" role="radio" aria-checked="false">' +
              '<input type="radio" name="wizardMode" value="manual">' +
              '<span class="wizard-mode-icon">↖</span>' +
              '<span class="wizard-mode-copy"><strong>Manual</strong><small>Start with an empty room and choose every product yourself.</small></span>' +
            '</label>' +
          '</div>' +
          '<div class="wizard-ai-options" id="wizardAIOptions">' +
            '<div class="section-label">Room type <span>shapes the starter mix</span></div>' +
            '<div class="wizard-use-grid" role="radiogroup" aria-label="Room type">' + useCards + '</div>' +
            '<div class="wizard-starter">' +
              '<div class="wizard-starter-head"><span>Starter mix preview</span><small id="wizardStarterMeta">…</small></div>' +
              '<div class="wizard-starter-strip" id="wizardStarterStrip"></div>' +
              '<p class="wizard-starter-note">Nothing is placed yet. After creation, review these products and images in the Assistant, adjust quantities, then generate.</p>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<p class="wizard-note">Doors and windows can be added after the room is created. Furniture is never silently resized if you change dimensions later.</p>' +
        '<div class="room-form-message" id="wizardMessage"></div>' +
      '</form>';
    App.UI.modal({
      title: existing ? 'Start a new room' : 'Create your room',
      eyebrow: 'Real dimensions · step 1 of the workflow',
      bodyHtml: body,
      wide: true,
      actions: [
        { label: 'Cancel', kind: 'secondary' },
        {
          label: 'Create room',
          kind: 'primary',
          onClick: async function (api) {
            const form = api.bodyEl.querySelector('#roomWizardForm');
            const message = api.bodyEl.querySelector('#wizardMessage');
            const name = form.elements.name.value.trim();
            const shape = form.elements.shape.value;
            const height = Number(form.elements.heightCm.value);
            let width = Number(form.elements.widthCm.value);
            let length = Number(form.elements.lengthCm.value);
            const diameter = Number(form.elements.diameterCm.value);
            if (!name) { message.textContent = 'Give the design a name.'; return false; }
            if (!Number.isFinite(height) || height < C.ROOM.MIN_HEIGHT_CM || height > C.ROOM.MAX_HEIGHT_CM) {
              message.textContent = 'Ceiling height must be between ' + C.ROOM.MIN_HEIGHT_CM + ' and ' + C.ROOM.MAX_HEIGHT_CM + ' cm.';
              return false;
            }
            if (shape === 'circle') {
              if (!Number.isFinite(diameter) || diameter < C.ROOM.MIN_DIM_CM || diameter > C.ROOM.MAX_DIM_CM) {
                message.textContent = 'Diameter must be between ' + C.ROOM.MIN_DIM_CM + ' and ' + C.ROOM.MAX_DIM_CM + ' cm.';
                return false;
              }
              width = diameter;
              length = diameter;
            } else {
              if (!Number.isFinite(width) || width < C.ROOM.MIN_DIM_CM || width > C.ROOM.MAX_DIM_CM) {
                message.textContent = 'Width must be between ' + C.ROOM.MIN_DIM_CM + ' and ' + C.ROOM.MAX_DIM_CM + ' cm.';
                return false;
              }
              if (shape === 'square') length = width;
              if (!Number.isFinite(length) || length < C.ROOM.MIN_DIM_CM || length > C.ROOM.MAX_DIM_CM) {
                message.textContent = 'Length must be between ' + C.ROOM.MIN_DIM_CM + ' and ' + C.ROOM.MAX_DIM_CM + ' cm.';
                return false;
              }
            }
            try {
              const preserved = await preserveWorkspaceForReplacement(null, 'creating a new room');
              if (!preserved.ok) return false;
            } catch (err) {
              U.showToast(err.message || 'The current workspace could not be preserved. Nothing was changed.', 'error', { duration: 9000 });
              return false;
            }
            const budgetRaw = form.elements.budget.value.trim();
            const budget = budgetRaw === '' ? null : Number(budgetRaw);
            const modeInput = form.querySelector('input[name="wizardMode"]:checked');
            const useInput = form.querySelector('input[name="wizardRoomUse"]:checked');
            const approach = modeInput && modeInput.value === 'manual' ? 'manual' : 'ai';
            const roomUse = useInput && C.ROOM_USES[useInput.value] ? useInput.value : 'living';
            const design = App.State.createDesign({
              name: name,
              shape: shape,
              widthCm: width,
              lengthCm: length,
              diameterCm: diameter,
              heightCm: height,
              budget: budget === null ? C.DEFAULT_BUDGET : budget,
              mode: approach,
              roomUse: roomUse
            });
            const starter = approach === 'ai' ? starterSelectionsFor(roomUse, design.room) : {};
            ui.selection = null;
            ui.aiSnapshot = null;
            ui.aiSnapshotDesignId = null;
            ui.aiReport = null;
            ui.aiTemplate = 'balanced';
            ui.aiSelections = starter;
            App.State.init(design);
            if (budget === null) App.State.setBudget(null);
            await App.Storage.saveCurrent(design);
            updateHeader();
            updateEmptyState();
            updateIssuesBadge();
            setWorkflowStep('furnish', { keepTab: true });
            setInspectorTab(approach === 'ai' ? 'ai' : 'item', true);
            setView('plan');
            requestAnimationFrame(function () { App.Designer2D.fitView(); });
            updateSaveIndicator('saved');
            if (approach === 'ai') {
              const items = Object.keys(starter).reduce(function (sum, id) { return sum + starter[id]; }, 0);
              U.showToast('Room created in AI-assisted mode with ' + Object.keys(starter).length + ' starter product' +
                (Object.keys(starter).length === 1 ? '' : 's') + (items ? ' (' + items + ' items)' : '') +
                ' preloaded. Review the images and quantities, then generate.', 'success', { duration: 7000 });
            } else {
              U.showToast('Room created in manual mode. Add doors or windows from the plan toolbar, then drag products from the catalog.', 'success', { duration: 6500 });
            }
          }
        }
      ],
      onMount: function (bodyEl, api) {
        const form = bodyEl.querySelector('#roomWizardForm');
        const shape = bodyEl.querySelector('#wizardShape');
        const aiOptions = bodyEl.querySelector('#wizardAIOptions');
        const starterStrip = bodyEl.querySelector('#wizardStarterStrip');
        const starterMeta = bodyEl.querySelector('#wizardStarterMeta');
        const primaryButton = api && api.el ? api.el.querySelector('.modal-footer [data-autofocus-primary]') : null;
        form.elements.name.focus();
        form.elements.name.select();
        function syncFields() {
          const value = shape.value;
          bodyEl.querySelector('[data-wizard-field="width"]').hidden = value === 'circle';
          bodyEl.querySelector('[data-wizard-field="length"]').hidden = value === 'circle' || value === 'square';
          bodyEl.querySelector('[data-wizard-field="diameter"]').hidden = value !== 'circle';
          const label = bodyEl.querySelector('#wizardWidthLabel');
          if (label) label.textContent = value === 'square' ? 'Side (cm)' : 'Width (cm)';
        }
        function syncApproach() {
          const checked = form.querySelector('input[name="wizardMode"]:checked');
          const mode = checked ? checked.value : 'ai';
          bodyEl.querySelectorAll('[data-wizard-mode-card]').forEach(function (card) {
            const active = card.getAttribute('data-wizard-mode-card') === mode;
            card.classList.toggle('is-selected', active);
            card.setAttribute('aria-checked', active ? 'true' : 'false');
          });
          aiOptions.hidden = mode !== 'ai';
          if (primaryButton) primaryButton.textContent = mode === 'ai' ? 'Create room & load products' : 'Create room';
          if (mode === 'ai') updatePreview();
        }
        function updatePreview() {
          const useInput = form.querySelector('input[name="wizardRoomUse"]:checked');
          const roomUse = useInput && C.ROOM_USES[useInput.value] ? useInput.value : 'living';
          bodyEl.querySelectorAll('[data-wizard-use-card]').forEach(function (card) {
            const active = card.getAttribute('data-wizard-use-card') === roomUse;
            card.classList.toggle('is-selected', active);
            card.setAttribute('aria-checked', active ? 'true' : 'false');
          });
          const preview = wizardStarterPreviewHtml(roomUse, wizardRoomSnapshot(form));
          starterStrip.innerHTML = preview.html;
          starterMeta.textContent = preview.meta;
          decorateAIMedia(starterStrip);
        }
        form.addEventListener('change', function (event) {
          if (event.target.name === 'wizardMode') {
            syncApproach();
            return;
          }
          if (event.target.name === 'wizardRoomUse') {
            updatePreview();
            return;
          }
          if (['shape', 'widthCm', 'lengthCm', 'diameterCm'].indexOf(event.target.name) >= 0) {
            syncFields();
            if (!aiOptions.hidden) updatePreview();
          }
        });
        syncFields();
        syncApproach();
      }
    });
  }

  function fatalBoot(err) {
    ui.fatal = true;
    document.body.classList.add('has-fatal-error');
    if (els.bootScreen) {
      els.bootScreen.classList.add('is-error');
      const target = els.fatalError || els.bootScreen;
      target.hidden = false;
      target.innerHTML = '<strong>FormaRoom could not start.</strong><p>' + U.escapeHtml(err && err.message ? err.message : 'Unknown startup error') + '</p><p>Check that all files in the js and vendor folders are present, then reload the page.</p>';
    }
    console.error(err);
  }

  function hideBootScreen() {
    if (!els.bootScreen) return;
    els.bootScreen.classList.add('is-hidden');
    setTimeout(function () {
      if (els.bootScreen) els.bootScreen.hidden = true;
    }, 450);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.App = window.App || {});
