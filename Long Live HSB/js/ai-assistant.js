(function (App) {
  'use strict';

  const U = App.Util;
  const C = App.CONFIG;

  const memory = {
    snapshot: null,
    snapshotDesignId: null,
    lastMove: null,
    draft: null
  };

  const MODEL_KEY = 'formaroom.ai.model.v1';

  const PRODUCT_DEFAULTS = {
    bed: { widthCm: 160, lengthCm: 200, heightCm: 110, price: 1199 },
    wardrobe: { widthCm: 150, lengthCm: 60, heightCm: 220, price: 1099 },
    sofa: { widthCm: 200, lengthCm: 90, heightCm: 85, price: 899 },
    chair: { widthCm: 80, lengthCm: 80, heightCm: 85, price: 349 },
    table: { widthCm: 140, lengthCm: 80, heightCm: 75, price: 549 },
    desk: { widthCm: 140, lengthCm: 70, heightCm: 75, price: 499 },
    shelf: { widthCm: 90, lengthCm: 35, heightCm: 180, price: 329 },
    storage: { widthCm: 100, lengthCm: 45, heightCm: 85, price: 499 },
    lighting: { widthCm: 40, lengthCm: 40, heightCm: 160, price: 149 },
    rug: { widthCm: 200, lengthCm: 140, heightCm: 2, price: 249 },
    decor: { widthCm: 40, lengthCm: 40, heightCm: 60, price: 89 },
    staircase: { widthCm: 100, lengthCm: 220, heightCm: 280, price: 2190 },
    door: { widthCm: 90, lengthCm: 5, heightCm: 210, price: 349 },
    window: { widthCm: 120, lengthCm: 5, heightCm: 120, price: 399 }
  };

  const NAME_LABELS = {
    bed: 'Bed',
    wardrobe: 'Wardrobe',
    sofa: 'Sofa',
    chair: 'Chair',
    table: 'Table',
    desk: 'Desk',
    shelf: 'Shelf',
    storage: 'Cabinet',
    lighting: 'Lamp',
    rug: 'Rug',
    decor: 'Decor',
    staircase: 'Staircase',
    door: 'Door',
    window: 'Window'
  };

  const CATEGORY_HINTS = [
    ['staircase', /\b(stair|stairs|staircase|steps)\b/],
    ['wardrobe', /\b(wardrobe|closet|armoire)\b/],
    ['sofa', /\b(sofa|couch|settee)\b/],
    ['chair', /\b(chair|armchair|stool|seat)\b/],
    ['bed', /\b(bed|mattress)\b/],
    ['desk', /\b(desk|workstation)\b/],
    ['shelf', /\b(shelf|shelves|shelving|bookcase|bookshelf)\b/],
    ['storage', /\b(cabinet|sideboard|dresser|storage|console|drawers)\b/],
    ['table', /\b(table|island)\b/],
    ['lighting', /\b(lamp|light|lighting|pendant|chandelier|sconce)\b/],
    ['rug', /\b(rug|carpet|mat)\b/],
    ['decor', /\b(decor|vase|mirror|plant|artwork)\b/],
    ['door', /\bdoor\b/],
    ['window', /\bwindow\b/]
  ];

  const MATERIAL_WORDS = ['oak', 'walnut', 'ash', 'pine', 'beech', 'birch', 'steel', 'brass', 'glass', 'marble', 'leather', 'linen', 'velvet', 'wool', 'cotton', 'rattan', 'ceramic', 'concrete'];

  function parseMoney(raw) {
    let s = String(raw == null ? '' : raw).trim().replace(/\s/g, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0 && s.indexOf('.') >= 0) {
      s = s.lastIndexOf(',') > s.lastIndexOf('.')
        ? s.replace(/\./g, '').replace(',', '.')
        : s.replace(/,/g, '');
    } else if (s.indexOf(',') >= 0) {
      s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
    } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
    return Number(s);
  }

  function parsePrice(text) {
    const m = text.match(/(?:€|eur(?:os)?)\s*(\d[\d\s.,]*)/i)
      || text.match(/(\d[\d\s.,]*)\s*(?:€|eur(?:os)?)/i)
      || text.match(/\b(?:price|cost|costs|priced at)\s*(?:of|is|:|=)?\s*(\d[\d\s.,]*)/i);
    if (!m) return null;
    const value = parseMoney(m[1]);
    return Number.isFinite(value) && value >= 0 ? value : null;
  }

  function parseBudget(text) {
    const m = text.match(/(?:€|eur(?:os)?)\s*(\d[\d\s.,]*)/i)
      || text.match(/(\d[\d\s.,]*)\s*(?:€|eur(?:os)?)/i)
      || text.match(/\b(?:under|below|max(?:imum)?|budget(?:\s+of)?|less than|up to)\s*(\d[\d\s.,]*)/i);
    if (!m) return null;
    const value = parseMoney(m[1]);
    return Number.isFinite(value) && value > 0 ? value : null;
  }

  function parseDimensions(text) {
    const out = {};
    const triplet = text.match(/(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:x|×|\*|by)\s*(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:x|×|\*|by)\s*(\d+(?:[.,]\d+)?)/i);
    if (triplet) {
      out.widthCm = parseMoney(triplet[1]);
      out.lengthCm = parseMoney(triplet[2]);
      out.heightCm = parseMoney(triplet[3]);
    }
    const axes = [
      ['widthCm', /(?:width|wide)\s*(?:of|is|:|=)?\s*(\d+(?:[.,]\d+)?)/i, /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:wide|in width)/i],
      ['lengthCm', /(?:length|long|depth|deep)\s*(?:of|is|:|=)?\s*(\d+(?:[.,]\d+)?)/i, /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:long|deep|in depth)/i],
      ['heightCm', /(?:height|tall)\s*(?:of|is|:|=)?\s*(\d+(?:[.,]\d+)?)/i, /(\d+(?:[.,]\d+)?)\s*(?:cm)?\s*(?:high|tall|in height)/i]
    ];
    axes.forEach(function (axis) {
      const hit = text.match(axis[1]) || text.match(axis[2]);
      if (hit) out[axis[0]] = parseMoney(hit[1]);
    });
    Object.keys(out).forEach(function (key) {
      if (!(out[key] > 0)) delete out[key];
    });
    return out;
  }

  function detectCategory(text) {
    for (let i = 0; i < CATEGORY_HINTS.length; i++) {
      if (CATEGORY_HINTS[i][1].test(text)) return CATEGORY_HINTS[i][0];
    }
    return null;
  }

  function titleCase(text) {
    return String(text || '').replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }

  function cleanCapturedName(text) {
    let name = String(text || '').trim();
    const filler = /^(?:it|this|that|the|to|as|a|an|its|product|please|now|kindly)\b[\s,]*/i;
    while (filler.test(name)) name = name.replace(filler, '');
    return titleCase(name.trim());
  }

  function detectName(raw, lower, category, material) {
    const quoted = raw.match(/["“”']([^"“”']{2,60})["“”']/);
    if (quoted) return titleCase(quoted[1].trim());
    const rename = lower.match(/\b(?:rename|call it|name it)\s+(?:to\s+)?([a-z0-9][\w'’-]*(?:\s+[a-z0-9][\w'’-]*){0,4})/);
    if (rename) {
      const cleaned = cleanCapturedName(rename[1].replace(/\b(?:please|now|thanks)\b/g, ''));
      if (cleaned) return cleaned;
    }
    const called = lower.match(/\b(?:called|named)\s+([a-z0-9][\w'’-]*(?:\s+[a-z0-9][\w'’-]*){0,4})/);
    if (called) {
      const words = called[1].split(/\s+/).filter(function (word) {
        return ['for', 'at', 'with', 'in', 'price', 'cost', 'costs', 'under', 'cm', 'euro', 'euros'].indexOf(word) < 0;
      });
      if (words.length) return cleanCapturedName(words.join(' '));
    }
    const label = NAME_LABELS[category] || '';
    if (material && label) return titleCase(material + ' ' + label);
    if (label) return 'New ' + label;
    return 'New product';
  }

  function detectMaterial(lower) {
    for (let i = 0; i < MATERIAL_WORDS.length; i++) {
      if (new RegExp('\\b' + MATERIAL_WORDS[i] + '\\b').test(lower)) return titleCase(MATERIAL_WORDS[i]);
    }
    return '';
  }

  function draftSummary(draft) {
    if (!draft) return '';
    const p = draft.product;
    const bits = [
      '"' + p.name + '"',
      C.CATEGORIES[p.category] ? C.CATEGORIES[p.category].label.toLowerCase() : p.category,
      p.widthCm + ' × ' + p.lengthCm + ' × ' + p.heightCm + ' cm',
      '€' + Math.round(p.price)
    ];
    if (p.materials) bits.push(p.materials);
    const head = draft.mode === 'edit' ? 'Product changes ready for review' : 'New product ready for review';
    let text = head + ' — ' + bits.join(' · ') + '.';
    if (draft.filled && draft.filled.length) {
      text += ' I filled in ' + draft.filled.join(', ') + ' from the default ' + (C.CATEGORIES[p.category] || {}).label + ' size — tell me to change any of them.';
    }
    text += draft.mode === 'edit'
      ? ' Saving updates this browser\'s catalog only.'
      : ' Saving adds it to this browser\'s catalog; nothing is created until you confirm.';
    return text;
  }

  function draftActions(draft) {
    return [
      { id: 'ai-product-confirm', label: draft.mode === 'edit' ? 'Save changes' : 'Create product' },
      { id: 'ai-product-cancel', label: 'Discard draft' }
    ];
  }

  function buildDraft(ctx, text, mode, existing) {
    const lower = text.toLowerCase();
    const category = detectCategory(lower) || (existing ? existing.category : 'storage');
    const defaults = PRODUCT_DEFAULTS[category] || PRODUCT_DEFAULTS.storage;
    const dims = parseDimensions(lower);
    const price = parsePrice(lower);
    const material = detectMaterial(lower);
    const filled = [];
    if (!existing) {
      if (!dims.widthCm) { dims.widthCm = defaults.widthCm; filled.push('width'); }
      if (!dims.lengthCm) { dims.lengthCm = defaults.lengthCm; filled.push('length'); }
      if (!dims.heightCm) { dims.heightCm = defaults.heightCm; filled.push('height'); }
      if (price == null) { filled.push('price'); }
    }
    const base = existing ? U.deepClone(existing) : {
      id: '',
      name: '',
      category: category,
      price: defaults.price,
      widthCm: defaults.widthCm,
      lengthCm: defaults.lengthCm,
      heightCm: defaults.heightCm,
      description: '',
      brand: '',
      materials: '',
      availability: '',
      variants: [],
      assets: {},
      modelRotationDeg: 0
    };
    if (mode === 'create') {
      base.name = detectName(text, lower, category, material);
      base.category = category;
      if (dims.widthCm) base.widthCm = dims.widthCm;
      if (dims.lengthCm) base.lengthCm = dims.lengthCm;
      if (dims.heightCm) base.heightCm = dims.heightCm;
      if (price != null) base.price = price;
      if (material) base.materials = material;
    } else {
      if (dims.widthCm) base.widthCm = dims.widthCm;
      if (dims.lengthCm) base.lengthCm = dims.lengthCm;
      if (dims.heightCm) base.heightCm = dims.heightCm;
      if (price != null) base.price = price;
      if (material) base.materials = material;
      if (/\b(name|called|named|rename)\b/.test(lower)) base.name = detectName(text, lower, base.category, material) || base.name;
      if (category && dims && detectCategory(lower)) base.category = category;
    }
    return {
      mode: mode,
      id: existing ? existing.id : null,
      product: base,
      filled: filled.filter(function (value, index, list) { return list.indexOf(value) === index; })
    };
  }

  function updateDraftFromText(ctx, text) {
    const lower = text.toLowerCase();
    const draft = memory.draft;
    const dims = parseDimensions(lower);
    const price = parsePrice(lower);
    const material = detectMaterial(lower);
    const category = detectCategory(lower);
    const hasName = /\b(name|called|named|rename)\b/.test(lower) || /["“”']/.test(text);
    const changed = Object.keys(dims).length > 0 || price != null || material || category || hasName;
    if (!changed) return false;
    if (dims.widthCm) draft.product.widthCm = dims.widthCm;
    if (dims.lengthCm) draft.product.lengthCm = dims.lengthCm;
    if (dims.heightCm) draft.product.heightCm = dims.heightCm;
    if (price != null) draft.product.price = price;
    if (material) draft.product.materials = material;
    if (draft.mode === 'create' && category) draft.product.category = category;
    if (hasName) {
      const name = detectName(text, lower, draft.product.category, material);
      if (name) draft.product.name = name;
    }
    if (draft.mode === 'create') {
      draft.filled = draft.filled.filter(function (entry) {
        return !(entry === 'width' && dims.widthCm) && !(entry === 'length' && dims.lengthCm) &&
          !(entry === 'height' && dims.heightCm) && !(entry === 'price' && price != null);
      });
    }
    return true;
  }

  function findExistingProduct(ctx, text) {
    const words = countWords(text).filter(function (word) {
      return ['the', 'a', 'an', 'product', 'edit', 'update', 'change', 'modify', 'adjust', 'rename', 'set', 'price',
        'cost', 'costs', 'name', 'category', 'width', 'height', 'length', 'depth', 'cm', 'to', 'is', 'of', 'in',
        'catalog', 'new', 'make', 'and', 'for'].indexOf(word) < 0 && !/^\d+$/.test(word);
    });
    const custom = (ctx.products || []).filter(function (product) { return product.source === 'custom'; });
    return findProductByWords({ products: custom }, words) || findProductByWords(ctx, words);
  }

  function productIntent(text, lower, ctx) {
    const category = detectCategory(lower);
    const dims = parseDimensions(lower);
    const price = parsePrice(lower);
    const mentionsProduct = /\b(product|catalog item|catalog)\b/.test(lower);
    const creates = /\b(create|add|make|build|design)\b/.test(lower) || /\bnew\b/.test(lower);
    const edits = /\b(edit|update|change|modify|rename|reprice|adjust|set)\b/.test(lower);
    if (!creates && !edits) return null;
    if (mentionsProduct && edits) return 'edit';
    if (mentionsProduct && creates) return 'create';
    if (category && (Object.keys(dims).length === 3 || price != null)) {
      if (edits && !creates) return 'edit';
      if (creates && !edits) return 'create';
      /* Both kinds of verb present: an existing product being named means edit,
         anything else is a new product. */
      return findExistingProduct(ctx, text) ? 'edit' : 'create';
    }
    if (category && /\b(create|make|build|design)\b/.test(lower) && /\b(new|product)\b/.test(lower)) return 'create';
    return null;
  }

  function modelConfig() {
    try {
      const raw = localStorage.getItem(MODEL_KEY);
      const parsed = raw ? JSON.parse(raw) : null;
      return { url: parsed && typeof parsed.url === 'string' ? parsed.url : '', model: parsed && typeof parsed.model === 'string' ? parsed.model : '' };
    } catch (err) {
      return { url: '', model: '' };
    }
  }

  function setModelConfig(config) {
    const url = String((config && config.url) || '').trim();
    const model = String((config && config.model) || '').trim();
    if (url && !/^https?:\/\//i.test(url)) throw new Error('The endpoint must start with http:// or https://.');
    try {
      if (!url) localStorage.removeItem(MODEL_KEY);
      else localStorage.setItem(MODEL_KEY, JSON.stringify({ url: url, model: model }));
    } catch (err) {
      throw new Error('This browser blocked local storage, so the model endpoint could not be saved.');
    }
    return { url: url, model: model };
  }

  function hasModel() {
    return !!modelConfig().url;
  }

  async function modelInterpret(text, ctx) {
    const config = modelConfig();
    if (!config.url) throw new Error('No model endpoint is connected.');
    const design = ctx.design;
    const room = design && design.room;
    const custom = (ctx.products || []).filter(function (p) { return p.source === 'custom'; }).slice(0, 40)
      .map(function (p) { return p.id + ' = ' + p.name + ' (' + p.category + ', ' + p.widthCm + '×' + p.lengthCm + '×' + p.heightCm + ' cm)'; });
    const categories = Object.keys(C.CATEGORIES).map(function (key) { return key + ' (' + C.CATEGORIES[key].label + ')'; }).join(', ');
    const system = [
      'You are the FormaRoom catalog assistant inside a browser-based furniture planner.',
      'You may only propose creating or editing a catalog product. You cannot move, delete, price or place anything yourself.',
      'Reply with one JSON object and nothing else.',
      'For a product request return: {"reply":"short sentence","product":{"mode":"create" or "edit","id":"existing id for edit","name":"...","category":"...","price":number,"widthCm":number,"lengthCm":number,"heightCm":number,"materials":"..."}}.',
      'For anything else return {"reply":"short honest answer"}; do not claim an action was performed.',
      'Categories: ' + categories + '.',
      'Current room: ' + (room ? (room.widthCm + '×' + room.lengthCm + '×' + room.heightCm + ' cm, ' + (design.placedItems || []).length + ' placed items') : 'none') + '.',
      'Custom products: ' + (custom.length ? custom.join('; ') : 'none') + '.'
    ].join('\n');
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, 20000) : null;
    let response;
    try {
      response = await fetch(config.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: config.model || undefined,
          messages: [{ role: 'system', content: system }, { role: 'user', content: text }]
        }),
        signal: controller ? controller.signal : undefined
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) throw new Error('The model endpoint answered with HTTP ' + response.status + '.');
    const data = await response.json();
    let payload = data;
    if (data && data.choices && data.choices[0]) {
      payload = data.choices[0].message ? data.choices[0].message.content : data.choices[0].text;
      if (typeof payload === 'string') {
        try { payload = JSON.parse(payload); } catch (err) { payload = { reply: payload }; }
      }
    }
    if (!payload || typeof payload !== 'object') throw new Error('The model returned an unreadable answer.');
    const reply = typeof payload.reply === 'string' ? payload.reply.trim() : '';
    if (payload.product && typeof payload.product === 'object') {
      const proposed = payload.product;
      const isEdit = proposed.mode === 'edit' || (!proposed.mode && proposed.id);
      if (isEdit) {
        const existing = App.Catalog.getProduct(String(proposed.id || ''));
        if (!existing) throw new Error('The model asked to edit a product that is not in the catalog.');
        const draft = buildDraft(ctx, text, 'edit', existing);
        Object.keys(PRODUCT_DEFAULTS[existing.category] || {}).forEach(function (key) {
          if (U.isFiniteNumber(proposed[key])) draft.product[key] = proposed[key];
        });
        if (U.isFiniteNumber(proposed.price)) draft.product.price = proposed.price;
        if (typeof proposed.name === 'string' && proposed.name.trim()) draft.product.name = proposed.name.trim();
        if (typeof proposed.materials === 'string') draft.product.materials = proposed.materials;
        memory.draft = draft;
        return { reply: draftSummary(draft), actions: draftActions(draft) };
      }
      const draft = buildDraft(ctx, text, 'create');
      if (typeof proposed.name === 'string' && proposed.name.trim()) draft.product.name = proposed.name.trim();
      ['widthCm', 'lengthCm', 'heightCm'].forEach(function (key) {
        if (U.isFiniteNumber(proposed[key]) && proposed[key] > 0) draft.product[key] = proposed[key];
      });
      if (U.isFiniteNumber(proposed.price) && proposed.price >= 0) draft.product.price = proposed.price;
      if (proposed.category && C.CATEGORIES[proposed.category]) draft.product.category = proposed.category;
      if (typeof proposed.materials === 'string') draft.product.materials = proposed.materials;
      const supplied = [];
      if (U.isFiniteNumber(proposed.widthCm) && proposed.widthCm > 0) supplied.push('width');
      if (U.isFiniteNumber(proposed.lengthCm) && proposed.lengthCm > 0) supplied.push('length');
      if (U.isFiniteNumber(proposed.heightCm) && proposed.heightCm > 0) supplied.push('height');
      if (U.isFiniteNumber(proposed.price) && proposed.price >= 0) supplied.push('price');
      draft.filled = draft.filled.filter(function (entry) { return supplied.indexOf(entry) < 0; });
      const preview = Object.assign({}, draft.product, { id: draft.product.id || 'DRAFT-PREVIEW' });
      const validation = App.Catalog.validateProductData(preview);
      if (validation.errors.length) throw new Error('The model proposed a product that failed validation: ' + validation.errors[0]);
      memory.draft = draft;
      return { reply: draftSummary(draft), actions: draftActions(draft) };
    }
    if (!reply) throw new Error('The model returned an empty answer.');
    return { reply: reply, actions: [] };
  }

  async function confirmDraft(ctx) {
    const draft = memory.draft;
    if (!draft) return { ok: false, message: 'There is no product draft waiting. Describe the product you want and I will prepare one.' };
    const product = U.deepClone(draft.product);
    const isNew = draft.mode === 'create';
    try {
      if (isNew) {
        product.id = App.Catalog.nextCustomId();
        product.source = 'custom';
        product.demo = false;
        product.description = product.description || 'Created with the design assistant.';
      }
      const result = await App.Catalog.upsertProduct(product, { isNew: isNew, allowSeedOverride: !isNew });
      if (!result || !result.product) throw new Error('The catalog did not return the saved product.');
      memory.draft = null;
      if (typeof App.onCatalogChange === 'function') App.onCatalogChange('assistant');
      const saved = result.product;
      const actions = isNew ? [{ id: 'ai-product-place|' + saved.id, label: 'Add to room' }] : [];
      return {
        ok: true,
        message: (isNew ? 'Created "' : 'Saved "') + saved.name + '" (' + saved.id + ') in the catalog at ' +
          U.formatMoney(saved.price) + ', ' + saved.widthCm + ' × ' + saved.lengthCm + ' × ' + saved.heightCm + ' cm.' +
          (saved.source === 'demo' ? ' This is a local override; the demo catalog itself is unchanged.' : '') +
          (isNew ? ' It has no 3D file yet, so it shows as a named black block until you attach a GLB.' : ''),
        actions: actions
      };
    } catch (err) {
      return {
        ok: false,
        message: 'I could not save that product: ' + (err && err.message ? err.message : 'unknown error') + '. The draft is still open so you can adjust it.'
      };
    }
  }

  function takeSnapshot(ctx) {
    const design = ctx.design;
    if (!design) return;
    memory.snapshot = {
      placedItems: U.deepClone(design.placedItems),
      structuralItems: U.deepClone(design.structuralItems),
      floor: U.deepClone(design.floor),
      wallColor: design.wallColor,
      budget: design.budget
    };
    memory.snapshotDesignId = design.id;
  }

  function performUndo(ctx) {
    if (!memory.snapshot || memory.snapshotDesignId !== ctx.design.id) {
      return { ok: false, message: 'There is nothing for me to undo in this design yet.' };
    }
    ctx.state.replacePlacedItems(U.deepClone(memory.snapshot.placedItems), { addedVia: 'manual', reason: 'assistant-undo' });
    ctx.state.replaceStructuralItems(U.deepClone(memory.snapshot.structuralItems), { reason: 'assistant-undo' });
    ctx.state.setFloor(U.deepClone(memory.snapshot.floor));
    ctx.state.setWallColor(memory.snapshot.wallColor);
    ctx.state.setBudget(memory.snapshot.budget);
    memory.snapshot = null;
    memory.lastMove = null;
    return { ok: true, message: 'Done — I restored the design exactly as it was before my last change.' };
  }

  function findProductByWords(ctx, words) {
    const products = ctx.products || [];
    const scored = products.map(function (product) {
      const name = String(product.name || '').toLowerCase();
      let score = 0;
      words.forEach(function (word) {
        if (word && name.indexOf(word) >= 0) score += word.length;
      });
      return { product: product, score: score };
    }).filter(function (entry) { return entry.score > 0; });
    if (!scored.length) return null;
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored[0].product;
  }

  function countWords(text) {
    return String(text || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  }

  function roomCenter(ctx) {
    return App.Geometry.roomCenter(ctx.design.room);
  }

  function placedInstances(ctx, productId) {
    return ctx.design.placedItems.filter(function (item) { return item.productId === productId; });
  }

  function moveItemToWall(ctx, product) {
    const G = App.Geometry;
    const design = ctx.design;
    if (G.isCircle(design.room)) {
      return { ok: false, message: 'Circular rooms have no straight walls to push things against.' };
    }
    const instances = placedInstances(ctx, product.id);
    if (!instances.length) return { ok: false, message: 'There is no ' + product.name + ' in this design yet.' };
    const walls = G.getWalls(design.room);
    const center = roomCenter(ctx);
    let moved = 0;
    let lastError = null;
    instances.forEach(function (item) {
      const relX = item.xCm - center.x;
      const relZ = item.zCm - center.z;
      let bestWall = walls[0];
      let bestDist = Infinity;
      walls.forEach(function (wall) {
        const d = Math.abs((relX - wall.start.x) * wall.outward.x + (relZ - wall.start.z) * wall.outward.z);
        if (d < bestDist) { bestDist = d; bestWall = wall; }
      });
      const along = (relX - bestWall.start.x) * bestWall.dir.x + (relZ - bestWall.start.z) * bestWall.dir.z;
      const half = (product.category === 'rug' ? 0 : 2);
      const depth = Math.min(product.widthCm, product.lengthCm);
      const clearance = depth / 2 + half + C.WALL_THICKNESS_CM / 2;
      const alongClamped = U.clamp(along, Math.max(product.widthCm, product.lengthCm) / 2 + 4, bestWall.lengthCm - Math.max(product.widthCm, product.lengthCm) / 2 - 4);
      const p = G.wallPoint(bestWall, alongClamped);
      let nx = p.x + bestWall.inward.x * clearance;
      let nz = p.z + bestWall.inward.z * clearance;
      const rotationDeg = Math.atan2(bestWall.inward.x, bestWall.inward.z) * 180 / Math.PI;
      const spot = G.nearestFreePlacement(design, product, ctx.productsById, nx, nz, rotationDeg);
      if (spot) { nx = spot.xCm; nz = spot.zCm; }
      const result = ctx.state.updatePlaced(item.id, { xCm: U.round(nx + center.x, 2), zCm: U.round(nz + center.z, 2), rotationDeg: U.normalizeDeg(rotationDeg) });
      if (result.ok) {
        moved++;
        memory.lastMove = { itemId: item.id, dx: nx + center.x - item.xCm, dz: nz + center.z - item.zCm };
      } else {
        lastError = result.error;
      }
    });
    if (moved) return { ok: true, message: 'Moved the ' + product.name + ' against the nearest wall and faced it into the room.' };
    return { ok: false, message: lastError || 'I could not move the ' + product.name + ' there — something blocks the way.' };
  }

  function moveItemFromWall(ctx, product, distanceCm) {
    const G = App.Geometry;
    const design = ctx.design;
    if (G.isCircle(design.room)) {
      return { ok: false, message: 'In a circular room I can only nudge things toward the middle.' };
    }
    const instances = placedInstances(ctx, product.id);
    if (!instances.length) return { ok: false, message: 'There is no ' + product.name + ' in this design yet.' };
    const walls = G.getWalls(design.room);
    const center = roomCenter(ctx);
    const step = distanceCm || 40;
    let moved = 0;
    let lastError = null;
    instances.forEach(function (item) {
      const relX = item.xCm - center.x;
      const relZ = item.zCm - center.z;
      let bestWall = walls[0];
      let bestDist = Infinity;
      walls.forEach(function (wall) {
        const d = Math.abs((relX - wall.start.x) * wall.outward.x + (relZ - wall.start.z) * wall.outward.z);
        if (d < bestDist) { bestDist = d; bestWall = wall; }
      });
      const nx = relX + bestWall.inward.x * step;
      const nz = relZ + bestWall.inward.z * step;
      const spot = G.nearestFreePlacement(design, product, ctx.productsById, nx, nz, item.rotationDeg);
      const fx = spot ? spot.xCm : nx;
      const fz = spot ? spot.zCm : nz;
      const result = ctx.state.updatePlaced(item.id, { xCm: U.round(fx + center.x, 2), zCm: U.round(fz + center.z, 2) });
      if (result.ok) {
        moved++;
        memory.lastMove = { itemId: item.id, dx: fx + center.x - item.xCm, dz: fz + center.z - item.zCm };
      } else {
        lastError = result.error;
      }
    });
    if (moved) return { ok: true, message: 'Moved the ' + product.name + ' about ' + step + ' cm away from the wall.' };
    return { ok: false, message: lastError || 'There is not enough free space to move the ' + product.name + ' farther out.' };
  }

  function nudgeLastMove(ctx) {
    if (!memory.lastMove || !memory.lastMove.itemId) {
      return { ok: false, message: 'I have not moved anything yet, so there is nothing to push a little farther.' };
    }
    const item = ctx.design.placedItems.find(function (p) { return p.id === memory.lastMove.itemId; });
    if (!item) return { ok: false, message: 'The item I moved before is no longer in the design.' };
    const G = App.Geometry;
    const product = ctx.productsById[item.productId];
    const dx = memory.lastMove.dx || 0;
    const dz = memory.lastMove.dz || 0;
    const len = Math.hypot(dx, dz) || 1;
    const step = 30;
    const nx = item.xCm + (dx / len) * step;
    const nz = item.zCm + (dz / len) * step;
    const spot = product ? G.nearestFreePlacement(ctx.design, product, ctx.productsById, nx, nz, item.rotationDeg) : null;
    const result = ctx.state.updatePlaced(item.id, { xCm: U.round(spot ? spot.xCm : nx, 2), zCm: U.round(spot ? spot.zCm : nz, 2) });
    if (!result.ok) return { ok: false, message: result.error };
    memory.lastMove = { itemId: item.id, dx: dx, dz: dz };
    return { ok: true, message: 'Moved it another ' + step + ' cm in the same direction.' };
  }

  function addProduct(ctx, product, quantity) {
    const G = App.Geometry;
    const count = Math.max(1, Math.min(quantity || 1, 8));
    const added = [];
    for (let i = 0; i < count; i++) {
      const spot = G.findFreeSpot(ctx.design, product, ctx.productsById, {});
      if (!spot) break;
      /* findFreeSpot returns design coordinates, so they can go straight to the
         state; adding the room centre again used to push items off the room. */
      const result = ctx.state.addPlaced(product.id, spot.xCm, spot.zCm, spot.rotationDeg || 0, null, 'manual');
      if (!result.ok) break;
      added.push(result.item);
    }
    if (!added.length) {
      return { ok: false, message: 'I could not fit a ' + product.name + ' anywhere — the room may be too full or the footprint too large.' };
    }
    return { ok: true, message: 'Added ' + added.length + ' × ' + product.name + '.' + (added.length < count ? ' Only ' + added.length + ' fit.' : '') };
  }

  function removeProduct(ctx, product) {
    const instances = placedInstances(ctx, product.id);
    if (!instances.length) return { ok: false, message: 'There is no ' + product.name + ' in this design.' };
    const item = instances[instances.length - 1];
    const result = ctx.state.removePlaced(item.id);
    if (!result.ok) return { ok: false, message: result.error };
    return { ok: true, message: 'Removed one ' + product.name + ' (' + (instances.length - 1) + ' left).' };
  }

  function applyTemplate(ctx, templateId) {
    const design = ctx.design;
    if (!design.placedItems.length) {
      return { ok: false, message: 'There is no furniture to rearrange yet — add products first, then ask me to re-space them.' };
    }
    const selections = [];
    design.placedItems.forEach(function (item) {
      const existing = selections.find(function (entry) { return entry.productId === item.productId; });
      if (existing) existing.quantity++;
      else selections.push({ productId: item.productId, quantity: 1 });
    });
    const result = App.AI.generateLayout({
      design: design,
      productsById: ctx.productsById,
      selections: selections,
      template: templateId
    });
    if (!result.ok) return { ok: false, message: result.errors[0] || 'The layout engine could not rearrange the room.' };
    if (!result.items.length) return { ok: false, message: 'Nothing could be placed with that style. The design is unchanged.' };
    /* The layout engine already works in design coordinates. */
    const items = result.items.map(function (item) {
      return {
        productId: item.productId,
        xCm: item.xCm,
        zCm: item.zCm,
        rotationDeg: item.rotationDeg,
        variantId: item.variantId || null
      };
    });
    const replaced = ctx.state.replacePlacedItems(items, { addedVia: 'ai', reason: 'assistant-layout' });
    if (!replaced.ok) return { ok: false, message: replaced.error };
    const label = (C.TEMPLATES[templateId] || {}).label || templateId;
    let message = 'Re-spaced the room using the "' + label + '" style: ' + items.length + ' items placed with clear walkways.';
    if (result.unplaced && result.unplaced.length) {
      message += ' Could not place: ' + result.unplaced.map(function (u) { return u.name; }).join(', ') + '.';
    }
    return { ok: true, message: message };
  }

  function resizeOpening(ctx, type, dimension, delta) {
    const item = ctx.design.structuralItems.find(function (entry) { return entry.type === type; });
    if (!item) {
      return { ok: false, message: 'There is no ' + type + ' in this design yet. Add one with the plan tools first.' };
    }
    const spec = type === 'window' ? C.STRUCTURAL.WINDOW : C.STRUCTURAL.DOOR;
    const patch = {};
    if (dimension === 'widthCm') {
      patch.widthCm = U.clamp(item.widthCm + delta, spec.minWidthCm, spec.maxWidthCm);
    } else {
      patch.heightCm = U.clamp(item.heightCm + delta, spec.minHeightCm, spec.maxHeightCm);
    }
    const result = ctx.state.updateStructural(item.id, patch);
    if (!result.ok) return { ok: false, message: result.error };
    const dimLabel = dimension === 'widthCm' ? 'width' : 'height';
    return { ok: true, message: 'The ' + type + ' is now ' + Math.round(patch[dimension]) + ' cm in ' + dimLabel + '.' };
  }

  function setFloorColor(ctx, hex) {
    const result = ctx.state.setFloor({ mode: 'color', color: hex });
    if (!result.ok) return { ok: false, message: result.error };
    return { ok: true, message: 'Floor changed to ' + hex + '. It is a solid colour now — say "undo" to put the previous floor back.' };
  }

  function setWallColor(ctx, hex) {
    const result = ctx.state.setWallColor(hex);
    if (!result.ok) return { ok: false, message: result.error };
    return { ok: true, message: 'Walls repainted. The new colour is stored with this design.' };
  }

  function addCheapestLamp(ctx) {
    const lamps = ctx.products.filter(function (p) { return p.category === 'lighting'; })
      .sort(function (a, b) {
        const pa = U.isFiniteNumber(a.price) ? a.price : Infinity;
        const pb = U.isFiniteNumber(b.price) ? b.price : Infinity;
        return pa - pb;
      });
    if (!lamps.length) return { ok: false, message: 'The catalog has no lighting products to add.' };
    const outcome = addProduct(ctx, lamps[0], 1);
    if (!outcome.ok) return outcome;
    return { ok: true, message: outcome.message + ' Lamps are placed free-standing — drag it next to the sofa or desk.' };
  }

  function reduceToBudget(ctx, amount) {
    const budgetResult = ctx.state.setBudget(amount);
    if (!budgetResult.ok) return { ok: false, message: budgetResult.error };
    return { ok: true, message: 'Budget set to ' + U.formatMoney(amount) + '. Open the Budget tab to see live totals; ask me to remove specific items if you are over.' };
  }

  function interpret(text, ctx) {
    const design = ctx.design;
    if (!design) {
      return { reply: 'Create a room first, then I can style it and move furniture around.', actions: [] };
    }
    const raw = String(text || '').trim();
    const lower = raw.toLowerCase();
    const words = countWords(raw);

    /* A pending product draft owns follow-up messages: attribute changes update
       it, a plain yes confirms it, and cancel throws it away. */
    if (memory.draft) {
      if (/^(cancel|discard|forget it|never mind|drop it|no)\b/.test(lower)) {
        memory.draft = null;
        return { reply: 'Discarded the product draft. Nothing was added to the catalog.', actions: [] };
      }
      if (/^(yes|confirm|save|create it|add it|do it|go ahead|looks good|ok|okay)\b/.test(lower)) {
        return { confirmDraft: true, reply: '', actions: [] };
      }
      if (/\b(show|review|summary|what)\b/.test(lower) && /\b(draft|product)\b/.test(lower)) {
        return { reply: draftSummary(memory.draft), actions: draftActions(memory.draft) };
      }
      if (updateDraftFromText(ctx, raw)) {
        return { reply: draftSummary(memory.draft), actions: draftActions(memory.draft) };
      }
    }

    const intent = productIntent(raw, lower, ctx);
    if (intent === 'create') {
      const draft = buildDraft(ctx, raw, 'create');
      memory.draft = draft;
      return { reply: draftSummary(draft), actions: draftActions(draft) };
    }
    if (intent === 'edit') {
      const existing = findExistingProduct(ctx, raw);
      if (!existing) {
        return {
          reply: 'Which product should I edit? Name it exactly as it appears in the catalog — for example "edit the QA storage cabinet price to 500".',
          actions: []
        };
      }
      const draft = buildDraft(ctx, raw, 'edit', existing);
      memory.draft = draft;
      return { reply: draftSummary(draft), actions: draftActions(draft) };
    }

    if (/^(undo|put (it|that|them) back|revert|go back|restore)/.test(lower)) {
      const outcome = performUndo(ctx);
      return { reply: outcome.message, actions: [] };
    }

    const nudgeIntent = /\b(farther|further|a bit more|a little more|again|push it)\b/.test(lower) ||
      /^(more|more please|a little|again please|keep going)[.!]?$/.test(lower);
    if (nudgeIntent && memory.lastMove) {
      takeSnapshot(ctx);
      const outcome = nudgeLastMove(ctx);
      if (outcome.ok) {
        return { reply: outcome.message, actions: [{ id: 'nudge-last', label: 'A little farther' }, { id: 'undo', label: 'Put it back' }] };
      }
      return { reply: outcome.message, actions: [] };
    }

    if (/\b(window|windows)\b/.test(lower) && /\b(wider|bigger|larger|taller|narrower|smaller|increase|decrease|resize)\b/.test(lower)) {
      const grow = /\b(wider|bigger|larger|taller|increase)\b/.test(lower);
      const taller = /\b(taller|height)\b/.test(lower) && !/\b(wider|width)\b/.test(lower);
      takeSnapshot(ctx);
      const outcome = resizeOpening(ctx, 'window', taller ? 'heightCm' : 'widthCm', grow ? 20 : -20);
      if (outcome.ok) {
        return { reply: outcome.message, actions: [
          { id: 'resize-opening|window|' + (taller ? 'heightCm' : 'widthCm') + '|' + (grow ? 20 : -20), label: grow ? '20 cm more' : '20 cm less' },
          { id: 'undo', label: 'Undo' }
        ] };
      }
      return { reply: outcome.message, actions: [] };
    }

    if (/\b(door|doors)\b/.test(lower) && /\b(wider|bigger|larger|taller|narrower|smaller|increase|decrease|resize)\b/.test(lower)) {
      const grow = /\b(wider|bigger|larger|taller|increase)\b/.test(lower);
      const taller = /\b(taller|height)\b/.test(lower) && !/\b(wider|width)\b/.test(lower);
      takeSnapshot(ctx);
      const outcome = resizeOpening(ctx, 'door', taller ? 'heightCm' : 'widthCm', grow ? 10 : -10);
      if (outcome.ok) {
        return { reply: outcome.message, actions: [
          { id: 'resize-opening|door|' + (taller ? 'heightCm' : 'widthCm') + '|' + (grow ? 10 : -10), label: grow ? '10 cm more' : '10 cm less' },
          { id: 'undo', label: 'Undo' }
        ] };
      }
      return { reply: outcome.message, actions: [] };
    }

    if (/\b(budget|afford|spend|cost|under|cheaper)\b/.test(lower)) {
      const amount = parseBudget(lower);
      if (amount) {
        takeSnapshot(ctx);
        const outcome = reduceToBudget(ctx, amount);
        return { reply: outcome.message, actions: [{ id: 'undo', label: 'Undo' }] };
      }
      const summary = App.Pricing ? App.Pricing.summarize(design, ctx.productsById) : null;
      return {
        reply: summary
          ? 'The current design totals ' + U.formatMoney(summary.total) + ' for ' + summary.quantity + ' items. Tell me a number — for example "keep it under 2000" — and I will set the budget.'
          : 'Tell me a number — for example "keep it under 2000" — and I will set the budget.',
        actions: []
      };
    }

    if (/\b(bright|lighter|airy|light|gloomy|dark)\b/.test(lower)) {
      const lightWall = C.WALL_COLORS.find(function (entry) { return entry.id === 'warm-white'; }) || C.WALL_COLORS[0];
      return {
        reply: 'Two reliable ways to brighten the room: lighter walls, and an extra lamp near where you sit. Which would you like?',
        actions: [
          { id: 'wall-color|' + lightWall.value, label: 'Walls: ' + lightWall.label },
          { id: 'add-lamp', label: 'Add a lamp' },
          { id: 'wall-color|' + lightWall.value + ';add-lamp', label: 'Both' }
        ]
      };
    }

    if (/\b(spacious|space|roomier|declutter|less crowded|open up|cramped)\b/.test(lower)) {
      if (!design.placedItems.length) {
        return { reply: 'The room is still empty, so there is nothing to re-space. Add furniture first — or ask me to make the floor wooden or the walls brighter.', actions: [] };
      }
      return {
        reply: 'I can re-space what you have. The space-saving style tightens groupings and keeps door swings clear; wall-focused pushes big pieces to the walls; or I can remove one item.',
        actions: [
          { id: 'layout-template|space', label: 'Space-saving layout' },
          { id: 'layout-template|wall', label: 'Push to walls' },
          { id: 'remove-smallest', label: 'Remove one item' }
        ]
      };
    }

    if (/\b(away from|further from|farther from|out from)\b/.test(lower)) {
      const product = findProductByWords(ctx, words.filter(function (w) { return ['the', 'a', 'an', 'move', 'away', 'from', 'further', 'farther', 'out', 'it', 'this', 'that', 'little', 'bit', 'more'].indexOf(w) < 0; }));
      const target = product || (memory.lastMove ? ctx.productsById[(ctx.design.placedItems.find(function (p) { return p.id === memory.lastMove.itemId; }) || {}).productId] : null);
      if (!target) {
        return { reply: 'Which piece should move out from the wall? Name it — for example "move the sofa away from the wall".', actions: [] };
      }
      takeSnapshot(ctx);
      const outcome = moveItemFromWall(ctx, target, /\b(lot|much|meter|metre)\b/.test(lower) ? 80 : 40);
      if (outcome.ok) {
        return { reply: outcome.message, actions: [{ id: 'move-away|' + target.id + '|40', label: 'A little farther' }, { id: 'undo', label: 'Put it back' }] };
      }
      return { reply: outcome.message, actions: [] };
    }

    if (/\b(against|to) the wall\b/.test(lower) || (/\bmove\b/.test(lower) && /\b(wall|corner)\b/.test(lower))) {
      const product = findProductByWords(ctx, words.filter(function (w) { return ['the', 'a', 'an', 'move', 'to', 'against', 'wall', 'corner', 'push', 'put', 'place', 'it', 'this', 'that'].indexOf(w) < 0; }));
      if (!product) {
        return { reply: 'Which piece should go to the wall? Name it — for example "move the sofa against the wall".', actions: [] };
      }
      takeSnapshot(ctx);
      const outcome = moveItemToWall(ctx, product);
      if (outcome.ok) {
        return { reply: outcome.message, actions: [{ id: 'move-away|' + product.id + '|30', label: 'Pull it out a bit' }, { id: 'undo', label: 'Put it back' }] };
      }
      return { reply: outcome.message, actions: [] };
    }

    if (/\b(remove|delete|get rid of|take out|drop)\b/.test(lower)) {
      const product = findProductByWords(ctx, words.filter(function (w) { return ['the', 'a', 'an', 'remove', 'delete', 'get', 'rid', 'of', 'take', 'out', 'drop', 'it', 'this', 'that', 'one'].indexOf(w) < 0; }));
      if (!product) return { reply: 'Which product should I remove? Name it — for example "remove the armchair".', actions: [] };
      takeSnapshot(ctx);
      const outcome = removeProduct(ctx, product);
      return { reply: outcome.message, actions: outcome.ok ? [{ id: 'undo', label: 'Put it back' }] : [] };
    }

    if (/\b(add|place|put|bring)\b/.test(lower)) {
      let quantity = 1;
      const qtyMatch = lower.match(/\b(\d+|one|two|three|four|five|six|a|an)\b/);
      if (qtyMatch) {
        const wordNumbers = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, a: 1, an: 1 };
        quantity = /^\d+$/.test(qtyMatch[1]) ? parseInt(qtyMatch[1], 10) : (wordNumbers[qtyMatch[1]] || 1);
      }
      const product = findProductByWords(ctx, words.filter(function (w) { return ['the', 'a', 'an', 'add', 'place', 'put', 'bring', 'more', 'another', 'some', 'in', 'to', 'room', 'it'].indexOf(w) < 0 || /^\d+$/.test(w); }));
      if (!product) {
        const chairs = ctx.products.filter(function (p) { return p.category === 'chair'; }).sort(function (a, b) { return a.price - b.price; });
        if (/\b(chair|seats?|stools?)\b/.test(lower) && chairs.length) {
          takeSnapshot(ctx);
          const outcome = addProduct(ctx, chairs[0], quantity);
          return { reply: outcome.message, actions: outcome.ok ? [{ id: 'undo', label: 'Undo' }] : [] };
        }
        return { reply: 'Which product should I add? Name it — for example "add two chairs" or "add the pebble armchair".', actions: [] };
      }
      takeSnapshot(ctx);
      const outcome = addProduct(ctx, product, quantity);
      return { reply: outcome.message, actions: outcome.ok ? [{ id: 'undo', label: 'Undo' }] : [] };
    }

    if (/\b(floor|ground)\b/.test(lower) && /\b(wood|wooden|oak|timber|parquet|walnut|brown)\b/.test(lower)) {
      return {
        reply: 'A wooden floor suits this room. I can apply a solid oak or walnut tone straight away. For a real wood image texture, open Room → Floor and upload a PNG — texture mode tiles it at the scale you choose.',
        actions: [
          { id: 'floor-color|#c3a276', label: 'Oak floor' },
          { id: 'floor-color|#7a5a3e', label: 'Walnut floor' },
          { id: 'floor-color|#3c332b', label: 'Dark ebony' }
        ]
      };
    }

    if (/\b(floor|ground)\b/.test(lower) && /\b(grey|gray|white|black|dark|concrete|tile)\b/.test(lower)) {
      const pick = /\bblack|dark\b/.test(lower) ? '#57534c' : /\bwhite\b/.test(lower) ? '#f5f4f0' : '#cfcdc7';
      return {
        reply: 'I can switch the floor to that tone as a solid colour, or you can upload a real tile or concrete texture from Room → Floor.',
        actions: [
          { id: 'floor-color|' + pick, label: 'Apply ' + (pick === '#57534c' ? 'charcoal' : pick === '#f5f4f0' ? 'white' : 'light grey') },
          { id: 'undo', label: 'Undo' }
        ]
      };
    }

    if (/\bwall(s)?\b/.test(lower) && /\b(paint|color|colour|white|grey|gray|beige|green|blue|dark)\b/.test(lower)) {
      const pick = /\bwhite\b/.test(lower) ? '#f2f0ea' : /\bgrey|gray\b/.test(lower) ? '#d3d1ca' : /\bbeige|oat\b/.test(lower) ? '#e6dbc8' : /\bgreen|sage\b/.test(lower) ? '#ccd8c8' : /\bblue|mist\b/.test(lower) ? '#d4dde0' : /\bclay|terracotta\b/.test(lower) ? '#d9c0ad' : null;
      if (pick) {
        takeSnapshot(ctx);
        const outcome = setWallColor(ctx, pick);
        return { reply: outcome.message, actions: [{ id: 'undo', label: 'Undo' }] };
      }
    }

    if (/\b(hi|hello|hey|help)\b/.test(lower)) {
      return {
        reply: 'Hello! I am the design assistant. I can create or edit catalog products, restyle the floor and walls, move furniture to or away from walls, add or remove placed items, resize doors and windows, re-space the room, set budgets and undo. Product drafts always wait for your confirmation before saving.',
        actions: [
          { id: 'floor-color|#c3a276', label: 'Wooden floor' },
          { id: 'layout-template|space', label: 'More spacious' },
          { id: 'add-lamp', label: 'Brighter' }
        ]
      };
    }

    return {
      unmatched: true,
      reply: 'I did not find a matching action for that. Try "create a 140 × 70 × 75 cm oak desk for €450", "edit the QA storage cabinet price to 500", "make the floor wooden", "make it more spacious", "move the sofa against the wall", "add two chairs", "make the window wider", or "keep it under 2000".',
      actions: [
        { id: 'floor-color|#c3a276', label: 'Wooden floor' },
        { id: 'layout-template|space', label: 'More spacious' },
        { id: 'add-lamp', label: 'Brighter' }
      ]
    };
  }

  function execute(actionId, ctx) {
    if (actionId === 'ai-product-confirm') return confirmDraft(ctx);
    if (actionId === 'ai-product-cancel') {
      const had = !!memory.draft;
      memory.draft = null;
      return { ok: had, message: had ? 'Discarded the product draft. Nothing was saved.' : 'There is no product draft to discard.' };
    }
    if (actionId.indexOf('ai-product-place|') === 0) {
      const id = actionId.slice('ai-product-place|'.length);
      const product = App.Catalog.getProduct(id);
      if (!product) return { ok: false, message: 'That product is no longer in the catalog.' };
      if (!ctx.design) return { ok: false, message: 'Create a room first, then I can place the product.' };
      const G = App.Geometry;
      const spot = G.findFreeSpot(ctx.design, product, ctx.productsById, {});
      if (!spot) return { ok: false, message: 'There is no clear floor space for "' + product.name + '" at its real size. Move something or enlarge the room.' };
      const variant = App.Catalog.defaultVariantId(product);
      takeSnapshot(ctx);
      const result = ctx.state.addPlaced(product.id, spot.xCm, spot.zCm, spot.rotationDeg || 0, variant, 'manual');
      if (!result.ok) return { ok: false, message: result.error };
      return { ok: true, message: 'Placed "' + product.name + '" in the room. Drag it to fine-tune the position.', actions: [{ id: 'undo', label: 'Undo' }] };
    }
    if (!ctx.design) return { ok: false, message: 'Create a room first.' };
    if (actionId === 'undo') return performUndo(ctx);
    if (actionId === 'nudge-last') {
      takeSnapshot(ctx);
      return nudgeLastMove(ctx);
    }
    if (actionId === 'add-lamp') {
      takeSnapshot(ctx);
      return addCheapestLamp(ctx);
    }
    if (actionId === 'remove-smallest') {
      const items = ctx.design.placedItems.filter(function (item) {
        const product = ctx.productsById[item.productId];
        return product && product.category !== 'rug';
      });
      if (!items.length) return { ok: false, message: 'There is no furniture to remove.' };
      takeSnapshot(ctx);
      const item = items[items.length - 1];
      const product = ctx.productsById[item.productId];
      const result = ctx.state.removePlaced(item.id);
      return result.ok
        ? { ok: true, message: 'Removed one ' + (product ? product.name : 'item') + ' to open up the room.' }
        : { ok: false, message: result.error };
    }
    if (actionId.indexOf('floor-color|') === 0) {
      takeSnapshot(ctx);
      return setFloorColor(ctx, actionId.slice('floor-color|'.length));
    }
    if (actionId.indexOf('wall-color|') === 0) {
      const payload = actionId.slice('wall-color|'.length);
      takeSnapshot(ctx);
      if (payload.indexOf(';add-lamp') >= 0) {
        const colorOutcome = setWallColor(ctx, payload.split(';')[0]);
        if (!colorOutcome.ok) return colorOutcome;
        const lampOutcome = addCheapestLamp(ctx);
        return { ok: true, message: colorOutcome.message + ' ' + (lampOutcome.ok ? lampOutcome.message : '') };
      }
      return setWallColor(ctx, payload);
    }
    if (actionId.indexOf('layout-template|') === 0) {
      takeSnapshot(ctx);
      return applyTemplate(ctx, actionId.slice('layout-template|'.length));
    }
    if (actionId.indexOf('move-away|') === 0) {
      const parts = actionId.split('|');
      const product = ctx.productsById[parts[1]];
      if (!product) return { ok: false, message: 'That product is not in the catalog anymore.' };
      takeSnapshot(ctx);
      return moveItemFromWall(ctx, product, Number(parts[2]) || 40);
    }
    if (actionId.indexOf('resize-opening|') === 0) {
      const parts = actionId.split('|');
      takeSnapshot(ctx);
      const outcome = resizeOpening(ctx, parts[1], parts[2], Number(parts[3]) || 20);
      if (outcome.ok) {
        return {
          ok: true,
          message: outcome.message,
          actions: [{ id: actionId, label: 'More' }, { id: 'undo', label: 'Undo' }]
        };
      }
      return outcome;
    }
    return { ok: false, message: 'I no longer recognise that action — the room may have changed. Try asking again in words.' };
  }

  App.AIAssistant = {
    interpret: interpret,
    execute: execute,
    modelInterpret: modelInterpret,
    hasModel: hasModel,
    getModelConfig: modelConfig,
    setModelConfig: setModelConfig,
    getDraftSummary: function () { return memory.draft ? draftSummary(memory.draft) : ''; }
  };
})(window.App = window.App || {});
