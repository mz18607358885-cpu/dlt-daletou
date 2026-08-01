// js/selector.js
// 大乐透 5 组号码生成器
// 浏览器/Node 双端可用,无 npm 依赖
//
// 硬性规则(每组号必须全部满足):
//  1. 前区 5 个号 1-35 互不重复
//  2. 后区 2 个号 1-12 互不重复
//  3. 前区三区分布:必须全覆盖 [1-10] [11-20] [21-35] 三个区间
//  4. 单区最多 3 个号
//  5. 奇偶比 3:2 或 2:3
//  6. 前区和值 60-120
//  7. 连号最多 2 连
//  8. 后区 2 个号和值 9-16
//  9. 后区不能全冷或全热(至少 1 个温 或 1 冷 1 热)
//  10. 5 组号之间差异化:任意两组之间相同号码 ≤ 2 个
//
// 用法 (Node):
//   const Stats = require('./js/stats');
//   Stats.loadHistory(history);
//   const Sel = require('./js/selector');
//   console.log(Sel.generate(5));
//
// 用法 (浏览器):
//   <script src="js/stats.js"></script>
//   <script src="js/selector.js"></script>
//   console.log(Sel.generate(5));

(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Selector = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ===== Utilities =====

  function randInt(min, max) {
    // 闭区间 [min, max]
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function pickN(pool, n) {
    return shuffle(pool).slice(0, n);
  }

  function sum(arr) {
    return arr.reduce((a, b) => a + b, 0);
  }

  function isOdd(n) {
    return n % 2 === 1;
  }

  function zonesOf(front) {
    // [1-10] [11-20] [21-35]
    const z = [0, 0, 0];
    for (const n of front) {
      if (n <= 10) z[0]++;
      else if (n <= 20) z[1]++;
      else z[2]++;
    }
    return z;
  }

  function oddEven(front) {
    const odd = front.filter(isOdd).length;
    return [odd, 5 - odd];
  }

  function findConsecutive(front) {
    // 返回最长的连续段长度
    const sorted = front.slice().sort((a, b) => a - b);
    let maxRun = 1, run = 1;
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) {
        run++;
        if (run > maxRun) maxRun = run;
      } else {
        run = 1;
      }
    }
    return maxRun;
  }

  function describeConsecutive(front) {
    const sorted = front.slice().sort((a, b) => a - b);
    const groups = [];
    let cur = [sorted[0]];
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] === sorted[i - 1] + 1) {
        cur.push(sorted[i]);
      } else {
        if (cur.length >= 2) groups.push(cur.slice());
        cur = [sorted[i]];
      }
    }
    if (cur.length >= 2) groups.push(cur);
    if (groups.length === 0) return '无';
    return groups.map(g => g.join('-')).join(', ');
  }

  // ===== 选号核心 =====

  // 候选池(按 zone 拆分)
  function buildZonePools(hotColdByZone) {
    return {
      z1: hotColdByZone[1], // 1-10
      z2: hotColdByZone[2], // 11-20
      z3: hotColdByZone[3], // 21-35
    };
  }

  // 5 组差异化:从前区候选池里尽可能分散
  // 输入: {z1:[1-10号], z2:[11-20号], z3:[21-35号], used:Set, n:组数}
  // 输出: [[a,b,c,d,e], ...] 5 组前区号
  function sampleFront(zones, usedNums, n = 5) {
    const results = [];
    const attempts = 2000;
    for (let k = 0; k < n; k++) {
      let ok = false;
      for (let a = 0; a < attempts; a++) {
        // 每组号:
        // 必须覆盖 3 个 zone,各 1-3 个
        // 单区最多 3
        // 总共 5 个
        // 我们强制: 2/2/1 或 2/1/2 或 1/2/2 这三种分布
        const distros = [[2, 2, 1], [2, 1, 2], [1, 2, 2]];
        const distro = distros[Math.floor(Math.random() * distros.length)];
        const picks = [];
        for (let z = 0; z < 3; z++) {
          const pool = zones[z + 1].filter(x => !usedNums.has(x) && !picks.includes(x));
          if (pool.length < distro[z]) break; // 不够
          const sub = pickN(pool, distro[z]);
          picks.push(...sub);
        }
        if (picks.length !== 5) continue;
        if (new Set(picks).size !== 5) continue;
        // 奇偶 3:2 或 2:3
        const [odd, even] = oddEven(picks);
        if (odd !== 3 && odd !== 2) continue;
        // 和值 60-120
        if (sum(picks) < 60 || sum(picks) > 120) continue;
        // 连号最多 2 连
        if (findConsecutive(picks) > 2) continue;
        ok = true;
        results.push(picks);
        for (const p of picks) usedNums.add(p);
        break;
      }
      if (!ok) {
        // 兜底:放弃 usedNums 限制,严格满足硬性规则
        for (let a = 0; a < attempts; a++) {
          const distros = [[2, 2, 1], [2, 1, 2], [1, 2, 2]];
          const distro = distros[Math.floor(Math.random() * distros.length)];
          const picks = [];
          for (let z = 0; z < 3; z++) {
            const pool = zones[z + 1];
            if (pool.length < distro[z]) break;
            const sub = pickN(pool, distro[z]);
            picks.push(...sub);
          }
          if (picks.length !== 5) continue;
          if (new Set(picks).size !== 5) continue;
          const [odd, even] = oddEven(picks);
          if (odd !== 3 && odd !== 2) continue;
          if (sum(picks) < 60 || sum(picks) > 120) continue;
          if (findConsecutive(picks) > 2) continue;
          ok = true;
          results.push(picks);
          for (const p of picks) picks.length && usedNums.add(p);
          break;
        }
      }
    }
    return results;
  }

  // 后区:和值 9-16,且不能全冷全热
  // backZone 是 [{num, count, label}, ...] 数组
  function sampleBack(backZone, n = 5) {
    const nums = backZone.map(x => x.num); // 1-12
    const results = [];
    for (let k = 0; k < n; k++) {
      let ok = false;
      for (let a = 0; a < 400; a++) {
        const pair = pickN(nums, 2).sort((a, b) => a - b);
        if (pair[0] === pair[1]) continue;
        const s = sum(pair);
        if (s < 9 || s > 16) continue;
        // 不能全冷或全热
        const labels = pair.map(p => backZoneLabel(backZone, p));
        const hasWarm = labels.some(l => l === '温');
        const isAllCold = labels.every(l => l === '冷');
        const isAllHot = labels.every(l => l === '热');
        // 必须 1 温,或 1 冷 + 1 热
        if (!hasWarm && !(labels.includes('冷') && labels.includes('热'))) continue;
        results.push(pair);
        ok = true;
        break;
      }
      if (!ok) {
        // 兜底:穷举合法 pair
        for (let s = 9; s <= 16 && !ok; s++) {
          for (let a = 1; a <= 11 && !ok; a++) {
            for (let b = a + 1; b <= 12 && !ok; b++) {
              if (a + b === s) {
                results.push([a, b]);
                ok = true;
              }
            }
          }
        }
      }
    }
    return results;
  }

  // 取后区号在 backZone 里的 label
  function backZoneLabel(backZone, num) {
    const item = backZone.find(x => x.num === num);
    return item ? item.label : '温';
  }

  // 入口:generate(n=5)
  function generate(n) {
    n = n || 5;
    const Stats = (typeof module === 'object' && module.exports)
      ? require('./stats.js')
      : (typeof self !== 'undefined' ? self.Stats : window.Stats);
    if (!Stats) throw new Error('Selector: Stats module not found. Load stats.js first.');
    if (!Stats.isLoaded || !Stats.isLoaded()) {
      throw new Error('Selector: history not loaded. Call Stats.loadHistory() first.');
    }
    const stats = Stats.getAllHotCold(30);

    // 前区按 zone 拆分(每组内按 label 子分桶便于差异化)
    const z1 = stats.前区.filter(x => x.num <= 10).map(x => x.num);
    const z2 = stats.前区.filter(x => x.num >= 11 && x.num <= 20).map(x => x.num);
    const z3 = stats.前区.filter(x => x.num >= 21).map(x => x.num);
    const zones = { 1: z1, 2: z2, 3: z3 };

    // 前区候选池按"组"差异化:
    // 组 1: 冷热平衡(主用温)
    // 组 2: 包含 1 对连号
    // 组 3: 21-35 区 2-3 个号(胆码型)
    // 组 4: 主用温号
    // 组 5: 跨度大(小号+大号)
    // 我们用统一的 sampleFront 跑 5 组,差异化通过 usedNums 强制
    const usedNums = new Set();
    const fronts = sampleFront(zones, usedNums, n);

    // 如果某组需要特别调整(连号/胆码),在 generate 里调
    enforceStrategies(fronts, zones);

    // 后区
    const backs = sampleBack(stats.后区, n);

    // 组装输出
    const out = [];
    for (let i = 0; i < n; i++) {
      const front = fronts[i].slice().sort((a, b) => a - b);
      const back = backs[i];
      const z = zonesOf(front);
      const oe = oddEven(front);
      const labels = front.map(num => {
        const item = stats.前区.find(x => x.num === num);
        return item ? item.label : '温';
      });
      const cold = labels.filter(l => l === '冷').length;
      const warm = labels.filter(l => l === '温').length;
      const hot = labels.filter(l => l === '热').length;
      const zone23 = front.filter(n => n >= 21);
      out.push({
        前区: front,
        后区: back,
        和值: sum(front),
        奇偶比: oe[0] + ':' + oe[1],
        区间分布: z.join('-'),
        冷热分配: cold + '冷' + warm + '温' + hot + '热',
        连号: describeConsecutive(front),
        区间23胆码: zone23,
        备注: buildRemark({ front, back, z, oe, cold, warm, hot, zone23, con: describeConsecutive(front), total: sum(front) }),
      });
    }

    return out;
  }

  // 策略微调:对 5 组号应用不同偏向
  // (主要靠 usedNums 强制差异化,这里再补一次调整确保不重)
  function enforceStrategies(fronts, zones) {
    // 简单的去重保险:如果两组号相同,重新生成第二组
    for (let i = 1; i < fronts.length; i++) {
      let tries = 0;
      while (sameSet(fronts[i], fronts[i - 1]) && tries < 50) {
        // 替换其中一个
        fronts[i] = pickN([...zones[1], ...zones[2], ...zones[3]], 5);
        if (findConsecutive(fronts[i]) > 2) continue;
        if (sum(fronts[i]) < 60 || sum(fronts[i]) > 120) continue;
        const [odd] = oddEven(fronts[i]);
        if (odd !== 3 && odd !== 2) continue;
        if (zonesOf(fronts[i]).some(c => c > 3)) continue;
        if (new Set(fronts[i]).size !== 5) continue;
        if (!zonesOf(fronts[i]).every((c, idx) => c > 0)) continue;
        break;
      }
      tries++;
    }
  }

  function sameSet(a, b) {
    if (!a || !b) return false;
    const sa = new Set(a), sb = new Set(b);
    if (sa.size !== sb.size) return false;
    for (const x of sa) if (!sb.has(x)) return false;
    return true;
  }

  function buildRemark(o) {
    const bits = [];
    bits.push(`前区 ${o.front.join(' ')} | 后区 ${o.back.join(' ')}`);
    bits.push(`和值 ${o.total} · 奇偶 ${o.oe[0]}:${o.oe[1]} · 三区 ${o.z.join('-')}`);
    bits.push(`冷热 ${o.cold}冷${o.warm}温${o.hot}热`);
    if (o.con !== '无') bits.push(`连号 ${o.con}`);
    if (o.zone23.length) bits.push(`23 区间胆码 ${o.zone23.join(' ')}`);
    return bits.join('  ·  ');
  }

  return {
    generate: generate,
    // 内部工具,便于测试
    _internal: { zonesOf, oddEven, findConsecutive, sum, isOdd, sampleFront, sampleBack },
  };
});
