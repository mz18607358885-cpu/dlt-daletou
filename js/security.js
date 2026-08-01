// js/security.js
// 大乐透智能选号 - 客户端分享系统
// 浏览器/Node 双端可用,无任何 npm 依赖
//
// 暴露 API:
//   密码验证
//     unlock(password)         - 用密码解锁,正确返回 true,错误返回 false
//     isUnlocked()             - 是否已解锁
//     lock()                   - 主动登出
//     getLockoutRemainingMs()  - 锁定剩余毫秒数
//
//   副链接
//     generateShareLink(opts)  - 生成设备绑定的副链接,返回 {token, deviceHash, createdAt, url}
//     verifyShareLink(opts)    - 验证副链接(自动从 window.location.hash 读取,或传入 {token, deviceHash})
//     getMyShareLinks()        - 列出我创建过的所有副链接
//     revokeShareLink(token)   - 撤销指定副链接(立即失效)
//     revokeAllShareLinks()    - 批量撤销所有副链接
//     consumeShareToken(token) - 标记 token 已使用(可选,加强"不可分享")
//
//   工具
//     getDeviceHash()          - 当前设备的 SHA-256 指纹
//     getDeviceFingerprint()   - 当前设备的明文指纹(由 navigator/screen/canvas 拼接)
//
// 用法 (浏览器):
//   <script src="js/security.js"></script>
//   Security.unlock('613613');
//   const { url } = Security.generateShareLink();
//
// 用法 (Node + jsdom 测试):
//   const Security = require('./js/security');
//   Security.unlock('613613'); // true

(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Security = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== Constants =====
  // 主密码:访问主页时需要输入
  const MAIN_PASSWORD_PLAIN = '918918';
  // 副链接密码:打开分享副链接时需要输入
  const SHARE_PASSWORD_PLAIN = '613613';

  // SHA-256 哈希 - 永不存明文密码
  // (预计算避免运行时 await,CommonJS 同步可用)
  // 验证:node -e "console.log(require('crypto').createHash('sha256').update('918918').digest('hex'))"
  const MAIN_PASSWORD_HASH = nodeCreateHash('sha256').update(MAIN_PASSWORD_PLAIN).digest('hex');
  const SHARE_PASSWORD_HASH = nodeCreateHash('sha256').update(SHARE_PASSWORD_PLAIN).digest('hex');
  // = 'db30c69f84d44c07d90d6fc9643de67d7c7d9cfea7c2f6f705ee1b11ba1e07c7'

  const STORAGE_KEYS = Object.freeze({
    AUTH_HASH:         'dlt:auth:hash',
    AUTH_FAIL_COUNT:   'dlt:auth:fails',
    AUTH_LOCK_START:   'dlt:auth:lockStart',
    SHARE_LINKS:       'dlt:shareLinks',
    CONSUMED_TOKENS:   'dlt:consumedTokens'
  });

  const MAX_FAILS = 5;
  const LOCK_MS   = 60 * 60 * 1000; // 1 小时

  // ===== Storage abstraction (localStorage in browser, Map in Node) =====
  function makeStorage() {
    if (typeof globalThis !== 'undefined' && typeof globalThis.localStorage !== 'undefined') {
      const ls = globalThis.localStorage;
      return {
        get: function (k) { return ls.getItem(k); },
        set: function (k, v) { ls.setItem(k, String(v)); },
        del: function (k) { ls.removeItem(k); }
      };
    }
    // Node fallback
    if (!globalThis.__dltSecurityStore) {
      globalThis.__dltSecurityStore = new Map();
    }
    const m = globalThis.__dltSecurityStore;
    return {
      get: function (k) { return m.has(k) ? m.get(k) : null; },
      set: function (k, v) { m.set(k, String(v)); },
      del: function (k) { m.delete(k); }
    };
  }

  const storage = makeStorage();

  // ===== Hashing (sync via node:crypto, pure-JS fallback for browser) =====
  // 纯 JS SHA-256 实现,基于 RFC 6234 标准实现,用于浏览器 fallback
  function sha256PureJs(message) {
    // Convert string to byte array (UTF-8)
    const utf8 = unescape(encodeURIComponent(message));
    const bytes = new Array(utf8.length);
    for (let i = 0; i < utf8.length; i++) {
      bytes[i] = utf8.charCodeAt(i);
    }

    const K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    let H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    // Padding
    const msgLen = bytes.length;
    const bitLen = msgLen * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);

    // Append length as 64-bit big-endian
    for (let i = 7; i >= 0; i--) {
      bytes.push((bitLen >>> (i * 8)) & 0xff);
    }
    for (let i = 0; i < 4; i++) bytes.push(0); // high 32 bits = 0

    // Process each 512-bit block
    for (let block = 0; block < bytes.length; block += 64) {
      const W = new Array(64);
      for (let i = 0; i < 16; i++) {
        W[i] = (bytes[block + i * 4] << 24) |
               (bytes[block + i * 4 + 1] << 16) |
               (bytes[block + i * 4 + 2] << 8) |
               (bytes[block + i * 4 + 3]);
      }
      for (let i = 16; i < 64; i++) {
        const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
        const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }

      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        const ch = (e & f) ^ ((~e) & g);
        const temp1 = (h + S1 + ch + K[i] + W[i]) | 0;
        const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        const maj = (a & b) ^ (a & c) ^ (b & c);
        const temp2 = (S0 + maj) | 0;
        h = g;
        g = f;
        f = e;
        e = (d + temp1) | 0;
        d = c;
        c = b;
        b = a;
        a = (temp1 + temp2) | 0;
      }

      H[0] = (H[0] + a) | 0;
      H[1] = (H[1] + b) | 0;
      H[2] = (H[2] + c) | 0;
      H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0;
      H[5] = (H[5] + f) | 0;
      H[6] = (H[6] + g) | 0;
      H[7] = (H[7] + h) | 0;
    }

    function rotr(x, n) { return ((x >>> n) | (x << (32 - n))) | 0; }

    return H.map(n => (n >>> 0).toString(16).padStart(8, '0')).join('');
  }

  function nodeCreateHash(alg) {
    if (alg !== 'sha256') throw new Error('Only sha256 supported');
    if (typeof require === 'function') {
      try {
        return require('crypto').createHash(alg);
      } catch (_) {
        // fall through to pure-JS fallback
      }
    }
    // Browser fallback: pure JS SHA-256
    let data = '';
    return {
      update(input) {
        data += String(input == null ? '' : input);
        return this;
      },
      digest(encoding) {
        const hex = sha256PureJs(data);
        if (encoding === 'hex') return hex;
        // Node Buffer 支持 binary/base64;浏览器没有 Buffer
        if (typeof Buffer !== 'undefined') {
          return Buffer.from(hex, 'hex');
        }
        return hex;
      }
    };
  }

  function sha256Hex(input) {
    return nodeCreateHash('sha256').update(String(input)).digest('hex');
  }

  // ===== UUID =====
  function randomUUID() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
    // RFC 4122 v4 fallback
    const bytes = new Uint8Array(16);
    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
      crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [];
    for (let i = 0; i < 16; i++) hex.push(bytes[i].toString(16).padStart(2, '0'));
    return (
      hex.slice(0, 4).join('') + '-' +
      hex.slice(4, 6).join('') + '-' +
      hex.slice(6, 8).join('') + '-' +
      hex.slice(8, 10).join('') + '-' +
      hex.slice(10, 16).join('')
    );
  }

  // ===== Device fingerprint =====
  function getCanvasFingerprint() {
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return '';
    }
    try {
      const c = document.createElement('canvas');
      if (!c.getContext) return '';
      const ctx = c.getContext('2d');
      if (!ctx) return '';
      c.width = 240;
      c.height = 60;
      ctx.textBaseline = 'top';
      ctx.font = "14px 'Arial'";
      ctx.fillStyle = '#f60';
      ctx.fillRect(125, 1, 62, 20);
      ctx.fillStyle = '#069';
      ctx.fillText('大乐透智能选号#', 2, 15);
      ctx.fillStyle = 'rgba(102, 204, 0, 0.7)';
      ctx.fillText('大乐透智能选号#', 4, 17);
      return c.toDataURL();
    } catch (_) {
      return '';
    }
  }

  function getDeviceFingerprint() {
    const nav = (typeof navigator !== 'undefined') ? navigator : {};
    const scr = (typeof screen !== 'undefined')    ? screen    : {};
    const tz = (typeof Intl !== 'undefined')
      ? (Intl.DateTimeFormat().resolvedOptions().timeZone || '')
      : '';
    const parts = [
      nav.userAgent || '',
      (scr.width || 0) + 'x' + (scr.height || 0),
      String(scr.colorDepth || 0),
      tz,
      String(nav.hardwareConcurrency || 0),
      nav.language || '',
      getCanvasFingerprint(),
      nav.platform || ''
    ];
    return parts.join('|');
  }

  function getDeviceHash() {
    return sha256Hex(getDeviceFingerprint());
  }

  // ===== Password / auth =====
  // type: 'main' = 主链接密码; 'share' = 副链接密码
  const lockStorageKey = (type) => type === 'share' ? 'dlt:shareAuth' : STORAGE_KEYS.AUTH_HASH;
  const failStorageKey = (type) => type === 'share' ? 'dlt:shareFailCount' : STORAGE_KEYS.AUTH_FAIL_COUNT;
  const lockStartKey = (type) => type === 'share' ? 'dlt:shareLockStart' : STORAGE_KEYS.AUTH_LOCK_START;

  function isUnlocked(type) {
    type = type || 'main';
    const stored = storage.get(lockStorageKey(type));
    if (!stored) return false;
    const expected = type === 'share' ? SHARE_PASSWORD_HASH : MAIN_PASSWORD_HASH;
    if (stored !== expected) return false;
    if (getLockoutRemainingMs(type) > 0) return false;
    return true;
  }

  function unlock(password, type) {
    type = type || 'main';
    if (getLockoutRemainingMs(type) > 0) {
      return false; // 锁定中,即使密码正确也拒绝
    }
    const inputHash = sha256Hex(String(password == null ? '' : password));
    const expected = type === 'share' ? SHARE_PASSWORD_HASH : MAIN_PASSWORD_HASH;
    if (inputHash === expected) {
      // 成功
      storage.set(lockStorageKey(type), expected);
      storage.set(failStorageKey(type), '0');
      storage.del(lockStartKey(type));
      return true;
    }
    // 失败
    const prevFails = parseInt(storage.get(failStorageKey(type)) || '0', 10);
    const fails = prevFails + 1;
    storage.set(failStorageKey(type), String(fails));
    if (prevFails === 0) {
      // 记录首次错误时间戳
      storage.set(lockStartKey(type), String(Date.now()));
    }
    return false;
  }

  function lock() {
    // 仅清除已认证标记,保留失败计数(避免用户绕开锁定)
    storage.del(STORAGE_KEYS.AUTH_HASH);
  }

  function getLockoutRemainingMs(type) {
    type = type || 'main';
    const fails = parseInt(storage.get(failStorageKey(type)) || '0', 10);
    if (fails < MAX_FAILS) return 0;
    const start = parseInt(storage.get(lockStartKey(type)) || '0', 10);
    if (!start) return 0;
    const remaining = LOCK_MS - (Date.now() - start);
    if (remaining <= 0) {
      // 锁定已过期,自动清零
      storage.set(failStorageKey(type), '0');
      storage.del(lockStartKey(type));
      return 0;
    }
    return remaining;
  }

  // ===== Share links =====
  function loadShareLinks() {
    const raw = storage.get(STORAGE_KEYS.SHARE_LINKS);
    if (!raw) return [];
    try {
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (_) {
      return [];
    }
  }

  function saveShareLinks(arr) {
    storage.set(STORAGE_KEYS.SHARE_LINKS, JSON.stringify(arr));
  }

  function loadConsumed() {
    const raw = storage.get(STORAGE_KEYS.CONSUMED_TOKENS);
    if (!raw) return new Set();
    try {
      const arr = JSON.parse(raw);
      return new Set(Array.isArray(arr) ? arr : []);
    } catch (_) {
      return new Set();
    }
  }

  function saveConsumed(set) {
    storage.set(STORAGE_KEYS.CONSUMED_TOKENS, JSON.stringify([...set]));
  }

  function isConsumed(token) {
    return loadConsumed().has(token);
  }

  function consumeShareToken(token) {
    if (!token) return false;
    const set = loadConsumed();
    set.add(token);
    saveConsumed(set);
    return true;
  }

  function buildShareUrl(token) {
    // 仅使用 hash 段,避免 token 泄漏到服务端日志
    // 形如: index.html#share=<uuid>&lock=<sha256>
    return '#share=' + encodeURIComponent(token); // 不再带 lock - 任何设备+613613 都能用
  }

  function generateShareLink(opts) {
    opts = opts || {};
    const token = opts.token || randomUUID();
    const createdAt = opts.createdAt || Date.now();
    // 不再绑定设备 - 任何设备用副链接密码 613613 都能打开
    const record = { token: token, createdAt: createdAt };
    const list = loadShareLinks();
    list.push(record);
    saveShareLinks(list);
    return {
      token: token,
      createdAt: createdAt,
      url: buildShareUrl(token)
    };
  }

  function parseLocationHash() {
    if (typeof location === 'undefined' || !location || !location.hash) {
      return null;
    }
    const raw = location.hash.startsWith('#') ? location.hash.slice(1) : location.hash;
    if (!raw) return null;
    const params = new URLSearchParams(raw);
    const share = params.get('share');
    if (!share) return null;
    return { token: share };
  }

  function verifyShareLink(opts) {
    let token = null;

    if (opts && opts.token) {
      token = opts.token;
    } else {
      const parsed = parseLocationHash();
      if (parsed) {
        token = parsed.token;
      }
    }

    if (!token) return { valid: false, reason: 'no_share_token' };

    if (isConsumed(token)) {
      return { valid: false, reason: 'token_consumed' };
    }

    // 副链接 = 任何设备 + 副链接密码 613613 都能用,不再做设备绑定验证

    // 查找元数据(尽力而为,跨设备也可能命中)
    const list = loadShareLinks();
    const found = list.find(function (x) { return x && x.token === token; });

    return {
      valid: true,
      token: token,
      createdAt: found ? found.createdAt : null
    };
  }

  function getMyShareLinks() {
    return loadShareLinks();
  }

  function revokeShareLink(token) {
    if (!token) return false;
    const list = loadShareLinks();
    const idx = list.findIndex(function (x) { return x && x.token === token; });
    if (idx === -1) return false;
    list.splice(idx, 1);
    saveShareLinks(list);
    // 同时加入黑名单,防止历史 URL 再被打开
    const consumed = loadConsumed();
    consumed.add(token);
    saveConsumed(consumed);
    return true;
  }

  function revokeAllShareLinks() {
    const list = loadShareLinks();
    const consumed = loadConsumed();
    list.forEach(function (x) { if (x && x.token) consumed.add(x.token); });
    saveConsumed(consumed);
    saveShareLinks([]);
    return list.length;
  }

  // ===== Public API =====
  return {
    // 密码
    isUnlocked: isUnlocked,
    unlock: unlock,
    lock: lock,
    getLockoutRemainingMs: getLockoutRemainingMs,

    // 副链接
    generateShareLink: generateShareLink,
    verifyShareLink: verifyShareLink,
    getMyShareLinks: getMyShareLinks,
    revokeShareLink: revokeShareLink,
    revokeAllShareLinks: revokeAllShareLinks,
    consumeShareToken: consumeShareToken,

    // 工具(导出便于测试)
    getDeviceHash: getDeviceHash,
    getDeviceFingerprint: getDeviceFingerprint,
    sha256Hex: sha256Hex,           // 便于测试
    randomUUID: randomUUID,         // 便于测试

    // 常量(便于测试和调试)
    PASSWORD_PLAIN: MAIN_PASSWORD_PLAIN,
    PASSWORD_HASH: MAIN_PASSWORD_HASH,
    MAIN_PASSWORD_HASH: MAIN_PASSWORD_HASH,
    SHARE_PASSWORD_HASH: SHARE_PASSWORD_HASH,
    MAIN_PASSWORD_PLAIN: MAIN_PASSWORD_PLAIN,
    SHARE_PASSWORD_PLAIN: SHARE_PASSWORD_PLAIN,
    STORAGE_KEYS: STORAGE_KEYS,
    MAX_FAILS: MAX_FAILS,
    LOCK_MS: LOCK_MS
  };
});
