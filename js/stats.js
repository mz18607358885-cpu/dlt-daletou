// js/stats.js
// 冷热统计模块 - 大乐透 (Super Lotto)
// 浏览器/Node 双端可用,无任何 npm 依赖
//
// 暴露 API:
//   getHotCold(n, window)        - 单个号码 n 的冷热统计
//   getAllHotCold(window)        - 所有号码(前区 1-35 + 后区 1-12)
//   getLastDraw()                - 最新一期(已开奖)
//   getNextDraw()                - 模拟的下一期
//   advanceToNextDraw()          - 把 nextDraw 升级为 lastDraw,生成新 nextDraw
//   loadHistory(data)            - 加载历史数据 (data = {draws, nextDraw})
//   getHistory()                 - 取得当前加载的原始数据
//
// 用法 (浏览器):
//   <script src="js/cwl_source.js"></script>
//   <script src="js/stats.js"></script>
//   CWLSource.loadDefault().then(() => {
//     console.log(Stats.getAllHotCold(30));
//   });
//
// 用法 (Node):
//   const path = require('path');
//   const fs = require('fs');
//   const history = JSON.parse(fs.readFileSync(path.join(__dirname, 'data/history.json')));
//   const Stats = require('./js/stats');
//   Stats.loadHistory(history);
//   console.log(Stats.getAllHotCold(30));

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Stats = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== Internal state =====
  let _history = null;     // { draws: [...], nextDraw: {...} }
  let _loaded = false;

  // ===== Utilities =====

  // 取最近 window 期(从已开奖数据末尾),不足 window 用全部
  function recentDraws(window) {
    if (!_history || !Array.isArray(_history.draws)) return [];
    const all = _history.draws;
    if (!window || window >= all.length) return all.slice();
    return all.slice(all.length - window);
  }

  // 统计号码 n 在指定期数集合的 出现次数/最大遗漏/当前遗漏
  // (保留作为通用工具,但 getHotCold 实际使用 statInZone)
  function statNumber(draws, n, pool) {
    let count = 0;
    let maxMiss = 0;
    let currentMiss = 0;
    let lastSeenIdx = -1;
    for (let i = 0; i < draws.length; i++) {
      const hit = draws[i].前区.includes(n) || draws[i].后区.includes(n);
      if (hit) {
        count++;
        if (lastSeenIdx >= 0) {
          const miss = i - lastSeenIdx - 1;
          if (miss > maxMiss) maxMiss = miss;
        }
        lastSeenIdx = i;
      }
    }
    if (lastSeenIdx === -1) {
      currentMiss = draws.length;
      maxMiss = draws.length;
    } else {
      currentMiss = draws.length - 1 - lastSeenIdx;
    }
    return { count, maxMiss, currentMiss };
  }

  // 严格按 pool 判定 (front 1-35, back 1-12)
  function statInZone(draws, n, zone) {
    // zone: '前区' | '后区'
    let count = 0;
    let maxMiss = 0;
    let currentMiss = 0;
    let lastSeenIdx = -1;
    for (let i = 0; i < draws.length; i++) {
      const hit = draws[i][zone].indexOf(n) !== -1;
      if (hit) {
        count++;
        if (lastSeenIdx >= 0) {
          const miss = i - lastSeenIdx - 1;
          if (miss > maxMiss) maxMiss = miss;
        }
        lastSeenIdx = i;
      }
    }
    if (lastSeenIdx === -1) {
      currentMiss = draws.length;
      maxMiss = draws.length;
    } else {
      currentMiss = draws.length - 1 - lastSeenIdx;
    }
    return { count, maxMiss, currentMiss };
  }

  // 冷热标签 (按 count 阈值)
  //   热号: count >= 6
  //   温号: 3 <= count <= 5
  //   冷号: count <= 2
  function labelByCount(count) {
    if (count >= 6) return '热';
    if (count >= 3) return '温';
    return '冷';
  }

  // 在前区/后区查找号码 n(根据值域)
  function zoneOf(n) {
    if (n >= 1 && n <= 35) return '前区';
    if (n >= 1 && n <= 12) return '后区';
    return null;
  }

  // ===== Public API =====

  function loadHistory(data) {
    if (!data || !Array.isArray(data.draws)) {
      throw new Error('loadHistory: data.draws must be an array');
    }
    _history = {
      draws: data.draws.slice(),
      nextDraw: data.nextDraw || null,
    };
    _loaded = true;
    return true;
  }

  function getHistory() {
    return _history;
  }

  function isLoaded() {
    return _loaded;
  }

  function getLastDraw() {
    if (!_history || !_history.draws || _history.draws.length === 0) return null;
    return _history.draws[_history.draws.length - 1];
  }

  function getNextDraw() {
    if (!_history) return null;
    return _history.nextDraw;
  }

  // 把 nextDraw 提升为 lastDraw,然后生成新的 nextDraw
  // 内部使用的随机算法与 data/_generate.js 一致 (mulberry32)
  // 真实环境应该由后端推送,这里保证可演示
  function advanceToNextDraw(opts) {
    if (!_history) throw new Error('advanceToNextDraw: no history loaded');
    const oldNext = _history.nextDraw;
    if (!oldNext) throw new Error('advanceToNextDraw: no current nextDraw');

    // 推入 lastDraw
    _history.draws.push({
      期号: oldNext.期号,
      开奖日期: oldNext.开奖日期,
      前区: oldNext.前区.slice(),
      后区: oldNext.后区.slice(),
    });

    // 解析当前 last 周期号,推算下一期
    const lastPeriod = parseInt(oldNext.期号, 10);
    const newPeriod = String(lastPeriod + 1);

    // 推算日期:大乐透每周一/三/六开奖
    // 简单策略: 上一期日期 + 2 或 3 天
    const lastDate = new Date(oldNext.开奖日期 + 'T00:00:00Z');
    const nextDate = new Date(lastDate.getTime() + 2 * 86400000); // +2 天
    // 调整到周一周三周六
    const dayOfWeek = nextDate.getUTCDay(); // 0=Sun, 1=Mon, 3=Wed, 6=Sat
    let addDays = 0;
    if (dayOfWeek === 0) addDays = 1;       // Sun -> Mon
    else if (dayOfWeek === 2) addDays = 1;  // Tue -> Wed
    else if (dayOfWeek === 4) addDays = 2;  // Thu -> Sat
    else if (dayOfWeek === 5) addDays = 1;  // Fri -> Sat
    // Mon, Wed, Sat 不变
    if (addDays > 0) nextDate.setUTCDate(nextDate.getUTCDate() + addDays);
    const newDateStr = nextDate.toISOString().slice(0, 10);

    // 选号 (确定性伪随机,基于周期号)
    const rng = mulberry32(lastPeriod * 7919 + 1);
    const newFront = pickFront(rng);
    const newBack = pickBack(rng);

    _history.nextDraw = {
      期号: newPeriod,
      开奖日期: newDateStr,
      前区: newFront,
      后区: newBack,
    };

    return _history.nextDraw;
  }

  // ===== Pseudo random helpers (must mirror data/_generate.js) =====
  function mulberry32(seed) {
    let s = seed | 0;
    return function () {
      s = (s + 0x6d2b79f5) | 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const FRONT_WEIGHTS = new Array(36).fill(1).map((_, i) => {
    if (i >= 8 && i <= 26) return 1.15;
    if (i <= 5 || i >= 31) return 0.85;
    return 1.0;
  });
  const BACK_WEIGHTS = new Array(13).fill(1).map((_, i) => {
    if (i >= 4 && i <= 9) return 1.15;
    return 0.95;
  });

  function weightedPick(rng, max, weights) {
    let total = 0;
    for (let i = 1; i <= max; i++) total += weights[i];
    let r = rng() * total;
    for (let i = 1; i <= max; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return max;
  }

  function pickFront(rng) {
    const picked = new Set();
    while (picked.size < 5) {
      picked.add(weightedPick(rng, 35, FRONT_WEIGHTS));
    }
    return [...picked].sort((a, b) => a - b);
  }

  function pickBack(rng) {
    const picked = new Set();
    while (picked.size < 2) {
      picked.add(weightedPick(rng, 12, BACK_WEIGHTS));
    }
    return [...picked].sort((a, b) => a - b);
  }

  // ===== Public stat functions =====

  /**
   * 单个号码 n 的冷热统计
   * @param {number} n - 号码 (1-35 为前区, 1-12 也可作为后区,按值域自动判定)
   * @param {number} [window=30] - 统计窗口期数
   * @returns {{前区: object, 后区: object}|object}
   *   如果 n 严格在前区(>12) 或严格在后区(<=12 且 n>0),返回单 zone 对象
   *   否则返回双 zone 对象
   */
  function getHotCold(n, window) {
    if (!_loaded) {
      throw new Error('Stats: history not loaded. Call Stats.loadHistory() or load via cwl_source.js first.');
    }
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
      throw new Error('getHotCold: n must be a positive integer');
    }
    window = window || 30;
    const draws = recentDraws(window);

    // 1-12 同时可能在前区也可能在后区;按用户意图解释:
    // 大乐透规则中 1-12 同时存在于前区和后区集合里,
    // 真实场景下查询"号码 5"通常指:前区的 5 还是后区的 5?
    // 此处策略: 同时返回两套统计,标签独立判断
    const result = {};
    if (n >= 1 && n <= 35) {
      const s = statInZone(draws, n, '前区');
      result.前区 = {
        [n]: {
          count: s.count,
          maxMiss: s.maxMiss,
          currentMiss: s.currentMiss,
          label: labelByCount(s.count),
        },
      };
    }
    if (n >= 1 && n <= 12) {
      const s = statInZone(draws, n, '后区');
      result.后区 = {
        [n]: {
          count: s.count,
          maxMiss: s.maxMiss,
          currentMiss: s.currentMiss,
          label: labelByCount(s.count),
        },
      };
    }
    return result;
  }

  /**
   * 所有号码的冷热统计
   * @param {number} [window=30]
   * @returns {{前区: Array, 后区: Array, meta: object}}
   */
  function getAllHotCold(window) {
    if (!_loaded) {
      throw new Error('Stats: history not loaded. Call Stats.loadHistory() or load via cwl_source.js first.');
    }
    window = window || 30;
    const draws = recentDraws(window);

    const front = [];
    for (let n = 1; n <= 35; n++) {
      const s = statInZone(draws, n, '前区');
      front.push({
        num: n,
        count: s.count,
        maxMiss: s.maxMiss,
        currentMiss: s.currentMiss,
        label: labelByCount(s.count),
      });
    }
    const back = [];
    for (let n = 1; n <= 12; n++) {
      const s = statInZone(draws, n, '后区');
      back.push({
        num: n,
        count: s.count,
        maxMiss: s.maxMiss,
        currentMiss: s.currentMiss,
        label: labelByCount(s.count),
      });
    }
    return {
      前区: front,
      后区: back,
      meta: {
        window: window,
        actualDraws: draws.length,
        totalDraws: _history.draws.length,
        // 汇总
        summary: {
          前区热: front.filter(x => x.label === '热').length,
          前区温: front.filter(x => x.label === '温').length,
          前区冷: front.filter(x => x.label === '冷').length,
          后区热: back.filter(x => x.label === '热').length,
          后区温: back.filter(x => x.label === '温').length,
          后区冷: back.filter(x => x.label === '冷').length,
        },
      },
    };
  }

  // ===== Expose =====
  return {
    loadHistory,
    getHistory,
    isLoaded,
    getLastDraw,
    getNextDraw,
    advanceToNextDraw,
    getHotCold,
    getAllHotCold,
    // 暴露工具函数,便于测试
    _internal: { statInZone, labelByCount, recentDraws },
  };
});
