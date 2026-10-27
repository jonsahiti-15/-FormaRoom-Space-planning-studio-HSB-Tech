(function (App) {
  'use strict';

  const U = App.Util;

  function dateStamp() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function baseName(design) {
    return U.sanitizeFilename(design && design.name ? design.name : 'formaroom-design') + '-' + dateStamp();
  }

  function csvCell(value) {
    if (value === null || value === undefined) return '';
    const text = String(value);
    if (/[",\r\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function csvRow(cells) {
    return cells.map(csvCell).join(',');
  }

  function productCSV(design) {
    if (!design) throw new Error('There is no design to export.');
    const productsById = App.Catalog.getProductsById();
    const summary = App.Pricing.summarize(design, productsById);
    const lines = [];
    lines.push(csvRow(['FormaRoom product list']));
    lines.push(csvRow(['Design', design.name]));
    lines.push(csvRow(['Company', App.CONFIG.COMPANY_NAME]));
    lines.push(csvRow(['Room shape', App.Geometry.roomShapeLabel(design.room)]));
    lines.push(csvRow(['Room dimensions', U.formatRoomDims(design.room)]));
    lines.push(csvRow(['Exported', new Date().toISOString()]));
    lines.push('');
    lines.push(csvRow(['Product ID', 'Product name', 'Category', 'Quantity', 'Unit price (EUR)', 'Subtotal (EUR)', 'Width (cm)', 'Length (cm)', 'Height (cm)', 'Variants in design', 'Availability']));
    summary.lines.forEach(function (line) {
      const product = productsById[line.productId];
      const instances = (design.placedItems || []).filter(function (item) { return item.productId === line.productId; });
      const variantNames = [];
      instances.forEach(function (item) {
        const variant = product ? App.Catalog.variantFor(product, item.variantId) : null;
        if (variant && variantNames.indexOf(variant.name) < 0) variantNames.push(variant.name);
      });
      lines.push(csvRow([
        line.productId,
        line.name,
        product ? App.Catalog.getCategoryLabel(product.category) : 'Unavailable',
        line.quantity,
        line.priceValid ? line.unitPrice.toFixed(2) : '',
        line.priceValid ? line.subtotal.toFixed(2) : '',
        product ? product.widthCm : '',
        product ? product.lengthCm : '',
        product ? product.heightCm : '',
        variantNames.join('; '),
        product ? (product.availability || '') : 'Product missing from catalog'
      ]));
    });
    if (!summary.lines.length) {
      lines.push(csvRow(['No products placed', '', '', 0, '', '', '', '', '', '', '']));
    }
    lines.push('');
    lines.push(csvRow(['Total items', summary.quantity]));
    lines.push(csvRow(['Total price (EUR)', summary.incomplete ? 'Incomplete - some products unavailable' : summary.total.toFixed(2)]));
    lines.push(csvRow(['Budget (EUR)', summary.hasBudget ? summary.budget.toFixed(2) : 'No budget set']));
    lines.push(csvRow(['Remaining (EUR)', summary.hasBudget && !summary.incomplete ? summary.remaining.toFixed(2) : '']));
    lines.push(csvRow(['Over budget', summary.over ? 'Yes' : 'No']));
    lines.push(csvRow(['Note', 'Prices and dimensions are read from the local FormaRoom product catalog.']));
    return '\uFEFF' + lines.join('\r\n');
  }

  function productsBlob(design) {
    return new Blob([productCSV(design)], { type: 'text/csv;charset=utf-8' });
  }

  function planBlob(design, options) {
    const opts = options || {};
    return App.Designer2D.exportImage(design, { width: opts.width || 1800, height: opts.height || 1200 });
  }

  function backupBlob(design) {
    return new Blob([App.Storage.buildDesignBackup(design)], { type: 'application/json' });
  }

  async function downloadPlan(design) {
    if (!design) throw new Error('There is no design to export.');
    const blob = await planBlob(design);
    return U.downloadBlob(baseName(design) + '-floor-plan.png', blob);
  }

  async function downloadProducts(design) {
    if (!design) throw new Error('There is no design to export.');
    if (!design.placedItems.length) throw new Error('Add at least one product before exporting a product list.');
    return U.downloadBlob(baseName(design) + '-products.csv', productsBlob(design));
  }

  async function downloadBackup(design) {
    if (!design) throw new Error('There is no design to export.');
    return U.downloadBlob(baseName(design) + '-backup.json', backupBlob(design));
  }

  /* A home is only portable if the room designs it points at travel with it,
     so every designId referenced by a room is embedded in the same file. */
  async function homeBackupJSON() {
    const home = App.Home.get();
    if (!home) throw new Error('There is no whole home to export.');
    const missing = [];
    const designs = [];
    const ids = [];
    (home.rooms || []).forEach(function (room) {
      if (room.designId && ids.indexOf(room.designId) < 0) ids.push(room.designId);
    });
    for (let i = 0; i < ids.length; i++) {
      const design = await App.Home.loadDesign(ids[i]);
      if (design) designs.push(design);
      else missing.push(ids[i]);
    }
    return {
      text: App.Storage.buildHomeBackup(home, designs),
      roomCount: (home.rooms || []).length,
      designCount: designs.length,
      missingCount: missing.length
    };
  }

  async function downloadHomeBackup() {
    const result = await homeBackupJSON();
    const home = App.Home.get();
    const name = U.sanitizeFilename(home.name || 'formaroom-home') + '-' + dateStamp() + '-home.json';
    await U.downloadBlob(name, new Blob([result.text], { type: 'application/json' }));
    return result;
  }

  App.Export = {
    planBlob: planBlob,
    productsBlob: productsBlob,
    backupBlob: backupBlob,
    productCSV: productCSV,
    downloadPlan: downloadPlan,
    downloadProducts: downloadProducts,
    downloadBackup: downloadBackup,
    homeBackupJSON: homeBackupJSON,
    downloadHomeBackup: downloadHomeBackup
  };
})(window.App = window.App || {});
