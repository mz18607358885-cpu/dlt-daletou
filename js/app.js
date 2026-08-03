// dist/js/app.js
// 大乐透智能选号 - 主应用入口
// 集成 CWLSource + Stats + Selector + Security

(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ===== 状态 =====
  const state = {
    isShareMode: false,
    shareLinkValid: false,
    groups: [],
    loading: false,
    currentPeriod: null,        // 当前显示的期号
    currentDate: null,           // 当前显示的开奖日期
    usingFallback: false,        // 是否使用 fallback 数据
  };

  // ===== 工具 =====
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  function show(id) { const el = document.getElementById(id); if (el) el.hidden = false; }
  function hide(id) { const el = document.getElementById(id); if (el) el.hidden = true; }

  function setText(id, text) { const el = document.getElementById(id); if (el) el.textContent = text; }

  // ===== 设备绑定(副链接 5 台设备上限) =====
  async function checkDeviceBinding(token) {
    const deviceHash = Security.getDeviceHash();
    const endpoint = '/.netlify/functions/device-auth';

    // 1. 查当前设备是否已在列表中
    const getResp = await fetch(`${endpoint}?token=${encodeURIComponent(token)}&device=${encodeURIComponent(deviceHash)}`);
    const getData = await getResp.json();

    if (getData.deviceAllowed) {
      return { allowed: true, count: getData.count, max: getData.max };
    }

    // 2. 不在列表 → 尝试注册(只有列表未满时才会成功)
    const postResp = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: token,
        deviceHash: deviceHash,
        action: 'register'
      })
    });
    const postData = await postResp.json();

    if (postData.allowed) {
      return { allowed: true, count: postData.count, max: postData.max, newlyRegistered: !postData.alreadyRegistered };
    }

    // 3. 注册失败(可能是设备数已满)
    return {
      allowed: false,
      reason: postData.reason || 'device_blocked',
      count: postData.count,
      max: postData.max
    };
  }

  // ===== 入口 =====
  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    setText('drawPeriod', '加载中…');
    setText('drawDate', '');

    // 1. 加载数据(优先静态,后台异步尝试升级)
    try {
      await loadData(false);
      // 后台静默升级(不阻塞 UI)
      CWLSource.tryUpgrade().then(function (upgraded) {
        if (upgraded) {
          // 数据升级成功,重新渲染
          Stats.loadHistory(upgraded);
          const last = Stats.getLastDraw();
          if (last) {
            setText('drawPeriod', last.期号);
            setText('drawDate', last.开奖日期);
            // 重新选号 + 刷新冷热统计
            renderGroups(Selector.generate(5));
            renderStats();
            // 刷新最新开奖卡片
            renderLatestDraw(last);
            setFooterStatus('✓ 已从体彩 API 实时升级 · ' + (upgraded.meta?.fetchedAt || ''));
          }
        }
      });
    } catch (e) {
      console.error('加载数据失败', e);
      setText('drawPeriod', '加载失败');
      setText('drawDate', e.message || '请稍后重试');
      return;
    }

    // 2. 检查 URL hash(副链接模式)
    const hash = window.location.hash;
    if (hash.includes('share=')) {
      // 副链接模式:验证设备绑定
      state.isShareMode = true;
      const verify = Security.verifyShareLink();
      if (verify && verify.valid) {
        state.shareToken = verify.token;  // 记录当前 share token,供设备管理用
        // 调用 Netlify Function 做设备绑定检查(5台上限)
        checkDeviceBinding(verify.token).then(deviceResult => {
          if (deviceResult.allowed) {
            state.shareLinkValid = true;
            showSharePasswordModal();
          } else {
            state.shareLinkValid = false;
            showShareModeInvalid(deviceResult.reason || 'device_blocked', deviceResult);
          }
        }).catch(err => {
          // 网络错误时,降级为通过(容错,不影响体验)
          console.warn('设备绑定检查失败,降级放行:', err);
          state.shareLinkValid = true;
          showSharePasswordModal();
        });
      } else {
        state.shareLinkValid = false;
        showShareModeInvalid(verify ? verify.reason : 'unknown');
      }
      return;
    }

    // 3. 正常模式:检查主密码解锁
    if (Security.isUnlocked('main')) {
      unlockUI();
      renderGroups(Selector.generate(5));
      renderStats();
      renderShareList();
    } else {
      showPasswordModal();
    }
  }

  // ===== 数据加载 =====
  async function loadData(forceRefresh) {
    if (state.loading) return;
    state.loading = true;

    // 显示加载状态
    if (forceRefresh) {
      setText('drawPeriod', '刷新中…');
      setText('drawDate', '');
    }

    try {
      const data = await CWLSource.loadDefault();
      if (data) {
        Stats.loadHistory(data);
        const last = Stats.getLastDraw();
        if (last) {
          state.currentPeriod = last.期号;
          state.currentDate = last.开奖日期;
          // 注意:实际真正"已开奖"的最后一期,可能 nextDraw 才是"当前等待开奖的"
          // 但 Stats 默认 getLastDraw 返回的是已开奖的最后一条
          setText('drawPeriod', last.期号);
          setText('drawDate', last.开奖日期);
        }
        // 数据来源判断
        const meta = data.meta || {};
        if (meta.source === 'sporttery.cn') {
          state.usingFallback = false;
          setFooterStatus('✓ 已连接体彩官方数据源 · ' + meta.fetchedAt);
        } else {
          state.usingFallback = true;
          setFooterStatus('⚠ 当前为本地缓存数据,刷新按钮重试实时');
        }
      }
    } finally {
      state.loading = false;
    }
  }

  function setFooterStatus(text) {
    const footer = document.querySelector('.footer span');
    if (footer) {
      // 保留第一个内容
      const firstPart = '⚠️ 仅供娱乐参考,理性购彩 · 凭主密码 918918 访问';
      footer.textContent = text || firstPart;
    }
  }

  // ===== 密码弹窗(主链接) =====
  function showPasswordModal() {
    show('passwordModal');
    const input = $('#passwordInput');
    input.value = '';
    input.placeholder = '请输入密码';
    input.type = 'password';
    input.maxLength = 6;
    input.focus();
    $('#passwordError').textContent = '';
    $('#passwordModalTitle').textContent = '请输入访问密码';
    $('#passwordModalHint').textContent = '这是私人智能选号工具,凭密码访问';
  }

  function showSharePasswordModal() {
    show('passwordModal');
    const input = $('#passwordInput');
    input.value = '';
    input.placeholder = '请输入副链接密码';
    input.type = 'password';
    input.maxLength = 6;
    input.focus();
    $('#passwordError').textContent = '';
    $('#passwordModalTitle').textContent = '副链接验证';
    $('#passwordModalHint').textContent = '此链接已绑定到指定设备,请输入副链接密码';
  }

  function hidePasswordModal() { hide('passwordModal'); }

  $('#passwordSubmit').addEventListener('click', tryUnlock);
  $('#passwordInput').addEventListener('keypress', e => {
    if (e.key === 'Enter') tryUnlock();
  });

  function tryUnlock() {
    const pw = $('#passwordInput').value.trim();
    // 判断是主链接还是副链接模式
    const type = state.isShareMode && state.shareLinkValid ? 'share' : 'main';
    const ok = Security.unlock(pw, type);
    if (ok) {
      hidePasswordModal();
      unlockUI();
      if (state.isShareMode) {
        // 副链接模式:只显示 banner + 5 组号 + 重新选号/更新/冷热,不显示副链接列表和分享按钮
        showShareMode();
      } else {
        // 主链接模式:显示完整的副链接列表
        renderShareList();
      }
      renderGroups(Selector.generate(5));
      renderStats();
    } else {
      const remaining = Security.getLockoutRemainingMs(type);
      if (remaining > 0) {
        const mins = Math.ceil(remaining / 60000);
        $('#passwordError').textContent = `密码错误次数过多,锁定 ${mins} 分钟后重试`;
      } else {
        const typeName = type === 'share' ? '副链接' : '主';
        $('#passwordError').textContent = `${typeName}密码错误,请重试`;
      }
    }
  }

  function unlockUI() {
    hide('passwordModal');
    show('mainContent');
    const last = Stats.getLastDraw();
    if (last) {
      setText('drawPeriod', last.期号);
      setText('drawDate', last.开奖日期);
      renderLatestDraw(last);
      startCountdown();
    }
  }

  // ===== 最新开奖结果卡片 =====
  function renderLatestDraw(draw) {
    if (!draw) return;
    setText('latestDrawPeriod', draw.期号);
    setText('latestDrawDate', draw.开奖日期);
    // 渲染号码球
    const frontHtml = (draw.前区 || []).map(n => `<div class="ball ball-front">${String(n).padStart(2, '0')}</div>`).join('');
    const backHtml = (draw.后区 || []).map(n => `<div class="ball ball-back">${String(n).padStart(2, '0')}</div>`).join('');
    setHTML('latestFrontBalls', frontHtml);
    setHTML('latestBackBalls', backHtml);
    // 检查是否过期(超过 3 天没新数据 = 可能有新一期未抓到)
    checkStale(draw);
  }

  function setHTML(id, html) {
    const el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  // 标记"可能已过期"
  function checkStale(draw) {
    const card = document.getElementById('latestDrawCard');
    if (!card || !draw) return;
    const lastDate = new Date(draw.开奖日期);
    const now = new Date();
    const daysSince = (now - lastDate) / 86400000;
    if (daysSince > 2) {
      card.classList.add('is-stale');
    } else {
      card.classList.remove('is-stale');
    }
  }

  // 计算下一期开奖时间:大乐透每周一、三、六 21:30
  function getNextDrawTime() {
    const now = new Date();
    const DRAWS = [1, 3, 6]; // 周一、三、六
    const DRAW_HOUR = 21;
    const DRAW_MIN = 30;

    // 找到下一个开奖日 21:30
    for (let offset = 0; offset < 14; offset++) {
      const d = new Date(now.getTime() + offset * 86400000);
      d.setHours(DRAW_HOUR, DRAW_MIN, 0, 0);
      if (DRAWS.includes(d.getDay()) && d.getTime() > now.getTime()) {
        return d;
      }
    }
    return null;
  }

  let _countdownTimer = null;
  function startCountdown() {
    if (_countdownTimer) clearInterval(_countdownTimer);
    function tick() {
      const target = getNextDrawTime();
      const el = document.getElementById('countdownTime');
      if (!el || !target) {
        if (el) el.textContent = '--';
        return;
      }
      const diff = target.getTime() - Date.now();
      if (diff <= 0) {
        // 已过开奖时间,提示"新一期可能已开奖"
        el.textContent = '🔔 新一期可能已开奖,点"立即刷新"查看';
        // 自动高亮卡片
        const card = document.getElementById('latestDrawCard');
        if (card) card.classList.add('is-stale');
        return;
      }
      const d = Math.floor(diff / 86400000);
      const h = Math.floor((diff % 86400000) / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      let txt = '';
      if (d > 0) txt += d + '天 ';
      txt += String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
      el.textContent = txt;
    }
    tick();
    _countdownTimer = setInterval(tick, 1000);
  }

  // ===== 渲染 5 组号 =====
  function renderGroups(groups) {
    state.groups = groups;
    const container = $('#groupsContainer');
    container.innerHTML = groups.map((g, i) => groupCardHtml(g, i)).join('');
  }

  function groupCardHtml(g, i) {
    const strategy = ['冷热平衡', '连号策略', '胆码集中', '温号集中', '跨度大'][i] || '智能组合';
    const labels = g.前区.map(num => {
      const item = Stats.getAllHotCold(30).前区.find(x => x.num === num);
      return item ? item.label : '温';
    });
    const coldTags = g.前区.filter((num, idx) => labels[idx] === '冷').map(n => `<span class="tag tag-cold">${n}</span>`).join('');
    const warmTags = g.前区.filter((num, idx) => labels[idx] === '温').map(n => `<span class="tag tag-warm">${n}</span>`).join('');
    const hotTags = g.前区.filter((num, idx) => labels[idx] === '热').map(n => `<span class="tag tag-hot">${n}</span>`).join('');

    const frontBalls = g.前区.map(n => `<div class="ball ball-front">${String(n).padStart(2, '0')}</div>`).join('');
    const backBalls = g.后区.map(n => `<div class="ball ball-back">${String(n).padStart(2, '0')}</div>`).join('');

    // 收藏:用 group 的 front+back 作为 key(同一组号只能收藏一次)
    const favKey = g.前区.join(',') + '|' + g.后区.join(',');
    const isFav = Favorites.has(favKey);

    return `
      <div class="group-card glass" data-group-idx="${i}">
        <button class="fav-btn ${isFav ? 'is-fav' : ''}" data-action="toggle-fav" data-fav-key="${favKey}" title="${isFav ? '取消收藏' : '收藏这组号'}">
          ${isFav ? '❤️' : '🤍'}
        </button>
        <div class="group-title">
          <span class="group-num">${i + 1}</span>
          <span class="group-strategy">${escapeHtml(strategy)}</span>
        </div>
        <div class="balls">
          ${frontBalls}
          <div class="ball-divider"></div>
          ${backBalls}
        </div>
        <div class="group-remark">
          <div class="remark-row"><span class="remark-label">和值</span> ${g.和值}</div>
          <div class="remark-row"><span class="remark-label">奇偶</span> ${escapeHtml(g.奇偶比)}</div>
          <div class="remark-row"><span class="remark-label">三区</span> ${escapeHtml(g.区间分布)}</div>
          <div class="remark-row"><span class="remark-label">冷热</span> ${escapeHtml(g.冷热分配)}</div>
          ${g.连号 !== '无' ? `<div class="remark-row"><span class="remark-label">连号</span> <span class="tag tag-info">${escapeHtml(g.连号)}</span></div>` : ''}
          ${g.区间23胆码.length ? `<div class="remark-row"><span class="remark-label">23 区间</span> <span class="tag tag-info">${g.区间23胆码.join(' ')}</span></div>` : ''}
          <div class="remark-row" style="margin-top:6px;">
            <span class="tag tag-cold">冷</span>${coldTags}
            <span class="tag tag-warm">温</span>${warmTags}
            <span class="tag tag-hot">热</span>${hotTags}
          </div>
          <div class="group-actions">
            <button class="btn btn-sm btn-primary" data-action="copy-group" data-group-idx="${i}" title="复制为体彩买票格式">
              <span class="btn-icon">📋</span> 复制这组号
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // ===== 收藏管理 =====
  const Favorites = (function () {
    const KEY = 'dlt:favorites';
    function load() {
      try {
        const raw = localStorage.getItem(KEY);
        if (!raw) return [];
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr : [];
      } catch (_) { return []; }
    }
    function save(arr) {
      localStorage.setItem(KEY, JSON.stringify(arr));
    }
    function has(key) {
      return load().some(f => f.key === key);
    }
    function add(key, payload) {
      const arr = load();
      if (arr.some(f => f.key === key)) return false;
      arr.unshift({
        key: key,
        group: payload.group,
        strategy: payload.strategy,
        period: payload.period || '',
        savedAt: Date.now()
      });
      save(arr);
      return true;
    }
    function remove(key) {
      const arr = load();
      const idx = arr.findIndex(f => f.key === key);
      if (idx === -1) return false;
      arr.splice(idx, 1);
      save(arr);
      return true;
    }
    function clear() {
      save([]);
    }
    function all() { return load(); }
    return { has, add, remove, clear, all, KEY };
  })();

  function updateFavCount() {
    const cnt = Favorites.all().length;
    const el = $('#favCount');
    if (el) el.textContent = cnt > 0 ? `(${cnt})` : '';
  }

  function renderFavorites() {
    const list = Favorites.all();
    const container = $('#favoritesList');
    if (!list.length) {
      container.innerHTML = '<div class="fav-empty">还没有收藏。点击卡片右上角 ❤️ 收藏喜欢的号码组。</div>';
      return;
    }
    container.innerHTML = list.map((f) => {
      const frontBalls = f.group.前区.map(n => `<div class="ball ball-front">${String(n).padStart(2, '0')}</div>`).join('');
      const backBalls = f.group.后区.map(n => `<div class="ball ball-back">${String(n).padStart(2, '0')}</div>`).join('');
      const dateStr = new Date(f.savedAt).toLocaleString('zh-CN', { hour12: false });
      return `
        <div class="group-card glass fav-item">
          <button class="fav-btn is-fav" data-action="remove-fav" data-fav-key="${f.key}" title="取消收藏">❤️</button>
          <div class="group-title">
            <span class="group-num">⭐</span>
            <span class="group-strategy">${escapeHtml(f.strategy || '收藏号码')}</span>
            <span class="fav-period">收藏于 ${dateStr}${f.period ? ' · 期号 ' + f.period : ''}</span>
          </div>
          <div class="balls">
            ${frontBalls}
            <div class="ball-divider"></div>
            ${backBalls}
          </div>
          <div class="group-actions">
            <button class="btn btn-sm btn-primary" data-action="copy-fav" data-fav-key="${f.key}" title="复制为体彩买票格式">
              <span class="btn-icon">📋</span> 复制这组号
            </button>
          </div>
        </div>
      `;
    }).join('');
  }

  // ===== 复制 =====
  function formatGroupForCopy(g) {
    // 体彩买票标准格式:前 5 个 + 后 2 个,空格分隔
    const all = g.前区.concat(g.后区);
    return all.map(n => String(n).padStart(2, '0')).join(' ');
  }

  function copyText(text) {
    // 优先用 Clipboard API
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(() => true).catch(() => fallbackCopy(text));
    }
    return Promise.resolve(fallbackCopy(text));
  }

  function fallbackCopy(text) {
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (_) { return false; }
  }

  function showCopyToast(msg) {
    let toast = $('#copyToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'copyToast';
      toast.className = 'copy-toast';
      document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => toast.classList.remove('show'), 1600);
  }

  // 卡片事件委托(收藏 + 复制)
  $('#groupsContainer').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'toggle-fav') {
      const key = btn.dataset.favKey;
      const card = btn.closest('.group-card');
      const idx = parseInt(card.dataset.groupIdx, 10);
      const g = state.groups[idx];
      const strategy = card.querySelector('.group-strategy')?.textContent || '';
      if (Favorites.has(key)) {
        Favorites.remove(key);
        btn.classList.remove('is-fav');
        btn.textContent = '🤍';
        showCopyToast('已取消收藏');
      } else {
        Favorites.add(key, { group: g, strategy: strategy, period: state.currentPeriod || '' });
        btn.classList.add('is-fav');
        btn.textContent = '❤️';
        showCopyToast('已收藏 ⭐');
      }
      updateFavCount();
    } else if (action === 'copy-group') {
      const idx = parseInt(btn.dataset.groupIdx, 10);
      const g = state.groups[idx];
      const text = formatGroupForCopy(g);
      copyText(text).then(ok => {
        showCopyToast(ok ? `已复制: ${text}` : '复制失败,请手动选择');
      });
    }
  });

  // 收藏面板事件委托
  $('#favoritesList').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const key = btn.dataset.favKey;
    if (action === 'remove-fav') {
      Favorites.remove(key);
      renderFavorites();
      updateFavCount();
      // 同步主页面爱心按钮状态
      const mainBtn = document.querySelector(`#groupsContainer button[data-fav-key="${CSS.escape(key)}"]`);
      if (mainBtn) {
        mainBtn.classList.remove('is-fav');
        mainBtn.textContent = '🤍';
      }
      showCopyToast('已取消收藏');
    } else if (action === 'copy-fav') {
      const list = Favorites.all();
      const item = list.find(f => f.key === key);
      if (item) {
        const text = formatGroupForCopy(item.group);
        copyText(text).then(ok => {
          showCopyToast(ok ? `已复制: ${text}` : '复制失败,请手动选择');
        });
      }
    }
  });

  // 切换收藏面板显示
  $('#btnToggleFavorites').addEventListener('click', () => {
    const panel = $('#favoritesPanel');
    if (panel.hidden) {
      renderFavorites();
      panel.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } else {
      panel.hidden = true;
    }
  });

  $('#btnClearFavorites').addEventListener('click', () => {
    if (Favorites.all().length === 0) {
      showCopyToast('没有收藏可以清空');
      return;
    }
    if (confirm('确认清空所有收藏?此操作不可恢复。')) {
      Favorites.clear();
      renderFavorites();
      updateFavCount();
      // 同步主页面所有爱心按钮
      document.querySelectorAll('#groupsContainer button[data-fav-key]').forEach(b => {
        b.classList.remove('is-fav');
        b.textContent = '🤍';
      });
      showCopyToast('已清空收藏');
    }
  });

  // ===== 设备管理(副链接绑定) =====
  async function fetchDeviceList(token) {
    const url = '/.netlify/functions/device-auth?token=' + encodeURIComponent(token);
    const resp = await fetch(url);
    return await resp.json();
  }

  async function removeDevice(token, deviceHash) {
    const resp = await fetch('/.netlify/functions/device-auth', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, deviceHash })
    });
    return await resp.json();
  }

  async function clearAllDevices(token) {
    const resp = await fetch('/.netlify/functions/device-auth', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token })
    });
    return await resp.json();
  }

  function formatDateTime(ts) {
    if (!ts) return '—';
    const d = new Date(ts);
    const pad = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  // filterToken: 副链接模式 = 当前 token;主链接模式 = undefined(全部)
  async function renderDevices(filterToken) {
    const allLinks = Security.getMyShareLinks();
    // 过滤(副链接模式只显示自己)
    const links = filterToken
      ? allLinks.filter(l => l.token === filterToken)
      : allLinks;
    const container = $('#devicesList');

    // 副链接模式:加上提示
    const isShareView = !!filterToken;

    if (!links.length) {
      container.innerHTML = isShareView
        ? '<div class="fav-empty">本副链接未在本设备生成过,无法查看设备列表。<br/><small>设备管理只有创建过副链接的设备才看得到。</small></div>'
        : '<div class="fav-empty">还没有副链接。先生成一个副链接(主页面点"生成分享副链接"),再回来这里管理设备。</div>';
      return;
    }

    // 并发查询每个 token 的设备数(只拉摘要,具体设备点展开才拉)
    const summaries = await Promise.all(links.map(async (link) => {
      try {
        const data = await fetchDeviceList(link.token);
        return { link, data };
      } catch (e) {
        return { link, data: { ok: false, error: e.message, count: 0, max: 5, devices: [] } };
      }
    }));

    // 副链接模式:默认展开;主链接模式:默认折叠
    container.innerHTML = summaries.map(({ link, data }) => {
      const full = data.full || data.count >= data.max;
      const statusClass = full ? 'is-full' : (data.count > 0 ? 'is-partial' : 'is-empty');
      const statusText = full ? '已满' : (data.count > 0 ? `${data.count}/${data.max} 台` : '空');
      const shortToken = link.token.substring(0, 8) + '...';
      const createdAt = link.createdAt ? formatDateTime(link.createdAt) : '—';
      const defaultExpanded = isShareView || data.devices.length === 0;
      return `
        <div class="device-link-card glass-inner" data-token="${escapeHtml(link.token)}" data-expanded="${defaultExpanded}">
          <div class="device-link-header">
            <div class="device-link-info">
              <code class="device-link-token">${shortToken}</code>
              <span class="device-link-created">生成于 ${createdAt}</span>
            </div>
            <span class="device-link-status ${statusClass}">${statusText}</span>
            <button class="btn btn-sm btn-ghost device-toggle" data-action="toggle-detail" data-token="${escapeHtml(link.token)}">${defaultExpanded ? '收起' : '查看设备'}</button>
          </div>
          <div class="device-list" data-token="${escapeHtml(link.token)}" ${defaultExpanded ? '' : 'hidden'}>
            ${data.devices.length === 0 ? '<div class="device-empty">暂无设备绑定</div>' :
              data.devices.map(d => `
                <div class="device-row ${d.isCurrent ? 'is-current' : ''}" data-hash="${escapeHtml(d.hash)}">
                  <code class="device-hash">${escapeHtml(d.hashShort)}</code>
                  <span class="device-time">${formatDateTime(d.firstSeen)}</span>
                  ${d.isCurrent ? '<span class="device-tag">当前设备</span>' : ''}
                  <button class="btn btn-sm btn-ghost device-remove" data-action="remove-device" data-token="${escapeHtml(link.token)}" data-hash="${escapeHtml(d.hash)}">移除</button>
                </div>
              `).join('')
            }
          </div>
          ${data.devices.length > 0 ? `
            <div class="device-link-actions" ${defaultExpanded ? '' : 'hidden'} data-token="${escapeHtml(link.token)}">
              <button class="btn btn-sm btn-ghost" data-action="clear-devices" data-token="${escapeHtml(link.token)}">清空该链接所有设备</button>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');
  }

  $('#btnToggleDevices').addEventListener('click', async () => {
    const panel = $('#devicesPanel');
    if (panel.hidden) {
      panel.hidden = false;
      panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      // 副链接模式:隐藏查询框(自己就是查询结果)
      if (state.isShareMode) {
        $('#deviceSearchBox').style.display = 'none';
      } else {
        $('#deviceSearchBox').style.display = 'flex';
        $('#deviceSearchResult').innerHTML = '';
      }
      $('#devicesList').innerHTML = '<div class="fav-empty">加载中...</div>';
      try {
        // 副链接模式:只显示当前 token;主链接模式:全部
        const filterToken = state.isShareMode ? state.shareToken : null;
        await renderDevices(filterToken);
      } catch (e) {
        $('#devicesList').innerHTML = `<div class="fav-empty">加载失败: ${escapeHtml(e.message)}</div>`;
      }
    } else {
      panel.hidden = true;
    }
  });

  // ===== 查询任意副链接设备(主链接模式) =====
  function renderDeviceSearchResult(data, token) {
    const container = $('#deviceSearchResult');
    if (!data.ok) {
      container.innerHTML = `<div class="fav-empty">查询失败: ${escapeHtml(data.error || '未知错误')}</div>`;
      return;
    }
    const full = data.full || data.count >= data.max;
    const statusClass = full ? 'is-full' : (data.count > 0 ? 'is-partial' : 'is-empty');
    const statusText = full ? '已满' : (data.count > 0 ? `${data.count}/${data.max} 台` : '空');
    const shortToken = token.length > 14 ? token.substring(0, 14) + '...' : token;
    container.innerHTML = `
      <div class="device-link-card glass-inner">
        <div class="device-link-header">
          <div class="device-link-info">
            <code class="device-link-token">${escapeHtml(shortToken)}</code>
            <span class="device-link-created">查询结果</span>
          </div>
          <span class="device-link-status ${statusClass}">${statusText}</span>
          <button class="btn btn-sm btn-ghost" id="deviceSearchBack">返回列表</button>
        </div>
        <div class="device-list">
          ${data.devices.length === 0 ? '<div class="device-empty">该副链接暂无设备绑定</div>' :
            data.devices.map(d => `
              <div class="device-row">
                <code class="device-hash">${escapeHtml(d.hashShort)}</code>
                <span class="device-time">${formatDateTime(d.firstSeen)}</span>
                ${d.isCurrent ? '<span class="device-tag">当前设备</span>' : ''}
              </div>
            `).join('')
          }
        </div>
      </div>
    `;
    $('#deviceSearchBack').addEventListener('click', () => {
      container.innerHTML = '';
      $('#deviceSearchInput').value = '';
    });
  }

  $('#deviceSearchBtn').addEventListener('click', async () => {
    const token = $('#deviceSearchInput').value.trim();
    if (!token) {
      showCopyToast('请输入 token');
      return;
    }
    if (!/^[0-9a-f-]{36}$/i.test(token)) {
      showCopyToast('token 格式不对,应该是 UUID 格式');
      return;
    }
    const btn = $('#deviceSearchBtn');
    btn.disabled = true;
    btn.textContent = '查询中...';
    try {
      const data = await fetchDeviceList(token);
      renderDeviceSearchResult(data, token);
    } catch (e) {
      renderDeviceSearchResult({ ok: false, error: e.message }, token);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔍 查询';
    }
  });

  // 回车触发查询
  $('#deviceSearchInput').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') $('#deviceSearchBtn').click();
  });

  // 设备管理事件委托
  $('#devicesList').addEventListener('click', async (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    const token = btn.dataset.token;
    if (!token) return;

    if (action === 'toggle-detail') {
      // 展开/收起某个副链接的设备详情
      const card = btn.closest('.device-link-card');
      const list = card.querySelector('.device-list');
      const actions = card.querySelector('.device-link-actions');
      const isHidden = list.hidden;
      list.hidden = !isHidden;
      if (actions) actions.hidden = !isHidden;
      btn.textContent = isHidden ? '收起' : '查看设备';
      card.dataset.expanded = isHidden ? 'true' : 'false';
      return;
    }

    if (action === 'remove-device') {
      const deviceHash = btn.dataset.hash;
      if (!deviceHash) return;
      if (!confirm('确认移除这台设备?该设备将无法再使用此副链接。')) return;
      btn.disabled = true;
      btn.textContent = '移除中...';
      try {
        const res = await removeDevice(token, deviceHash);
        if (res.ok) {
          showCopyToast('设备已移除');
          await renderDevices();
        } else {
          showCopyToast('移除失败: ' + (res.error || '未知错误'));
          btn.disabled = false;
          btn.textContent = '移除';
        }
      } catch (err) {
        showCopyToast('网络错误');
        btn.disabled = false;
        btn.textContent = '移除';
      }
    } else if (action === 'clear-devices') {
      if (!confirm('确认清空该副链接的所有设备?所有已绑设备都将无法再使用此副链接。')) return;
      btn.disabled = true;
      try {
        const res = await clearAllDevices(token);
        if (res.ok) {
          showCopyToast('已清空该链接所有设备');
          await renderDevices();
        } else {
          showCopyToast('清空失败: ' + (res.error || '未知错误'));
        }
      } catch (err) {
        showCopyToast('网络错误');
      } finally {
        btn.disabled = false;
      }
    }
  });

  // ===== 操作按钮 =====
  $('#btnRegenerate').addEventListener('click', () => {
    renderGroups(Selector.generate(5));
  });

  // 强制刷新数据(从体彩 API 重新拉)
  $('#btnAdvance').addEventListener('click', async () => {
    if (state.loading) return;
    const btn = $('#btnAdvance');
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="btn-icon">⏳</span> 正在拉取最新...';
    btn.disabled = true;
    try {
      await loadData(true);
      renderGroups(Selector.generate(5));
      renderStats();
      // 重新渲染最新开奖卡片
      const last = Stats.getLastDraw();
      if (last) renderLatestDraw(last);
      btn.innerHTML = '<span class="btn-icon">✓</span> 已更新到 ' + state.currentPeriod;
      setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000);
    } catch (e) {
      btn.innerHTML = '<span class="btn-icon">✗</span> 失败: ' + (e.message || '网络错误');
      setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 3000);
    }
  });

  // '立即刷新'按钮(在最新开奖卡片里)
  $('#btnRefreshLatest').addEventListener('click', async () => {
    if (state.loading) return;
    const btn = $('#btnRefreshLatest');
    const orig = btn.innerHTML;
    btn.innerHTML = '⏳ 刷新中...';
    btn.disabled = true;
    try {
      await loadData(true);
      renderGroups(Selector.generate(5));
      renderStats();
      const last = Stats.getLastDraw();
      if (last) renderLatestDraw(last);
      btn.innerHTML = '✓ 已刷新';
      setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000);
    } catch (e) {
      btn.innerHTML = '✗ 失败';
      setTimeout(() => { btn.innerHTML = orig; btn.disabled = false; }, 2000);
    }
  });

  $('#btnShare').addEventListener('click', () => {
    const result = Security.generateShareLink();
    const fullUrl = window.location.origin + window.location.pathname + result.url;
    $('#shareUrlInput').value = fullUrl;
    show('shareModal');
    setTimeout(() => $('#shareUrlInput').select(), 100);
    renderShareList();
  });

  $('#copyShareUrl').addEventListener('click', () => {
    const input = $('#shareUrlInput');
    input.select();
    try {
      document.execCommand('copy');
      $('#copyShareUrl').textContent = '已复制';
      setTimeout(() => { $('#copyShareUrl').textContent = '复制'; }, 1500);
    } catch (e) {
      console.error('复制失败', e);
    }
  });

  $('#closeShareModal').addEventListener('click', () => hide('shareModal'));

  $('#btnToggleStats').addEventListener('click', () => {
    const panel = $('#statsPanel');
    if (panel.hidden) show('statsPanel');
    else hide('statsPanel');
  });

  // ===== 副链接列表 =====
  function renderShareList() {
    const list = Security.getMyShareLinks();
    const ul = $('#shareList');
    if (list.length === 0) {
      ul.innerHTML = '<li class="share-info">还没有副链接,点上方"生成分享副链接"创建</li>';
      show('sharesPanel');
      return;
    }
    ul.innerHTML = list.map(link => {
      const created = new Date(link.createdAt).toLocaleString('zh-CN');
      return `
        <li class="share-item">
          <div class="share-meta">
            <span class="share-token">${escapeHtml((link.token || '').substring(0, 8))}…</span>
            <span class="share-info">${escapeHtml((link.deviceHash || '通用').substring(0, 6))}… · ${escapeHtml(created)}</span>
          </div>
          <div class="share-actions">
            <button class="btn btn-ghost btn-sm" data-token="${escapeHtml(link.token)}" data-action="copy">复制</button>
            <button class="btn btn-ghost btn-sm" data-token="${escapeHtml(link.token)}" data-action="revoke">撤销</button>
          </div>
        </li>
      `;
    }).join('');

    ul.querySelectorAll('button[data-action]').forEach(btn => {
      btn.addEventListener('click', e => {
        const token = e.target.dataset.token;
        const action = e.target.dataset.action;
        if (action === 'revoke') {
          if (confirm('确认撤销这个副链接?撤销后无法再访问。')) {
            Security.revokeShareLink(token);
            renderShareList();
          }
        } else if (action === 'copy') {
          const url = window.location.origin + window.location.pathname + '#share=' + token;  // 副链接无 lock
          const ta = document.createElement('textarea');
          ta.value = url;
          document.body.appendChild(ta);
          ta.select();
          try { document.execCommand('copy'); e.target.textContent = '已复制'; setTimeout(() => { e.target.textContent = '复制'; }, 1500); } catch (_) {}
          document.body.removeChild(ta);
        }
      });
    });

    show('sharesPanel');
  }

  // ===== 冷热统计可视化 =====
  function renderStats() {
    const all = Stats.getAllHotCold(30);
    const frontContainer = $('#frontBalls');
    const backContainer = $('#backBalls');

    frontContainer.innerHTML = all.前区.map(item => {
      const gradient = item.label === '热' ? 'var(--hot-color)' : item.label === '温' ? 'var(--warm-color)' : 'var(--cold-color)';
      const title = `号 ${item.num} · ${item.label} · 出现 ${item.count} 次 · 当前遗漏 ${item.currentMiss} · 最大遗漏 ${item.maxMiss}`;
      return `<div class="stat-ball" style="background: ${gradient};" title="${escapeHtml(title)}">${String(item.num).padStart(2, '0')}<span class="stat-count">${item.count}</span></div>`;
    }).join('');

    backContainer.innerHTML = all.后区.map(item => {
      const gradient = item.label === '热' ? 'var(--hot-color)' : item.label === '温' ? 'var(--warm-color)' : 'var(--cold-color)';
      const title = `号 ${item.num} · ${item.label} · 出现 ${item.count} 次 · 当前遗漏 ${item.currentMiss} · 最大遗漏 ${item.maxMiss}`;
      return `<div class="stat-ball" style="background: ${gradient};" title="${escapeHtml(title)}">${String(item.num).padStart(2, '0')}<span class="stat-count">${item.count}</span></div>`;
    }).join('');
  }

  // ===== 副链接模式 UI =====
  // 副链接 = 独立的"只读浏览 + 重新选号"模式
  // 跟主链接唯一区别:不能生成分享副链接,其他功能(重新选号/更新最新一期/冷热统计)全保留
  // 不显示任何 banner(纯净界面)
  function showShareMode() {
    // 不显示 banner
    hide('shareModeBanner');
    // 隐藏"生成分享副链接"按钮 - 副链接不能再分享
    $('#btnShare').style.display = 'none';
    // 隐藏副链接列表
    hide('sharesPanel');
    // 设备管理按钮在副链接模式仍然可用(只看自己这个 token)
    // 默认显示(已经在 index.html 里)
  }

  function showShareModeInvalid(reason, extra) {
    document.querySelector('.main')?.remove();
    const isDeviceLimit = reason === 'device_limit_reached';
    const title = isDeviceLimit ? '设备数已满' : '链接无效';
    const icon = isDeviceLimit ? '🚫' : '🔒';
    let desc = '';
    if (isDeviceLimit) {
      desc = `此副链接已绑定 <strong>${extra?.count ?? 5}</strong> 台设备(上限 ${extra?.max ?? 5} 台),<br/>无法在新设备上打开。<br/><br/>请联系分享者:<br/>• 在已绑定的设备上撤销一台,或<br/>• 重新生成新的副链接`;
    } else {
      desc = '此副链接无法访问。<br/>' + (reason ? '原因: ' + escapeHtml(reason) : '');
    }
    document.body.innerHTML = `
      <div class="bg-orbs">
        <div class="orb orb-1"></div>
        <div class="orb orb-2"></div>
      </div>
      <div style="position:relative; z-index:10; padding:60px 20px; text-align:center;">
        <div class="glass" style="max-width:480px; margin:0 auto; padding:40px;">
          <div style="font-size:64px; margin-bottom:16px;">${icon}</div>
          <h2 style="margin-bottom:12px;">${title}</h2>
          <p style="color: rgba(255,255,255,0.7); margin-bottom:24px;">${desc}</p>
          <a href="${window.location.pathname}" class="btn btn-primary btn-block">返回主页</a>
        </div>
      </div>
    `;
  }

  // exitShareMode 按钮已移除(副链接模式不再提供"返回主页")
})();
