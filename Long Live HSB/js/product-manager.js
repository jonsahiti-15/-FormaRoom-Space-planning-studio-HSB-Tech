(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;
  const esc = U.escapeHtml;

  let modalApi = null;
  let bodyEl = null;
  let editing = null;
  let pendingObjectUrls = [];

  function open() {
    if (modalApi) return;
    App.UI.modal({
      title: 'Product catalog manager',
      eyebrow: C.COMPANY_NAME,
      wide: 'xl',
      bodyHtml: '<div id="pmBody" class="pm-body"></div>',
      actions: [{ label: 'Close', value: 'close', kind: 'secondary' }],
      onMount: function (body, api) {
        modalApi = api;
        bodyEl = body.querySelector('#pmBody');
        renderList();
      }
    }).then(function () {
      pendingObjectUrls.forEach(function (url) { try { URL.revokeObjectURL(url); } catch (err) { /* ignore */ } });
      pendingObjectUrls = [];
      modalApi = null;
      bodyEl = null;
      editing = null;
      if (typeof App.onCatalogManagerClose === 'function') App.onCatalogManagerClose();
    });
  }

  function sourceBadge(product) {
    if (product.source === 'custom') return '<span class="badge badge-local">Local product</span>';
    if (product.demo) return '<span class="badge badge-demo">Demo catalog</span>';
    return '';
  }

  function storageWarning() {
    const health = App.Storage.getHealth();
    if (health.persistent) return '';
    return '<div class="notice notice-warning"><strong>Storage unavailable:</strong> catalog changes will last only for this tab. ' +
      (health.errors[0] ? esc(health.errors[0]) : '') + '</div>';
  }

  function renderList() {
    editing = null;
    const products = App.Catalog.getProducts();
    const health = App.Storage.getHealth();
    const rows = products.map(function (product) {
      const isSeed = App.Catalog.SEED_PRODUCTS.some(function (p) { return p.id === product.id; });
      const customised = isSeed && App.Catalog.isSeedOverridden(product.id);
      return '' +
        '<div class="pm-row" data-product-id="' + esc(product.id) + '">' +
          '<div class="pm-thumb"><canvas width="90" height="66"></canvas></div>' +
          '<div class="pm-main">' +
            '<div class="pm-name">' + esc(product.name) + ' ' + sourceBadge(product) + (customised ? '<span class="badge badge-custom">Customised</span>' : '') + '</div>' +
            '<div class="pm-meta"><code>' + esc(product.id) + '</code><span>' + esc(App.Catalog.getCategoryLabel(product.category)) + '</span><span>' + U.formatMoney(product.price) + '</span><span>' + U.formatDims(product) + '</span></div>' +
            '<div class="pm-assets">' +
              (product.assets.main ? '<span title="Main image attached">Image</span>' : '') +
              (product.assets.top ? '<span title="2D top view attached">Top view</span>' : '') +
              (product.assets.glb ? '<span title="GLB model attached">GLB model</span>' : '<span class="is-muted">No GLB</span>') +
            '</div>' +
          '</div>' +
          '<div class="pm-actions">' +
            '<button type="button" class="btn btn-small btn-secondary" data-pm-action="edit" data-id="' + esc(product.id) + '">Edit</button>' +
            (isSeed && customised ? '<button type="button" class="btn btn-small btn-ghost" data-pm-action="reset" data-id="' + esc(product.id) + '">Reset</button>' : '') +
            (!isSeed ? '<button type="button" class="btn btn-small btn-ghost btn-danger-text" data-pm-action="delete" data-id="' + esc(product.id) + '">Delete</button>' : '') +
          '</div>' +
        '</div>';
    }).join('');
    bodyEl.innerHTML = '' +
      '<div class="pm-toolbar">' +
        '<div>' +
          '<p class="pm-intro">Products shown here are the catalog used by the planner and the price list. ' +
            'Demo products include clear illustrations; attach your company\'s own photos and GLB files to make them real.</p>' +
          '<div class="pm-stats">' +
            '<span><strong>' + products.length + '</strong> products</span>' +
            '<span><strong>' + App.Catalog.countCustom() + '</strong> local additions</span>' +
            '<span><strong>' + App.Catalog.countOverrides() + '</strong> customised demo items</span>' +
            '<span>Storage: <strong>' + esc(health.persistent ? (health.mode === 'dual' ? 'local + backup' : health.mode === 'local' ? 'browser local' : 'backup database') : 'session only') + '</strong></span>' +
          '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-primary" data-pm-action="new">+ New product</button>' +
      '</div>' +
      storageWarning() +
      '<div class="notice notice-info"><strong>Demo data disclosure:</strong> this file ships with ' +
        products.filter(function (p) { return p.demo; }).length + ' illustrative Northline Living products. ' +
        'Their prices, dimensions, imagery and 3D previews are clearly labelled demo content, not a real supplier catalog. ' +
        'Edit any product to attach authentic catalog assets.</div>' +
      '<div class="pm-list">' + rows + '</div>';
    decorateThumbs();
    bodyEl.querySelectorAll('[data-pm-action]').forEach(function (button) {
      button.addEventListener('click', onListAction);
    });
  }

  function decorateThumbs() {
    bodyEl.querySelectorAll('.pm-row').forEach(function (row) {
      const id = row.getAttribute('data-product-id');
      const product = App.Catalog.getProduct(id);
      const canvas = row.querySelector('canvas');
      if (!product || !canvas) return;
      canvas.width = 90;
      canvas.height = 66;
      App.Media.drawThumb(canvas, product);
      const main = product.assets && product.assets.main;
      if (main && main.key) {
        App.Media.getAssetObjectURL(main.key).then(function (url) {
          if (!url || !row.isConnected) return;
          const img = document.createElement('img');
          img.className = 'pm-thumb-photo';
          img.alt = '';
          img.src = url;
          img.onerror = function () { img.remove(); };
          row.querySelector('.pm-thumb').appendChild(img);
        }).catch(function () {});
      }
    });
  }

  async function onListAction(event) {
    const action = event.currentTarget.getAttribute('data-pm-action');
    const id = event.currentTarget.getAttribute('data-id');
    if (action === 'new') {
      renderForm(null);
      return;
    }
    const product = App.Catalog.getProduct(id);
    if (!product) return;
    if (action === 'edit') {
      renderForm(product);
      return;
    }
    if (action === 'reset') {
      const confirmed = await App.UI.confirm('Reset demo product?',
        'All customised catalog data and uploaded files for "' + product.name + '" will be removed and the original demo product will be restored. Saved designs keep using this product ID.',
        { confirmLabel: 'Reset product', danger: true });
      if (!confirmed) return;
      await App.Catalog.resetSeedProduct(id);
      App.UI.toast('Demo product restored.', 'success');
      if (typeof App.onCatalogChange === 'function') App.onCatalogChange();
      renderList();
      return;
    }
    if (action === 'delete') {
      const instanceCount = App.State.countProductInstances(id);
      let warning = 'Uploaded files for this product will also be deleted. This cannot be undone.';
      if (instanceCount) warning = 'This product is used ' + instanceCount + ' time' + (instanceCount === 1 ? '' : 's') + ' in the current design. Those placed items will remain but will be marked unavailable until the product is re-created with the same ID. ' + warning;
      const confirmed = await App.UI.confirm('Delete local product?', warning, { confirmLabel: 'Delete product', danger: true });
      if (!confirmed) return;
      await App.Catalog.deleteCustomProduct(id);
      App.UI.toast('Local product deleted.', 'success');
      if (typeof App.onCatalogChange === 'function') App.onCatalogChange();
      renderList();
    }
  }

  function categoryOptions(selected) {
    return App.Catalog.getCategories().map(function (cat) {
      return '<option value="' + esc(cat.id) + '"' + (cat.id === selected ? ' selected' : '') + '>' + esc(cat.label) + '</option>';
    }).join('');
  }

  function assetSlot(kind, label, product, hint) {
    const ref = product.assets && product.assets[kind];
    let stateText = 'Not attached';
    if (ref) stateText = ref.name || 'Attached file';
    return '' +
      '<div class="pm-asset" data-asset-slot="' + kind + '">' +
        '<div class="pm-asset-head"><strong>' + esc(label) + '</strong><span class="pm-asset-state">' + esc(stateText) + '</span></div>' +
        '<p class="pm-help">' + esc(hint) + '</p>' +
        '<div class="pm-asset-controls">' +
          '<label class="btn btn-small btn-secondary pm-file-btn">Choose file<input type="file" data-asset-input="' + kind + '" accept="' + (kind === 'glb' ? '.glb,model/gltf-binary' : 'image/*') + '"></label>' +
          '<button type="button" class="btn btn-small btn-ghost btn-danger-text" data-asset-remove="' + kind + '"' + (ref ? '' : ' hidden') + '>Remove</button>' +
        '</div>' +
        '<div class="pm-asset-preview" data-asset-preview="' + kind + '"></div>' +
      '</div>';
  }

  function variantsToText(variants) {
    return (variants || []).map(function (v) { return v.name + ' | ' + v.color; }).join('\n');
  }

  function parseVariants(text, existing) {
    const lines = String(text || '').split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    const used = {};
    return lines.map(function (line) {
      const parts = line.split('|');
      const name = (parts[0] || '').trim().slice(0, 60);
      if (!name) return null;
      const color = (parts[1] || '').trim();
      const previous = (existing || []).find(function (v) { return v.name.toLowerCase() === name.toLowerCase(); });
      let id = previous ? previous.id : name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
      if (!id) id = 'variant';
      while (used[id]) id += '-2';
      used[id] = true;
      return { id: id, name: name, color: U.isHexColor(color) ? color : (previous && previous.color) || '#b9b2a4' };
    }).filter(Boolean);
  }

  function renderForm(product) {
    const isNew = !product;
    const isSeed = !!product && App.Catalog.SEED_PRODUCTS.some(function (p) { return p.id === product.id; });
    const data = product || {
      id: App.Catalog.nextCustomId(), name: '', category: 'storage', price: '', widthCm: '', lengthCm: '', heightCm: '',
      description: '', brand: C.COMPANY_NAME, materials: '', availability: 'In stock', variants: [], modelRotationDeg: 0,
      assets: { main: null, display: null, top: null, glb: null }
    };
    editing = {
      isNew: isNew,
      isSeed: isSeed,
      productId: data.id,
      pending: {},
      remove: {},
      original: product,
      previewUrls: []
    };
    bodyEl.innerHTML = '' +
      '<div class="pm-form-head">' +
        '<button type="button" class="btn btn-small btn-ghost" data-pm-back>← Back to catalog</button>' +
        '<div><h3>' + (isNew ? 'Add a product' : 'Edit ' + esc(data.name)) + '</h3>' +
        '<p class="pm-help">' + (isNew ? 'This product will be available in the catalog immediately after saving.' : (isSeed ? 'You are customising a demo product. The original demo defaults remain recoverable via Reset.' : 'Changes apply wherever this product is placed in a design.')) + '</p></div>' +
      '</div>' +
      '<form id="pmForm" class="pm-form" autocomplete="off" novalidate>' +
        '<div class="pm-form-grid">' +
          '<label class="field"><span>Product ID</span><input name="id" value="' + esc(data.id) + '" readonly class="is-readonly"><small>Stable ID. IDs cannot change after creation.</small></label>' +
          '<label class="field"><span>Product name</span><input name="name" value="' + esc(data.name) + '" maxlength="120" required placeholder="e.g. Oslo Three-Door Wardrobe"></label>' +
          '<label class="field"><span>Category</span><select name="category">' + categoryOptions(data.category) + '</select></label>' +
          '<label class="field"><span>Price (EUR)</span><input name="price" type="number" min="0" step="0.01" value="' + (data.price === null ? '' : esc(String(data.price))) + '" required placeholder="0.00"></label>' +
          '<label class="field"><span>Width (cm)</span><input name="widthCm" type="number" min="1" step="0.1" value="' + esc(String(data.widthCm == null ? '' : data.widthCm)) + '" required></label>' +
          '<label class="field"><span>Length / depth (cm)</span><input name="lengthCm" type="number" min="1" step="0.1" value="' + esc(String(data.lengthCm == null ? '' : data.lengthCm)) + '" required></label>' +
          '<label class="field"><span>Height (cm)</span><input name="heightCm" type="number" min="1" step="0.1" value="' + esc(String(data.heightCm == null ? '' : data.heightCm)) + '" required></label>' +
          '<label class="field"><span>Availability</span><input name="availability" value="' + esc(data.availability || '') + '" maxlength="120" placeholder="e.g. In stock"></label>' +
          '<label class="field"><span>Brand / manufacturer</span><input name="brand" value="' + esc(data.brand || '') + '" maxlength="120"></label>' +
          '<label class="field"><span>Materials</span><input name="materials" value="' + esc(data.materials || '') + '" maxlength="300"></label>' +
          '<label class="field field-wide"><span>Description</span><textarea name="description" rows="3" maxlength="1200">' + esc(data.description || '') + '</textarea></label>' +
          '<label class="field"><span>Model orientation correction (°)</span><input name="modelRotationDeg" type="number" min="0" max="359" step="1" value="' + esc(String(data.modelRotationDeg || 0)) + '"><small>Rotate the GLB around its vertical axis if its front does not face the room.</small></label>' +
          '<label class="field"><span>Variants</span><textarea name="variants" rows="3" placeholder="Sand fabric | #cbb79f">' + esc(variantsToText(data.variants)) + '</textarea><small>One per line: name | hex colour. Each placed item can choose a variant.</small></label>' +
        '</div>' +
        '<h3 class="pm-section-title">Catalog assets</h3>' +
        '<p class="pm-help">Each asset is stored separately. A missing image uses the labeled illustration; a missing GLB uses a clearly labelled procedural preview. No model is fabricated as an authentic company model.</p>' +
        '<div class="pm-assets-grid">' +
          assetSlot('main', 'Main catalog image', data, 'Used on product cards and in the catalog. JPG, PNG, WebP or SVG up to 6 MB.') +
          assetSlot('display', 'Display image', data, 'Used in the product detail view. Independent from the main image.') +
          assetSlot('top', '2D top-view image', data, 'Used for the floor-plan footprint when present. The footprint size always comes from the dimensions above.') +
          assetSlot('glb', '3D GLB model', data, 'A binary .glb file up to 40 MB. Loaded locally; no CDN or server is used.') +
        '</div>' +
        '<div class="pm-form-message" id="pmFormMessage" role="status"></div>' +
        '<div class="pm-form-actions">' +
          '<button type="button" class="btn btn-secondary" data-pm-back>Cancel</button>' +
          '<button type="submit" class="btn btn-primary" id="pmSaveBtn">' + (isNew ? 'Add product' : 'Save changes') + '</button>' +
        '</div>' +
      '</form>';
    bodyEl.querySelectorAll('[data-pm-back]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (editing) revokeEditingUrls();
        renderList();
      });
    });
    const form = bodyEl.querySelector('#pmForm');
    form.addEventListener('submit', saveForm);
    bodyEl.querySelectorAll('[data-asset-input]').forEach(function (input) {
      input.addEventListener('change', function () {
        const kind = input.getAttribute('data-asset-input');
        handleAssetSelection(kind, input.files && input.files[0]);
        input.value = '';
      });
    });
    bodyEl.querySelectorAll('[data-asset-remove]').forEach(function (button) {
      button.addEventListener('click', function () {
        removeAsset(button.getAttribute('data-asset-remove'));
      });
    });
    ['main', 'display', 'top', 'glb'].forEach(function (kind) { refreshAssetSlot(kind); });
  }

  function revokeEditingUrls() {
    if (!editing) return;
    (editing.previewUrls || []).forEach(function (url) { try { URL.revokeObjectURL(url); } catch (err) { /* ignore */ } });
    editing.previewUrls = [];
  }

  function showFormMessage(message, type) {
    const el = bodyEl && bodyEl.querySelector('#pmFormMessage');
    if (!el) return;
    el.className = 'pm-form-message' + (type ? ' is-' + type : '');
    el.textContent = message || '';
  }

  function assetCard(kind) {
    return bodyEl ? bodyEl.querySelector('[data-asset-slot="' + kind + '"]') : null;
  }

  function refreshAssetSlot(kind) {
    if (!editing) return;
    const card = assetCard(kind);
    if (!card) return;
    const original = editing.original;
    const existing = original && original.assets ? original.assets[kind] : null;
    const pending = editing.pending[kind];
    const removed = !!editing.remove[kind];
    const stateEl = card.querySelector('.pm-asset-state');
    const removeBtn = card.querySelector('[data-asset-remove]');
    const preview = card.querySelector('[data-asset-preview]');
    if (pending) {
      stateEl.textContent = pending.name + ' (will be saved)';
      removeBtn.hidden = false;
    } else if (existing && !removed) {
      stateEl.textContent = existing.name || 'Attached file';
      removeBtn.hidden = false;
    } else if (removed && existing) {
      stateEl.textContent = 'Will be removed when you save';
      removeBtn.hidden = true;
    } else {
      stateEl.textContent = 'Not attached';
      removeBtn.hidden = true;
    }
    preview.innerHTML = '';
    if (pending && pending.type && pending.type.indexOf('image/') === 0) {
      const url = URL.createObjectURL(pending);
      editing.previewUrls.push(url);
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Pending upload preview';
      preview.appendChild(img);
    } else if (pending) {
      preview.innerHTML = '<div class="pm-file-pill"><strong>GLB</strong> ' + esc(pending.name) + ' · ' + U.formatFileSize(pending.size) + '</div>';
    } else if (existing && !removed) {
      if (kind === 'glb') {
        preview.innerHTML = '<div class="pm-file-pill"><strong>GLB</strong> ' + esc(existing.name) + '</div>';
      } else {
        App.Media.getAssetObjectURL(existing.key).then(function (url) {
          if (!url || !preview.isConnected || editing.pending[kind] || editing.remove[kind]) return;
          const img = document.createElement('img');
          img.src = url;
          img.alt = kind + ' asset';
          preview.innerHTML = '';
          preview.appendChild(img);
        }).catch(function () {
          preview.innerHTML = '<div class="pm-file-pill is-warning">Attached file could not be read</div>';
        });
      }
    } else {
      preview.innerHTML = '<div class="pm-file-pill is-empty">Using the built-in labeled illustration / procedural preview</div>';
    }
  }

  async function handleAssetSelection(kind, file) {
    if (!file || !editing) return;
    if (kind === 'glb') {
      if (!/\.glb$/i.test(file.name)) {
        App.UI.toast('Choose a binary .glb file. .gltf files with external files are not supported.', 'error');
        return;
      }
      if (file.size > C.LIMITS.MAX_GLB_BYTES) {
        App.UI.toast('The GLB file is larger than the ' + Math.round(C.LIMITS.MAX_GLB_BYTES / 1024 / 1024) + ' MB limit.', 'error');
        return;
      }
      try {
        await validateGlbFile(file);
      } catch (err) {
        App.UI.toast(err.message || 'This GLB file could not be read.', 'error');
        return;
      }
    } else {
      if (!file.type || file.type.indexOf('image/') !== 0) {
        App.UI.toast('Choose an image file (JPG, PNG, WebP or SVG).', 'error');
        return;
      }
      if (file.size > C.LIMITS.MAX_IMAGE_BYTES) {
        App.UI.toast('The image is larger than the ' + Math.round(C.LIMITS.MAX_IMAGE_BYTES / 1024 / 1024) + ' MB limit.', 'error');
        return;
      }
      try {
        await validateImageFile(file);
      } catch (err) {
        App.UI.toast('This image could not be decoded by the browser.', 'error');
        return;
      }
    }
    const previous = editing.pending[kind];
    if (previous) {
      const stale = editing.previewUrls.filter(function (url, index, arr) { return arr.indexOf(url) === index; });
      editing.previewUrls = stale;
    }
    editing.pending[kind] = file;
    editing.remove[kind] = false;
    refreshAssetSlot(kind);
  }

  function removeAsset(kind) {
    if (!editing) return;
    if (editing.pending[kind]) delete editing.pending[kind];
    else if (editing.original && editing.original.assets && editing.original.assets[kind]) editing.remove[kind] = true;
    refreshAssetSlot(kind);
  }

  function validateImageFile(file) {
    return new Promise(function (resolve, reject) {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        if (!img.width || !img.height) reject(new Error('Empty image.'));
        else resolve();
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        reject(new Error('Image decode failed.'));
      };
      img.src = url;
    });
  }

  async function validateGlbFile(file) {
    const buffer = await U.readFileAsArrayBuffer(file);
    if (buffer.byteLength < 20) throw new Error('This file is too small to be a valid GLB.');
    const header = new Uint8Array(buffer, 0, 4);
    const magic = String.fromCharCode(header[0], header[1], header[2], header[3]);
    if (magic !== 'glTF') throw new Error('This is not a binary GLB file (missing glTF header).');
    const version = new DataView(buffer).getUint32(4, true);
    if (version !== 2) throw new Error('Only GLB version 2 models are supported.');
    if (typeof THREE === 'undefined' || !THREE.GLTFLoader) return;
    await new Promise(function (resolve, reject) {
      try {
        new THREE.GLTFLoader().parse(buffer, '', function () { resolve(); }, function (err) {
          reject(new Error('The GLB could not be parsed' + (err && err.message ? ': ' + err.message : '. It may use an unsupported compression extension.')));
        });
      } catch (err) {
        reject(new Error('The GLB could not be parsed: ' + (err && err.message ? err.message : 'unknown error')));
      }
    });
  }

  function existingAssetRefs(product) {
    const refs = {};
    ['main', 'display', 'top', 'glb'].forEach(function (kind) {
      const ref = product && product.assets ? product.assets[kind] : null;
      if (ref) refs[kind] = { key: ref.key, name: ref.name, type: ref.type };
    });
    return refs;
  }

  async function saveForm(event) {
    event.preventDefault();
    if (!editing) return;
    const form = bodyEl.querySelector('#pmForm');
    const saveBtn = bodyEl.querySelector('#pmSaveBtn');
    showFormMessage('');
    const data = {
      id: form.elements.id.value.trim(),
      name: form.elements.name.value.trim(),
      category: form.elements.category.value,
      price: form.elements.price.value,
      widthCm: form.elements.widthCm.value,
      lengthCm: form.elements.lengthCm.value,
      heightCm: form.elements.heightCm.value,
      availability: form.elements.availability.value.trim(),
      brand: form.elements.brand.value.trim(),
      materials: form.elements.materials.value.trim(),
      description: form.elements.description.value.trim(),
      modelRotationDeg: form.elements.modelRotationDeg.value,
      variants: parseVariants(form.elements.variants.value, editing.original ? editing.original.variants : [])
    };
    const normalized = App.Catalog.normalizeProduct(Object.assign({}, editing.original || {}, data, {
      price: data.price === '' ? null : Number(data.price),
      widthCm: data.widthCm === '' ? NaN : Number(data.widthCm),
      lengthCm: data.lengthCm === '' ? NaN : Number(data.lengthCm),
      heightCm: data.heightCm === '' ? NaN : Number(data.heightCm),
      modelRotationDeg: Number(data.modelRotationDeg) || 0
    }));
    const validation = App.Catalog.validateProductData(normalized, App.Catalog.getProducts());
    if (validation.errors.length) {
      showFormMessage(validation.errors.join(' '), 'error');
      return;
    }
    saveBtn.disabled = true;
    saveBtn.classList.add('is-busy');
    try {
      const assets = existingAssetRefs(editing.original);
      ['main', 'display', 'top'].forEach(function (kind) {
        if (editing.remove[kind]) delete assets[kind];
      });
      if (editing.remove.glb) delete assets.glb;
      let persistenceNote = '';
      for (const kind of ['main', 'display', 'top', 'glb']) {
        const file = editing.pending[kind];
        if (!file) continue;
        const stored = await App.Storage.saveAsset(file, { name: file.name, type: kind === 'glb' ? 'model/gltf-binary' : file.type });
        assets[kind] = { key: stored.key, name: stored.name, type: stored.type };
        if (!stored.persisted) persistenceNote = 'Some uploaded files could not be persisted across reloads because the browser backup database is unavailable.';
      }
      normalized.assets = assets;
      const result = await App.Catalog.upsertProduct(normalized, {
        isNew: editing.isNew,
        allowSeedOverride: editing.isSeed
      });
      const removedKeys = [];
      const originalAssets = editing.original && editing.original.assets ? editing.original.assets : {};
      ['main', 'display', 'top', 'glb'].forEach(function (kind) {
        if (!editing.remove[kind]) return;
        if (originalAssets[kind] && originalAssets[kind].key) removedKeys.push(originalAssets[kind].key);
      });
      ['main', 'display', 'top', 'glb'].forEach(function (kind) {
        if (editing.pending[kind] && originalAssets[kind] && originalAssets[kind].key) removedKeys.push(originalAssets[kind].key);
      });
      removedKeys.forEach(function (key) { App.Storage.deleteAsset(key).catch(function () {}); });
      revokeEditingUrls();
      const persisted = result.persistence && (result.persistence.local || result.persistence.idb);
      if (!persisted) {
        App.UI.toast('Product saved for this session. The browser did not allow catalog metadata to be persisted.', 'warning');
      } else if (persistenceNote) {
        App.UI.toast(persistenceNote, 'warning');
      } else {
        App.UI.toast(editing.isNew ? 'Product added to the catalog.' : 'Product updated.', 'success');
      }
      if (typeof App.onCatalogChange === 'function') App.onCatalogChange();
      renderList();
    } catch (err) {
      console.error(err);
      showFormMessage(err && err.message ? err.message : 'The product could not be saved.', 'error');
    } finally {
      if (saveBtn && saveBtn.isConnected) {
        saveBtn.disabled = false;
        saveBtn.classList.remove('is-busy');
      }
    }
  }

  App.ProductManager = { open: open };
})(window.App = window.App || {});
