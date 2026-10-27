(function (App) {
  'use strict';

  const U = App.Util;
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  const urlCache = new Map();
  const imageCache = new Map();
  const pending = new Map();
  const imageFailed = new Set();

  function ensureCanvas(canvas, cssWidth, cssHeight) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, Math.round(cssWidth));
    const h = Math.max(1, Math.round(cssHeight));
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    return { ctx: ctx, width: w, height: h, dpr: dpr };
  }

  function roundRect(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + w - radius, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
    ctx.lineTo(x + w, y + h - radius);
    ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
    ctx.lineTo(x + radius, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
  }

  function productColor(product, variantColor) {
    if (variantColor && U.isHexColor(variantColor)) return variantColor;
    if (product && product.variants && product.variants.length && U.isHexColor(product.variants[0].color)) return product.variants[0].color;
    return App.Catalog ? App.Catalog.getCategoryColor(product ? product.category : '') : '#b9b2a4';
  }

  function palette(product, variantColor) {
    const base = productColor(product, variantColor);
    return {
      base: base,
      light: U.lighten(base, 0.32),
      soft: U.lighten(base, 0.62),
      dark: U.darken(base, 0.36),
      ink: '#33423b',
      cream: '#f4efe6',
      metal: '#8b948f',
      wood: U.darken(base, 0.12)
    };
  }

  function outline(ctx, c, widthCm) {
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = widthCm || 1.4;
    ctx.stroke();
  }

  function drawBed(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.dark;
    roundRect(ctx, -hw + 1, hl - 9, w - 2, 7.5, 2.4);
    ctx.fill();
    ctx.fillStyle = c.light;
    roundRect(ctx, -hw + 1.5, -hl + 1.5, w - 3, l - 3, 3);
    ctx.fill();
    outline(ctx, c);
    ctx.fillStyle = c.soft;
    roundRect(ctx, -hw + 4, -hl + 4, w - 8, l * 0.56, 3);
    ctx.fill();
    ctx.strokeStyle = c.dark;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(-hw + 4, -hl + 4 + l * 0.56);
    ctx.lineTo(hw - 4, -hl + 4 + l * 0.56);
    ctx.stroke();
    ctx.globalAlpha = 1;
    const pillowW = (w - 14) / 2;
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = c.cream;
      roundRect(ctx, -hw + 5 + i * (pillowW + 4), hl - 24, pillowW, 12, 3);
      ctx.fill();
      ctx.strokeStyle = U.darken(c.base, 0.22);
      ctx.lineWidth = 0.8;
      ctx.stroke();
    }
    ctx.fillStyle = c.base;
    ctx.globalAlpha = 0.3;
    roundRect(ctx, -hw + 6, -hl + l * 0.28, w - 12, l * 0.22, 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function drawWardrobe(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.base;
    roundRect(ctx, -hw + 1, -hl + 1, w - 2, l - 2, 1.6);
    ctx.fill();
    outline(ctx, c);
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 0.9;
    const doors = w > 130 ? 3 : 2;
    for (let i = 1; i < doors; i++) {
      const x = -hw + 1 + (w - 2) * (i / doors);
      ctx.beginPath();
      ctx.moveTo(x, -hl + 2);
      ctx.lineTo(x, hl - 2);
      ctx.stroke();
    }
    ctx.fillStyle = c.dark;
    ctx.globalAlpha = 0.65;
    ctx.fillRect(-hw + 2, -hl + 1.5, w - 4, 2.2);
    ctx.globalAlpha = 1;
    for (let i = 0; i < doors; i++) {
      const center = -hw + 1 + (w - 2) * ((i + 0.5) / doors);
      ctx.fillStyle = c.metal;
      roundRect(ctx, center - 3, -hl + 4.5, 6, 1.4, 0.7);
      ctx.fill();
    }
    ctx.strokeStyle = c.light;
    ctx.lineWidth = 0.6;
    ctx.beginPath();
    ctx.moveTo(-hw + 5, -hl + 8);
    ctx.lineTo(hw - 5, -hl + 8);
    ctx.stroke();
  }

  function drawSofa(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.base;
    roundRect(ctx, -hw + 1, -hl + 1, w - 2, l - 2, Math.min(8, w * 0.06));
    ctx.fill();
    outline(ctx, c);
    ctx.fillStyle = c.dark;
    roundRect(ctx, -hw + 2, hl - Math.min(16, l * 0.26), w - 4, Math.min(14, l * 0.22), 4);
    ctx.fill();
    const armW = Math.min(14, w * 0.08);
    ctx.fillStyle = c.wood;
    roundRect(ctx, -hw + 2, -hl + 2, armW, l - 4, 3);
    ctx.fill();
    roundRect(ctx, hw - 2 - armW, -hl + 2, armW, l - 4, 3);
    ctx.fill();
    const seatCount = w > 190 ? 3 : w > 120 ? 2 : 1;
    const innerLeft = -hw + 3 + armW;
    const innerRight = hw - 3 - armW;
    const seatW = (innerRight - innerLeft - (seatCount - 1) * 2) / seatCount;
    const seatTop = -hl + 4;
    const seatBottom = hl - Math.min(17, l * 0.28);
    for (let i = 0; i < seatCount; i++) {
      ctx.fillStyle = c.light;
      roundRect(ctx, innerLeft + i * (seatW + 2), seatTop, seatW, Math.max(6, seatBottom - seatTop), 2.6);
      ctx.fill();
      ctx.strokeStyle = c.dark;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 0.6;
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawChair(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.base;
    roundRect(ctx, -hw + 1, -hl + 1, w - 2, l - 2, Math.min(7, w * 0.15));
    ctx.fill();
    outline(ctx, c);
    ctx.fillStyle = c.dark;
    roundRect(ctx, -hw + 3, hl - Math.min(9, l * 0.18), w - 6, Math.min(7, l * 0.14), 2);
    ctx.fill();
    ctx.fillStyle = c.light;
    roundRect(ctx, -hw + 4, -hl + 3.5, w - 8, l - 14, 3);
    ctx.fill();
  }

  function drawTable(ctx, w, l, c, round) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.base;
    if (round) {
      ctx.beginPath();
      ctx.ellipse(0, 0, hw - 1, hl - 1, 0, 0, Math.PI * 2);
      ctx.fill();
      outline(ctx, c);
      ctx.strokeStyle = c.dark;
      ctx.globalAlpha = 0.25;
      ctx.beginPath();
      ctx.ellipse(0, 0, hw * 0.7, hl * 0.7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    roundRect(ctx, -hw + 1, -hl + 1, w - 2, l - 2, Math.min(5, w * 0.04));
    ctx.fill();
    outline(ctx, c);
    ctx.strokeStyle = c.dark;
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 0.7;
    const lines = Math.max(3, Math.round(l / 15));
    for (let i = 1; i < lines; i++) {
      const y = -hl + (l / lines) * i;
      ctx.beginPath();
      ctx.moveTo(-hw + 3, y);
      ctx.lineTo(hw - 3, y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawDesk(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.base;
    roundRect(ctx, -hw + 1, -hl + 1, w - 2, l - 2, 2);
    ctx.fill();
    outline(ctx, c);
    ctx.fillStyle = c.wood;
    const drawerW = Math.min(38, w * 0.3);
    roundRect(ctx, hw - drawerW - 3, -hl + 3, drawerW, l - 6, 1.6);
    ctx.fill();
    ctx.strokeStyle = c.light;
    ctx.lineWidth = 0.7;
    ctx.stroke();
    for (let i = 0; i < 2; i++) {
      ctx.fillStyle = c.metal;
      const y = -hl + 6 + i * ((l - 12) / 2);
      roundRect(ctx, hw - drawerW + drawerW / 2 - 4, y, 8, 1.2, 0.6);
      ctx.fill();
    }
    ctx.fillStyle = c.soft;
    roundRect(ctx, -hw + 5, -hl + l * 0.32, w * 0.35, l * 0.34, 1);
    ctx.fill();
  }

  function drawShelf(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.light;
    roundRect(ctx, -hw + 1, -hl + 1, w - 2, l - 2, 1);
    ctx.fill();
    outline(ctx, c);
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 0.8;
    for (let i = 0; i < 3; i++) {
      const x = -hw + 3 + ((w - 6) / 3) * i;
      ctx.beginPath();
      ctx.moveTo(x, -hl + 3);
      ctx.lineTo(x, hl - 3);
      ctx.stroke();
    }
    ctx.fillStyle = c.base;
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 3; i++) {
      const x = -hw + 5 + ((w - 6) / 3) * i;
      ctx.fillRect(x, -hl + 4, Math.min(5, w / 14), l - 8);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = c.soft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-hw + 1, -hl + 3);
    ctx.lineTo(hw - 1, -hl + 3);
    ctx.stroke();
  }

  function drawStorage(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.base;
    roundRect(ctx, -hw + 1, -hl + 1, w - 2, l - 2, 1.5);
    ctx.fill();
    outline(ctx, c);
    const drawers = l > 60 ? 3 : w > 100 ? 3 : 2;
    if (w > 100 && l < 60) {
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 0.8;
      for (let i = 1; i < drawers; i++) {
        const x = -hw + 2 + ((w - 4) / drawers) * i;
        ctx.beginPath();
        ctx.moveTo(x, -hl + 3);
        ctx.lineTo(x, hl - 3);
        ctx.stroke();
      }
      for (let i = 0; i < drawers; i++) {
        const center = -hw + 2 + ((w - 4) / drawers) * (i + 0.5);
        ctx.fillStyle = c.metal;
        roundRect(ctx, center - 5, -hl + 4, 10, 1.2, 0.6);
        ctx.fill();
      }
    } else {
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 0.8;
      for (let i = 1; i < drawers; i++) {
        const y = -hl + 2 + ((l - 4) / drawers) * i;
        ctx.beginPath();
        ctx.moveTo(-hw + 3, y);
        ctx.lineTo(hw - 3, y);
        ctx.stroke();
      }
      for (let i = 0; i < drawers; i++) {
        const centerY = -hl + 2 + ((l - 4) / drawers) * (i + 0.5);
        ctx.fillStyle = c.metal;
        roundRect(ctx, -6, centerY, 12, 1.2, 0.6);
        ctx.fill();
      }
    }
    ctx.strokeStyle = c.soft;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-hw + 2, -hl + 2.5);
    ctx.lineTo(hw - 2, -hl + 2.5);
    ctx.stroke();
  }

  function drawLighting(ctx, w, l, c) {
    const r = Math.min(w, l) / 2;
    ctx.fillStyle = c.soft;
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
    ctx.fill();
    outline(ctx, c);
    ctx.fillStyle = c.base;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.dark;
    ctx.globalAlpha = 0.4;
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function drawRug(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.soft;
    ctx.fillRect(-hw, -hl, w, l);
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 0.9;
    ctx.strokeRect(-hw + 1, -hl + 1, w - 2, l - 2);
    ctx.strokeStyle = c.base;
    ctx.lineWidth = 2;
    ctx.strokeRect(-hw + 8, -hl + 8, w - 16, l - 16);
    ctx.strokeStyle = c.base;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = 0.7;
    const lines = Math.max(4, Math.round(l / 40));
    for (let i = 1; i < lines; i++) {
      const y = -hl + (l / lines) * i;
      ctx.beginPath();
      for (let x = -hw + 12; x <= hw - 12; x += 6) {
        const wave = Math.sin((x / 22) + i) * 2;
        if (x === -hw + 12) ctx.moveTo(x, y + wave);
        else ctx.lineTo(x, y + wave);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function drawDecor(ctx, w, l, c) {
    const r = Math.min(w, l) / 2;
    ctx.fillStyle = c.soft;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    outline(ctx, c);
    const leaf = Math.max(1.2, r * 0.16);
    const angles = [0, 45, 90, 135, 180, 225, 270, 315];
    ctx.fillStyle = U.darken('#8fae8d', 0.1);
    angles.forEach(function (deg) {
      const rad = U.degToRad(deg);
      const x = Math.cos(rad) * r * 0.38;
      const y = Math.sin(rad) * r * 0.38;
      ctx.beginPath();
      ctx.ellipse(x, y, leaf, leaf * 0.58, rad, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.fillStyle = c.base;
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 0.7;
    ctx.stroke();
  }

  function drawStaircase(ctx, w, l, c) {
    const hw = w / 2;
    const hl = l / 2;
    ctx.fillStyle = c.soft;
    ctx.fillRect(-hw, -hl, w, l);
    outline(ctx, c);
    const steps = Math.max(5, Math.round(l / 22));
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 0.9;
    for (let i = 1; i < steps; i++) {
      const y = -hl + (l / steps) * i;
      ctx.beginPath();
      ctx.moveTo(-hw + 2, y);
      ctx.lineTo(hw - 2, y);
      ctx.stroke();
    }
    ctx.strokeStyle = c.base;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-hw + 3, -hl + 2);
    ctx.lineTo(-hw + 3, hl - 2);
    ctx.moveTo(hw - 3, -hl + 2);
    ctx.lineTo(hw - 3, hl - 2);
    ctx.stroke();
  }

  function drawDoorPanel(ctx, w, l, c) {
    const hw = w / 2;
    const hl = Math.max(4, l / 2);
    ctx.fillStyle = c.base;
    ctx.fillRect(-hw, -hl, w, hl * 2);
    outline(ctx, c);
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.arc(-hw + 4, -hl + 4, Math.max(8, w * 0.62), 0, Math.PI / 2);
    ctx.stroke();
    ctx.fillStyle = c.metal;
    ctx.beginPath();
    ctx.arc(hw - w * 0.16, 0, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawWindowPanel(ctx, w, l, c) {
    const hw = w / 2;
    const hl = Math.max(4, l / 2);
    ctx.fillStyle = '#dcecf1';
    ctx.fillRect(-hw, -hl, w, hl * 2);
    outline(ctx, c);
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.6;
    ctx.strokeRect(-hw + 1.5, -hl + 1.5, w - 3, hl * 2 - 3);
    ctx.beginPath();
    ctx.moveTo(0, -hl);
    ctx.lineTo(0, hl);
    ctx.stroke();
  }

  function drawTopView(ctx, product, variantColor) {
    if (!ctx || !product) return;
    const w = Math.max(10, product.widthCm);
    const l = Math.max(10, product.lengthCm);
    const c = palette(product, variantColor);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    switch (product.category) {
      case 'bed': drawBed(ctx, w, l, c); break;
      case 'wardrobe': drawWardrobe(ctx, w, l, c); break;
      case 'sofa': drawSofa(ctx, w, l, c); break;
      case 'chair': drawChair(ctx, w, l, c); break;
      case 'table': drawTable(ctx, w, l, c, false); break;
      case 'desk': drawDesk(ctx, w, l, c); break;
      case 'shelf': drawShelf(ctx, w, l, c); break;
      case 'storage': drawStorage(ctx, w, l, c); break;
      case 'lighting': drawLighting(ctx, w, l, c); break;
      case 'rug': drawRug(ctx, w, l, c); break;
      case 'decor': drawDecor(ctx, w, l, c); break;
      case 'staircase': drawStaircase(ctx, w, l, c); break;
      case 'door': drawDoorPanel(ctx, w, l, c); break;
      case 'window': drawWindowPanel(ctx, w, l, c); break;
      default: {
        ctx.fillStyle = c.base;
        roundRect(ctx, -w / 2, -l / 2, w, l, 2);
        ctx.fill();
        outline(ctx, c);
      }
    }
    ctx.restore();
  }

  function rgba(hex, alpha) {
    const rgb = U.hexToRgb(hex);
    return 'rgba(' + rgb.r + ',' + rgb.g + ',' + rgb.b + ',' + alpha + ')';
  }

  function drawThumb(canvas, product, variantColor) {
    if (!canvas || !product) return;
    const parentWidth = canvas.clientWidth || Number(canvas.getAttribute('width')) || 140;
    const parentHeight = canvas.clientHeight || Number(canvas.getAttribute('height')) || 88;
    const setup = ensureCanvas(canvas, parentWidth, parentHeight);
    const W = setup.width;
    const H = setup.height;
    const ctx = setup.ctx;
    const c = palette(product, variantColor);

    const hasPhoto = product.assets && (product.assets.main || product.assets.display || product.assets.top);
    if (App.Catalog && App.Catalog.usesFallback && App.Catalog.usesFallback(product) && !hasPhoto) {
      ctx.fillStyle = '#121212';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = Math.max(9, Math.min(13, W / 11));
      ctx.font = '600 ' + fontSize + 'px ' + FONT;
      const words = String(product.name || 'Product').split(/\s+/);
      const lines = [''];
      words.forEach(function (word) {
        const candidate = lines[lines.length - 1] ? lines[lines.length - 1] + ' ' + word : word;
        if (ctx.measureText(candidate).width > W - 18 && lines[lines.length - 1]) {
          if (lines.length < 3) lines.push(word);
          else lines[lines.length - 1] += ' ' + word;
        } else {
          lines[lines.length - 1] = candidate;
        }
      });
      lines.slice(0, 3).forEach(function (line, index) {
        ctx.fillText(line, W / 2, H / 2 + (index - (Math.min(lines.length, 3) - 1) / 2) * (fontSize + 3));
      });
      return;
    }

    const bg = ctx.createLinearGradient(0, 0, W * 0.35, H);
    bg.addColorStop(0, '#fdfcf8');
    bg.addColorStop(1, '#eeeadf');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    const glow = ctx.createRadialGradient(W * 0.5, H * 0.42, 1, W * 0.5, H * 0.42, Math.max(W, H) * 0.72);
    glow.addColorStop(0, rgba(c.base, 0.2));
    glow.addColorStop(0.55, rgba(c.base, 0.07));
    glow.addColorStop(1, rgba(c.base, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.translate(W * 0.5, H * 0.56);
    ctx.scale(1, 0.62);
    const contact = ctx.createRadialGradient(0, 0, 1, 0, 0, Math.min(W, H) * 0.46);
    contact.addColorStop(0, 'rgba(42, 50, 43, 0.14)');
    contact.addColorStop(1, 'rgba(42, 50, 43, 0)');
    ctx.fillStyle = contact;
    ctx.fillRect(-W, -H, W * 2, H * 2);
    ctx.restore();

    const padX = Math.max(10, W * 0.11);
    const padY = Math.max(9, H * 0.12);
    const w = Math.max(10, product.widthCm);
    const l = Math.max(10, product.lengthCm);
    let scale = Math.min((W - padX * 2) / w, (H - padY * 2) / l);
    if (product.category === 'rug') scale *= 0.9;
    if (product.category === 'shelf' || product.category === 'wardrobe') scale *= 0.94;
    ctx.save();
    ctx.translate(W / 2, H / 2 + H * 0.015);
    ctx.scale(scale, scale);
    ctx.shadowColor = rgba(c.dark, 0.24);
    ctx.shadowBlur = 15 / scale;
    ctx.shadowOffsetY = 4 / scale;
    drawTopView(ctx, product, variantColor);
    ctx.restore();

    const vignette = ctx.createRadialGradient(W * 0.5, H * 0.45, Math.min(W, H) * 0.34, W * 0.5, H * 0.52, Math.max(W, H) * 0.82);
    vignette.addColorStop(0, 'rgba(255, 255, 255, 0)');
    vignette.addColorStop(1, 'rgba(64, 56, 42, 0.09)');
    ctx.fillStyle = vignette;
    ctx.fillRect(0, 0, W, H);
  }

  function loadImage(url) {
    return new Promise(function (resolve) {
      const img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { resolve(null); };
      img.src = url;
    });
  }

  async function ensureImageForAsset(key) {
    if (!key) return null;
    if (imageCache.has(key)) return imageCache.get(key);
    if (pending.has(key)) return pending.get(key);
    const promise = (async function () {
      try {
        const url = await App.Storage.getAssetURL(key);
        if (!url) return null;
        urlCache.set(key, url);
        const img = await loadImage(url);
        if (img) imageCache.set(key, img);
        else imageFailed.add(key);
        return img;
      } catch (err) {
        console.warn('Could not load product image asset.', err);
        imageFailed.add(key);
        return null;
      } finally {
        pending.delete(key);
        if (typeof App.Media.onAssetLoaded === 'function') {
          try { App.Media.onAssetLoaded(key); } catch (err) { console.warn(err); }
        }
      }
    })();
    pending.set(key, promise);
    return promise;
  }

  function getTopImage(product) {
    if (!product || !product.assets || !product.assets.top) return null;
    const key = product.assets.top.key;
    if (imageCache.has(key)) return imageCache.get(key);
    ensureImageForAsset(key);
    return null;
  }

  function getImageForKey(key) {
    if (!key) return null;
    if (imageCache.has(key)) return imageCache.get(key);
    ensureImageForAsset(key);
    return null;
  }

  function primeProduct(product) {
    if (!product || !product.assets) return;
    ['main', 'display', 'top'].forEach(function (kind) {
      const ref = product.assets[kind];
      if (ref && ref.key) ensureImageForAsset(ref.key);
    });
  }

  async function getAssetObjectURL(key) {
    if (!key) return null;
    if (urlCache.has(key)) return urlCache.get(key);
    const url = await App.Storage.getAssetURL(key);
    if (url) urlCache.set(key, url);
    return url;
  }

  function getCachedAssetURL(key) {
    return urlCache.get(key) || null;
  }

  function clearUrlCache() {
    urlCache.clear();
    imageCache.clear();
    pending.clear();
    imageFailed.clear();
  }

  App.Media = {
    ensureCanvas: ensureCanvas,
    drawTopView: drawTopView,
    drawThumb: drawThumb,
    palette: palette,
    productColor: productColor,
    getTopImage: getTopImage,
    getImageForKey: getImageForKey,
    ensureImageForAsset: ensureImageForAsset,
    getAssetObjectURL: getAssetObjectURL,
    getCachedAssetURL: getCachedAssetURL,
    primeProduct: primeProduct,
    clearUrlCache: clearUrlCache,
    onAssetLoaded: null
  };
})(window.App = window.App || {});
