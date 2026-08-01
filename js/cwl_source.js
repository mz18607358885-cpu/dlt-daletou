// js/cwl_source.js
// 大乐透数据源适配器 - v3
//
// 策略:
//  1. 优先用预生成的 data/history.json(60 期真实数据,构建时拉取)
//  2. 后台异步尝试 fetch Netlify Function(/.netlify/functions/dlt)升级数据
//  3. Function 失败(Netlify IP 被 WAF 拦)时,fallback 静态数据,不影响主流程
//
// 数据排序:统一从旧到新(draws[length-1] = 最新一期 = getLastDraw)

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.CWLSource = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const config = {
    apiPath: '/.netlify/functions/dlt',
    fallbackHistoryJsonPath: 'data/history.json',
  };

  // 统一数据格式:draws 从旧到新排序
  function normalize(raw) {
    if (!raw || !raw.draws || !Array.isArray(raw.draws)) return raw;
    const sorted = raw.draws.slice().sort((a, b) => {
      const na = parseInt(a.期号, 10) || 0;
      const nb = parseInt(b.期号, 10) || 0;
      return na - nb;
    });
    return { ...raw, draws: sorted };
  }

  function fetchText(url) {
    if (typeof fetch === 'function') {
      return fetch(url, { credentials: 'omit' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.text();
      });
    }
    return new Promise(function (resolve, reject) {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
        else reject(new Error('HTTP ' + xhr.status));
      };
      xhr.onerror = function () { reject(new Error('Network error')); };
      xhr.send();
    });
  }

  let _cachedData = null;
  let _upgrading = false;
  let _upgradePromise = null;
  let _upgradeCallbacks = [];

  function loadDefault() {
    return loadFallback().then(function (data) {
      _cachedData = data;
      return data;
    });
  }

  function loadFallback() {
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      return fetchText(config.fallbackHistoryJsonPath).then(function (txt) {
        return normalize(JSON.parse(txt));
      });
    }
    const fs = require('fs');
    const path = require('path');
    const txt = fs.readFileSync(path.join(__dirname, '..', 'data', 'history.json'), 'utf-8');
    return Promise.resolve(normalize(JSON.parse(txt)));
  }

  // 异步尝试升级数据(从 Netlify Function)
  function tryUpgrade() {
    if (_upgrading) return _upgradePromise;
    _upgrading = true;
    _upgradePromise = fetchText(config.apiPath).then(function (txt) {
      const data = normalize(JSON.parse(txt));
      if (data && data.draws && Array.isArray(data.draws) && data.draws.length > 0) {
        _cachedData = data;
        return data;
      }
      throw new Error('格式不对');
    }).catch(function () {
      // Function 失败(Netlify IP 被 WAF 拦)是正常情况,静默
      return null;
    }).then(function (data) {
      _upgrading = false;
      _upgradeCallbacks.forEach(function (cb) {
        try { cb(data); } catch (e) {}
      });
      _upgradeCallbacks = [];
      return data;
    });
    return _upgradePromise;
  }

  function getCurrent() {
    return _cachedData;
  }

  function onUpgrade(cb) {
    if (!_upgrading) {
      cb(_cachedData);
    } else {
      _upgradeCallbacks.push(cb);
    }
  }

  return {
    config: config,
    loadDefault: loadDefault,
    loadFallback: loadFallback,
    tryUpgrade: tryUpgrade,
    getCurrent: getCurrent,
    onUpgrade: onUpgrade,
  };
});
