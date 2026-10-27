(function (App) {
  'use strict';

  const modalStack = [];

  function uid(prefix) {
    return (prefix || 'id') + '-' + Date.now().toString(36).toUpperCase() + '-' +
      Math.random().toString(36).slice(2, 7).toUpperCase();
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function lerp(a, b, t) { return a + (b - a) * t; }

  function degToRad(deg) { return deg * Math.PI / 180; }

  function normalizeDeg(deg) {
    let d = Number(deg);
    if (!Number.isFinite(d)) d = 0;
    d = ((d % 360) + 360) % 360;
    return Math.round(d * 10) / 10;
  }

  function round(value, places) {
    const p = Math.pow(10, places == null ? 2 : places);
    return Math.round(value * p) / p;
  }

  function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
  }

  function toNumber(value, fallback) {
    if (value === '' || value === null || value === undefined) return fallback;
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }

  function escapeHtml(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function deepClone(value) {
    if (window.structuredClone) {
      try { return window.structuredClone(value); } catch (err) { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(value));
  }

  function debounce(fn, wait) {
    let timer = null;
    function debounced() {
      const args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () { fn.apply(null, args); }, wait);
    }
    debounced.cancel = function () { clearTimeout(timer); };
    return debounced;
  }

  const moneyFormatter = new Intl.NumberFormat('en-IE', {
    style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2
  });

  function formatMoney(value) {
    if (!isFiniteNumber(value)) return '—';
    return moneyFormatter.format(value);
  }

  function formatNumber(value, maxDecimals) {
    if (!isFiniteNumber(value)) return '—';
    return new Intl.NumberFormat('en-IE', { maximumFractionDigits: maxDecimals == null ? 1 : maxDecimals }).format(value);
  }

  function formatDims(product) {
    if (!product) return '—';
    return formatNumber(product.widthCm, 0) + ' × ' + formatNumber(product.lengthCm, 0) +
      ' × ' + formatNumber(product.heightCm, 0) + ' cm';
  }

  function formatRoomDims(room) {
    if (!room) return '—';
    if (room.shape === 'circle') {
      return 'Ø ' + formatNumber(room.diameterCm, 0) + ' cm · H ' + formatNumber(room.heightCm, 0) + ' cm';
    }
    return formatNumber(room.widthCm, 0) + ' × ' + formatNumber(room.lengthCm, 0) + ' × ' +
      formatNumber(room.heightCm, 0) + ' cm';
  }

  function formatDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function formatFileSize(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '—';
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
    return (n / 1024 / 1024).toFixed(1) + ' MB';
  }

  function formatTime(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (isNaN(d.getTime())) return '—';
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  }

  function sanitizeFilename(name) {
    return String(name || 'design').trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '-').slice(0, 80) || 'design';
  }

  function isTypingTarget(target) {
    if (!target) return false;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
  }

  function showToast(message, type, options) {
    const opts = options || {};
    let layer = document.getElementById('toastLayer');
    if (!layer) {
      layer = document.createElement('div');
      layer.id = 'toastLayer';
      layer.className = 'toast-layer';
      document.body.appendChild(layer);
    }
    while (layer.children.length >= 4) layer.removeChild(layer.firstChild);
    const toast = document.createElement('div');
    toast.className = 'toast toast-' + (type || 'info');
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    const text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;
    toast.appendChild(text);
    if (opts.actionLabel) {
      const actionBtn = document.createElement('button');
      actionBtn.className = 'toast-action';
      actionBtn.type = 'button';
      actionBtn.textContent = opts.actionLabel;
      actionBtn.addEventListener('click', function () {
        try { if (opts.onAction) opts.onAction(); } finally { dismiss(); }
      });
      toast.appendChild(actionBtn);
    }
    const closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Dismiss notification');
    closeBtn.textContent = '×';
    closeBtn.addEventListener('click', dismiss);
    toast.appendChild(closeBtn);
    layer.appendChild(toast);
    requestAnimationFrame(function () { toast.classList.add('is-visible'); });
    let timer = setTimeout(dismiss, opts.duration || 4200);
    toast.addEventListener('mouseenter', function () { clearTimeout(timer); });
    toast.addEventListener('mouseleave', function () { timer = setTimeout(dismiss, 2200); });
    function dismiss() {
      clearTimeout(timer);
      toast.classList.remove('is-visible');
      setTimeout(function () { if (toast.parentNode) toast.parentNode.removeChild(toast); }, 180);
    }
    return { dismiss: dismiss };
  }

  function openModal(opts) {
    const options = opts || {};
    return new Promise(function (resolve) {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const wideClass = options.wide === 'xl' ? ' modal-xl' : options.wide ? ' modal-wide' : '';
      const dismissible = options.dismissible !== false;
      let resolved = false;
      let busy = false;

      const modal = document.createElement('div');
      modal.className = 'modal' + wideClass;
      modal.setAttribute('role', 'dialog');
      modal.setAttribute('aria-modal', 'true');
      modal.setAttribute('aria-label', options.title || 'Dialog');

      const header = document.createElement('header');
      header.className = 'modal-header';
      const titleWrap = document.createElement('div');
      titleWrap.className = 'modal-title-wrap';
      if (options.eyebrow) {
        const eyebrow = document.createElement('span');
        eyebrow.className = 'modal-eyebrow';
        eyebrow.textContent = options.eyebrow;
        titleWrap.appendChild(eyebrow);
      }
      const title = document.createElement('h2');
      title.className = 'modal-title';
      title.textContent = options.title || '';
      titleWrap.appendChild(title);
      header.appendChild(titleWrap);
      if (dismissible) {
        const x = document.createElement('button');
        x.type = 'button';
        x.className = 'modal-close';
        x.setAttribute('aria-label', 'Close dialog');
        x.textContent = '×';
        x.addEventListener('click', function () { close(null); });
        header.appendChild(x);
      }
      modal.appendChild(header);

      const body = document.createElement('div');
      body.className = 'modal-body';
      body.innerHTML = options.bodyHtml || '';
      modal.appendChild(body);

      const actions = options.actions || [];
      let footer = null;
      if (actions.length) {
        footer = document.createElement('footer');
        footer.className = 'modal-footer';
        actions.forEach(function (spec) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'btn ' + (spec.kind ? 'btn-' + spec.kind : 'btn-secondary');
          btn.textContent = spec.label;
          if (spec.disabled) btn.disabled = true;
          btn.addEventListener('click', async function () {
            if (busy) return;
            if (spec.onClick) {
              busy = true;
              const original = btn.textContent;
              if (spec.busyLabel) btn.textContent = spec.busyLabel;
              btn.classList.add('is-busy');
              let outcome;
              try {
                outcome = await spec.onClick(api);
              } catch (err) {
                console.error(err);
                showToast(err && err.message ? err.message : 'Something went wrong.', 'error');
                outcome = false;
              } finally {
                busy = false;
                btn.classList.remove('is-busy');
                btn.textContent = original;
              }
              if (outcome === false) return;
              if (outcome && typeof outcome === 'object' && outcome.close === false) return;
            }
            close(spec.value !== undefined ? spec.value : spec.label);
          });
          if (spec.kind === 'primary') btn.setAttribute('data-autofocus-primary', 'true');
          footer.appendChild(btn);
        });
        modal.appendChild(footer);
      }

      const api = {
        el: modal,
        bodyEl: body,
        close: function (value) { close(value); },
        setBusy: function (value) {
          busy = !!value;
          modal.classList.toggle('is-busy', busy);
        }
      };

      function close(value) {
        if (resolved) return;
        resolved = true;
        document.removeEventListener('keydown', onKeyDown, true);
        const index = modalStack.indexOf(api);
        if (index >= 0) modalStack.splice(index, 1);
        backdrop.classList.remove('is-open');
        setTimeout(function () {
          if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        }, 160);
        resolve(value);
      }

      function onKeyDown(event) {
        if (event.key === 'Escape' && dismissible && !busy) {
          event.stopPropagation();
          close(null);
        }
        if (event.key === 'Tab') {
          const focusables = modal.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
          if (!focusables.length) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }

      if (dismissible && options.backdropClose) {
        backdrop.addEventListener('mousedown', function (event) {
          if (event.target === backdrop && !busy) close(null);
        });
      }

      backdrop.appendChild(modal);
      document.body.appendChild(backdrop);
      modalStack.push(api);
      document.addEventListener('keydown', onKeyDown, true);

      requestAnimationFrame(function () {
        backdrop.classList.add('is-open');
        const autofocus = modal.querySelector('[data-autofocus], [autofocus]');
        const target = autofocus || body.querySelector('input:not([type="hidden"]), select, textarea') ||
          footer && footer.querySelector('[data-autofocus-primary]') || footer && footer.querySelector('button') ||
          modal.querySelector('.modal-close');
        if (target) {
          try { target.focus(); } catch (err) { /* ignore */ }
        }
      });

      if (typeof options.onMount === 'function') {
        options.onMount(body, api);
      }
    });
  }

  function confirmDialog(title, message, opts) {
    const options = opts || {};
    return openModal({
      title: title,
      bodyHtml: '<p class="modal-text">' + escapeHtml(message) + '</p>',
      dismissible: true,
      backdropClose: false,
      actions: [
        { label: options.cancelLabel || 'Cancel', value: 'cancel', kind: 'secondary' },
        { label: options.confirmLabel || 'Confirm', value: 'confirm', kind: options.danger ? 'danger' : 'primary' }
      ]
    }).then(function (result) { return result === 'confirm'; });
  }

  function alertDialog(title, message) {
    return openModal({
      title: title,
      bodyHtml: '<p class="modal-text">' + escapeHtml(message) + '</p>',
      actions: [{ label: 'OK', value: 'ok', kind: 'primary' }]
    });
  }

  function downloadBlob(filename, blob) {
    return new Promise(function (resolve, reject) {
      try {
        if (!(blob instanceof Blob)) throw new Error('Export produced no file data.');
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          URL.revokeObjectURL(url);
          if (a.parentNode) a.parentNode.removeChild(a);
          resolve(filename);
        }, 1200);
      } catch (err) {
        reject(err);
      }
    });
  }

  function readFileAsArrayBuffer(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(reader.result); };
      reader.onerror = function () { reject(reader.error || new Error('Could not read file.')); };
      reader.readAsArrayBuffer(file);
    });
  }

  function readFileAsText(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('Could not read file.')); };
      reader.readAsText(file);
    });
  }

  function readFileAsDataURL(file) {
    return new Promise(function (resolve, reject) {
      const reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || '')); };
      reader.onerror = function () { reject(reader.error || new Error('Could not read file.')); };
      reader.readAsDataURL(file);
    });
  }

  function hexToRgb(hex) {
    let h = String(hex || '').replace('#', '').trim();
    if (h.length === 3) h = h.split('').map(function (c) { return c + c; }).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return { r: 200, g: 200, b: 200 };
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16)
    };
  }

  function mixColor(hex, target, amount) {
    const a = hexToRgb(hex);
    const b = hexToRgb(target);
    const t = clamp(amount, 0, 1);
    return 'rgb(' + Math.round(lerp(a.r, b.r, t)) + ',' + Math.round(lerp(a.g, b.g, t)) + ',' + Math.round(lerp(a.b, b.b, t)) + ')';
  }

  function lighten(hex, amount) { return mixColor(hex, '#ffffff', amount); }
  function darken(hex, amount) { return mixColor(hex, '#000000', amount); }

  function isHexColor(value) {
    return /^#[0-9a-fA-F]{6}$/.test(String(value || '')) || /^#[0-9a-fA-F]{3}$/.test(String(value || ''));
  }

  function parseVariantList(text) {
    return String(text || '').split(',').map(function (entry) {
      const parts = entry.trim().split(':');
      if (!parts[0]) return null;
      const color = parts[1] && isHexColor(parts[1].trim()) ? parts[1].trim() : null;
      return { name: parts[0].trim().slice(0, 40), color: color };
    }).filter(Boolean);
  }

  App.Util = {
    uid: uid,
    clamp: clamp,
    lerp: lerp,
    degToRad: degToRad,
    normalizeDeg: normalizeDeg,
    round: round,
    isFiniteNumber: isFiniteNumber,
    toNumber: toNumber,
    escapeHtml: escapeHtml,
    deepClone: deepClone,
    debounce: debounce,
    formatMoney: formatMoney,
    formatNumber: formatNumber,
    formatDims: formatDims,
    formatRoomDims: formatRoomDims,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatTime: formatTime,
    formatFileSize: formatFileSize,
    sanitizeFilename: sanitizeFilename,
    isTypingTarget: isTypingTarget,
    toast: showToast,
    showToast: showToast,
    openModal: openModal,
    confirm: confirmDialog,
    alert: alertDialog,
    downloadBlob: downloadBlob,
    readFileAsArrayBuffer: readFileAsArrayBuffer,
    readFileAsText: readFileAsText,
    readFileAsDataURL: readFileAsDataURL,
    hexToRgb: hexToRgb,
    mixColor: mixColor,
    lighten: lighten,
    darken: darken,
    isHexColor: isHexColor,
    parseVariantList: parseVariantList
  };
  App.UI = { toast: showToast, modal: openModal, confirm: confirmDialog, alert: alertDialog };
})(window.App = window.App || {});
