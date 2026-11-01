// 大乐透分析系统 v2 - 主程序
// 新增: 杀号池 + 候选池 + 复式选号 + 收藏

const APP = {
  currentTab: "kill",
  isMainLink: true,
  shareToken: null,
  isLoggedIn: false,

  // 全局状态
  state: {
    // 手动杀号(用户点选的)
    frontKilled: new Set(),
    backKilled: new Set(),
    // 公式杀号(自动汇总,本期触发的)
    formulaKilledFront: new Map(),  // num -> count of formulas
    formulaKilledBack: new Map(),
    // 用户覆盖:把公式杀的号手动"复活"(优先级最高)
    userOverrideFront: new Set(),
    userOverrideBack: new Set(),
    // 复式选号
    selection: { front: [], back: [] },
    // 批量单注(5 注独立)
    picks: [],
    // 收藏
    favorites: []
  },

  init() {
    this.loadFavorites();
    this.loadUserData();  // 合并 localStorage 用户数据
    this.loadLearnData(); // 加载学习数据
    // 启动时跑一次自适应学习(避免首次启动智选无权重调整)
    setTimeout(() => {
      try {
        this.learnKillingPatterns();  // 🧠 先:50 期自学习杀号模式
        this.computeFormulaKills();  // 再:用最新软杀号算杀号
        this.selfTuneWeights();
        this.learnFromHistory();
        this.computeFormulaKills();  // 二次算杀号(此时自学习已完成)
      } catch (e) { console.warn(e); }
    }, 200);
    const shareToken = window.DeviceTracker.getShareToken();
    if (shareToken) {
      this.shareToken = shareToken;
      this.isMainLink = false;
      // 自动登录(30 天内免输入)
      if (this.checkRemember("share", shareToken)) {
        this.autoLoginShare();
        return;
      }
      this.showShareLogin();
    } else {
      // 主链接自动登录
      if (this.checkRemember("main")) {
        this.autoLoginMain();
        return;
      }
      this.showMainLogin();
    }
  },

  // ============== 30 天登录记忆 ==============
  REMEMBER_DAYS: 30,
  REMEMBER_KEY_MAIN: "dlt_remember_main",
  REMEMBER_KEY_SHARE: (token) => `dlt_remember_share_${token}`,

  saveRemember(type, extra = {}) {
    const key = type === "main" ? this.REMEMBER_KEY_MAIN : this.REMEMBER_KEY_SHARE(extra.token);
    const data = {
      ts: Date.now(),
      deviceUuid: this.getDeviceUuid(),
      ...extra
    };
    try { localStorage.setItem(key, JSON.stringify(data)); } catch (e) {}
  },

  checkRemember(type, token) {
    const key = type === "main" ? this.REMEMBER_KEY_MAIN : this.REMEMBER_KEY_SHARE(token);
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return false;
      const data = JSON.parse(raw);
      const ageDays = (Date.now() - data.ts) / (24 * 3600 * 1000);
      if (ageDays > this.REMEMBER_DAYS) {
        localStorage.removeItem(key);  // 过期清掉
        return false;
      }
      // 副链接额外校验:设备 UUID 必须一致(防止 token 改后复用)
      if (type === "share" && data.deviceUuid !== this.getDeviceUuid()) {
        return false;
      }
      return true;
    } catch (e) { return false; }
  },

  clearRemember(type, token) {
    const key = type === "main" ? this.REMEMBER_KEY_MAIN : this.REMEMBER_KEY_SHARE(token);
    try { localStorage.removeItem(key); } catch (e) {}
  },

  getDeviceUuid() {
    return localStorage.getItem("dlt_device_uuid") || "";
  },

  autoLoginMain() {
    this.isLoggedIn = true;
    this.isMainLink = true;
    this.showApp();
    this.startCloudAutoFetch();
    setTimeout(() => this.toast("✓ 30 天内免登录(主链接)"), 300);
  },

  async autoLoginShare() {
    // 静默校验设备(防止 30 天内被主链接移除)
    const result = await window.DeviceTracker.checkShareLimit(this.shareToken, 5);
    if (!result.success) {
      // 校验失败,清记忆,弹登录框
      this.clearRemember("share", this.shareToken);
      this.showShareLogin();
      this.toast("记忆失效,请重新验证(" + (result.reason || "") + ")", "err");
      return;
    }
    this.isLoggedIn = true;
    this.isMainLink = false;
    this.showApp();
    this.startCloudAutoFetch();
    setTimeout(() => this.toast("✓ 30 天内免登录(副链接)"), 300);
  },

  // ============== 登录流程 ==============
  showMainLogin() {
    document.getElementById("app-container").classList.add("hidden");
    document.getElementById("login-container").classList.remove("hidden");
    document.getElementById("login-title").textContent = "大乐透专业智能杀号系统";
    document.getElementById("login-sub").textContent = "请输入主链接密码";
    document.getElementById("login-btn").textContent = "登录";
    document.getElementById("login-btn").onclick = () => this.handleLogin("918918", "main");
    this.renderRememberInfo("main");
  },

  showShareLogin() {
    document.getElementById("app-container").classList.add("hidden");
    document.getElementById("login-container").classList.remove("hidden");
    document.getElementById("login-title").textContent = "大乐透专业智能杀号系统";
    document.getElementById("login-sub").textContent = `分享链接: ${this.shareToken}`;
    document.getElementById("login-btn").textContent = "验证并进入";
    document.getElementById("login-btn").onclick = () => this.handleShareLogin();
    this.renderRememberInfo("share");
  },

  renderRememberInfo(type) {
    const infoEl = document.getElementById("remember-info");
    const forgetBtn = document.getElementById("forget-btn");
    if (!infoEl) return;
    let key;
    if (type === "main") {
      key = this.REMEMBER_KEY_MAIN;
    } else {
      key = this.REMEMBER_KEY_SHARE(this.shareToken);
    }
    try {
      const raw = localStorage.getItem(key);
      if (!raw) {
        infoEl.textContent = "💡 登录后会记住 30 天,无需重复输入密码";
        forgetBtn.style.display = "none";
        return;
      }
      const data = JSON.parse(raw);
      const ageDays = (Date.now() - data.ts) / (24 * 3600 * 1000);
      const remainDays = Math.max(0, Math.ceil(this.REMEMBER_DAYS - ageDays));
      infoEl.innerHTML = `<span style="color:var(--primary)">✓ 已记住密码,还剩 ${remainDays} 天免登录</span>`;
      forgetBtn.style.display = "block";
      forgetBtn.onclick = () => {
        if (confirm("确定要清除登录记忆吗?\n清除后下次需要重新输入密码。")) {
          this.clearRemember(type, this.shareToken);
          this.renderRememberInfo(type);
          this.toast("✓ 已清除登录记忆");
        }
      };
    } catch (e) {
      infoEl.textContent = "";
      forgetBtn.style.display = "none";
    }
  },

  async handleLogin(expectedPwd, type) {
    const input = document.getElementById("password").value;
    const errEl = document.getElementById("login-error");
    errEl.classList.remove("show");

    if (input !== expectedPwd) {
      errEl.textContent = "密码错误";
      errEl.classList.add("show");
      return;
    }

    this.isLoggedIn = true;
    this.isMainLink = type === "main";
    this.showApp();
    // 保存 30 天登录记忆
    this.saveRemember("main");
    // 启动云端自动拉取(主链接 + 副链接都可以)
    this.startCloudAutoFetch();
    // 主链接登录后立即拉取最新(不等 8 秒)
    if (type === "main") {
      setTimeout(() => this.fetchFromCloud(true), 1500);
    }
  },

  async handleShareLogin() {
    const pwd = document.getElementById("password").value;
    const errEl = document.getElementById("login-error");

    if (pwd !== "112233") {
      errEl.textContent = "副链接密码错误";
      errEl.classList.add("show");
      return;
    }

    errEl.classList.remove("show");
    errEl.textContent = "正在校验设备...";
    errEl.classList.add("show");

    const result = await window.DeviceTracker.checkShareLimit(this.shareToken, 5);

    if (!result.success) {
      errEl.textContent = result.reason || "设备校验失败";
      errEl.classList.add("show");
      return;
    }

    this.isLoggedIn = true;
    this.isMainLink = false;
    this.showApp();
    // 保存 30 天登录记忆(包含 shareToken + deviceUuid)
    this.saveRemember("share", { token: this.shareToken });
    // 启动云端自动拉取
    this.startCloudAutoFetch();

    if (result.isNew) {
      setTimeout(() => {
        this.toast(`设备已注册 (${result.deviceCount}/${result.limit})`);
      }, 500);
    }
  },

  showApp() {
    document.getElementById("login-container").classList.add("hidden");
    document.getElementById("app-container").classList.remove("hidden");
    // 副链接用户不显示分享 tab
    const shareTab = document.querySelector(".share-tab");
    if (shareTab) {
      shareTab.style.display = this.isMainLink ? "" : "none";
    }
    // 副链接如果当前在分享 tab,切到杀号
    if (!this.isMainLink && this.currentTab === "share") {
      this.currentTab = "kill";
    }
    this.computeFormulaKills();
    this.renderHeader();
    this.renderTab(this.currentTab);
    this.startCountdown();
    this.startAutoRefresh();
  },

  // ============== 公式杀号自动汇总 ==============
  computeFormulaKills() {
    const data = window.DLT_DATA;
    const idx = data.length;  // 待预测的下一期索引
    const prev = data[idx - 1];  // 上期(预测下期用)
    const frontMap = new Map();
    const backMap = new Map();
    // 构建 ctx(给新公式用)
    const ctx = { idx, allData: data, allBackResults: {}, allFrontResults: {} };

    // === 给新蓝球公式用的统计 ===
    // 1. 后区冷热分数(冷号加分)
    const backHotCold = { coldScore: {} };
    for (let n = 1; n <= 12; n++) {
      // 看 n 在最近 10 期出现次数(0=冷, 多=热)
      const recent10 = data.slice(Math.max(0, idx - 10), idx);
      const recent5 = data.slice(Math.max(0, idx - 5), idx);
      const c10 = recent10.filter(d => d.back.includes(n)).length;
      const c5 = recent5.filter(d => d.back.includes(n)).length;
      // 冷号(10期0次,5期0次)得分高(应该杀)
      backHotCold.coldScore[n] = (10 - c10) * 0.5 + (5 - c5) * 0.3;
    }
    ctx.backHotCold = backHotCold;

    // 2. 后区上期重号率(过去 50 期,n 在上期出现时下期也出现的比例)
    const backRepeatStats = {};
    for (let n = 1; n <= 12; n++) {
      let cases = 0, repeats = 0;
      for (let i = 1; i < Math.min(idx, 50); i++) {
        if (data[i - 1].back.includes(n)) {
          cases++;
          if (data[i].back.includes(n)) repeats++;
        }
      }
      backRepeatStats[n] = cases > 0 ? repeats / cases : 0;
    }
    ctx.backRepeatStats = backRepeatStats;

    // 3. 后区遗漏值(每个号距上次出现的期数)
    const backOverdue = {};
    for (let n = 1; n <= 12; n++) {
      let gap = 0;
      for (let i = idx - 1; i >= 0; i--) {
        if (data[i].back.includes(n)) break;
        gap++;
      }
      backOverdue[n] = gap;
    }
    ctx.backOverdue = backOverdue;

    // 4. 前区重号率(给上期重号温和版用)
    const repeatStats = {};
    for (let n = 1; n <= 35; n++) {
      let cases = 0, repeats = 0;
      for (let i = 1; i < Math.min(idx, 100); i++) {
        if (data[i - 1].front.includes(n)) {
          cases++;
          if (data[i].front.includes(n)) repeats++;
        }
      }
      repeatStats[n] = cases > 0 ? repeats / cases : 0;
    }
    ctx.repeatStats = repeatStats;
    // 记录每个公式的触发详情
    this.state.frontFormulaDetails = [];
    this.state.backFormulaDetails = [];
    // 预跑 13 公式回测(算准确率)
    const frontBacktest = this._runQuickBacktest("front");
    const backBacktest = this._runQuickBacktest("back");

    // 前区基础杀号 1: 上期重号杀(杀 3 个,经验:下期最多重 1-2 个)
    const prevFrontSorted = [...prev.front].sort((a, b) => (b % 10) - (a % 10));
    prevFrontSorted.slice(0, 3).forEach(n => {
      frontMap.set(n, (frontMap.get(n) || 0) + 1);
    });

    // 前区基础杀号 2: 冷号杀(近 10 期没出的号)
    const lookback = data.slice(Math.max(0, idx - 10), idx);
    for (let n = 1; n <= 35; n++) {
      if (!lookback.some(d => d.front.includes(n))) {
        frontMap.set(n, (frontMap.get(n) || 0) + 1);
      }
    }

    // 前区基础杀号 3: 高频杀(近 8 期出现≥2 次的号,杀 3 个)
    const recent8 = data.slice(Math.max(0, idx - 8), idx);
    const freq8 = {};
    recent8.forEach(d => d.front.forEach(n => { freq8[n] = (freq8[n] || 0) + 1; }));
    const highFreq = Object.entries(freq8)
      .filter(([_, c]) => c >= 2)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([n]) => parseInt(n));
    highFreq.forEach(n => {
      frontMap.set(n, (frontMap.get(n) || 0) + 1);
    });

    // 前区公式(加权投票:高准确率公式的杀号 value 更高)
    Object.entries(window.DLT_FORMULAS.front).forEach(([key, f]) => {
      const { killed, triggered } = f.test(prev, ctx);
      const back = frontBacktest[key] || { accuracy: 0, triggered: 0 };
      this.state.frontFormulaDetails.push({
        key, name: f.name, triggered, killed,
        accuracy: back.accuracy,
        triggeredCount: back.triggered
      });
      if (triggered) {
        // 加权:准确率 > 87 加 1.5, > 84 加 1.2, 其他加 1.0
        const acc = parseFloat(back.accuracy);
        const weight = acc >= 87 ? 1.5 : acc >= 84 ? 1.2 : 1.0;
        killed.forEach(n => {
          frontMap.set(n, (frontMap.get(n) || 0) + weight);
        });
      }
    });

    // 后区基础杀号: 上期重号(2 个,累计回测自动更新)
    prev.back.forEach(n => {
      backMap.set(n, (backMap.get(n) || 0) + 1);
    });

    // 后区公式(加权投票:高准确率公式的杀号 value 更高)
    Object.entries(window.DLT_FORMULAS.back).forEach(([key, f]) => {
      const { killed, triggered } = f.test(prev, ctx);
      const back = backBacktest[key] || { accuracy: 0, triggered: 0 };
      this.state.backFormulaDetails.push({
        key, name: f.name, triggered, killed,
        accuracy: back.accuracy,
        triggeredCount: back.triggered
      });
      if (triggered) {
        // 加权:准确率 > 87 加 1.5, > 84 加 1.2, 其他加 1.0
        const acc = parseFloat(back.accuracy);
        const weight = acc >= 87 ? 1.5 : acc >= 84 ? 1.2 : 1.0;
        killed.forEach(n => {
          backMap.set(n, (backMap.get(n) || 0) + weight);
        });
      }
    });

    this.state.formulaKilledFront = frontMap;
    this.state.formulaKilledBack = backMap;
    // 🧠 应用自学习软杀号(从 50 期数据学的,权重 0.5-1.0)
    this.applySoftKills();
    // 前区兜底:保证杀号 ≥ 12(候选池 ≤ 23),不够则从"次冷号"补齐
    this.ensureFrontKillCount(12);
    // 后区兜底:保证杀号 ≥ 4(候选池 ≤ 8),不够则补齐
    this.ensureBackKillCount(4);
    // 前区上限:杀号 ≤ 14(候选池 ≥ 21),避免某区间集中被全杀
    this.ensureFrontMaxKill(14);
    // 后区上限:杀号 ≤ 9(候选池 ≥ 3) - 几乎取消限制,让所有公式生效
    this.ensureBackMaxKill(9);
    // 范围保护:1-12 区 + 25-35 区 至少各留 5 个号
    this.ensureZoneBalance();
  },

  // 区间平衡保护(避免某一区被全杀)
  ensureZoneBalance() {
    const killed = this.state.formulaKilledFront;
    const removed = [];
    // 三区: 1-12, 13-24, 25-35
    const zones = [
      [1, 12, 4],   // 至少 4 个
      [13, 24, 5],  // 至少 5 个
      [25, 35, 5]   // 至少 5 个
    ];
    for (const [lo, hi, minKeep] of zones) {
      // 该区被杀的号
      const killedInZone = [];
      for (let n = lo; n <= hi; n++) {
        if (killed.has(n)) killedInZone.push(n);
      }
      const remainingInZone = (hi - lo + 1) - killedInZone.length;
      // 剩余 < minKeep → 撤销最弱杀号
      if (remainingInZone < minKeep) {
        const need = minKeep - remainingInZone;
        // 按杀号次数升序,优先删"置信度低"的
        const sortedKilled = killedInZone
          .map(n => ({ n, count: killed.get(n) || 0 }))
          .sort((a, b) => a.count - b.count);
        for (let i = 0; i < need && i < sortedKilled.length; i++) {
          killed.delete(sortedKilled[i].n);
          removed.push(sortedKilled[i].n);
        }
      }
    }
  },

  // 红球最大杀号数限制(候选池 ≥ 35 - maxKill)
  ensureFrontMaxKill(maxKill) {
    const killed = this.state.formulaKilledFront;
    if (killed.size <= maxKill) return;
    // 候选池 < 35-maxKill → 撤销杀号次数少的(保留杀号次数多的 = 高确信)
    const entries = Array.from(killed.entries()).sort((a, b) => a[1] - b[1]);
    let need = killed.size - maxKill;
    for (const [num, count] of entries) {
      if (need <= 0) break;
      killed.delete(num);
      need--;
    }
  },

  // 蓝球最大杀号数限制(候选池 ≥ 12 - maxKill)
  ensureBackMaxKill(maxKill) {
    const killed = this.state.formulaKilledBack;
    if (killed.size <= maxKill) return;
    const entries = Array.from(killed.entries()).sort((a, b) => a[1] - b[1]);
    let need = killed.size - maxKill;
    for (const [num, count] of entries) {
      if (need <= 0) break;
      killed.delete(num);
      need--;
    }
  },

  // 快速回测(只算准确率,不存结果)
  _runQuickBacktest(zone) {
    const data = window.DLT_DATA;
    const formulas = window.DLT_FORMULAS[zone];
    const result = {};
    Object.entries(formulas).forEach(([key, f]) => {
      let triggered = 0, totalKilled = 0, correct = 0;
      for (let i = 1; i < data.length; i++) {
        const prev = data[i - 1];
        const actual = zone === "front" ? new Set(data[i].front) : new Set(data[i].back);

        // 构建 ctx(给新公式用)
        const ctx = { idx: i, allData: data };
        // 后区 ctx
        if (zone === "back") {
          // 后区冷热分数
          const backHotCold = { coldScore: {} };
          for (let n = 1; n <= 12; n++) {
            const r10 = data.slice(Math.max(0, i - 10), i);
            const r5 = data.slice(Math.max(0, i - 5), i);
            backHotCold.coldScore[n] = (10 - r10.filter(d => d.back.includes(n)).length) * 0.5 +
                                        (5 - r5.filter(d => d.back.includes(n)).length) * 0.3;
          }
          ctx.backHotCold = backHotCold;
          // 后区重号率
          const backRepeatStats = {};
          for (let n = 1; n <= 12; n++) {
            let cases = 0, repeats = 0;
            for (let j = 1; j < Math.min(i, 50); j++) {
              if (data[j - 1].back.includes(n)) {
                cases++;
                if (data[j].back.includes(n)) repeats++;
              }
            }
            backRepeatStats[n] = cases > 0 ? repeats / cases : 0;
          }
          ctx.backRepeatStats = backRepeatStats;
          // 后区遗漏值
          const backOverdue = {};
          for (let n = 1; n <= 12; n++) {
            let gap = 0;
            for (let j = i - 1; j >= 0; j--) {
              if (data[j].back.includes(n)) break;
              gap++;
            }
            backOverdue[n] = gap;
          }
          ctx.backOverdue = backOverdue;
        } else {
          // 前区重号率(给上期重号温和版)
          const repeatStats = {};
          for (let n = 1; n <= 35; n++) {
            let cases = 0, repeats = 0;
            for (let j = 1; j < Math.min(i, 100); j++) {
              if (data[j - 1].front.includes(n)) {
                cases++;
                if (data[j].front.includes(n)) repeats++;
              }
            }
            repeatStats[n] = cases > 0 ? repeats / cases : 0;
          }
          ctx.repeatStats = repeatStats;
        }

        const r = f.test(prev, ctx);
        if (!r.triggered) continue;
        triggered++;
        totalKilled += r.killed.length;
        r.killed.forEach(n => { if (!actual.has(n)) correct++; });
      }
      const accuracy = totalKilled > 0 ? (correct / totalKilled * 100).toFixed(1) : 0;
      result[key] = { accuracy, triggered, totalKilled, correct };
    });
    return result;
  },

  // 🧠 应用自学习软杀号(50 期回测找的模式)
  // 软杀号权重 0.5-1.0:合并到基础杀号,但优先级低于公式
  applySoftKills() {
    this.loadLearnData();
    const softKills = this.learnData.softKills;
    if (!softKills) return;
    // 软杀号作为"参考信息"保存,但不直接参与硬杀(因为 50 期样本小,容易误杀)
    // 仅当硬杀号数 < 12(前区)/ < 4(后区)时,用软杀号补
    const frontCount = this.state.formulaKilledFront.size;
    if (frontCount < 12 && softKills.front) {
      const sortedSoft = Object.entries(softKills.front).sort((a, b) => b[1] - a[1]);
      for (const [n, w] of sortedSoft) {
        if (frontCount >= 12) break;
        if (w >= 0.8) {
          this.state.formulaKilledFront.set(parseInt(n), Math.max(this.state.formulaKilledFront.get(parseInt(n)) || 0, 0.5));
          frontCount++;
        }
      }
    }
    const backCount = this.state.formulaKilledBack.size;
    if (backCount < 4 && softKills.back) {
      const sortedSoft = Object.entries(softKills.back).sort((a, b) => b[1] - a[1]);
      for (const [n, w] of sortedSoft) {
        if (backCount >= 4) break;
        if (w >= 0.8) {
          this.state.formulaKilledBack.set(parseInt(n), Math.max(this.state.formulaKilledBack.get(parseInt(n)) || 0, 0.5));
          backCount++;
        }
      }
    }
  },

  // 前区保证杀号数 ≥ target(候选池 ≤ 35 - target)
  // 不够 → 从"次冷号"补齐(25 期没出 + 30 期没出)
  ensureFrontKillCount(target) {    const killed = this.state.formulaKilledFront;
    if (killed.size >= target) return;
    const data = window.DLT_DATA;
    const idx = data.length - 1;
    // 计算每号"冷度"(多少期内没出)
    const coldness = {};
    for (let n = 1; n <= 35; n++) {
      for (let look = 15; look <= 50; look += 5) {
        const recent = data.slice(Math.max(0, idx - look), idx);
        if (!recent.some(d => d.front.includes(n))) {
          coldness[n] = (coldness[n] || 0) + 1;  // 加权
        } else {
          break;
        }
      }
    }
    // 按冷度降序,补齐到 target
    const sorted = Object.entries(coldness)
      .filter(([n]) => !killed.has(parseInt(n)))
      .sort((a, b) => b[1] - a[1]);
    let need = target - killed.size;
    for (const [n, c] of sorted) {
      if (need <= 0) break;
      killed.set(parseInt(n), 0.5);  // 软杀(权重 0.5,代表"次冷")
      need--;
    }
  },

  // 蓝球保证杀号数 ≥ target
  // 不够 → 从"次冷号"补齐
  ensureBackKillCount(target) {
    const killed = this.state.formulaKilledBack;
    if (killed.size >= target) return;
    const data = window.DLT_DATA;
    const idx = data.length - 1;
    // 蓝球冷度
    const coldness = {};
    for (let n = 1; n <= 12; n++) {
      for (let look = 10; look <= 30; look += 5) {
        const recent = data.slice(Math.max(0, idx - look), idx);
        if (!recent.some(d => d.back.includes(n))) {
          coldness[n] = (coldness[n] || 0) + 1;
        } else {
          break;
        }
      }
    }
    const sorted = Object.entries(coldness)
      .filter(([n]) => !killed.has(parseInt(n)))
      .sort((a, b) => b[1] - a[1]);
    let need = target - killed.size;
    for (const [n, c] of sorted) {
      if (need <= 0) break;
      killed.set(parseInt(n), 0.5);
      need--;
    }
  },

  // ============== 顶部栏 ==============
  renderHeader() {
    const latest = window.DLT_HELPERS.latest();
    const html = `
      <div class="header">
        <div class="header-row">
          <div class="brand">
            <div class="brand-icon">大</div>
            <div>
              <div>大乐透专业智能杀号系统</div>
              <div class="text-xs text-muted" style="margin-top:2px">
                ${this.isMainLink ? '<span class="badge">主链接</span>' : ''}
                · 数据 ${window.DLT_DATA.length} 期 · 设备: ${window.DeviceTracker.deviceType()}
              </div>
            </div>
          </div>
          <div class="countdown">
            <span>下期倒计时</span>
            <span class="countdown-time" id="countdown">--:--:--</span>
          </div>
        </div>
      </div>
    `;
    document.getElementById("app-header").innerHTML = html;
  },

  // ============== 倒计时 + 自动检测 ==============
  startCountdown() {
    let drawAlerted = false;
    const update = () => {
      const target = window.DLT_HELPERS.nextDrawTime();
      const now = new Date();
      const diff = target - now;
      if (diff < 0) {
        const el = document.getElementById("countdown");
        if (el) el.textContent = "即将开奖";
        // 开奖时间到(超过 5 分钟):自动检测并提示录入
        if (Math.abs(diff) > 5 * 60 * 1000 && !drawAlerted) {
          drawAlerted = true;
          this.onDrawTimeReached();
        }
        return;
      }
      drawAlerted = false;  // 重新开始下次开奖时重置
      const h = Math.floor(diff / 3600000);
      const m = Math.floor((diff % 3600000) / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      const el = document.getElementById("countdown");
      if (el) el.textContent = `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
    };
    update();
    setInterval(update, 1000);
  },

  // 开奖时间到 + 5 分钟:提示录入
  onDrawTimeReached() {
    const pending = this.checkDataFreshness();
    if (pending > 0) {
      this.toast(`⏰ 大乐透已开奖 ${pending} 期,请录入最新数据`);
      // 自动弹录入框(只弹一次)
      setTimeout(() => {
        if (!document.getElementById("update-modal")) {
          this.openUpdateDialog();
        }
      }, 1000);
    }
  },

  startAutoRefresh() {
    this.loadUserData();
    this.checkDataFreshness();
    // 每 60 秒检查一次数据新鲜度
    setInterval(() => this.checkDataFreshness(), 60 * 1000);
  },

  // 用户数据(localStorage)合并
  USER_DATA_KEY: "dlt_user_added_periods_v1",

  loadUserData() {
    try {
      const raw = localStorage.getItem(this.USER_DATA_KEY);
      if (!raw) return;
      const userData = JSON.parse(raw);
      if (!Array.isArray(userData)) return;
      const existing = new Set(window.DLT_DATA.map(d => d.period));
      let added = 0;
      for (const d of userData) {
        if (d && d.period && !existing.has(d.period)) {
          window.DLT_DATA.push(d);
          existing.add(d.period);
          added++;
        }
      }
      if (added > 0) {
        window.DLT_DATA.sort((a, b) => a.period.localeCompare(b.period));
        console.log(`从 localStorage 合并 ${added} 期用户数据`);
      }
    } catch (e) { console.warn(e); }
  },

  saveUserData() {
    try {
      localStorage.setItem(this.USER_DATA_KEY, JSON.stringify(window.DLT_DATA));
    } catch (e) { console.warn(e); }
  },

  // 检测数据新鲜度(对比"现在"和"最新期")
  checkDataFreshness() {
    const latest = window.DLT_HELPERS.latest();
    if (!latest) return;
    const latestDate = new Date(latest.date + "T20:30:00");
    const now = new Date();
    // 算从 latest 到现在过了几个开奖日
    const days = [1, 3, 6];
    let expectedDraws = 0;
    const cursor = new Date(latestDate.getTime() + 24 * 3600 * 1000);
    while (cursor < now) {
      if (days.includes(cursor.getDay())) expectedDraws++;
      cursor.setDate(cursor.getDate() + 1);
    }
    // 当天过了 20:30 也算 1 期
    if (days.includes(now.getDay()) && now.getHours() >= 20 && now.getMinutes() >= 30) {
      const today = now.toISOString().slice(0, 10);
      if (latest.date !== today) expectedDraws++;
    }
    this.updateDataStatus(expectedDraws);

    // 如果有滞后,自动静默尝试云端拉取
    if (expectedDraws > 0 && this.cloudAutoFetchEnabled) {
      this.fetchFromCloud(true);
    }
    return expectedDraws;
  },

  // 启动云端自动拉取(智能模式:只在检测到落后时才拉)
  startCloudAutoFetch() {
    this.cloudAutoFetchEnabled = true;
    // 启动后 8 秒拉一次(让页面先渲染)
    setTimeout(() => {
      if (this.state.isLoggedIn) this.fetchFromCloud(true);
    }, 8000);
    // 每 3 分钟静默拉一次(只检测,不强制)
    this.cloudAutoFetchTimer = setInterval(() => {
      if (!this.state.isLoggedIn) return;
      // 只在"未登录后第一次" + 顶栏显示落后时才拉
      if (this.state.hasNewCloudData) return;  // 已有新数据待确认,不重复拉
      // 静默 GET 检查缓存(比 POST 轻)
      fetch("/.netlify/functions/fetch-latest", { method: "GET" })
        .then(r => r.json())
        .then(json => {
          if (json.success && json.data) {
            const currentLatest = DLT_DATA[DLT_DATA.length - 1];
            if (Number(json.data.period) > Number(currentLatest.period)) {
              // 云端比本地新 → 弹确认
              this.state.hasNewCloudData = true;
              this.showCloudConfirmDialog(json.data);
            }
          }
        })
        .catch(() => {});
    }, 5 * 60 * 1000);
  },

  updateDataStatus(pending) {
    let el = document.getElementById("data-status");
    if (!el) {
      const header = document.getElementById("app-header");
      if (!header) return;
      el = document.createElement("div");
      el.id = "data-status";
      el.style.cssText = "display:inline-block;font-size:11px;padding:3px 8px;border-radius:6px;margin-left:10px;cursor:pointer";
      const brand = header.querySelector(".brand");
      if (brand) brand.appendChild(el);
    }
    if (pending > 0) {
      el.textContent = `⚠ 落后 ${pending} 期 - 点击云端拉取`;
      el.style.background = "rgba(255,107,107,0.18)";
      el.style.color = "#ff6b6b";
      el.onclick = () => this.fetchFromCloud();
    } else {
      el.textContent = "✓ 数据最新";
      el.style.background = "rgba(0,200,100,0.15)";
      el.style.color = "#3ddc84";
      el.onclick = null;
    }
  },

  // ====== 云端拉取最新数据 ======
  async fetchFromCloud(silent = false) {
    // 支持 Netlify / 腾讯云 / 本地(Lighthouse/COS)等任意部署
    // 只要 /api/fetch-latest 或 /.netlify/functions/fetch-latest 可访问
    const tryEndpoints = async () => {
      // 先试 POST
      for (const ep of ["/.netlify/functions/fetch-latest", "/api/fetch-latest"]) {
        try {
          const r = await fetch(ep, { method: "POST" });
          if (r.ok) return await r.json();
        } catch (e) { /* 下个 */ }
      }
      return null;
    };
    const el = document.getElementById("data-status");
    if (el) {
      el.textContent = "🌐 拉取中...";
      el.style.color = "var(--primary)";
      el.style.background = "rgba(108,92,231,0.18)";
    }
    try {
      const json = await tryEndpoints();
      if (!json || !json.success) {
        if (!silent) this.toast("云端拉取失败,请手动录入");
        this.updateDataStatus(0);
        return;
      }
      const d = json.data;
      // 校验:期号 > 当前最新?
      const currentLatest = window.DLT_DATA[window.DLT_DATA.length - 1];
      if (Number(d.period) <= Number(currentLatest.period)) {
        if (!silent) this.toast(`云端数据 ${d.period} 不比本地新`);
        this.updateDataStatus(0);
        return;
      }
      // 弹窗让用户确认录入
      if (silent) {
        this.applyCloudUpdate(d);
      } else {
        this.showCloudConfirmDialog(d);
      }
    } catch (e) {
      if (!silent) this.toast("云端不可用 - 请手动录入");
      this.checkDataStatus();
    }
  },

  showCloudConfirmDialog(d) {
    const html = `
      <div class="modal-mask" onclick="if(event.target===this)closeModal()">
        <div class="modal">
          <div class="modal-title">🌐 云端拉取到新数据</div>
          <div class="cloud-info" style="background:var(--bg-3);padding:14px;border-radius:8px;margin:12px 0">
            <div style="font-size:13px;color:var(--ink-3);margin-bottom:8px">期号: <b style="color:var(--ink);font-size:15px">${d.period}</b>  ·  日期: <b style="color:var(--ink)">${d.date}</b></div>
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <span style="color:var(--ink-3);font-size:12px">前区:</span>
              ${d.front.map(n => `<span class="mini-ball">${String(n).padStart(2,'0')}</span>`).join('')}
              <span style="color:var(--ink-3);margin:0 4px">+</span>
              <span style="color:var(--ink-3);font-size:12px">后区:</span>
              ${d.back.map(n => `<span class="mini-ball blue">${String(n).padStart(2,'0')}</span>`).join('')}
            </div>
            <div style="font-size:11px;color:var(--ink-3);margin-top:10px">数据源: ${d.source}</div>
          </div>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button class="btn btn-primary" style="flex:1" onclick="APP.applyCloudUpdate(${JSON.stringify(d).replace(/"/g, '&quot;')});closeModal()">✓ 确认录入</button>
            <button class="btn" style="flex:1" onclick="closeModal()">取消</button>
          </div>
        </div>
      </div>`;
    const m = document.createElement("div");
    m.innerHTML = html;
    document.body.appendChild(m.firstElementChild);
  },

  applyCloudUpdate(d) {
    this.state.hasNewCloudData = false;
    // 复用录入逻辑
    const newRecord = {
      period: d.period,
      date: d.date,
      front: d.front,
      back: d.back,
      source: "cloud"
    };
    // 找到插入位置
    let inserted = false;
    for (let i = DLT_DATA.length - 1; i >= 0; i--) {
      if (Number(DLT_DATA[i].period) < Number(d.period)) {
        DLT_DATA.splice(i + 1, 0, newRecord);
        inserted = true;
        break;
      }
    }
    if (!inserted) DLT_DATA.unshift(newRecord);
    // 持久化到 USER_DATA
    this.state.userAdded = this.state.userAdded || [];
    if (!this.state.userAdded.find(x => x.period === d.period)) {
      this.state.userAdded.push(newRecord);
      localStorage.setItem(this.USER_DATA_KEY, JSON.stringify(this.state.userAdded));
    }
    showToast(`✓ ${d.period} 期已录入,系统重算中...`, "ok");
    this.learnFromHistory();
    this.selfTuneWeights();
    this.checkDataStatus();
    this.render();
  },

  // 弹窗:录入新一期
  openUpdateDialog() {
    const last = window.DLT_HELPERS.latest();
    const nextP = window.DLT_HELPERS.nextPeriod();
    const now = new Date();
    let defaultDate;
    if ([1,3,6].includes(now.getDay()) && now.getHours() >= 20 && now.getMinutes() >= 30) {
      defaultDate = now.toISOString().slice(0, 10);
    } else {
      let d = new Date(now);
      for (let i = 1; i < 8; i++) {
        d = new Date(now);
        d.setDate(now.getDate() - i);
        if ([1,3,6].includes(d.getDay())) {
          defaultDate = d.toISOString().slice(0, 10);
          break;
        }
      }
    }

    const html = `
      <div class="modal" id="update-modal" onclick="if(event.target===this)APP.closeUpdateDialog()">
        <div class="modal-content" style="max-width:520px">
          <div class="modal-title">📥 录入最新开奖数据</div>
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:14px;flex-wrap:wrap">
            <button class="btn btn-sm" onclick="APP.fetchFromCloud();closeModal()" style="background:rgba(108,92,231,0.18);color:var(--primary);border:1px solid var(--primary);padding:5px 12px;font-size:12px">
              🌐 从云端拉取
            </button>
            <span class="text-xs text-muted" style="flex:1">或手动录入 ↓</span>
          </div>
          <p class="text-sm text-muted" style="margin-bottom:14px">
            云端优先(自动),失败时可手动录入。录入后会自动重算下期杀号。
          </p>
          <div class="form-row">
            <label>期号</label>
            <input type="text" id="upd-period" value="${nextP}" maxlength="7" style="width:100px">
            <span class="text-xs text-muted">当前最新: ${last.period}</span>
          </div>
          <div class="form-row">
            <label>开奖日期</label>
            <input type="date" id="upd-date" value="${defaultDate}">
          </div>
          <div class="form-row">
            <label>前区 5 个号(01-35)</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${[1,2,3,4,5].map(i => `<input type="number" id="upd-f${i}" min="1" max="35" placeholder="${i}" style="width:56px;text-align:center">`).join('')}
            </div>
          </div>
          <div class="form-row">
            <label>后区 2 个号(01-12)</label>
            <div style="display:flex;gap:6px">
            ${[1,2].map(i => `<input type="number" id="upd-b${i}" min="1" max="12" placeholder="${i}" style="width:56px;text-align:center">`).join('')}
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:16px;justify-content:flex-end">
            <button class="btn" onclick="APP.closeUpdateDialog()">取消</button>
            <button class="btn btn-primary" onclick="APP.submitUpdate()">录入并重算</button>
          </div>
        </div>
      </div>
    `;
    const div = document.createElement("div");
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
  },

  closeUpdateDialog() {
    const m = document.getElementById("update-modal");
    if (m) m.remove();
  },

  submitUpdate() {
    const period = document.getElementById("upd-period").value.trim();
    const date = document.getElementById("upd-date").value;
    if (!/^\d{7}$/.test(period)) { this.toast("期号格式错误,应为 7 位数字(例:2026093)"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { this.toast("日期格式错误"); return; }
    if (window.DLT_DATA.some(d => d.period === period)) { this.toast(`期号 ${period} 已存在`); return; }
    const front = [];
    for (let i = 1; i <= 5; i++) {
      const v = parseInt(document.getElementById(`upd-f${i}`).value, 10);
      if (isNaN(v) || v < 1 || v > 35) { this.toast(`前区第 ${i} 个号错误`); return; }
      front.push(v);
    }
    const back = [];
    for (let i = 1; i <= 2; i++) {
      const v = parseInt(document.getElementById(`upd-b${i}`).value, 10);
      if (isNaN(v) || v < 1 || v > 12) { this.toast(`后区第 ${i} 个号错误`); return; }
      back.push(v);
    }
    if (new Set(front).size !== 5) { this.toast("前区 5 个号有重复"); return; }
    if (new Set(back).size !== 2) { this.toast("后区 2 个号有重复"); return; }
    front.sort((a, b) => a - b);
    back.sort((a, b) => a - b);
    window.DLT_DATA.push({ period, date, front, back });
    window.DLT_DATA.sort((a, b) => a.period.localeCompare(b.period));
    this.saveUserData();
    this.toast(`✓ ${period} 期已录入,正在重算公式回测(${window.DLT_DATA.length} 期)...`);
    this.closeUpdateDialog();
    // 异步重算(不阻塞用户操作)
    setTimeout(() => {
      this.learnKillingPatterns();  // 🧠 先更新 50 期自学习(供 computeFormulaKills 使用)
      this.computeFormulaKills();  // 然后重新算杀号(含最新软杀号)
      this.learnFromHistory();
      this.selfTuneWeights();
      this.renderHeader();
      this.renderTab(this.currentTab);
      this.toast(`✓ 累计 ${window.DLT_DATA.length} 期,公式+自学习回测已更新`);
    }, 100);
  },

  // ============== 自适应权重调优(per-number adjustments) ==============
  // 思路: 跑过去 50 期,记录每个号的"漏出/错出",生成调整系数
  //   - 漏出(实际出了但算法没选上)→ +0.15 (下次更倾向选)
  //   - 错出(算法选了但实际没出)→ -0.10 (下次降权)
  selfTuneWeights() {
    const data = window.DLT_DATA;
    if (data.length < 5) return;
    this.loadLearnData();
    const adjustments = {};  // { "1": +0.15, "2": -0.10, ... }
    const evalStart = Math.max(1, data.length - 50);
    for (let i = evalStart; i < data.length; i++) {
      const ctxData = data.slice(0, i);
      const actual = data[i];
      // 算冷热加权
      const candidates = []; for (let n = 1; n <= 35; n++) candidates.push(n);
      const weights = this.computeHotColdWeightsForHistory(candidates, ctxData, 100);
      // 选 top 5(权重最高的)作为"算法会选的"
      const sorted = [...weights.entries()].sort((a, b) => b[1] - a[1]);
      const top5 = sorted.slice(0, 5).map(e => e[0]);
      const rest = sorted.slice(5).map(e => e[0]);
      // 漏出(实际出了但不在 top5)
      for (const n of actual.front) {
        if (!top5.includes(n)) {
          adjustments[n] = (adjustments[n] || 0) + 0.15;
        }
      }
      // 错出(在 top5 但实际没出)
      for (const n of top5) {
        if (!actual.front.includes(n)) {
          adjustments[n] = (adjustments[n] || 0) - 0.10;
        }
      }
    }
    // 衰减: 老的调整逐渐失效(避免历史偏差)
    const decay = 0.95;
    for (const k of Object.keys(this.learnData.adjustments || {})) {
      if (!adjustments[k]) adjustments[k] = (this.learnData.adjustments[k] || 0) * decay;
    }
    // 限制范围 [-1, 1]
    for (const k of Object.keys(adjustments)) {
      adjustments[k] = Math.max(-1, Math.min(1, adjustments[k]));
    }
    this.learnData.adjustments = adjustments;
    this.learnData.tuneUpdated = Date.now();
    this.learnData.lastLearn = Date.now();
    this.saveLearnData();
  },

  // 获取带自适应调整的权重
  getAdjustedWeights(candidates, baseWeights) {
    const adjusted = new Map();
    const tune = (this.learnData && this.learnData.adjustments) || {};
    for (const n of candidates) {
      const base = baseWeights.get(n) || 0.1;
      const adj = tune[String(n)] || tune[n] || 0;
      adjusted.set(n, Math.max(0.05, base + adj));
    }
    return adjusted;
  },


  // ============== 自学系统(基于历史回测) ==============
  // 评估过去 N 期"智选"的表现,微调参数
  LEARN_KEY: "dlt_learn_data_v1",
  learnData: {
    totalEvaluated: 0,    // 总评估期数
    totalHits: 0,         // 总命中数(红+蓝)
    bestHit: 0,           // 最佳单期命中
    hit3plus: 0,          // 红 3+ 命中期数
    hit4plus: 0,          // 红 4+ 命中期数
    hit5: 0,              // 红 5 全中(中一等奖)
    lastUpdated: 0,
    adjustments: []       // 调整历史
  },

  loadLearnData() {
    try {
      const raw = localStorage.getItem(this.LEARN_KEY);
      if (raw) Object.assign(this.learnData, JSON.parse(raw));
    } catch (e) { console.warn(e); }
  },

  saveLearnData() {
    try {
      localStorage.setItem(this.LEARN_KEY, JSON.stringify(this.learnData));
    } catch (e) { console.warn(e); }
  },

  // 🧠 自学习:分析最近 50 期数据,找杀号"软权重"模式
  // 找出"上期某特征 → 下期不出的号"的关联,作为软杀号(权重 0.5)
  learnKillingPatterns() {
    try {
      const data = window.DLT_DATA;
      if (data.length < 20) return;
      this.loadLearnData();
      const softKills = { front: {}, back: {} };
      // 分析最近 50 期
      const N = Math.min(50, data.length - 1);
      for (let zone of ['front', 'back']) {
        const max = zone === 'front' ? 35 : 12;
        // 统计"上期某号出现" → "下期该号也出现" 的概率(重号率)
        const repeatRate = {};
        for (let n = 1; n <= max; n++) {
          let cases = 0, repeats = 0;
          for (let i = 1; i < N; i++) {
            const prev = data[data.length - N + i - 1];
            const actual = data[data.length - N + i];
            if (prev[zone].includes(n)) {
              cases++;
              if (actual[zone].includes(n)) repeats++;
            }
          }
          repeatRate[n] = cases > 0 ? repeats / cases : 0;
        }
        // 找出"重号率低"的号(更应该杀)
        // 同时找"近期 10 期没出"的号(冷号回归,但加入"软杀"考虑)
        const recent10 = data.slice(-10);
        for (let n = 1; n <= max; n++) {
          const inRecent10 = recent10.filter(d => d[zone].includes(n)).length;
          const inLast3 = data.slice(-3).filter(d => d[zone].includes(n)).length;
          // 软权重 1:近 3 期都没出 → 加 0.3
          if (inLast3 === 0) {
            softKills[zone][n] = (softKills[zone][n] || 0) + 0.3;
          }
          // 软权重 2:近 10 期出现 0 次(极冷) → 加 0.5
          if (inRecent10 === 0) {
            softKills[zone][n] = (softKills[zone][n] || 0) + 0.5;
          }
          // 软权重 3:重号率 < 0.1(历史上几乎不重) → 加 0.2
          if (repeatRate[n] < 0.1) {
            softKills[zone][n] = (softKills[zone][n] || 0) + 0.2;
          }
        }
      }
      // 算最近 50 期 和值/跨度/区间/奇偶 实际分布(用于"软目标")
      const sumFreq = {}, spanFreq = {}, zoneFreq = {}, oeFreq = {};
      for (let i = Math.max(0, data.length - N); i < data.length; i++) {
        const d = data[i];
        const sum = d.front.reduce((a, b) => a + b, 0);
        const sorted = [...d.front].sort((a, b) => a - b);
        const span = sorted[4] - sorted[0];
        const sumBucket = Math.round(sum / 5) * 5;
        sumFreq[sumBucket] = (sumFreq[sumBucket] || 0) + 1;
        spanFreq[span] = (spanFreq[span] || 0) + 1;
        const z = `${d.front.filter(n => n <= 12).length}-${d.front.filter(n => n >= 13 && n <= 24).length}-${d.front.filter(n => n >= 25).length}`;
        const oe = `${d.front.filter(n => n % 2 === 0).length}-${d.front.filter(n => n % 2 === 1).length}`;
        zoneFreq[z] = (zoneFreq[z] || 0) + 1;
        oeFreq[oe] = (oeFreq[oe] || 0) + 1;
      }
      this.learnData.softKills = softKills;
      this.learnData.softPatterns = {
        sumFreq, spanFreq, zoneFreq, oeFreq,
        sumAnalyzed: N,
        updatedAt: Date.now()
      };
      this.learnData.lastLearn = Date.now();
      this.saveLearnData();
      console.log(`[learnKillingPatterns] ✓ 分析 ${N} 期,生成 ${Object.keys(softKills.front).length} 前区软杀号 + ${Object.keys(softKills.back).length} 后区软杀号`);
    } catch (e) {
      console.error('[learnKillingPatterns] 异常:', e);
    }
  },

  // 跑历史回测,评估智选算法的"自学效果"
  learnFromHistory() {
    try {
      const data = window.DLT_DATA;
      if (data.length < 5) return;  // 数据太少不评估

      this.loadLearnData();
      // 评估过去 50 期(从第 1 期开始,每期用前 1 期数据"预测"该期)
      // 因为是回测,实际"预测"没法改历史,所以只评估"事后"模式匹配
      const evalStart = Math.max(1, data.length - 50);
      let totalHits = 0, bestHit = 0, hit3plus = 0, hit4plus = 0, hit5 = 0;

      for (let i = evalStart; i < data.length; i++) {
        const prev = data[i - 1];
        const actual = data[i];
        // 模拟智选:用 prev 数据 + 当时没有用户杀号
        const candidates = []; for (let n = 1; n <= 35; n++) candidates.push(n);
        // 用 100 期冷热加权(基于 data[0..i-1])
        const ctxData = data.slice(0, i);
        const weights = this.computeHotColdWeightsForHistory(candidates, ctxData, 100);
        // 跑 30 次智选取平均命中(原 50 次,减少计算量)
        const hits = [];
        for (let t = 0; t < 30; t++) {
          const front = this.weightedSampleNoRepeat(candidates, 5, weights);
          const back = this.weightedSampleNoRepeat([1,2,3,4,5,6,7,8,9,10,11,12], 2, this.computeHotColdWeightsForHistory([1,2,3,4,5,6,7,8,9,10,11,12], ctxData, 100));
          const fHit = front.filter(n => actual.front.includes(n)).length;
          const bHit = back.filter(n => actual.back.includes(n)).length;
          hits.push(fHit + bHit);
        }
        const avgHit = hits.reduce((a, b) => a + b, 0) / hits.length;
        totalHits += avgHit;
        if (avgHit > bestHit) bestHit = avgHit;
        if (avgHit >= 3) hit3plus++;
        if (avgHit >= 4) hit4plus++;
        if (avgHit >= 5) hit5++;
      }
      const totalEval = data.length - evalStart;
      if (totalEval > 0) {
        this.learnData.totalEvaluated = totalEval;
        this.learnData.totalHits = totalHits;
        this.learnData.avgHit = (totalHits / totalEval).toFixed(2);
        this.learnData.bestHit = bestHit.toFixed(1);
        this.learnData.hit3plus = hit3plus;
        this.learnData.hit4plus = hit4plus;
        this.learnData.hit5 = hit5;
        this.learnData.lastUpdated = Date.now();
        this.learnData.learnProgress = Math.min(100, Math.round(totalEval / 50 * 100));
        this.saveLearnData();
        console.log(`[learnFromHistory] ✓ 评估 ${totalEval} 期,平均命中 ${this.learnData.avgHit}/7,最佳 ${this.learnData.bestHit}/7`);
      }
    } catch (e) {
      console.error("[learnFromHistory] 异常:", e);
    }
  },

  // 手动触发重新学习(显示 loading + 重新评估)
  manualLearn() {
    this.toast("🎓 正在重新评估历史数据...");
    setTimeout(() => {
      // 重置所有学习数据
      this.learnData = {
        totalEvaluated: 0,
        totalHits: 0,
        bestHit: 0,
        hit3plus: 0,
        hit4plus: 0,
        hit5: 0,
        lastUpdated: 0,
        adjustments: [],
        tuneUpdated: 0,
        lastLearn: 0
      };
      this.saveLearnData();
      this.learnKillingPatterns();  // 🧠 50 期自学习杀号模式
      this.computeFormulaKills();  // 重算杀号(含最新软杀号)
      this.learnFromHistory();
      this.selfTuneWeights();
      this.toast(`✓ 学习完成 - 平均命中 ${this.learnData.avgHit}/7`);
      // 刷新当前 tab
      this.renderTab(this.currentTab);
    }, 50);
  },

  // 给历史回测用的冷热加权(传入指定 data)
  computeHotColdWeightsForHistory(candidates, data, lookback = 30) {
    const weights = new Map();
    candidates.forEach(n => weights.set(n, 0.1));
    const recent = data.slice(-lookback);
    recent.forEach((d, i) => {
      const w = (i + 1) / recent.length;
      d.front.forEach(n => {
        if (weights.has(n)) weights.set(n, weights.get(n) + w);
      });
    });
    return weights;
  },

  // ============== 标签页切换 ==============
  switchTab(tab, evt) {
    this.currentTab = tab;
    document.querySelectorAll(".tab").forEach(el => el.classList.remove("active"));
    if (evt && evt.target) {
      evt.target.classList.add("active");
    } else {
      document.querySelectorAll(".tab").forEach(el => {
        if (el.dataset.tab === tab) el.classList.add("active");
      });
    }
    this.renderTab(tab);
  },

  renderTab(tab) {
    const main = document.getElementById("main-content");
    switch (tab) {
      case "kill": main.innerHTML = this.renderKillTab(); break;
      case "analysis": main.innerHTML = this.renderAnalysisTab(); break;
      case "history": main.innerHTML = this.renderHistoryTab(); break;
      case "share": main.innerHTML = this.renderShareTab(); break;
    }
  },

  // ============== 杀号 Tab(主功能) ==============
  renderKillTab() {
    const latest = window.DLT_HELPERS.latest();
    const nextPeriod = window.DLT_HELPERS.nextPeriod();
    const nextTime = window.DLT_HELPERS.nextDrawTime();

    // 计算候选池(前区)
    const frontKilledAll = this.getAllKilled("front");
    const backKilledAll = this.getAllKilled("back");
    const frontCandidates = [];
    for (let n = 1; n <= 35; n++) {
      if (!frontKilledAll.has(n)) frontCandidates.push(n);
    }
    const backCandidates = [];
    for (let n = 1; n <= 12; n++) {
      if (!backKilledAll.has(n)) backCandidates.push(n);
    }

    // 杀号池(已杀号)
    const frontKilledList = [...frontKilledAll].sort((a, b) => a - b);
    const backKilledList = [...backKilledAll].sort((a, b) => a - b);

    // 计算注数和金额
    const { count, money } = this.calculateCost();

    return `
      <div class="kill-layout">
        <!-- 左侧: 最新开奖 + 杀号池 -->
        <div>
          ${this.renderLatestCard(latest, nextPeriod, nextTime)}

          <!-- 红球杀号 -->
          <div class="kill-section">
            <div class="kill-section-header">
              <div class="kill-section-title">
                <span class="red-dot"></span>
                <span>红球杀号 <span class="text-xs text-muted">(1-35,点击切换)</span></span>
              </div>
              <div class="kill-section-actions">
                <button class="btn-mini" onclick="APP.applyFormulaKills('front')">📐 公式杀号</button>
                <button class="btn-mini" onclick="APP.clearKills('front')">↻ 恢复全部</button>
              </div>
            </div>
            <div class="ball-grid" id="front-ball-grid">
              ${this.renderBallGrid("front", 1, 35)}
            </div>
            <div class="candidate-pool">
              <div class="candidate-pool-header">
                <span>候选池(剩余 <span class="count">${frontCandidates.length}</span> 个)</span>
                <span class="text-xs text-muted">点击加入选号</span>
              </div>
              <div class="candidate-list" id="front-candidates">
                ${frontCandidates.map(n => `<span class="candidate-item" onclick="APP.addToSelection('front', ${n})">${String(n).padStart(2,'0')}</span>`).join('')}
              </div>
            </div>
            <div class="killed-pool">
              <div class="killed-pool-header">
                <span>🗑 已杀号池(<span class="count">${frontKilledList.length}</span> 个)<span class="text-xs text-muted" style="margin-left:6px">点击恢复</span></span>
              </div>
              <div class="killed-list" id="front-killed-list">
                ${frontKilledList.length > 0
                  ? frontKilledList.map(n => `<span class="killed-item" onclick="APP.toggleKill('front', ${n})" title="${n}号(点击恢复)">${String(n).padStart(2,'0')}</span>`).join('')
                  : '<span class="text-xs text-muted">无</span>'}
              </div>
            </div>
          </div>

          <!-- 蓝球杀号 -->
          <div class="kill-section">
            <div class="kill-section-header">
              <div class="kill-section-title">
                <span class="blue-dot"></span>
                <span>蓝球杀号 <span class="text-xs text-muted">(1-12,点击切换)</span></span>
              </div>
              <div class="kill-section-actions">
                <button class="btn-mini" onclick="APP.applyFormulaKills('back')">📐 公式杀号</button>
                <button class="btn-mini" onclick="APP.clearKills('back')">↻ 恢复全部</button>
              </div>
            </div>
            <div class="ball-grid" id="back-ball-grid">
              ${this.renderBallGrid("back", 1, 12)}
            </div>
            <div class="candidate-pool">
              <div class="candidate-pool-header">
                <span>候选池(剩余 <span class="count">${backCandidates.length}</span> 个)</span>
                <span class="text-xs text-muted">点击加入选号</span>
              </div>
              <div class="candidate-list" id="back-candidates">
                ${backCandidates.map(n => `<span class="candidate-item blue" onclick="APP.addToSelection('back', ${n})">${String(n).padStart(2,'0')}</span>`).join('')}
              </div>
            </div>
            <div class="killed-pool">
              <div class="killed-pool-header">
                <span>🗑 已杀号池(<span class="count">${backKilledList.length}</span> 个)<span class="text-xs text-muted" style="margin-left:6px">点击恢复</span></span>
              </div>
              <div class="killed-list" id="back-killed-list">
                ${backKilledList.length > 0
                  ? backKilledList.map(n => `<span class="killed-item killed-blue" onclick="APP.toggleKill('back', ${n})" title="${n}号(点击恢复)">${String(n).padStart(2,'0')}</span>`).join('')
                  : '<span class="text-xs text-muted">无</span>'}
              </div>
            </div>
          </div>
        </div>

        <!-- 右侧: 复式选号 + 收藏 -->
        <div>
          ${this.renderCompoundCard(count, money)}
          ${this.renderPickReference()}
          ${this.renderFavoritesCard()}
        </div>
      </div>
    `;
  },

  // ============== 最新开奖卡片 ==============
  renderLatestCard(latest, nextPeriod, nextTime) {
    const target = nextTime;
    const now = new Date();
    const diff = target - now;
    const h = Math.max(0, Math.floor(diff / 3600000));
    const m = Math.max(0, Math.floor((diff % 3600000) / 60000));
    const s = Math.max(0, Math.floor((diff % 60000) / 1000));
    const d = Math.floor(h / 24);
    const hRem = h % 24;

    return `
      <div class="latest-card">
        <div class="kill-section-header">
          <div class="kill-section-title">
            <span>📢 最新开奖</span>
            <span class="live-dot"></span>
            <span class="text-xs text-muted" style="color:var(--green)">LIVE</span>
          </div>
        </div>
        <div class="text-sm text-muted" style="margin-bottom:8px">
          第 <span class="text-primary font-bold">${latest.period}</span> 期 · ${latest.date}
        </div>
        <div class="home-latest-balls" style="margin:6px 0 12px">
          ${latest.front.map(n => `<div class="home-latest-ball">${String(n).padStart(2,'0')}</div>`).join('')}
          <span class="text-muted home-latest-sep">+</span>
          ${latest.back.map(n => `<div class="home-latest-ball blue">${String(n).padStart(2,'0')}</div>`).join('')}
        </div>

        <div class="countdown-grid">
          <div class="countdown-cell">
            <div class="num">${String(d).padStart(2,'0')}</div>
            <div class="lbl">天</div>
          </div>
          <div class="countdown-cell">
            <div class="num">${String(hRem).padStart(2,'0')}</div>
            <div class="lbl">时</div>
          </div>
          <div class="countdown-cell">
            <div class="num">${String(m).padStart(2,'0')}</div>
            <div class="lbl">分</div>
          </div>
          <div class="countdown-cell">
            <div class="num">${String(s).padStart(2,'0')}</div>
            <div class="lbl">秒</div>
          </div>
        </div>
        <div class="next-info">
          下一期 第 <span class="text-primary font-bold">${nextPeriod}</span> 期 · ${nextTime.toLocaleString("zh-CN", {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'})}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;align-items:center;justify-content:space-between">
          <button class="btn btn-sm" onclick="APP.openUpdateDialog()" style="background:var(--card);border:1px solid var(--line);color:var(--ink-2);padding:5px 10px;font-size:11.5px;border-radius:6px">
            📥 录入新一期
          </button>
          <span class="text-xs text-muted">大乐透:周一/三/六 20:30</span>
        </div>
      </div>
    `;
  },

  // ============== 球网格渲染 ==============
  renderBallGrid(zone, start, end) {
    const killedSet = this.getAllKilled(zone);
    const formulaMap = zone === "front" ? this.state.formulaKilledFront : this.state.formulaKilledBack;
    const selectedSet = new Set(zone === "front" ? this.state.selection.front : this.state.selection.back);
    const manualSet = zone === "front" ? this.state.frontKilled : this.state.backKilled;
    const overrideSet = zone === "front" ? this.state.userOverrideFront : this.state.userOverrideBack;

    let html = '';
    for (let n = start; n <= end; n++) {
      const isKilled = killedSet.has(n);
      const isSelected = selectedSet.has(n);
      const isManual = manualSet.has(n);
      const isOverridden = overrideSet.has(n);
      const isInFormula = formulaMap.has(n);
      const formulaCount = formulaMap.get(n) || 0;

      let classes = "ball-cell";
      if (zone === "front") classes += " front-color";
      else classes += " back-color";

      if (isKilled) classes += " killed";
      if (isSelected) classes += " selected";
      if (isOverridden && isInFormula) classes += " rescued";  // 用户覆盖,公式杀的号被恢复

      // 角标: 只在公式杀但没被覆盖时显示
      const badge = (isInFormula && !isOverridden && !isSelected) ? `<span class="badge">${formulaCount}</span>` : '';

      // title
      let title = `${n}号`;
      if (isManual) title += ' (手动杀号)';
      else if (isOverridden) title += ' (已恢复,点击重新杀)';
      else if (isInFormula) title += ` (${formulaCount}个公式杀,点击恢复)`;
      if (isSelected) title += ' [已在选号]';

      // 置信度属性(0-9) - 决定颜色深度
      const confidence = isInFormula ? Math.min(9, formulaCount) : 0;
      const confidenceAttr = (isInFormula || isManual) ? ` data-confidence="${confidence}"` : '';

      html += `<div class="${classes}"${confidenceAttr} onclick="APP.toggleKill('${zone}', ${n})" title="${title}">
        <span class="num-text">${String(n).padStart(2,'0')}</span>
        ${badge}
      </div>`;
    }
    return html;
  },

  // ============== 复式选号卡片 ==============
  renderCompoundCard(count, money) {
    const sel = this.state.selection;
    const picks = this.state.picks || [];
    // 计算注数和金额
    let totalCount = 0, totalMoney = 0;
    let displayCount, displayMoney;
    if (picks.length > 0) {
      // 多注模式: 5 注独立单注
      totalCount = picks.length;
      totalMoney = picks.length * 2;
      displayCount = totalCount;
      displayMoney = totalMoney;
    } else {
      // 复式模式: C(n,5) × C(m,2)
      totalCount = count;
      totalMoney = money;
      displayCount = count;
      displayMoney = money;
    }

    // 选号展示
    let ballsHtml = '';
    if (picks.length > 0) {
      ballsHtml = picks.map((p, i) => `
        <div class="pick-row" style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:var(--bg-2);border-radius:6px;margin-bottom:4px;border:1px solid var(--line)">
          <span class="text-xs text-muted" style="min-width:24px">第${i+1}注</span>
          <div style="display:flex;gap:2px;flex:1">
            ${p.front.map(n => `<span class="compound-ball" style="background:linear-gradient(135deg,#ff6b5a,var(--red))">${String(n).padStart(2,'0')}</span>`).join('')}
            <span class="text-xs text-muted" style="margin:0 2px">+</span>
            ${p.back.map(n => `<span class="compound-ball" style="background:linear-gradient(135deg,var(--blue),var(--blue-2))">${String(n).padStart(2,'0')}</span>`).join('')}
          </div>
          <button class="btn-mini" onclick="APP.removePick(${i})" title="删除此注" style="background:rgba(231,76,60,0.15);color:var(--red);border:1px solid rgba(231,76,60,0.3)">×</button>
        </div>
      `).join('');
    } else {
      // 复式选号展示
      ballsHtml = `
        <div class="compound-zone">
          <div class="compound-zone-label">
            <span class="red-dot"></span>
            <span>红</span>
            <span class="count">(${sel.front.length}/35)</span>
          </div>
          <div class="compound-balls ${sel.front.length > 0 ? 'has-balls' : ''}" id="compound-front">
            ${sel.front.length > 0 ? sel.front.map(n => `
              <span class="compound-ball" onclick="APP.removeFromSelection('front', ${n})" title="点击移除">
                ${String(n).padStart(2,'0')}
                <span class="remove">×</span>
              </span>
            `).join('') : '<span class="text-xs text-muted" style="padding:6px">从候选池点击加入,或点击智能单选自动生成</span>'}
          </div>
        </div>
        <div class="compound-zone">
          <div class="compound-zone-label">
            <span class="blue-dot"></span>
            <span>蓝</span>
            <span class="count">(${sel.back.length}/12)</span>
          </div>
          <div class="compound-balls ${sel.back.length > 0 ? 'has-balls' : ''}" id="compound-back">
            ${sel.back.length > 0 ? sel.back.map(n => `
              <span class="compound-ball" onclick="APP.removeFromSelection('back', ${n})" title="点击移除" style="background:linear-gradient(135deg,var(--blue),var(--blue-2));box-shadow:0 2px 6px rgba(52,152,219,0.4)">
                ${String(n).padStart(2,'0')}
                <span class="remove">×</span>
              </span>
            `).join('') : '<span class="text-xs text-muted" style="padding:6px">从候选池点击加入,或点击智能单选自动生成</span>'}
          </div>
        </div>
      `;
    }

    return `
      <div class="compound-card">
        <div class="compound-header">
          <div class="section-title">
            <span style="color:var(--primary)">★</span>
            <span>复式选号 ${picks.length > 0 ? `(多注 ${picks.length} 注)` : '(单注/复式)'}</span>
          </div>
        </div>

        ${picks.length > 0 ? `<div style="margin:8px 0">${ballsHtml}</div>` : ballsHtml}

        <div class="compound-summary">
          <div class="summary-item">
            <div class="label">注数</div>
            <div class="value">${displayCount}</div>
          </div>
          <div class="summary-item money">
            <div class="label">金额(¥)</div>
            <div class="value">¥${displayMoney}</div>
          </div>
        </div>
        ${displayCount === 0 && sel.front.length > 0 ? `
          <div class="text-xs" style="color:var(--warn);background:rgba(255,180,50,0.08);border:1px solid rgba(255,180,50,0.2);border-radius:6px;padding:8px 10px;margin-top:8px">
            ⚠ <strong>大乐透规则:</strong> 前区必须选 5 个,后区必须选 2 个。<br>
            当前: ${sel.front.length} 红 + ${sel.back.length} 蓝 → C(${sel.front.length},5) × C(${sel.back.length},2) = 0 注<br>
            ${sel.back.length < 2 ? `→ 后区 < 2 个,无法组合。点"🎲 智能"或"🎰 复式"自动选满 2 个` : `→ 前区 < 5 个,再选 ${5 - sel.front.length} 个`}
          </div>
        ` : ''}

        <div class="compound-actions">
          <button class="btn btn-ghost" onclick="APP.clearSelection()">🗑 清空</button>
          <button class="btn btn-primary" onclick="APP.smartPick()">🎲 智能单选</button>
          <button class="btn btn-primary" onclick="APP.smartPickFive()">🎲 5注</button>
          <button class="btn btn-primary" onclick="APP.smartPickCompound()">🎰 复式</button>
          <button class="btn btn-ghost" onclick="APP.smartPick()">🔄 复刷</button>
          <button class="btn btn-warn" onclick="APP.saveFavorite()">⭐ 收藏</button>
        </div>

        <!-- 快捷复式选号(精致大按钮) -->
        <div style="margin-top:12px;padding:12px;background:linear-gradient(135deg,rgba(108,92,231,0.08),rgba(108,92,231,0.02));border:1px solid rgba(108,92,231,0.25);border-radius:12px">
          <div style="font-size:12px;color:var(--ink-2);margin-bottom:10px;font-weight:600;display:flex;align-items:center;gap:6px">
            <span style="font-size:14px">⚡</span>
            <span>快捷复式(从候选池自动选)</span>
          </div>
          <div style="display:flex;gap:10px;flex-wrap:wrap">
            <button class="quick-compound-btn compound-6" onclick="APP.quickCompound(6, 3)">
              <div class="compound-label">6+3</div>
              <div class="compound-meta"><span class="num">18</span> 注 · ¥<span class="num">36</span></div>
            </button>
            <button class="quick-compound-btn compound-7" onclick="APP.quickCompound(7, 4)">
              <div class="compound-label">7+4</div>
              <div class="compound-meta"><span class="num">126</span> 注 · ¥<span class="num">252</span></div>
            </button>
            <button class="quick-compound-btn compound-8" onclick="APP.quickCompound(8, 4)">
              <div class="compound-label">8+4</div>
              <div class="compound-meta"><span class="num">336</span> 注 · ¥<span class="num">672</span></div>
            </button>
          </div>
          <div style="margin-top:10px;font-size:11px;color:var(--ink-3);line-height:1.5">
            💡 例: <b>7+4</b> = C(7,5)×C(4,2) = 21×6 = <b>126 注(¥252)</b>。覆盖更多组合,但费用倍增。
          </div>
        </div>
        <div class="text-xs text-muted" style="margin-top:8px;text-align:right">
          💡 智选严格在候选池(${`红 ${this.getAllKilled("front").size} 个被杀,候选 ${35 - this.getAllKilled("front").size}/35`})内选。结果受限于候选池大小。
        </div>
      </div>
    `;
  },

  // ============== 选号统计参考卡片 ==============
  // 展示 100 期实际统计规律,让用户看到"选号不是随机"的科学依据
  renderPickReference() {
    const data = window.DLT_DATA || [];
    if (data.length < 30) return '';
    const last100 = data.slice(-100);
    // 和值分布(按 10 分桶)
    const sumBuckets = {};
    const zoneFreq = {};
    const oeFreq = {};
    const spanFreq = {};
    let consecCount = 0, tailCount = 0;
    last100.forEach(d => {
      const sum = d.front.reduce((a, b) => a + b, 0);
      const sorted = [...d.front].sort((a, b) => a - b);
      const span = sorted[4] - sorted[0];
      const sumBucket = Math.round(sum / 10) * 10;
      sumBuckets[sumBucket] = (sumBuckets[sumBucket] || 0) + 1;
      spanFreq[span] = (spanFreq[span] || 0) + 1;
      const z = `${sorted.filter(n => n <= 12).length}-${sorted.filter(n => n >= 13 && n <= 24).length}-${sorted.filter(n => n >= 25).length}`;
      const oe = `${sorted.filter(n => n % 2 === 0).length}-${sorted.filter(n => n % 2 === 1).length}`;
      zoneFreq[z] = (zoneFreq[z] || 0) + 1;
      oeFreq[oe] = (oeFreq[oe] || 0) + 1;
      // 连号检测
      let hasConsec = false;
      for (let i = 0; i < sorted.length - 1; i++) if (sorted[i+1] - sorted[i] === 1) hasConsec = true;
      if (hasConsec) consecCount++;
      // 同尾号检测
      const tails = {};
      sorted.forEach(n => { tails[n % 10] = (tails[n % 10] || 0) + 1; });
      if (Object.values(tails).some(c => c >= 2)) tailCount++;
    });
    // 高频 top 3
    const topSum = Object.entries(sumBuckets).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topSpan = Object.entries(spanFreq).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topZone = Object.entries(zoneFreq).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const topOE = Object.entries(oeFreq).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const consecP = (consecCount / last100.length * 100).toFixed(0);
    const tailP = (tailCount / last100.length * 100).toFixed(0);
    // 上期重号概率
    let repeatCases = 0, repeatHits = 0;
    for (let i = data.length - 100; i < data.length - 1; i++) {
      if (!data[i + 1]) continue;
      const prev = new Set(data[i].front);
      const actual = data[i + 1].front;
      for (const n of prev) {
        repeatCases++;
        if (actual.includes(n)) repeatHits++;
      }
    }
    const repeatRate = repeatCases > 0 ? (repeatHits / repeatCases * 100).toFixed(1) : '--';
    // 格式化
    const fmtList = (arr, fmt) => arr.map(([k, v]) => {
      const pct = (v / last100.length * 100).toFixed(0);
      return `<span style="background:rgba(108,92,231,0.18);padding:2px 6px;border-radius:5px;margin-right:3px"><b>${(fmt ? fmt(k) : k)}</b> <span style="color:var(--ink-3);font-size:10px">${pct}%</span></span>`;
    }).join('');
    return `
      <div style="background:linear-gradient(135deg,rgba(108,92,231,0.10),rgba(108,92,231,0.04));border:1px solid rgba(108,92,231,0.25);border-radius:10px;padding:10px 12px;margin-top:10px;font-size:11.5px">
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:8px">
          <span style="font-size:13px">📊</span>
          <span style="font-weight:600;color:var(--primary)">选号统计参考</span>
          <span style="color:var(--ink-3);font-size:10px;margin-left:auto">近 ${last100.length} 期实际数据</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 12px">
          <div>
            <div style="color:var(--ink-3);font-size:10.5px;margin-bottom:3px">🎯 和值(高频桶)</div>
            <div>${fmtList(topSum, v => `${v}`)}</div>
          </div>
          <div>
            <div style="color:var(--ink-3);font-size:10.5px;margin-bottom:3px">📏 跨度(高频)</div>
            <div>${fmtList(topSpan)}</div>
          </div>
          <div>
            <div style="color:var(--ink-3);font-size:10.5px;margin-bottom:3px">📦 区间比(一二区)</div>
            <div>${fmtList(topZone)}</div>
          </div>
          <div>
            <div style="color:var(--ink-3);font-size:10.5px;margin-bottom:3px">⚖ 奇偶比(偶:奇)</div>
            <div>${fmtList(topOE)}</div>
          </div>
        </div>
        <div style="margin-top:8px;padding-top:8px;border-top:1px dashed rgba(108,92,231,0.25);display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;font-size:10.5px">
          <div style="text-align:center">
            <div style="color:var(--ink-3)">连号概率</div>
            <div style="color:var(--primary);font-weight:600;font-size:14px">${consecP}%</div>
          </div>
          <div style="text-align:center">
            <div style="color:var(--ink-3)">同尾概率</div>
            <div style="color:var(--primary);font-weight:600;font-size:14px">${tailP}%</div>
          </div>
          <div style="text-align:center">
            <div style="color:var(--ink-3)">重号概率</div>
            <div style="color:var(--primary);font-weight:600;font-size:14px">${repeatRate}%</div>
          </div>
        </div>
        <div style="margin-top:6px;font-size:10px;color:var(--ink-3);line-height:1.4">
          💡 智能选号会优先选符合上述高频模式的组合(基于真实历史分布,不是平均)
        </div>
      </div>
    `;
  },

  // ============== 收藏卡片 ==============
  renderFavoritesCard() {
    const totalPicks = this.state.favorites.reduce((s, f) => s + (f.picks ? f.picks.length : 1), 0);
    return `
      <div class="favorites-card">
        <div class="kill-section-header">
          <div class="section-title">
            <span style="color:var(--yellow)">⭐</span>
            <span>我的收藏</span>
            <span class="text-xs text-muted">(${this.state.favorites.length} 组 / ${totalPicks} 注)</span>
          </div>
          <div class="kill-section-actions">
            <button class="btn-mini" onclick="APP.copyAllFavorites()">📋 复制全部</button>
            <button class="btn-mini" onclick="APP.clearFavorites()">🗑 全部删除</button>
          </div>
        </div>
        ${this.state.favorites.length === 0 ?
          '<div class="text-xs text-muted" style="padding:12px;text-align:center">还没有收藏。选好号码后点击 ⭐ 收藏</div>' :
          this.state.favorites.slice().reverse().map((fav, i) => {
            const picks = fav.picks || [{ front: fav.front, back: fav.back }];
            const picksHtml = picks.map((p, j) => `
              <div style="display:flex;align-items:center;gap:4px;font-size:10.5px;margin-top:2px">
                <span class="text-xs text-muted" style="min-width:28px">第${j+1}注</span>
                <span class="fav-balls-inline">${p.front.map(n => `<span class="mini-ball">${String(n).padStart(2,'0')}</span>`).join('')}<span class="sep">+</span>${p.back.map(n => `<span class="mini-ball blue">${String(n).padStart(2,'0')}</span>`).join('')}</span>
              </div>
            `).join('');
            return `
              <div class="fav-item">
                <div style="flex:1;min-width:0">
                  <div class="font-bold" style="font-size:12px;margin-bottom:2px">${fav.name} <span class="text-xs text-muted">(${picks.length} 注)</span></div>
                  ${picksHtml}
                </div>
                <div class="fav-actions">
                  <button class="btn-mini" onclick="APP.loadFavorite(${this.state.favorites.length - 1 - i})">载入</button>
                  <button class="btn-mini" onclick="APP.copyFavorite(${this.state.favorites.length - 1 - i})">复制</button>
                  <button class="btn-mini" onclick="APP.deleteFavorite(${this.state.favorites.length - 1 - i})">删除</button>
                </div>
              </div>
            `;
          }).join('')
        }
      </div>
    `;
  },

  // ============== 杀号操作 ==============
  getAllKilled(zone) {
    const manual = zone === "front" ? this.state.frontKilled : this.state.backKilled;
    const formula = zone === "front" ? this.state.formulaKilledFront : this.state.formulaKilledBack;
    const override = zone === "front" ? this.state.userOverrideFront : this.state.userOverrideBack;
    // 公式杀 - 用户覆盖 + 手动杀
    const all = new Set([...manual]);
    formula.forEach((_, n) => {
      if (!override.has(n)) all.add(n);
    });
    return all;
  },

  toggleKill(zone, num) {
    const manualSet = zone === "front" ? this.state.frontKilled : this.state.backKilled;
    const formulaMap = zone === "front" ? this.state.formulaKilledFront : this.state.formulaKilledBack;
    const overrideSet = zone === "front" ? this.state.userOverrideFront : this.state.userOverrideBack;
    const sel = zone === "front" ? this.state.selection.front : this.state.selection.back;

    const isInFormula = formulaMap.has(num);
    const isManuallyKilled = manualSet.has(num);
    const isOverridden = overrideSet.has(num);

    if (isInFormula && !isOverridden) {
      // 公式杀的号 → 加入 override(恢复)
      overrideSet.add(num);
      if (sel.includes(num)) this.removeFromSelection(zone, num, true);
    } else if (isOverridden) {
      // 已恢复的 → 取消 override(重新杀)
      overrideSet.delete(num);
    } else if (isManuallyKilled) {
      // 手动杀的 → 取消
      manualSet.delete(num);
    } else {
      // 未杀的 → 手动杀
      manualSet.add(num);
      if (sel.includes(num)) this.removeFromSelection(zone, num, true);
    }
    this.renderTab(this.currentTab);
  },

  applyFormulaKills(zone) {
    const formulaMap = zone === "front" ? this.state.formulaKilledFront : this.state.formulaKilledBack;
    const overrideSet = zone === "front" ? this.state.userOverrideFront : this.state.userOverrideBack;
    const manualSet = zone === "front" ? this.state.frontKilled : this.state.backKilled;
    const count = formulaMap.size;
    if (count === 0) {
      this.toast("本期没有触发的公式");
      return;
    }
    if (confirm(`本期有 ${count} 个号被公式杀掉。\n\n点击"确定"将:把公式杀的号加入手动杀号(可手动点击 ↻ 恢复全部 撤回)\n\n注意:这不会清除已手动恢复的覆盖`)) {
      formulaMap.forEach((_, num) => {
        if (!overrideSet.has(num)) manualSet.add(num);
      });
      this.renderTab(this.currentTab);
      this.toast(`已应用公式杀号 (新增 ${manualSet.size - count} 个手动)`);
    }
  },

  clearKills(zone) {
    const manualSet = zone === "front" ? this.state.frontKilled : this.state.backKilled;
    const overrideSet = zone === "front" ? this.state.userOverrideFront : this.state.userOverrideBack;
    const total = manualSet.size + overrideSet.size;
    if (total === 0) {
      this.toast("没有杀号可恢复");
      return;
    }
    if (confirm(`确认恢复全部 ${total} 个杀号?\n(手动杀 + 用户覆盖的公式杀)`)) {
      manualSet.clear();
      overrideSet.clear();
      this.renderTab(this.currentTab);
      this.toast("已恢复全部");
    }
  },

  // ============== 选号操作 ==============
  addToSelection(zone, num) {
    const sel = this.state.selection;
    const arr = zone === "front" ? sel.front : sel.back;
    const max = zone === "front" ? 35 : 12;
    const min = zone === "front" ? 5 : 2;
    if (arr.includes(num)) {
      this.toast(`${num}号已在选号中`);
      return;
    }
    if (arr.length >= 18) {  // 大乐透前区最多 18 个,后区最多 12 个
      this.toast(`已达上限 ${arr.length} 个`);
      return;
    }
    arr.push(num);
    arr.sort((a, b) => a - b);
    this.renderTab(this.currentTab);
  },

  removeFromSelection(zone, num, silent = false) {
    const sel = this.state.selection;
    const arr = zone === "front" ? sel.front : sel.back;
    const idx = arr.indexOf(num);
    if (idx >= 0) {
      arr.splice(idx, 1);
      if (!silent) this.renderTab(this.currentTab);
    }
  },

  clearSelection() {
    const isEmpty = this.state.selection.front.length === 0 && this.state.selection.back.length === 0 && (this.state.picks || []).length === 0;
    if (isEmpty) {
      this.toast("选号已为空");
      return;
    }
    if (confirm("确认清空选号?")) {
      this.state.selection = { front: [], back: [] };
      this.state.picks = [];
      this.renderTab(this.currentTab);
      this.toast("已清空");
    }
  },

  // 删除某一注(5 注模式)
  removePick(idx) {
    if (!this.state.picks) return;
    this.state.picks.splice(idx, 1);
    this.renderTab(this.currentTab);
    this.toast(`已删除第 ${idx + 1} 注`);
  },

  // 注数计算
  calculateCost() {
    const nf = this.state.selection.front.length;
    const nb = this.state.selection.back.length;
    if (nf < 5 || nb < 2) return { count: 0, money: 0 };
    const count = this.combinations(nf, 5) * this.combinations(nb, 2);
    return { count, money: count * 2 };
  },

  combinations(n, k) {
    if (k < 0 || k > n) return 0;
    if (k === 0 || k === n) return 1;
    k = Math.min(k, n - k);
    let result = 1;
    for (let i = 0; i < k; i++) {
      result = result * (n - i) / (i + 1);
    }
    return Math.round(result);
  },

  // ============== 智能选号 v2 (杀号过滤 + 5 大约束) ==============
  // 候选池 → 冷热加权 → 满足 [和值/跨度/区间比/奇偶比] 约束的组合
  smartPick(reshuffle = false) {
    const frontKilled = this.getAllKilled("front");
    const backKilled = this.getAllKilled("back");
    const frontCandidates = [];
    for (let n = 1; n <= 35; n++) if (!frontKilled.has(n)) frontCandidates.push(n);
    const backCandidates = [];
    for (let n = 1; n <= 12; n++) if (!backKilled.has(n)) backCandidates.push(n);

    if (frontCandidates.length < 5) {
      this.toast("候选池红球不足 5 个,无法生成");
      return;
    }
    if (backCandidates.length < 2) {
      this.toast("候选池蓝球不足 2 个,无法生成");
      return;
    }

    // 选 1 注(满足 5 大约束)
    const result = this.smartPickWithConstraints(frontCandidates, backCandidates);
    if (!result) {
      this.toast("候选池太小,无法生成符合约束的组合");
      return;
    }
    this.state.selection = { front: result.front, back: result.back };
    this.renderTab(this.currentTab);
    const sum = result.front.reduce((a, b) => a + b, 0);
    const span = result.front[4] - result.front[0];
    const z = [result.front.filter(n => n <= 12).length, result.front.filter(n => n >= 13 && n <= 24).length, result.front.filter(n => n >= 25).length];
    const oe = [result.front.filter(n => n % 2 === 0).length, result.front.filter(n => n % 2 === 1).length];
    const candidateNote = frontCandidates.length <= 10 ? `⚠ 候选池仅 ${frontCandidates.length} 个,考虑减少杀号` : `候选 ${frontCandidates.length}/35`;
    this.toast(`智选: ${result.front.join(',')} + ${result.back.join(',')} | 和${sum} 跨${span} 区${z.join(':')} 奇偶${oe.join(':')} · ${candidateNote}`);
  },

  // 批量生成 5 注独立单注(不重复)
  smartPickFive() {
    const frontKilled = this.getAllKilled("front");
    const backKilled = this.getAllKilled("back");
    const frontCandidates = [];
    for (let n = 1; n <= 35; n++) if (!frontKilled.has(n)) frontCandidates.push(n);
    const backCandidates = [];
    for (let n = 1; n <= 12; n++) if (!backKilled.has(n)) backCandidates.push(n);

    if (frontCandidates.length < 5) { this.toast("候选池红球不足 5 个"); return; }
    if (backCandidates.length < 2) { this.toast("候选池蓝球不足 2 个"); return; }

    // 收集 5 注: 不重复 + 多样性(每注至少 2 个号不同)
    const picks = [];  // [{ front, back, score }, ...]
    let attempts = 0;
    const maxAttempts = 500;
    while (picks.length < 5 && attempts < maxAttempts) {
      attempts++;
      const result = this.smartPickWithConstraints(frontCandidates, backCandidates);
      if (!result) continue;
      // 1. 去重
      const key = result.front.join(',');
      if (picks.some(p => p.front.join(',') === key)) continue;
      // 2. 多样性:与已选每注至少 2 个号不同
      if (picks.length > 0) {
        const allDiverse = picks.every(p => {
          const diff = p.front.filter(n => !result.front.includes(n)).length;
          return diff >= 2;  // 至少 2 个号不同
        });
        if (!allDiverse) continue;
      }
      picks.push({ front: result.front, back: result.back, score: result.score });
    }

    // 如果多样性卡死(候选池太小),强制按 score 取
    if (picks.length === 0) {
      // 收集所有候选
      const allCands = [];
      for (let i = 0; i < 200; i++) {
        const r = this.smartPickWithConstraints(frontCandidates, backCandidates);
        if (r) allCands.push(r);
      }
      allCands.sort((a, b) => b.score - a.score);
      allCands.forEach(r => {
        const key = r.front.join(',');
        if (!picks.some(p => p.front.join(',') === key)) {
          picks.push({ front: r.front, back: r.back, score: r.score });
        }
      });
    }

    if (picks.length === 0) {
      this.toast("候选池太小,无法生成不重复组合");
      return;
    }

    // 存为 5 个独立单注
    this.state.picks = picks;
    this.state.selection = picks[0];  // 显示第 1 注
    this.renderTab(this.currentTab);
    this.toast(`🎲 已生成 ${picks.length} 注独立单注 · ${picks.length} 注 ¥${picks.length * 2}`);
  },

  // 自动补齐选号: 如果后区 < 2 或前区 < 5,自动从候选池补齐
  autoFillSelection() {
    const frontKilled = this.getAllKilled("front");
    const backKilled = this.getAllKilled("back");
    const frontCandidates = [];
    for (let n = 1; n <= 35; n++) if (!frontKilled.has(n) && !this.state.selection.front.includes(n)) frontCandidates.push(n);
    const backCandidates = [];
    for (let n = 1; n <= 12; n++) if (!backKilled.has(n) && !this.state.selection.back.includes(n)) backCandidates.push(n);

    // 后区补到 2 个
    if (this.state.selection.back.length < 2 && backCandidates.length > 0) {
      const need = 2 - this.state.selection.back.length;
      const shuffled = [...backCandidates].sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(need, shuffled.length); i++) {
        this.state.selection.back.push(shuffled[i]);
      }
      this.state.selection.back.sort((a, b) => a - b);
      this.toast(`已自动补齐后区到 2 个`);
    }
    // 前区补到 5 个
    if (this.state.selection.front.length < 5 && frontCandidates.length > 0) {
      const need = 5 - this.state.selection.front.length;
      const shuffled = [...frontCandidates].sort(() => Math.random() - 0.5);
      for (let i = 0; i < Math.min(need, shuffled.length); i++) {
        this.state.selection.front.push(shuffled[i]);
      }
      this.state.selection.front.sort((a, b) => a - b);
      this.toast(`已自动补齐前区到 5 个`);
    }
  },

  // 带 5 大约束的智能选号核心逻辑 (基于频率分布,不是平均值)
  smartPickWithConstraints(frontCandidates, backCandidates) {
    const data = window.DLT_DATA;
    const last30 = data.slice(-100);  // 用 100 期数据算和值/跨度/区配比/奇偶比频率
    const last10 = data.slice(-30);  // 短窗口(30 期)反映近期趋势,长期用 100 期

    // 智选严格在候选池内选(杀号的意义就是过滤)
    // 候选池小 → 结果单调是正常现象(说明杀号激进)
    // 提示用户:如果想更多样化,应该减少杀号或用更宽阈值
    // 算和值/跨度的频率分布(取前 5 高频值作为"高概率"目标)
    const sumFreq = {};
    const spanFreq = {};
    last30.forEach(d => {
      const sum = d.front.reduce((a, b) => a + b, 0);
      const sorted = [...d.front].sort((a, b) => a - b);
      const span = sorted[4] - sorted[0];
      // 按 5 分桶(和值 60-130 → 14 桶)
      const sumBucket = Math.round(sum / 5) * 5;
      sumFreq[sumBucket] = (sumFreq[sumBucket] || 0) + 1;
      spanFreq[span] = (spanFreq[span] || 0) + 1;
    });
    // 高频和值桶(按频率排序,取前 3 候选)
    const topSumBuckets = Object.entries(sumFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => parseInt(e[0]));
    // 高频跨度(取前 5)
    const topSpans = Object.entries(spanFreq).sort((a, b) => b[1] - a[1]).slice(0, 5).map(e => parseInt(e[0]));

    // 区间比 + 奇偶比:30 期实际频率(用作分布采样)
    const zoneFreq = {};
    const oeFreq = {};
    last30.forEach(d => {
      const z = `${d.front.filter(n => n <= 12).length}-${d.front.filter(n => n >= 13 && n <= 24).length}-${d.front.filter(n => n >= 25).length}`;
      const oe = `${d.front.filter(n => n % 2 === 0).length}-${d.front.filter(n => n % 2 === 1).length}`;
      zoneFreq[z] = (zoneFreq[z] || 0) + 1;
      oeFreq[oe] = (oeFreq[oe] || 0) + 1;
    });
    // 把频率归一化(总概率 = 1)
    const zoneTotal = Object.values(zoneFreq).reduce((a, b) => a + b, 0);
    const oeTotal = Object.values(oeFreq).reduce((a, b) => a + b, 0);
    const zoneProbs = {};  // { "1-3-1": 0.167, ... }
    Object.entries(zoneFreq).forEach(([k, v]) => zoneProbs[k] = v / zoneTotal);
    const oeProbs = {};
    Object.entries(oeFreq).forEach(([k, v]) => oeProbs[k] = v / oeTotal);

    // 加权"近期趋势":最近 5 期的和值/跨度桶权重 ×2
    const recentBoost = {};
    last10.slice(-10).forEach(d => {  // 近 10 期加权
      const sum = d.front.reduce((a, b) => a + b, 0);
      const sorted = [...d.front].sort((a, b) => a - b);
      const sumBucket = Math.round(sum / 5) * 5;
      recentBoost[sumBucket] = (recentBoost[sumBucket] || 0) + 2;
    });

    // 冷热加权(100 期,近期权重更高)+ 自适应调整
    this.loadLearnData();
    const baseWeights = this.computeHotColdWeights(frontCandidates, 100);
    const weights = this.getAdjustedWeights(frontCandidates, baseWeights);

    // 收集 800 次候选,按 score 比例 softmax 采样(保留多样性)
    // 统计连号/同尾号历史频率
    let consecRate = 0, tailRate = 0;
    for (const d of last30) {
      const s = [...d.front].sort((a, b) => a - b);
      let hasConsec = false;
      for (let i = 0; i < s.length - 1; i++) if (s[i+1] - s[i] === 1) hasConsec = true;
      if (hasConsec) consecRate++;
      // 同尾号(2 个同尾)
      const tails = {};
      d.front.forEach(n => { tails[n % 10] = (tails[n % 10] || 0) + 1; });
      if (Object.values(tails).some(c => c >= 2)) tailRate++;
    }
    const consecP = consecRate / last30.length;  // ~0.7
    const tailP = tailRate / last30.length;    // ~0.3

    const candidates = [];  // { front, score }
    for (let attempt = 0; attempt < 800; attempt++) {
      const front = this.weightedSampleNoRepeat(frontCandidates, 5, weights);
      const sum = front.reduce((a, b) => a + b, 0);
      const sorted = [...front].sort((a, b) => a - b);
      const span = sorted[4] - sorted[0];
      const z = [sorted.filter(n => n <= 12).length, sorted.filter(n => n >= 13 && n <= 24).length, sorted.filter(n => n >= 25).length];
      const oe = [sorted.filter(n => n % 2 === 0).length, sorted.filter(n => n % 2 === 1).length];
      const zKey = z.join('-');
      const oeKey = oe.join('-');

      // 多维评分
      let score = 0;
      const sumBucket = Math.round(sum / 5) * 5;
      const sumRank = topSumBuckets.indexOf(sumBucket);
      if (sumRank >= 0) score += (5 - sumRank) * 6;
      score += (recentBoost[sumBucket] || 0) * 2;
      const spanRank = topSpans.indexOf(span);
      if (spanRank >= 0) score += (5 - spanRank) * 3;
      if (span >= 18 && span <= 29) score += 6;
      if (span >= 28) score += 5;
      if (front.includes(1) || front.includes(35)) score += 4;
      // 区间比/奇偶比:按 100 期实际频率给分(关键:用真实概率而不是偏好)
      score += (zoneProbs[zKey] || 0) * 100;
      score += (oeProbs[oeKey] || 0) * 100;
      const hotPicked = front.filter(n => weights[n] > 1.5).length;
      score += hotPicked * 3;
      if (span < 10) score -= 10;
      // 新增:连号密度(70% 期有) + 同尾号(30% 期有)
      let hasConsec = false;
      for (let i = 0; i < sorted.length - 1; i++) if (sorted[i+1] - sorted[i] === 1) hasConsec = true;
      if (hasConsec) score += consecP * 8;  // 加权
      const ft = {};
      front.forEach(n => { ft[n % 10] = (ft[n % 10] || 0) + 1; });
      if (Object.values(ft).some(c => c >= 2)) score += tailP * 5;

      candidates.push({ front, score });
    }

    // Softmax 采样(temperature 控制多样性: 大→均匀,小→贪心)
    const temperature = 8;  // 中等多样性
    const maxScore = Math.max(...candidates.map(c => c.score));
    const probs = candidates.map(c => Math.exp((c.score - maxScore) / temperature));
    const totalProb = probs.reduce((a, b) => a + b, 0);
    const normProbs = probs.map(p => p / totalProb);
    const r = Math.random();
    let cum = 0;
    let bestPick = candidates[candidates.length - 1].front;
    for (let i = 0; i < candidates.length; i++) {
      cum += normProbs[i];
      if (r <= cum) { bestPick = candidates[i].front; break; }
    }
    if (!bestPick) return null;

    // 后区(用 100 期冷热加权)
    const backWeights = this.computeHotColdWeights(backCandidates, 100);
    const back = this.weightedSampleNoRepeat(backCandidates, 2, backWeights);
    back.sort((a, b) => a - b);

    return {
      front: bestPick.sort((a, b) => a - b),
      back,
      score: Math.round(candidates.find(c => c.front === bestPick).score)
    };
  },

  // 冷热号加权(指定期数)
  computeHotColdWeights(candidates, lookback = 30) {
    const data = window.DLT_DATA;
    const recent = data.slice(-lookback);
    const weights = new Map();
    candidates.forEach(n => weights.set(n, 0.1));

    recent.forEach((d, i) => {
      const w = (i + 1) / recent.length;  // 越近权重越高
      d.front.forEach(n => {
        if (weights.has(n)) weights.set(n, weights.get(n) + w);
      });
    });
    return weights;
  },

  // 加权抽样(不重复)
  weightedSampleNoRepeat(candidates, k, weightsMap) {
    const result = new Set();
    let attempts = 0;
    while (result.size < k && attempts < 200) {
      attempts++;
      const total = [...weightsMap.values()].reduce((a, b) => a + b, 0);
      const r = Math.random() * total;
      let acc = 0;
      for (const n of candidates) {
        if (result.has(n)) continue;
        acc += weightsMap.get(n);
        if (r <= acc) { result.add(n); break; }
      }
    }
    // 兜底:如果不够,补齐
    for (const n of candidates) {
      if (result.size >= k) break;
      if (!result.has(n)) result.add(n);
    }
    return [...result];
  },

  // 复式智能选号
  smartPickCompound() {
    const frontKilled = this.getAllKilled("front");
    const backKilled = this.getAllKilled("back");
    const frontCandidates = [];
    for (let n = 1; n <= 35; n++) if (!frontKilled.has(n)) frontCandidates.push(n);
    const backCandidates = [];
    for (let n = 1; n <= 12; n++) if (!backKilled.has(n)) backCandidates.push(n);

    if (frontCandidates.length < 6) {
      this.toast("候选池红球不足 6 个");
      return;
    }
    if (backCandidates.length < 3) {
      this.toast("候选池蓝球不足 3 个");
      return;
    }

    // 选 8-12 红, 3-5 蓝
    const nf = 8 + Math.floor(Math.random() * 5);  // 8-12
    const nb = 3 + Math.floor(Math.random() * 3);  // 3-5
    const frontWeights = this.computeHotColdWeights(frontCandidates, 100);
    const backWeights = this.computeHotColdWeights(backCandidates, 100);
    this.state.selection.front = this.weightedSampleNoRepeat(frontCandidates, nf, frontWeights);
    this.state.selection.back = this.weightedSampleNoRepeat(backCandidates, nb, backWeights);
    this.state.selection.front.sort((a, b) => a - b);
    this.state.selection.back.sort((a, b) => a - b);
    this.renderTab(this.currentTab);
    const { count, money } = this.calculateCost();
    this.toast(`复式 ${nf}红+${nb}蓝 · ${count} 注 ¥${money}`);
  },

  // 快捷复式:一键选 N+M 个号
  quickCompound(frontCount, backCount) {
    const frontKilled = this.getAllKilled("front");
    const backKilled = this.getAllKilled("back");
    const frontCandidates = [];
    for (let n = 1; n <= 35; n++) if (!frontKilled.has(n)) frontCandidates.push(n);
    const backCandidates = [];
    for (let n = 1; n <= 12; n++) if (!backKilled.has(n)) backCandidates.push(n);

    // 校验候选池
    if (frontCandidates.length < frontCount) {
      this.toast(`❌ 候选池红球只有 ${frontCandidates.length} 个,不够 ${frontCount} 个`);
      return;
    }
    if (backCandidates.length < backCount) {
      this.toast(`❌ 候选池蓝球只有 ${backCandidates.length} 个,不够 ${backCount} 个`);
      return;
    }
    if (frontCount < 5 || frontCount > 35) {
      this.toast(`❌ 红球数必须在 5-35 之间`);
      return;
    }
    if (backCount < 2 || backCount > 12) {
      this.toast(`❌ 蓝球数必须在 2-12 之间`);
      return;
    }

    // 用冷热加权选
    const frontWeights = this.computeHotColdWeights(frontCandidates, 100);
    const backWeights = this.computeHotColdWeights(backCandidates, 100);
    this.state.selection.front = this.weightedSampleNoRepeat(frontCandidates, frontCount, frontWeights);
    this.state.selection.back = this.weightedSampleNoRepeat(backCandidates, backCount, backWeights);
    this.state.selection.front.sort((a, b) => a - b);
    this.state.selection.back.sort((a, b) => a - b);

    // 清空 picks(因为是复式模式,不是多注模式)
    this.state.picks = [];

    this.renderTab(this.currentTab);
    const { count, money } = this.calculateCost();
    const C = (n, k) => {
      if (k < 0 || k > n) return 0;
      let r = 1;
      for (let i = 0; i < k; i++) r = r * (n - i) / (i + 1);
      return Math.round(r);
    };
    const totalNotes = C(frontCount, 5) * C(backCount, 2);
    this.toast(`✓ ${frontCount}+${backCount} 复式 = ${totalNotes} 注 ¥${money}`);
  },

  singlePick() {
    this.smartPick();
  },

  // 加权抽样(冷热号)
  weightedSample(candidates, k, lookback = 10) {
    const data = window.DLT_DATA;
    const recent = data.slice(-lookback);
    const weights = new Map();
    candidates.forEach(n => weights.set(n, 0.1));

    recent.forEach((d, i) => {
      const w = (i + 1) / recent.length;
      d.front.forEach(n => {
        if (weights.has(n)) weights.set(n, weights.get(n) + w);
      });
      d.back.forEach(n => {
        if (weights.has(n)) weights.set(n, weights.get(n) + w);
      });
    });

    // 加权抽样
    const nums = [...weights.keys()];
    const ws = nums.map(n => weights.get(n));
    const total = ws.reduce((a, b) => a + b, 0);
    const probs = ws.map(w => w / total);

    const result = new Set();
    const maxAttempts = k * 20;
    let attempts = 0;
    while (result.size < k && attempts < maxAttempts) {
      const r = Math.random();
      let acc = 0;
      for (let i = 0; i < nums.length; i++) {
        acc += probs[i];
        if (r <= acc) {
          if (!result.has(nums[i])) result.add(nums[i]);
          break;
        }
      }
      attempts++;
    }
    // 兜底
    while (result.size < k) {
      const rest = candidates.filter(n => !result.has(n));
      if (rest.length === 0) break;
      result.add(rest[Math.floor(Math.random() * rest.length)]);
    }
    return [...result].sort((a, b) => a - b);
  },

  // ============== 收藏 ==============
  loadFavorites() {
    try {
      const data = localStorage.getItem("dlt_favorites");
      this.state.favorites = data ? JSON.parse(data) : [];
    } catch (e) {
      this.state.favorites = [];
    }
  },

  saveFavorites() {
    localStorage.setItem("dlt_favorites", JSON.stringify(this.state.favorites));
  },

  saveFavorite() {
    const picks = this.state.picks || [];
    if (picks.length > 0) {
      // 多注模式: 收藏 5 注
      const name = prompt(`给这 ${picks.length} 注起个名字:`, `选号组 ${this.state.favorites.length + 1}`);
      this.state.favorites.push({
        name: name || `选号组 ${this.state.favorites.length + 1}`,
        picks: JSON.parse(JSON.stringify(picks)),
        period: window.DLT_DATA[window.DLT_DATA.length - 1]?.period || '',
        createdAt: Date.now()
      });
      this.saveFavorites();
      this.renderTab(this.currentTab);
      this.toast(`已收藏 ${picks.length} 注 ⭐`);
      return;
    }
    // 单注/复式模式
    const { front, back } = this.state.selection;
    if (front.length < 5 || back.length < 2) {
      this.toast("选号不完整,无法收藏(至少 5 红 + 2 蓝)");
      return;
    }
    const name = prompt("给这注起个名字:", `选号 ${this.state.favorites.length + 1}`);
    this.state.favorites.push({
      name: name || `选号 ${this.state.favorites.length + 1}`,
      front: [...front],
      back: [...back],
      period: window.DLT_DATA[window.DLT_DATA.length - 1]?.period || '',
      createdAt: Date.now()
    });
    this.saveFavorites();
    this.renderTab(this.currentTab);
    this.toast("已收藏 ⭐");
  },

  loadFavorite(idx) {
    const fav = this.state.favorites[idx];
    if (!fav) return;
    if (fav.picks) {
      // 多注收藏
      this.state.picks = JSON.parse(JSON.stringify(fav.picks));
      this.state.selection = fav.picks[0];
    } else {
      this.state.picks = [];
      this.state.selection = { front: [...fav.front], back: [...fav.back] };
    }
    this.renderTab(this.currentTab);
    this.toast(`已载入: ${fav.name}`);
  },

  copyFavorite(idx) {
    const fav = this.state.favorites[idx];
    if (!fav) return;
    let text;
    if (fav.picks) {
      text = fav.picks.map((p, i) => `第${i+1}注: ${p.front.join(' ')} + ${p.back.join(' ')}`).join('\n');
    } else {
      text = `前区 ${fav.front.join(' ')} + 后区 ${fav.back.join(' ')}`;
    }
    this.copyText(text);
  },

  deleteFavorite(idx) {
    if (!confirm("确认删除此收藏?")) return;
    this.state.favorites.splice(idx, 1);
    this.saveFavorites();
    this.renderTab(this.currentTab);
    this.toast("已删除");
  },

  clearFavorites() {
    if (this.state.favorites.length === 0) {
      this.toast("收藏为空");
      return;
    }
    if (!confirm(`确认删除全部 ${this.state.favorites.length} 个收藏?`)) return;
    this.state.favorites = [];
    this.saveFavorites();
    this.renderTab(this.currentTab);
    this.toast("已清空");
  },

  copyAllFavorites() {
    if (this.state.favorites.length === 0) {
      this.toast("收藏为空");
      return;
    }
    const text = this.state.favorites.map((f, i) => {
      const picks = f.picks || [{ front: f.front, back: f.back }];
      return picks.map((p, j) => {
        const label = picks.length > 1 ? `  第${j+1}注: ` : '';
        return `#${i+1} ${f.name}${label ? '\n' + label : ''}前区 ${p.front.join(' ')} + 后区 ${p.back.join(' ')}`;
      }).join('\n');
    }).join('\n\n');
    this.copyText(text, "全部收藏");
  },

  // 复制单注(单注复制按钮)
  copyFavorite(idx) {
    const f = this.state.favorites[idx];
    if (!f) return;
    const picks = f.picks || [{ front: f.front, back: f.back }];
    const fmt = arr => arr.map(n => String(n).padStart(2, '0')).join(' ');
    const lines = [];
    lines.push(`【${f.name}】 期号:${f.period || '当前'} ${f.createdAt ? this.formatTimeShort(f.createdAt) : ''}`.trim());
    picks.forEach((p, j) => {
      const front = fmt(p.front);
      const back = fmt(p.back);
      lines.push(picks.length > 1
        ? `第${j+1}注: 前区 ${front} | 后区 ${back}`
        : `前区 ${front} | 后区 ${back}`);
    });
    const total = picks.reduce((s, p) => s + 1, 0);
    lines.push(`合计 ${total} 注  ¥${total * 2}`);
    const text = lines.join('\n');
    this.copyText(text, f.name);
  },

  formatTimeShort(ts) {
    const d = new Date(ts);
    const M = String(d.getMonth() + 1).padStart(2, '0');
    const D = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return `${M}-${D} ${h}:${m}`;
  },

  // 通用复制:先试 clipboard API,失败/被拒则弹窗显示
  copyText(text, title = "复制") {
    // 尝试 navigator.clipboard
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(
        () => this.toast(`✓ ${title}已复制到剪贴板`),
        () => this.showCopyDialog(text, title)
      );
    } else {
      // 老浏览器或非安全上下文:用 textarea + execCommand
      this.fallbackCopy(text, title);
    }
  },

  fallbackCopy(text, title = "复制") {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
      if (ok) this.toast(`✓ ${title}已复制到剪贴板`);
      else this.showCopyDialog(text, title);
    } catch (e) {
      this.showCopyDialog(text, title);
    }
    document.body.removeChild(ta);
  },

  // 弹窗显示文本让用户手动复制(终极 fallback)
  showCopyDialog(text, title) {
    const html = `
      <div class="modal" onclick="if(event.target===this)APP.closeModal()">
        <div class="modal-content" style="max-width:520px">
          <div class="modal-title">📋 ${title}</div>
          <p class="text-sm text-muted" style="margin-bottom:10px">
            浏览器阻止了自动复制。请手动复制 ↓
          </p>
          <textarea readonly id="copy-dialog-text" style="width:100%;min-height:180px;padding:10px;background:var(--bg-3);color:var(--ink);border:1px solid var(--line);border-radius:6px;font-family:monospace;font-size:13px;line-height:1.6;resize:vertical">${text.replace(/</g, '&lt;')}</textarea>
          <div style="display:flex;gap:10px;margin-top:14px">
            <button class="btn btn-primary" style="flex:1" onclick="APP.selectAllCopyText()">全选并复制</button>
            <button class="btn" style="flex:1" onclick="APP.closeModal()">关闭</button>
          </div>
        </div>
      </div>
    `;
    const div = document.createElement("div");
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
    // 自动全选,方便用户复制
    setTimeout(() => {
      const ta = document.getElementById("copy-dialog-text");
      if (ta) { ta.focus(); ta.select(); }
    }, 100);
  },

  selectAllCopyText() {
    const ta = document.getElementById("copy-dialog-text");
    if (!ta) return;
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
      if (ok) {
        this.toast("✓ 已复制到剪贴板");
        this.closeModal();
      } else {
        this.toast("请按 Ctrl+C / Cmd+C 复制", "info");
      }
    } catch (e) {
      this.toast("请按 Ctrl+C / Cmd+C 复制", "info");
    }
  },

  // ============== 杀号分析 Tab(原杀红/杀蓝) ==============
  renderAnalysisTab() {
    const data = window.DLT_DATA;
    // 用最新一期(就是触发公式的那一期)
    const prev = data[data.length - 1];
    const frontResults = window.runBacktest("front");
    const backResults = window.runBacktest("back");

    // 📐 当前期公式触发详情(默认展开,因为这是分析 tab)
    const formulaDetailHtml = `
      <div class="formula-detail-card" style="margin-bottom:14px;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <div style="font-weight:600;font-size:14px">📐 当前期公式触发 <span style="font-size:11px;color:var(--ink-3);font-weight:400">(基于 ${prev.period} 期, ${prev.date})</span></div>
          <div style="font-size:11px;color:var(--ink-3)">${(this.state.frontFormulaDetails || []).filter(d => d.triggered).length} 红 + ${(this.state.backFormulaDetails || []).filter(d => d.triggered).length} 蓝 触发</div>
        </div>
        ${this.renderFormulaDetails()}
        <div style="margin-top:12px;padding-top:10px;border-top:1px dashed var(--line);font-size:11px;color:var(--ink-3)">
          💡 每个公式基于 ${window.DLT_DATA.length} 期回测(累计更新),准确率 = 杀对数 / 总杀数
        </div>
      </div>
    `;

    // 🧠 自学统计
    this.loadLearnData();
    const ld = this.learnData;
    const adj = ld.adjustments || {};
    const adjEntries = Object.entries(adj).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 6);
    const adjHtml = adjEntries.length === 0
      ? '<div class="text-xs text-muted" style="padding:6px">录入新期后,系统会自动调整</div>'
      : adjEntries.map(([n, v]) => {
          const color = v > 0 ? 'var(--green)' : 'var(--red)';
          const sign = v > 0 ? '↑' : '↓';
          return `<div class="tune-item"><span class="tune-num">${String(n).padStart(2,'0')}</span><span class="tune-arrow" style="color:${color}">${sign}</span><span class="tune-val" style="color:${color}">${v > 0 ? '+' : ''}${v.toFixed(2)}</span></div>`;
        }).join('');
    const learnCard = `
      <div class="learn-card">
        <div class="learn-header">
          <div class="learn-title" style="display:flex;justify-content:space-between;align-items:center;width:100%">
            <span>🧠 自学统计 + 🧬 自适应调整</span>
            <button class="btn-mini" onclick="APP.manualLearn()" style="background:rgba(108,92,231,0.18);color:var(--primary);border:1px solid var(--primary);padding:3px 10px;font-size:11px;cursor:pointer;border-radius:6px">
              🔄 重新学习
            </button>
          </div>
          <div class="learn-progress">
            <div class="learn-progress-bar" style="width:${ld.learnProgress || 0}%"></div>
            <span class="learn-progress-text">${ld.learnProgress || 0}% 完整度</span>
          </div>
        </div>
        <div class="learn-stats">
          <div class="learn-stat">
            <div class="num">${ld.totalEvaluated || 0}</div>
            <div class="lbl">评估期数</div>
          </div>
          <div class="learn-stat">
            <div class="num" style="color:var(--green)">${ld.avgHit || 0}</div>
            <div class="lbl">平均命中数 (7 球)</div>
          </div>
          <div class="learn-stat">
            <div class="num" style="color:var(--primary)">${ld.bestHit || 0}</div>
            <div class="lbl">历史最佳</div>
          </div>
          <div class="learn-stat">
            <div class="num">${ld.hit3plus || 0}</div>
            <div class="lbl">≥ 3 球</div>
          </div>
        </div>
        <div class="text-xs" style="margin-top:10px;padding-top:8px;border-top:1px dashed var(--line);font-weight:600;color:var(--ink-2)">🧬 智选权重调整(↑ 加权 / ↓ 降权):</div>
        <div class="tune-grid">${adjHtml}</div>
        <div class="text-xs text-muted" style="margin-top:8px">
          💡 每次录入新期,系统自动分析过去 50 期"漏出/错出",动态调整每个号的权重。<br>
          智能选号时自动叠加这些调整 → 智选算法随数据持续进化。
        </div>
      </div>
    `;

    // 计算统计
    const sum = prev.front.reduce((a, b) => a + b, 0);
    const span = Math.max(...prev.front) - Math.min(...prev.front);
    const zone = [
      prev.front.filter(n => n <= 12).length,
      prev.front.filter(n => n >= 13 && n <= 24).length,
      prev.front.filter(n => n >= 25).length
    ];
    const oe = [
      prev.front.filter(n => n % 2 === 0).length,
      prev.front.filter(n => n % 2 === 1).length
    ];

    // 杀号汇总池(本期所有公式触发的杀号)
    const frontKilledAll = this.getAllKilled("front");
    const backKilledAll = this.getAllKilled("back");
    const frontFormulaKilled = [...this.state.formulaKilledFront.keys()].sort((a, b) => a - b);
    const backFormulaKilled = [...this.state.formulaKilledBack.keys()].sort((a, b) => a - b);
    const frontKilledList = [...frontKilledAll].sort((a, b) => a - b);
    const backKilledList = [...backKilledAll].sort((a, b) => a - b);

    let html = `
      ${formulaDetailHtml}
      ${learnCard}
      <div class="disclaimer">
        <h4>📊 杀号公式回测分析</h4>
        <p>本系统基于历史 ${data.length} 期开奖数据,对 13 个杀号公式做回测。
        所有"杀号准确率"均为<strong>过滤型准确率</strong>(杀掉不出现的号),不是预测准确率。
        实际中奖概率仍为每注 1/2142 万,杀号只能减少组合数,无法提高中奖率。</p>
      </div>

      <div class="current-draw-card">
        <div class="current-draw-header">
          <div class="current-draw-title">
            <span>📋 上期开奖</span>
            <span class="live-dot"></span>
            <span class="text-xs text-muted">第 ${prev.period} 期</span>
          </div>
          <div class="current-draw-meta">
            <span>📅 ${prev.date}</span>
          </div>
        </div>

        <div class="current-draw-balls">
          ${prev.front.map(n => `<div class="current-draw-ball">${String(n).padStart(2,'0')}</div>`).join('')}
          <span class="text-muted" style="font-size:18px;margin:0 6px;font-weight:300">+</span>
          ${prev.back.map(n => `<div class="current-draw-ball blue">${String(n).padStart(2,'0')}</div>`).join('')}
        </div>

        <div class="current-draw-stats">
          <span class="stat-pill"><span class="lbl">和值</span><span class="val">${sum}</span></span>
          <span class="stat-pill"><span class="lbl">跨度</span><span class="val">${span}</span></span>
          <span class="stat-pill"><span class="lbl">区间</span><span class="val">${zone.join(':')}</span></span>
          <span class="stat-pill"><span class="lbl">奇偶</span><span class="val">${oe.join(':')}</span></span>
        </div>
      </div>

      <!-- 杀号汇总池(新加) -->
      <div class="kill-summary-card">
        <div class="kill-summary-header">
          <div class="kill-summary-title">
            <span style="color:var(--red)">🔴</span>
            <span>红球杀号汇总池</span>
            <span class="text-xs text-muted">(本期所有公式触发的杀号 · 点击可恢复)</span>
          </div>
        </div>
        <div class="kill-summary-stats">
          <div class="kill-stat">
            <span class="num" style="color:var(--red)">${frontFormulaKilled.length}</span>
            <span class="lbl">公式杀</span>
          </div>
          <div class="kill-stat">
            <span class="num">${this.state.frontKilled.size}</span>
            <span class="lbl">手动杀</span>
          </div>
          <div class="kill-stat">
            <span class="num" style="color:var(--green)">${this.state.userOverrideFront.size}</span>
            <span class="lbl">已恢复</span>
          </div>
          <div class="kill-stat highlight">
            <span class="num" style="color:var(--primary)">${frontKilledList.length}</span>
            <span class="lbl">总杀号</span>
          </div>
        </div>
        <div class="kill-summary-pools">
          <div class="summary-pool">
            <div class="pool-label">📐 公式杀掉 (${frontFormulaKilled.length})</div>
            <div class="pool-balls">
              ${frontFormulaKilled.length > 0
                ? frontFormulaKilled.map(n => {
                    const inOverride = this.state.userOverrideFront.has(n);
                    const inManual = this.state.frontKilled.has(n);
                    return `<span class="summary-ball ${inOverride ? 'rescued' : ''} ${inManual ? 'manual-added' : ''}" onclick="APP.toggleKill('front', ${n})" title="${n}号${inOverride ? '(已恢复)' : ''}${inManual ? '(已加入手动)' : '(点击恢复)'}">${String(n).padStart(2,'0')}</span>`;
                  }).join('')
                : '<span class="text-xs text-muted">无</span>'}
            </div>
          </div>
        </div>
      </div>

      <div class="kill-summary-card">
        <div class="kill-summary-header">
          <div class="kill-summary-title">
            <span style="color:var(--blue)">🔵</span>
            <span>蓝球杀号汇总池</span>
            <span class="text-xs text-muted">(本期所有公式触发的杀号 · 点击可恢复)</span>
          </div>
        </div>
        <div class="kill-summary-stats">
          <div class="kill-stat">
            <span class="num" style="color:var(--blue)">${backFormulaKilled.length}</span>
            <span class="lbl">公式杀</span>
          </div>
          <div class="kill-stat">
            <span class="num">${this.state.backKilled.size}</span>
            <span class="lbl">手动杀</span>
          </div>
          <div class="kill-stat">
            <span class="num" style="color:var(--green)">${this.state.userOverrideBack.size}</span>
            <span class="lbl">已恢复</span>
          </div>
          <div class="kill-stat highlight">
            <span class="num" style="color:var(--primary)">${backKilledList.length}</span>
            <span class="lbl">总杀号</span>
          </div>
        </div>
        <div class="kill-summary-pools">
          <div class="summary-pool">
            <div class="pool-label">📐 公式杀掉 (${backFormulaKilled.length})</div>
            <div class="pool-balls">
              ${backFormulaKilled.length > 0
                ? backFormulaKilled.map(n => {
                    const inOverride = this.state.userOverrideBack.has(n);
                    const inManual = this.state.backKilled.has(n);
                    return `<span class="summary-ball blue ${inOverride ? 'rescued' : ''} ${inManual ? 'manual-added' : ''}" onclick="APP.toggleKill('back', ${n})" title="${n}号${inOverride ? '(已恢复)' : ''}${inManual ? '(已加入手动)' : '(点击恢复)'}">${String(n).padStart(2,'0')}</span>`;
                  }).join('')
                : '<span class="text-xs text-muted">无</span>'}
            </div>
          </div>
        </div>
      </div>

      <div class="section-title mt-16 mb-12">🔴 杀红公式 (7 个)</div>
      ${Object.entries(frontResults).map(([key, r]) => this.renderFormulaCard(r, "front", key, prev)).join('')}
      <div class="section-title mt-16 mb-12">🔵 杀蓝公式 (6 个)</div>
      ${Object.entries(backResults).map(([key, r]) => this.renderFormulaCard(r, "back", key, prev)).join('')}
    `;
    return html;
  },

  renderFormulaCard(r, zone, key, prev) {
    const formula = window.DLT_FORMULAS[zone][key];
    const { killed, triggered } = formula.test(prev);
    return `
      <div class="formula-card">
        <div class="formula-header">
          <div class="formula-name">${r.name}</div>
          <div class="trigger-tag ${triggered ? 'on' : 'off'}">${triggered ? '已触发' : '未触发'}</div>
        </div>
        <div class="formula-desc">${r.desc}</div>
        <div class="formula-stats">
          <div class="stat-item blue">
            <div class="num">${r.triggerRate}%</div>
            <div class="lbl">触发率</div>
          </div>
          <div class="stat-item">
            <div class="num">${r.avgKilled}</div>
            <div class="lbl">平均杀号</div>
          </div>
          <div class="stat-item">
            <div class="num">${r.accuracy}%</div>
            <div class="lbl">杀号准确率</div>
          </div>
          <div class="stat-item warn">
            <div class="num">${r.missRate}%</div>
            <div class="lbl">误杀率</div>
          </div>
        </div>
        ${triggered && killed.length > 0 ? `
          <div class="formula-killed">
            <div class="text-xs font-bold mb-12">本期杀掉(${killed.length}个):</div>
            ${killed.map(n => `<span class="killed-num">${String(n).padStart(2,'0')}</span>`).join('')}
          </div>
        ` : ''}
      </div>
    `;
  },

  // ============== 历史数据 Tab ==============
  renderHistoryTab() {
    const data = window.DLT_DATA;
    let cards = '';
    // 倒序显示,最近 100 期(避免一次渲染太多卡顿)
    const showCount = Math.min(data.length, 100);
    for (let i = data.length - 1; i >= data.length - showCount; i--) {
      const d = data[i];
      const frontBalls = d.front.map(n => `<span class="hist-ball red">${String(n).padStart(2,'0')}</span>`).join('');
      const backBalls = d.back.map(n => `<span class="hist-ball blue">${String(n).padStart(2,'0')}</span>`).join('');

      // 计算 4 个统计指标
      const sum = d.front.reduce((a, b) => a + b, 0);
      const span = Math.max(...d.front) - Math.min(...d.front);
      const zone = [
        d.front.filter(n => n <= 12).length,
        d.front.filter(n => n >= 13 && n <= 24).length,
        d.front.filter(n => n >= 25).length
      ];
      const oe = [
        d.front.filter(n => n % 2 === 0).length,
        d.front.filter(n => n % 2 === 1).length
      ];

      cards += `
        <div class="hist-card">
          <div class="hist-card-header">
            <span class="hist-period">${d.period}</span>
            <span class="hist-date">${d.date}</span>
          </div>
          <div class="hist-balls-row">
            <div class="hist-balls-label">🔴 前</div>
            <div class="hist-balls">${frontBalls}</div>
          </div>
          <div class="hist-balls-row">
            <div class="hist-balls-label">🔵 后</div>
            <div class="hist-balls">${backBalls}</div>
          </div>
          <div class="hist-stats">
            <div class="hist-stat"><div class="lbl">和值</div><div class="val">${sum}</div></div>
            <div class="hist-stat"><div class="lbl">跨度</div><div class="val">${span}</div></div>
            <div class="hist-stat"><div class="lbl">区间</div><div class="val">${zone.join(':')}</div></div>
            <div class="hist-stat"><div class="lbl">奇偶</div><div class="val">${oe.join(':')}</div></div>
          </div>
        </div>
      `;
    }

    return `
      <div class="disclaimer">
        <h4>📚 历史数据</h4>
        <p>共 ${data.length} 期开奖数据。最近 ${showCount} 期卡片式展示,手机端友好。</p>
      </div>
      <div class="hist-toolbar">
        <button class="hist-tab active" id="hist-tab-card" onclick="APP.switchHistView('card', this)">📱 卡片</button>
        <button class="hist-tab hist-tab-table" id="hist-tab-table" onclick="APP.switchHistView('table', this)">📊 表格(桌面)</button>
      </div>
      <div id="hist-card-view" class="hist-list">${cards}</div>
      <div id="hist-table-view" class="hist-table-view" style="display:none">
        <div class="card">
          <div class="card-header">
            <div class="card-title">📊 完整数据(横向滚动)</div>
          </div>
          <div class="history-wrap">
            <table class="history-table">
              <thead>
                <tr><th>期号</th><th>日期</th><th>前区</th><th>后区</th><th>和值</th><th>跨度</th><th>区间</th><th>奇偶</th></tr>
              </thead>
              <tbody>${data.slice().reverse().map(d => {
                const frontBalls = d.front.map(n => `<span class="history-ball">${String(n).padStart(2,'0')}</span>`).join('');
                const backBalls = d.back.map(n => `<span class="history-ball blue">${String(n).padStart(2,'0')}</span>`).join('');
                const sum = d.front.reduce((a, b) => a + b, 0);
                const span = Math.max(...d.front) - Math.min(...d.front);
                const zone = [d.front.filter(n => n <= 12).length, d.front.filter(n => n >= 13 && n <= 24).length, d.front.filter(n => n >= 25).length];
                const oe = [d.front.filter(n => n % 2 === 0).length, d.front.filter(n => n % 2 === 1).length];
                return `<tr>
                  <td class="text-mono text-primary">${d.period}</td>
                  <td class="text-mono text-muted">${d.date}</td>
                  <td><div class="history-balls-row">${frontBalls}</div></td>
                  <td><div class="history-balls-row">${backBalls}</div></td>
                  <td>${sum}</td><td>${span}</td><td>${zone.join(':')}</td><td>${oe.join(':')}</td>
                </tr>`;
              }).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  },

  // 切换历史数据展示模式
  switchHistView(mode, btn) {
    document.querySelectorAll('.hist-tab').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
    document.getElementById('hist-card-view').style.display = mode === 'card' ? 'block' : 'none';
    document.getElementById('hist-table-view').style.display = mode === 'table' ? 'block' : 'none';
  },

  // ============== 分享 Tab ==============
  renderShareTab() {
    if (!this.isMainLink) {
      return `
        <div class="disclaimer">
          <h4>🔒 副链接无分享权限</h4>
          <p>您当前是副链接访问,无法生成分享链接。
          如需分享给其他设备,请使用主链接登录。</p>
        </div>
      `;
    }

    const tokens = window.DeviceTracker.listShareTokens();
    let tokensHtml = '';
    if (tokens.length === 0) {
      tokensHtml = `<div class="text-sm text-muted text-center" style="padding:20px">还没有创建过分享链接</div>`;
    } else {
      tokensHtml = tokens.map(t => {
        const url = `${window.location.origin}${window.location.pathname}?share=${t.token}`;
        const deviceCount = window.DeviceTracker.listDevices(t.token).length;
        return `
          <div class="card mb-12">
            <div class="flex between center">
              <div>
                <div class="font-bold">${t.name || "未命名分享"}</div>
                <div class="text-xs text-muted">创建于 ${new Date(t.createdAt).toLocaleString("zh-CN")} · 已用 <span style="color:${deviceCount >= 5 ? 'var(--red)' : 'var(--green)'}">${deviceCount} / 5</span> 设备</div>
              </div>
              <div class="flex gap-8">
                <button class="btn btn-ghost" onclick="APP.viewDevices('${t.token}')">📱 设备(${deviceCount})</button>
                <button class="btn btn-ghost" onclick="APP.copyShareLink('${url}')">复制链接</button>
                <button class="btn btn-warn" onclick="APP.deleteShare('${t.token}')">删除</button>
              </div>
            </div>
            <div class="share-link-box">
              <span class="url">${url}</span>
            </div>
          </div>
        `;
      }).join('');
    }

    return `
      <div class="disclaimer">
        <h4>🔗 分享链接说明</h4>
        <ul>
          <li>主链接可以生成分享链接,密码统一为 <strong>112233</strong></li>
          <li>每个分享链接最多支持 <strong>5 台设备</strong>(手机/电脑/平板各算一台)</li>
          <li>第 6 台设备访问时显示"5 台设备已满",不影响前 5 台使用</li>
          <li>设备识别基于浏览器指纹 + 本地 UUID</li>
          <li>严格场景建议部署云端校验(Netlify Function)</li>
        </ul>
      </div>

      <!-- 查询副链接 -->
      <div class="share-card" style="background:linear-gradient(135deg, rgba(52,152,219,0.05), transparent);border-color:rgba(52,152,219,0.3)">
        <div class="flex between center mb-12">
          <div>
            <div class="font-bold" style="color:var(--blue)">🔍 查询副链接</div>
            <div class="text-xs text-muted mt-8">输入完整 token 或链接,查询该副链接的设备使用情况</div>
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <input type="text" id="query-token-input" placeholder="例: vip-msk0o5com7qtnf3 或 https://...?share=vip-msk..." 
                 onkeydown="if(event.key==='Enter')APP.queryShareToken()"
                 style="flex:1;padding:9px 12px;background:var(--bg-2);border:1px solid var(--line);border-radius:6px;color:var(--ink);font-size:13px;font-family:'JetBrains Mono',monospace">
          <button class="btn btn-primary" onclick="APP.queryShareToken()" style="white-space:nowrap;padding:9px 18px">🔍 查询</button>
        </div>
        <div id="query-result" style="margin-top:12px"></div>
      </div>

      <div class="share-card">
        <div class="flex between center">
          <div>
            <div class="font-bold">创建新分享链接</div>
            <div class="text-xs text-muted mt-8">密码 112233,5 设备限制</div>
          </div>
          <button class="btn btn-primary" onclick="APP.createShare()">+ 创建分享</button>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div class="card-title">📋 已创建的分享链接</div>
        </div>
        ${tokensHtml}
      </div>
    `;
  },

  createShare() {
    const token = window.DeviceTracker.generateShareToken();
    const name = prompt("给这个分享链接起个名字:", `分享 #${window.DeviceTracker.listShareTokens().length + 1}`);
    window.DeviceTracker.saveShareMeta(token, { name: name || `分享 ${token.slice(0, 6)}` });
    this.renderTab("share");
    this.toast("分享链接已创建");
  },

  copyShareLink(url) {
    this.copyText(url);
  },

  // 查看设备列表
  async viewDevices(token) {
    // 显示 loading 窗
    const loadingHtml = `
      <div class="modal" onclick="if(event.target===this)APP.closeModal()">
        <div class="modal-content" style="max-width:560px;text-align:center;padding:30px">
          <div style="font-size:32px;margin-bottom:10px">☁️</div>
          <div class="text-muted">从云端加载设备列表...</div>
        </div>
      </div>`;
    const loadingDiv = document.createElement("div");
    loadingDiv.innerHTML = loadingHtml;
    document.body.appendChild(loadingDiv.firstElementChild);

    // 真正从云端拉
    let devices = [];
    let cloudOk = false;
    try {
      const resp = await fetch(`/.netlify/functions/devices?share=${encodeURIComponent(token)}`);
      if (resp.ok) {
        const json = await resp.json();
        if (json.success !== false || json.devices) {
          devices = json.devices || [];
          cloudOk = true;
        }
      }
    } catch (e) { console.warn("云端拉设备失败:", e); }

    // 关闭 loading
    this.closeModal();

    if (!cloudOk && devices.length === 0) {
      // 降级到本地
      devices = window.DeviceTracker.listDevices(token) || [];
    }

    const meta = window.DeviceTracker.getShareMeta(token);
    const name = meta?.name || token.slice(0, 8);
    const currentFp = window.DeviceTracker.fingerprint();
    const html = `
      <div class="modal" onclick="if(event.target===this)APP.closeModal()">
        <div class="modal-content" style="max-width:560px">
          <div class="modal-title">📱 ${name} 的注册设备 <span style="font-size:12px;color:${cloudOk ? 'var(--green)' : 'var(--ink-3)'};font-weight:400">${cloudOk ? '☁️ 云端' : '💾 本地'}</span></div>
          <p class="text-sm text-muted" style="margin-bottom:14px">
            共 <strong style="color:var(--red)">${devices.length} / 5</strong> 台设备 · 单个删除会腾出空位
          </p>
          ${devices.length === 0
            ? '<div class="text-sm text-muted text-center" style="padding:20px">该链接还没有任何设备注册</div>'
            : `<div class="device-list">${devices.map(d => {
                const isCurrent = d.fp === currentFp;
                const lastSeenDate = new Date(d.lastSeen).toLocaleString("zh-CN", {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
                const firstSeenDate = new Date(d.firstSeen).toLocaleString("zh-CN", {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
                return `
                  <div class="device-item ${isCurrent ? 'is-current' : ''}">
                    <div class="device-icon">${d.type === "手机" ? "📱" : d.type === "平板" ? "📱" : "💻"}</div>
                    <div class="device-info">
                      <div class="device-type">
                        ${d.type} <span class="text-xs text-muted">${d.fp.slice(0, 16)}...</span>
                        ${isCurrent ? '<span class="badge" style="margin-left:6px;background:var(--green-soft);color:var(--green)">本机</span>' : ''}
                      </div>
                      <div class="text-xs text-muted">首次 ${firstSeenDate} · 最近 ${lastSeenDate}</div>
                    </div>
                    <button class="btn-mini" onclick="APP.removeDevice('${token}','${d.fp}')" ${isCurrent ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>移除</button>
                  </div>
                `;
              }).join('')}</div>
              <div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end">
                <button class="btn btn-warn" onclick="APP.clearAllDevices('${token}')">🗑 清空所有设备</button>
                <button class="btn" onclick="APP.closeModal()">关闭</button>
              </div>`
          }
        </div>
      </div>
    `;
    const div = document.createElement("div");
    div.innerHTML = html;
    document.body.appendChild(div.firstElementChild);
  },

  // 移除单个设备(云端)
  async removeDevice(token, fp) {
    if (!confirm("确定移除该设备?\n移除后该设备需要重新输入密码才能使用。")) return;
    try {
      const resp = await fetch(`/.netlify/functions/devices?share=${encodeURIComponent(token)}&fp=${encodeURIComponent(fp)}`, {
        method: "DELETE"
      });
      if (resp.ok) {
        this.toast("✓ 已从云端移除该设备");
      } else {
        this.toast("云端移除失败,降级到本地", "warn");
        window.DeviceTracker.removeDevice(token, fp);
      }
    } catch (e) {
      window.DeviceTracker.removeDevice(token, fp);
      this.toast("本地移除完成", "warn");
    }
    this.closeModal();
    setTimeout(() => this.viewDevices(token), 300);
  },

  // 清空所有设备(云端)
  async clearAllDevices(token) {
    if (!confirm("⚠ 警告:清空所有设备?\n所有 5 台设备都需要重新注册。\n\n确定继续?")) return;
    try {
      const resp = await fetch(`/.netlify/functions/devices?share=${encodeURIComponent(token)}`, {
        method: "DELETE"
      });
      if (resp.ok) {
        this.toast("✓ 已从云端清空所有设备");
      } else {
        window.DeviceTracker.clearAllDevices(token);
      }
    } catch (e) {
      window.DeviceTracker.clearAllDevices(token);
    }
    this.closeModal();
    setTimeout(() => this.viewDevices(token), 300);
  },

  // 公式触发详情面板
  renderFormulaDetails() {
    const fd = this.state.frontFormulaDetails || [];
    const bd = this.state.backFormulaDetails || [];
    // 统计"高确信"杀号(被多公式杀的)
    const fk = this.state.formulaKilledFront || new Map();
    const bk = this.state.formulaKilledBack || new Map();
    // 估算误杀率:基于各公式准确率加权
    const calcMissRate = (formulaDetails, kMap) => {
      let totalWeight = 0, wrongWeight = 0;
      formulaDetails.forEach(d => {
        if (d.triggered) {
          const acc = parseFloat(d.accuracy);
          const missRate = (100 - acc) / 100;
          d.killed.forEach(n => {
            totalWeight++;
            wrongWeight += missRate;
          });
        }
      });
      return totalWeight > 0 ? (wrongWeight / totalWeight * 100).toFixed(1) : 0;
    };
    const fMissRate = calcMissRate(fd, fk);
    const bMissRate = calcMissRate(bd, bk);
    // 高确信杀号(被 4+ 公式杀的)
    const highConfF = [...fk.entries()].filter(([n, c]) => c >= 4).map(([n]) => n).sort((a, b) => a - b);
    const highConfB = [...bk.entries()].filter(([n, c]) => c >= 4).map(([n]) => n).sort((a, b) => a - b);
    // 只显示"已触发"的公式,简洁
    const renderTriggered = (d) => {
      const acc = parseFloat(d.accuracy);
      const accColor = acc >= 85 ? 'var(--green)' : acc >= 80 ? 'var(--primary)' : 'var(--orange)';
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px;background:rgba(231,76,60,0.06);border-radius:5px;margin-bottom:3px;font-size:11.5px">
        <div style="flex:1;display:flex;align-items:center;gap:6px">
          <span style="color:var(--green);font-weight:600">✓</span>
          <span>${d.name}</span>
        </div>
        <div style="display:flex;gap:6px;align-items:center;flex-shrink:0">
          <span style="color:var(--ink-2);font-size:11px;font-family:monospace">[${d.killed.join(",")}]</span>
          <span style="background:${accColor};color:white;padding:1px 5px;border-radius:6px;font-size:9.5px">${d.accuracy}%</span>
        </div>
      </div>`;
    };
    const trigF = fd.filter(d => d.triggered);
    const trigB = bd.filter(d => d.triggered);
    // 🧠 自学习数据
    this.loadLearnData();
    const softP = this.learnData.softPatterns || {};
    const softKillsF = (this.learnData.softKills && this.learnData.softKills.front) || {};
    const softKillsB = (this.learnData.softKills && this.learnData.softKills.back) || {};
    const softFCnt = Object.values(softKillsF).filter(w => w >= 0.8).length;
    const softBCnt = Object.values(softKillsB).filter(w => w >= 0.8).length;
    const sumTop = softP.sumFreq ? Object.entries(softP.sumFreq).sort((a,b) => b[1] - a[1]).slice(0, 3).map(([s]) => s).join('/') : '--';
    // 最后学习时间
    const lastLearn = softP.updatedAt ? new Date(softP.updatedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';
    const dataLen = (window.DLT_DATA || []).length;
    return `
      <div style="background:linear-gradient(135deg,rgba(108,92,231,0.10),rgba(108,92,231,0.04));border:1px solid rgba(108,92,231,0.25);border-radius:8px;padding:8px 10px;margin-bottom:8px;font-size:11px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:4px">
          <div style="display:flex;align-items:center;gap:5px">
            <span style="font-size:14px">🧠</span>
            <span style="font-weight:600;color:var(--primary)">自学习模式</span>
            <span style="color:var(--ink-3);font-size:10px">近 50 期 / 累计 ${dataLen} 期</span>
          </div>
          <span style="color:var(--ink-3);font-size:9.5px">最后更新: ${lastLearn}</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:5px">
          <span style="background:rgba(108,92,231,0.15);color:var(--primary);padding:1px 6px;border-radius:6px">
            红软杀 <b>${softFCnt}</b> 个
          </span>
          <span style="background:rgba(108,92,231,0.15);color:var(--primary);padding:1px 6px;border-radius:6px">
            蓝软杀 <b>${softBCnt}</b> 个
          </span>
          <span style="background:rgba(108,92,231,0.15);color:var(--primary);padding:1px 6px;border-radius:6px">
            高频和值 <b>${sumTop}</b>
          </span>
          <span style="color:var(--ink-3);font-size:10px;align-self:center">
            杀号数 &lt; 12 时软杀补位
          </span>
        </div>
      </div>
      <div style="background:rgba(255,107,107,0.08);border:1px solid rgba(255,107,107,0.2);border-radius:8px;padding:8px 10px;margin-bottom:10px;font-size:11.5px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <div>
            <span style="color:var(--red);font-weight:600">⚠ 误杀率</span>
            <span style="color:var(--ink-2);font-size:11px;margin-left:4px">每期约</span>
            <span style="background:rgba(255,107,107,0.18);color:var(--red);padding:1px 6px;border-radius:6px;font-weight:600;margin:0 4px">红 ${fMissRate}%</span>
            <span style="background:rgba(255,107,107,0.18);color:var(--red);padding:1px 6px;border-radius:6px;font-weight:600">蓝 ${bMissRate}%</span>
          </div>
        </div>
        <div style="margin-top:6px;font-size:11px;color:var(--ink-3);line-height:1.5">
          💡 <b>高确信杀号</b>(被 4+ 公式共识,误杀 &lt; 5%) 才是真正"该避开"的号
          ${highConfF.length > 0 ? `<br>🔴 高确信: <span style="color:var(--red);font-family:monospace">${highConfF.join(" ")}</span>` : ''}
          ${highConfB.length > 0 ? `&nbsp;&nbsp;🔵 高确信: <span style="color:#5b8def;font-family:monospace">${highConfB.join(" ")}</span>` : ''}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--ink-2);margin-bottom:6px">🔴 红球 (${trigF.length} 触发)</div>
          ${trigF.length > 0 ? trigF.map(renderTriggered).join('') : '<div style="font-size:11px;color:var(--ink-3);padding:8px;text-align:center">无公式触发</div>'}
        </div>
        <div>
          <div style="font-size:12px;font-weight:600;color:var(--ink-2);margin-bottom:6px">🔵 蓝球 (${trigB.length} 触发)</div>
          ${trigB.length > 0 ? trigB.map(renderTriggered).join('') : '<div style="font-size:11px;color:var(--ink-3);padding:8px;text-align:center">无公式触发</div>'}
        </div>
      </div>
    `;
  },

  // 自学状态显示
  renderLearnStatus() {
    const ld = this.learnData || {};
    const adj = ld.adjustments || {};
    const adjCount = Object.keys(adj).length;
    const totalAdjust = Object.values(adj).reduce((a, b) => a + b, 0);
    const positive = Object.values(adj).filter(v => v > 0).length;
    const negative = Object.values(adj).filter(v => v < 0).length;
    const lastLearn = ld.lastLearn ? new Date(ld.lastLearn).toLocaleString("zh-CN", {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'}) : "未学习";

    return `
      <div style="margin-top:14px;padding:10px 12px;background:linear-gradient(135deg,rgba(108,92,231,0.08),rgba(108,92,231,0.02));border:1px solid rgba(108,92,231,0.2);border-radius:8px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:18px">🎓</span>
            <div>
              <div style="font-size:13px;font-weight:600;color:var(--ink)">智能学习状态</div>
              <div style="font-size:11px;color:var(--ink-3)">最近学习: ${lastLearn} · ${adjCount} 个权重已调整</div>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center;font-size:11px">
            <span style="background:rgba(61,220,132,0.18);color:var(--green);padding:3px 8px;border-radius:6px">↑ 加权 ${positive}</span>
            <span style="background:rgba(255,107,107,0.18);color:var(--red);padding:3px 8px;border-radius:6px">↓ 减权 ${negative}</span>
            <span style="background:rgba(108,92,231,0.18);color:var(--primary);padding:3px 8px;border-radius:6px;font-weight:600">净 ${totalAdjust > 0 ? '+' : ''}${totalAdjust.toFixed(1)}</span>
          </div>
        </div>
        <div style="margin-top:8px;font-size:11px;color:var(--ink-3);line-height:1.5">
          💡 智选时会优先选"加权高"的号(实际命中率高),避开"减权"的号。每次录入新期自动重新学习。
          ${adjCount === 0 ? '<br><span style="color:var(--orange)">⚠ 还没开始学习 - 录入 1 期后会启动</span>' : ''}
        </div>
      </div>
    `;
  },

  closeModal() {
    const m = document.querySelector(".modal");
    if (m) m.remove();
  },

  // 折叠/展开公式触发详情
  toggleFormulaDetail() {
    const content = document.getElementById("formula-detail-content");
    const toggle = document.getElementById("formula-detail-toggle");
    if (!content) return;
    const visible = content.style.display !== "none";
    content.style.display = visible ? "none" : "block";
    if (toggle) toggle.textContent = visible ? "▾ 展开" : "▴ 收起";
  },

  // 旧:自学状态(分析 tab 用 learnCard 替代,保留备用)
  renderLearnStatus() {
    return '';
  },

  // 查询任意副链接 token 的设备情况
  queryShareToken() {
    const input = document.getElementById("query-token-input");
    const resultDiv = document.getElementById("query-result");
    if (!input || !resultDiv) return;
    let raw = input.value.trim();
    if (!raw) {
      resultDiv.innerHTML = '<div class="text-sm" style="color:var(--warn);padding:8px">⚠ 请输入 token 或完整链接</div>';
      return;
    }
    // 支持输入完整链接 ?share=xxx
    const m = raw.match(/[?&]share=([a-zA-Z0-9_-]+)/);
    if (m) raw = m[1];
    // 提取 token(只要字母数字下划线横线)
    const tokenMatch = raw.match(/[a-zA-Z0-9_-]{6,}/);
    if (!tokenMatch) {
      resultDiv.innerHTML = '<div class="text-sm" style="color:var(--warn);padding:8px">⚠ 未识别到有效 token (至少 6 位字母数字)</div>';
      return;
    }
    const token = tokenMatch[0];
    // 查本机 localStorage
    const devices = window.DeviceTracker.listDevices(token);
    const meta = window.DeviceTracker.getShareMeta(token);

    if (devices.length === 0 && !meta) {
      resultDiv.innerHTML = `
        <div class="text-sm" style="color:var(--ink-3);padding:10px;background:var(--bg-2);border-radius:6px">
          <div style="color:var(--warn);font-weight:600;margin-bottom:4px">⚠ 本机无该 token 数据</div>
          <div>token <code style="font-family:'JetBrains Mono',monospace;background:var(--bg-3);padding:1px 6px;border-radius:3px">${token}</code> 不在本机 localStorage 中。</div>
          <div class="text-xs" style="margin-top:6px">可能原因:① 该 token 由其他主链接创建;② token 错误;③ 浏览器换了。</div>
        </div>
      `;
      return;
    }

    const name = meta?.name || "未命名分享";
    const createdAt = meta?.createdAt ? new Date(meta.createdAt).toLocaleString("zh-CN") : "未知";
    const currentFp = window.DeviceTracker.fingerprint();

    const deviceListHtml = devices.length === 0
      ? '<div class="text-sm text-muted" style="padding:8px">该副链接当前没有设备注册</div>'
      : `<div class="device-list" style="margin-top:8px">${devices.map(d => {
          const isCurrent = d.fp === currentFp;
          const lastSeenDate = new Date(d.lastSeen).toLocaleString("zh-CN", {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
          const firstSeenDate = new Date(d.firstSeen).toLocaleString("zh-CN", {month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit'});
          return `
            <div class="device-item ${isCurrent ? 'is-current' : ''}">
              <div class="device-icon">${d.type === "手机" ? "📱" : d.type === "平板" ? "📱" : "💻"}</div>
              <div class="device-info">
                <div class="device-type">
                  ${d.type} <span class="text-xs text-muted">${d.fp.slice(0, 16)}...</span>
                  ${isCurrent ? '<span class="badge" style="margin-left:6px;background:var(--green-soft);color:var(--green)">本机</span>' : ''}
                </div>
                <div class="text-xs text-muted">首次 ${firstSeenDate} · 最近 ${lastSeenDate}</div>
              </div>
              <button class="btn-mini" onclick="APP.removeDevice('${token}','${d.fp}')" ${isCurrent ? 'disabled style="opacity:0.4;cursor:not-allowed"' : ''}>移除</button>
            </div>
          `;
        }).join('')}</div>
        <div style="margin-top:10px;display:flex;gap:8px;justify-content:flex-end">
          <button class="btn btn-warn" onclick="APP.clearAllDevices('${token}')">🗑 清空所有设备</button>
        </div>`;

    const url = `${window.location.origin}${window.location.pathname}?share=${token}`;
    resultDiv.innerHTML = `
      <div style="padding:12px;background:var(--bg-2);border:1px solid var(--line);border-radius:8px">
        <div class="flex between center mb-12">
          <div>
            <div class="font-bold">${name}</div>
            <div class="text-xs text-muted mt-8">token <code style="font-family:'JetBrains Mono',monospace;font-size:11px">${token}</code> · 创建 ${createdAt}</div>
          </div>
          <div class="text-right">
            <div style="font-size:18px;font-weight:700;color:${devices.length >= 5 ? 'var(--red)' : 'var(--green)'}">${devices.length} / 5</div>
            <div class="text-xs text-muted">设备使用</div>
          </div>
        </div>
        <div class="share-link-box" style="margin-bottom:10px">
          <span class="url" style="font-size:11px">${url}</span>
        </div>
        ${deviceListHtml}
      </div>
    `;
  },

  deleteShare(token) {
    if (!confirm("确定删除此分享链接?已注册的设备将被清空。")) return;
    localStorage.removeItem(`dlt_share_meta_${token}`);
    localStorage.removeItem(`dlt_share_${token}_devices`);
    this.renderTab("share");
    this.toast("分享链接已删除");
  },

  // ============== 工具 ==============
  logout() {
    this.isLoggedIn = false;
    this.state.selection = { front: [], back: [] };
    this.showMainLogin();
    document.getElementById("password").value = "";
  },

  toast(msg) {
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
  }
};

window.APP = APP;
document.addEventListener("DOMContentLoaded", () => APP.init());
