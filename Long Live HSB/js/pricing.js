(function (App) {
  'use strict';

  const U = App.Util;

  function summarize(design, productsById) {
    const lines = [];
    const byProduct = new Map();
    if (!design) {
      return {
        lines: [], total: 0, quantity: 0, incomplete: false, invalidCount: 0,
        structuralCount: 0, budget: null, remaining: null, over: false, hasBudget: false
      };
    }
    (design.placedItems || []).forEach(function (item) {
      const map = byProduct.get(item.productId);
      if (map) map.quantity += 1;
      else byProduct.set(item.productId, { productId: item.productId, quantity: 1 });
    });
    const catalog = productsById || (App.Catalog ? App.Catalog.getProductsById() : {});
    byProduct.forEach(function (entry) {
      const product = catalog[entry.productId];
      const hasProduct = !!product;
      const priceValid = hasProduct && U.isFiniteNumber(product.price) && product.price >= 0;
      const line = {
        productId: entry.productId,
        name: hasProduct ? product.name : 'Unavailable product (' + entry.productId + ')',
        category: hasProduct ? product.category : 'unknown',
        quantity: entry.quantity,
        unitPrice: priceValid ? product.price : null,
        subtotal: priceValid ? U.round(product.price * entry.quantity, 2) : null,
        available: hasProduct,
        priceValid: priceValid,
        firstInstanceId: null
      };
      if (design.placedItems) {
        const first = design.placedItems.find(function (item) { return item.productId === entry.productId; });
        line.firstInstanceId = first ? first.id : null;
      }
      lines.push(line);
    });
    const openingProducts = new Map();
    (design.structuralItems || []).forEach(function (item) {
      if (!item.productId) return;
      const entry = openingProducts.get(item.productId);
      if (entry) {
        entry.quantity += 1;
        entry.subtotal = U.round(entry.unitPrice * entry.quantity, 2);
      } else {
        openingProducts.set(item.productId, {
          productId: item.productId,
          name: item.name || item.productId,
          quantity: 1,
          unitPrice: U.isFiniteNumber(item.price) ? item.price : null,
          subtotal: U.isFiniteNumber(item.price) ? item.price : null,
          firstInstanceId: item.id
        });
      }
    });
    openingProducts.forEach(function (entry) {
      const product = catalog[entry.productId];
      if (!U.isFiniteNumber(entry.unitPrice) && product && U.isFiniteNumber(product.price)) {
        entry.unitPrice = product.price;
        entry.subtotal = U.round(product.price * entry.quantity, 2);
      }
      const priceValid = U.isFiniteNumber(entry.unitPrice) && entry.unitPrice >= 0;
      lines.push({
        productId: entry.productId,
        name: entry.name || (product ? product.name : 'Opening ' + entry.productId),
        category: product ? product.category : 'opening',
        quantity: entry.quantity,
        unitPrice: priceValid ? entry.unitPrice : null,
        subtotal: priceValid ? U.round(entry.unitPrice * entry.quantity, 2) : null,
        available: !!product,
        priceValid: priceValid,
        firstInstanceId: entry.firstInstanceId,
        instanceType: 'structural'
      });
    });
    lines.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });
    let total = 0;
    let incomplete = false;
    let invalidCount = 0;
    let quantity = 0;
    lines.forEach(function (line) {
      quantity += line.quantity;
      if (line.priceValid) total += line.subtotal;
      else {
        incomplete = true;
        invalidCount++;
      }
    });
    total = U.round(total, 2);
    const budget = U.isFiniteNumber(design.budget) && design.budget >= 0 ? design.budget : null;
    const hasBudget = budget !== null;
    const over = hasBudget && total > budget;
    const remaining = hasBudget ? U.round(budget - total, 2) : null;
    return {
      lines: lines,
      total: total,
      quantity: quantity,
      incomplete: incomplete,
      invalidCount: invalidCount,
      structuralCount: (design.structuralItems || []).length,
      budget: budget,
      remaining: remaining,
      over: over,
      hasBudget: hasBudget
    };
  }

  function budgetStatus(design, productsById) {
    const summary = summarize(design, productsById);
    let percent = 0;
    if (summary.hasBudget && summary.budget > 0) percent = (summary.total / summary.budget) * 100;
    else if (summary.total > 0) percent = 100;
    return {
      summary: summary,
      percent: percent,
      over: summary.over,
      remaining: summary.remaining,
      incomplete: summary.incomplete
    };
  }

  function productInstancesAtProduct(design, productId) {
    if (!design) return 0;
    return (design.placedItems || []).filter(function (item) { return item.productId === productId; }).length;
  }

  App.Pricing = {
    summarize: summarize,
    budgetStatus: budgetStatus,
    productInstancesAtProduct: productInstancesAtProduct
  };
})(window.App = window.App || {});
