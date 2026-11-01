// 杀号公式库(只保留 500 期回测准确率 > 纯随机基线的)
// 红球基线 85.7%,蓝球基线 83.3%
// 砍掉的:012路缺路 84.1% / 012路集中 84.8% / 质合极端 84.5% /
//        区间极端 85.4% / 尾数成对 85.1% / 跨度中位 85.3% /
//        蓝球 奇偶同号 82.8% / 重号 82.9% / 012路缺路 83.2% /
//        跨度极端 82.8% / 上期重号温和 82.6%

window.DLT_FORMULAS = {
  front: {
    // 1. 尾数集中杀(≥3同尾) - 87.0% ⭐
    tail_concentrate: {
      name: "尾数集中杀(≥3同尾)",
      desc: "上期同尾数≥3,杀所有同尾号",
      test: (prev) => {
        const tails = {};
        prev.front.forEach(n => { tails[n % 10] = (tails[n % 10] || 0) + 1; });
        const killedTails = Object.entries(tails).filter(([_, c]) => c >= 3).map(([t]) => parseInt(t));
        if (killedTails.length === 0) return { killed: [], triggered: false };
        const killed = [];
        for (let n = 1; n <= 35; n++) {
          if (killedTails.includes(n % 10)) killed.push(n);
        }
        return { killed, triggered: true };
      }
    },

    // 2. 跨度极端杀(>30) - 88.9% ⭐
    span_extreme: {
      name: "跨度极端杀(>30)",
      desc: "上期跨度>30,杀 1 和 35",
      test: (prev) => {
        const s = [...prev.front].sort((a, b) => a - b);
        const span = s[4] - s[0];
        if (span > 30) {
          return { killed: [1, 35], triggered: true };
        }
        return { killed: [], triggered: false };
      }
    },

    // 3. 连号邻位杀 - 86.1%
    consecutive_neighbor: {
      name: "连号邻位杀",
      desc: "上期有连号,杀连号两端的邻位号",
      test: (prev) => {
        const s = [...prev.front].sort((a, b) => a - b);
        const killed = new Set();
        for (let i = 0; i < s.length - 1; i++) {
          if (s[i+1] - s[i] === 1) {
            [s[i]-1, s[i+1]+1].forEach(n => {
              if (n >= 1 && n <= 35) killed.add(n);
            });
          }
        }
        return { killed: [...killed], triggered: killed.size > 0 };
      }
    },

    // 4. 大小比极端(≥4) - 86.0%
    big_small_extreme: {
      name: "大小比极端(≥4)",
      desc: "上期≥4大号杀 2 大;≥4小号杀 2 小",
      test: (prev) => {
        const bigCount = prev.front.filter(n => n > 18).length;
        if (bigCount >= 4) {
          const prevSet = new Set(prev.front);
          const bigs = [19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35].filter(n => !prevSet.has(n));
          return { killed: bigs.slice(0, 2), triggered: true };
        }
        if (bigCount <= 1) {
          const prevSet = new Set(prev.front);
          const smalls = [1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18].filter(n => !prevSet.has(n));
          return { killed: smalls.slice(0, 2), triggered: true };
        }
        return { killed: [], triggered: false };
      }
    },

    // 5. 区间集中(≥3) - 86.7%
    zone_concentrate: {
      name: "区间集中(≥3)",
      desc: "上期某区≥3,杀同区 2 个",
      test: (prev) => {
        const z = [0, 0, 0];
        prev.front.forEach(n => {
          if (n <= 12) z[0]++;
          else if (n <= 24) z[1]++;
          else z[2]++;
        });
        const maxZ = z.indexOf(Math.max(...z));
        if (z[maxZ] < 3) return { killed: [], triggered: false };
        let pool;
        if (maxZ === 0) pool = [1,2,3,4,5,6,7,8,9,10,11,12];
        else if (maxZ === 1) pool = [13,14,15,16,17,18,19,20,21,22,23,24];
        else pool = [25,26,27,28,29,30,31,32,33,34,35];
        const prevSet = new Set(prev.front);
        const cands = pool.filter(n => !prevSet.has(n));
        return { killed: cands.slice(0, 2), triggered: true };
      }
    },

    // 7. 上期重号(温和版) - 86.6% ⭐
    repeat_mild: {
      name: "上期重号(温和版)",
      desc: "上期 5 个号,杀 2 个最不可能重复的",
      test: (prev, ctx) => {
        if (!ctx || !ctx.repeatStats) {
          const s = [...prev.front].sort((a, b) => a - b);
          return { killed: [s[1], s[3]], triggered: true };
        }
        const sorted = [...prev.front].sort((a, b) => (ctx.repeatStats[a] || 0) - (ctx.repeatStats[b] || 0));
        return { killed: sorted.slice(0, 2), triggered: true };
      }
    },

    // 8. 连号密度杀 - 90.0% ⭐⭐ 最高
    consecutive_density: {
      name: "连号密度杀",
      desc: "上期有 2+ 组连号,杀连号两端的扩展号",
      test: (prev) => {
        const s = [...prev.front].sort((a, b) => a - b);
        const prevSet = new Set(prev.front);
        const groups = [];
        let i = 0;
        while (i < s.length) {
          let j = i;
          while (j + 1 < s.length && s[j + 1] - s[j] === 1) j++;
          if (j > i) groups.push([s[i], s[j]]);
          i = j + 1;
        }
        if (groups.length < 2) return { killed: [], triggered: false };
        const killed = new Set();
        for (const [lo, hi] of groups) {
          if (lo - 1 >= 1 && !prevSet.has(lo - 1)) killed.add(lo - 1);
          if (hi + 1 <= 35 && !prevSet.has(hi + 1)) killed.add(hi + 1);
        }
        return { killed: [...killed], triggered: killed.size > 0 };
      }
    },

    // 8. 跨度极端温和(<10) - 92.9% ⭐⭐ 极高准确率但罕见
    span_extreme_mild: {
      name: "跨度极端温和(<10)",
      desc: "上期跨度<10,杀端点 1/35/11/25",
      test: (prev) => {
        const s = [...prev.front].sort((a, b) => a - b);
        const span = s[4] - s[0];
        if (span < 10) {
          const prevSet = new Set(prev.front);
          const cands = [1, 35, 11, 25].filter(n => !prevSet.has(n));
          return { killed: cands, triggered: true };
        }
        return { killed: [], triggered: false };
      }
    },

    // 9. 和值中位(<80 或 >110 杀中间) - 86.7%
    sum_mid: {
      name: "和值中位杀",
      desc: "上期和值<80 杀 28-31 大端;>110 杀 14-17 中端",
      test: (prev) => {
        const sum = prev.front.reduce((a, b) => a + b, 0);
        const prevSet = new Set(prev.front);
        if (sum < 80) {
          const cands = [28, 29, 30, 31].filter(n => !prevSet.has(n));
          return { killed: cands.slice(0, 3), triggered: cands.length > 0 };
        }
        if (sum > 110) {
          const cands = [14, 15, 16, 17].filter(n => !prevSet.has(n));
          return { killed: cands.slice(0, 2), triggered: cands.length > 0 };
        }
        return { killed: [], triggered: false };
      }
    },

    // 10. 上期同尾杀(同尾不同号) - 86.4%
    same_tail: {
      name: "上期同尾杀",
      desc: "上期有同尾数,杀同尾其他号(避开上期号)",
      test: (prev) => {
        const tails = {};
        prev.front.forEach(n => { tails[n % 10] = (tails[n % 10] || 0) + 1; });
        const prevSet = new Set(prev.front);
        const cands = [];
        for (let n = 1; n <= 35; n++) {
          if (tails[n % 10] > 0 && !prevSet.has(n)) cands.push(n);
        }
        return { killed: cands.slice(0, 2), triggered: cands.length > 0 };
      }
    }
  },

  // ============ 杀蓝(后区)公式 ============
  back: {
    // 1. 后区和值极端 - 95.5% ⭐⭐
    back_sum_extreme: {
      name: "后区和值极端(<3或>21)",
      desc: "上期后区和值<3 杀 1,2;>21 杀 11,12",
      test: (prev) => {
        const sum = prev.back[0] + prev.back[1];
        const killed = [];
        if (sum < 3) killed.push(1, 2);
        if (sum > 21) killed.push(11, 12);
        return { killed, triggered: killed.length > 0 };
      }
    },

    // 2. 后区大小同号(温和版) - 84.1%
    back_big_small_same: {
      name: "后区大小同号杀(温和版)",
      desc: "上期后区全大杀 3 大(避上期);全小杀 3 小",
      test: (prev) => {
        const allBig = prev.back.every(n => n > 6);
        const allSmall = prev.back.every(n => n <= 6);
        if (allBig) {
          const prevSet = new Set(prev.back);
          const cands = [7, 8, 9, 10, 11, 12].filter(n => !prevSet.has(n));
          const maxDist = (n) => Math.max(...prev.back.map(p => Math.abs(n - p)));
          cands.sort((a, b) => maxDist(b) - maxDist(a));
          return { killed: cands.slice(0, 3), triggered: true };
        }
        if (allSmall) {
          const prevSet = new Set(prev.back);
          const cands = [1, 2, 3, 4, 5, 6].filter(n => !prevSet.has(n));
          const maxDist = (n) => Math.max(...prev.back.map(p => Math.abs(n - p)));
          cands.sort((a, b) => maxDist(b) - maxDist(a));
          return { killed: cands.slice(0, 3), triggered: true };
        }
        return { killed: [], triggered: false };
      }
    },

    // 3. 后区三区集中(温和版) - 83.8%
    back_zone_concentrate: {
      name: "后区三区集中(温和版)",
      desc: "上期后区同小区,杀该小区 2 个(避上期)",
      test: (prev) => {
        const z = n => n <= 4 ? 0 : (n <= 8 ? 1 : 2);
        if (z(prev.back[0]) !== z(prev.back[1])) {
          return { killed: [], triggered: false };
        }
        const zone = z(prev.back[0]);
        let pool = [];
        if (zone === 0) pool = [1,2,3,4];
        else if (zone === 1) pool = [5,6,7,8];
        else pool = [9,10,11,12];
        const prevSet = new Set(prev.back);
        const cands = pool.filter(n => !prevSet.has(n));
        return { killed: cands.slice(0, 2), triggered: true };
      }
    },

    // 4. 后区冷热杀 - 83.4%
    back_cold_extreme: {
      name: "后区冷热杀",
      desc: "近 10 期没出 + 近 5 期高频,杀 1 个最不活跃的号",
      test: (prev, ctx) => {
        if (!ctx || !ctx.backHotCold) {
          return { killed: [], triggered: false };
        }
        const scores = {};
        for (let n = 1; n <= 12; n++) {
          scores[n] = (ctx.backHotCold.coldScore[n] || 0);
        }
        const prevSet = new Set(prev.back);
        const sorted = Object.entries(scores)
          .filter(([n]) => !prevSet.has(parseInt(n)))
          .sort((a, b) => a[1] - b[1]);
        if (sorted.length === 0 || sorted[0][1] === 0) return { killed: [], triggered: false };
        return { killed: [parseInt(sorted[0][0])], triggered: true };
      }
    },

    // 5. 后区遗漏值杀 - 83.6%
    back_overdue: {
      name: "后区遗漏值杀",
      desc: "近 8 期没出过的号,杀 1 个(基于历史回归)",
      test: (prev, ctx) => {
        if (!ctx || !ctx.backOverdue) {
          return { killed: [], triggered: false };
        }
        const prevSet = new Set(prev.back);
        const sorted = Object.entries(ctx.backOverdue)
          .filter(([n]) => !prevSet.has(parseInt(n)))
          .sort((a, b) => b[1] - a[1]);
        if (sorted.length === 0 || sorted[0][1] < 5) return { killed: [], triggered: false };
        return { killed: [parseInt(sorted[0][0])], triggered: true };
      }
    }
  }
};

// ============ 回测引擎 ============
window.runBacktest = function(zone) {
  const data = window.DLT_DATA;
  const formulas = window.DLT_FORMULAS[zone];
  const results = {};

  Object.entries(formulas).forEach(([key, f]) => {
    let triggered = 0;
    let totalKilled = 0;
    let correctlyKilled = 0;
    let wrongKills = 0;

    for (let i = 1; i < data.length; i++) {
      const prev = data[i - 1];
      const actual = zone === "front" ? new Set(data[i].front) : new Set(data[i].back);
      const { killed, triggered: isTrig } = f.test(prev);
      if (!isTrig) continue;
      triggered++;
      totalKilled += killed.length;
      killed.forEach(n => {
        if (actual.has(n)) wrongKills++;
        else correctlyKilled++;
      });
    }

    const totalTests = data.length - 1;
    const accuracy = totalKilled > 0 ? (correctlyKilled / totalKilled * 100).toFixed(1) : 0;
    const missRate = accuracy > 0 ? (100 - parseFloat(accuracy)).toFixed(1) : 0;
    const triggerRate = totalTests > 0 ? (triggered / totalTests * 100).toFixed(1) : 0;
    const avgKilled = triggered > 0 ? (totalKilled / triggered).toFixed(1) : 0;
    results[key] = {
      name: f.name,
      triggered,
      totalTests,
      totalKilled,
      correct: correctlyKilled,
      wrong: wrongKills,
      accuracy,
      missRate,
      triggerRate,
      avgKilled
    };
  });

  return results;
};

// ============ 辅助函数 ============
window.DLT_HELPERS = {
  latest() { return window.DLT_DATA[window.DLT_DATA.length - 1]; },
  prev() { return window.DLT_DATA[window.DLT_DATA.length - 2]; },
  nextPeriod() {
    const last = this.latest();
    const num = parseInt(last.period, 10);
    if (isNaN(num)) return "26092";
    return String(num + 1).padStart(7, "0");
  },
  nextDrawTime() {
    const now = Date.now();
    const days = [1, 3, 6];
    for (let i = 0; i < 10; i++) {
      const bjMs = now + 8 * 3600 * 1000;
      const bjDate = new Date(bjMs);
      const Y = bjDate.getUTCFullYear();
      const M = bjDate.getUTCMonth();
      const D = bjDate.getUTCDate();
      const utcMs = Date.UTC(Y, M, D + i, 12, 30, 0);
      const dayOfWeek = new Date(utcMs).getUTCDay();
      if (days.includes(dayOfWeek) && utcMs > now) {
        return new Date(utcMs);
      }
    }
    return new Date();
  }
};
