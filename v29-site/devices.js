// 设备追踪模块
// 策略: 浏览器指纹 + 本地存储 + Netlify Function (可选)
// 限制: 静态托管下严格意义上的跨设备追踪有限,清缓存可绕过

window.DeviceTracker = {
  // 生成设备指纹
  fingerprint() {
    const stored = localStorage.getItem("dlt_device_uuid");
    if (stored) return stored;

    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width + "x" + screen.height,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 0,
      navigator.platform,
      screen.colorDepth,
      window.devicePixelRatio || 1
    ];

    // 简单 hash
    let hash = 0;
    const str = components.join("|");
    for (let i = 0; i < str.length; i++) {
      const chr = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + chr;
      hash |= 0;
    }
    const uuid = "dev_" + Math.abs(hash).toString(36) + "_" + Date.now().toString(36);
    localStorage.setItem("dlt_device_uuid", uuid);

    // 设备描述
    const isMobile = /Mobile|Android|iPhone/i.test(navigator.userAgent);
    const isTablet = /iPad|Tablet/i.test(navigator.userAgent);
    let deviceType = "电脑";
    if (isMobile) deviceType = "手机";
    else if (isTablet) deviceType = "平板";

    localStorage.setItem("dlt_device_type", deviceType);
    return uuid;
  },

  deviceType() {
    return localStorage.getItem("dlt_device_type") || "未知设备";
  },

  // 获取当前 share token
  getShareToken() {
    const params = new URLSearchParams(window.location.search);
    return params.get("share");
  },

  // 检查副链接设备数量
  async checkShareLimit(shareToken, limit = 5) {
    const fp = this.fingerprint();
    const storageKey = `dlt_share_${shareToken}_devices`;

    // 优先尝试云端校验(Netlify Function)
    const cloudResult = await this._checkCloud(shareToken, fp, limit);
    if (cloudResult.success !== null) return cloudResult;

    // 降级:本地存储(对单设备有效)
    let devices = [];
    try {
      devices = JSON.parse(localStorage.getItem(storageKey) || "[]");
    } catch (e) {
      devices = [];
    }

    // 清理过期(90 天)
    const now = Date.now();
    const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
    devices = devices.filter(d => now - d.lastSeen < NINETY_DAYS);

    const existing = devices.find(d => d.fp === fp);

    if (existing) {
      existing.lastSeen = now;
      localStorage.setItem(storageKey, JSON.stringify(devices));
      return {
        success: true,
        isNew: false,
        deviceCount: devices.length,
        limit,
        isCurrent: true
      };
    }

    if (devices.length >= limit) {
      return {
        success: false,
        isNew: false,
        deviceCount: devices.length,
        limit,
        isCurrent: false,
        reason: "5 台设备已满,请联系管理员"
      };
    }

    devices.push({
      fp,
      type: this.deviceType(),
      firstSeen: now,
      lastSeen: now
    });
    localStorage.setItem(storageKey, JSON.stringify(devices));

    return {
      success: true,
      isNew: true,
      deviceCount: devices.length,
      limit,
      isCurrent: true
    };
  },

  // 云端校验(需要部署 Netlify Function)
  async _checkCloud(shareToken, fp, limit) {
    try {
      const resp = await fetch(`/.netlify/functions/devices?share=${shareToken}&fp=${encodeURIComponent(fp)}&limit=${limit}`);
      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {
      // 静默失败,降级到本地
    }
    return { success: null };
  },

  // 注册到云端(可选)
  async _registerCloud(shareToken, fp) {
    try {
      await fetch(`/.netlify/functions/devices`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ share: shareToken, fp, type: this.deviceType() })
      });
    } catch (e) {
      // 静默
    }
  },

  // 生成新的 share token
  generateShareToken() {
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let token = "";
    for (let i = 0; i < 12; i++) {
      token += chars[Math.floor(Math.random() * chars.length)];
    }
    return token;
  },

  // 列出所有已创建的 share token (本地)
  listShareTokens() {
    const keys = Object.keys(localStorage).filter(k => k.startsWith("dlt_share_meta_"));
    return keys.map(k => {
      try {
        return JSON.parse(localStorage.getItem(k));
      } catch (e) {
        return null;
      }
    }).filter(Boolean);
  },

  // 保存 share token 元数据
  saveShareMeta(token, meta) {
    localStorage.setItem(`dlt_share_meta_${token}`, JSON.stringify({
      ...meta,
      token,
      createdAt: meta.createdAt || Date.now()
    }));
  },

  // 获取 share token 元数据
  getShareMeta(token) {
    try {
      return JSON.parse(localStorage.getItem(`dlt_share_meta_${token}`));
    } catch (e) {
      return null;
    }
  },

  // 列出某 token 的所有设备
  listDevices(token) {
    try {
      const raw = localStorage.getItem(`dlt_share_${token}_devices`);
      const devices = JSON.parse(raw || "[]");
      const now = Date.now();
      const NINETY_DAYS = 90 * 24 * 60 * 60 * 1000;
      // 清理过期
      return devices.filter(d => now - d.lastSeen < NINETY_DAYS);
    } catch (e) {
      return [];
    }
  },

  // 移除单个设备
  removeDevice(token, fp) {
    try {
      const devices = this.listDevices(token);
      const filtered = devices.filter(d => d.fp !== fp);
      localStorage.setItem(`dlt_share_${token}_devices`, JSON.stringify(filtered));
    } catch (e) {
      console.warn(e);
    }
  },

  // 清空所有设备
  clearAllDevices(token) {
    localStorage.removeItem(`dlt_share_${token}_devices`);
  }
};
