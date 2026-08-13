// netlify/functions/device-auth.js
// 副链接设备绑定管理:5 台设备上限 + firstSeen 时间记录
// - GET    /api/device-auth?token=xxx[&device=yyy]  查询设备列表
// - POST   /api/device-auth   body: {token, deviceHash, action:'register'}  注册
// - DELETE /api/device-auth   body: {token, deviceHash}  移除单台(没 deviceHash 则清空整个 token)

import { getStore } from '@netlify/blobs';

const STORE_NAME = 'share-devices';
const MAX_DEVICES_PER_TOKEN = 5;
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  });
}

function getStoreHandle() {
  return getStore({ name: STORE_NAME, consistency: 'strong' });
}

// 读取设备数据(兼容旧版 array 格式 + 新增 deleted 标记)
async function getDeviceData(token) {
  if (!token) return { devices: [], firstSeen: {}, deleted: false };
  try {
    const store = getStoreHandle();
    const data = await store.get(token, { type: 'json' });
    if (data === null || data === undefined) {
      return { devices: [], firstSeen: {}, deleted: false };
    }
    if (Array.isArray(data)) {
      // 旧数据格式:直接是 array
      return { devices: data, firstSeen: {}, deleted: false };
    }
    if (data && typeof data === 'object') {
      // 新数据格式:{devices, firstSeen, deleted?, deletedAt?}
      return {
        devices: Array.isArray(data.devices) ? data.devices : [],
        firstSeen: (data.firstSeen && typeof data.firstSeen === 'object') ? data.firstSeen : {},
        deleted: data.deleted === true,
        deletedAt: data.deletedAt || null
      };
    }
    return { devices: [], firstSeen: {}, deleted: false };
  } catch (e) {
    console.error('[getDeviceData] error:', e.message);
    return { devices: [], firstSeen: {}, deleted: false };
  }
}

async function setDeviceData(token, payload) {
  const store = getStoreHandle();
  await store.setJSON(token, payload);
  console.log('[setDeviceData]', token, '<-', payload.devices.length, 'devices');
}

async function deleteAll(token) {
  // 不直接 store.delete(token),因为 Netlify Blobs 的 delete 是"软删除",
  // 后续 setJSON 会重新创建 key,导致"删除"失效。
  // 改为写入一个 {deleted: true} 标记,register 时检查该标记拒绝
  const store = getStoreHandle();
  await store.setJSON(token, { deleted: true, devices: [], firstSeen: {}, deletedAt: Date.now() });
  console.log('[deleteAll]', token, 'marked as deleted');
}

export default async (req) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  try {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      const token = url.searchParams.get('token');
      const device = url.searchParams.get('device') || '';
      if (!token) return jsonResponse({ error: 'missing token' }, 400);

      const data = await getDeviceData(token);
      const isAllowed = device ? data.devices.includes(device) : false;

      // 设备列表(带 firstSeen),用于管理界面
      const deviceList = data.devices.map(h => ({
        hash: h,
        hashShort: h.substring(0, 12) + '...',
        firstSeen: data.firstSeen[h] || 0,
        isCurrent: h === device
      })).sort((a, b) => a.firstSeen - b.firstSeen); // 按首次时间升序

      return jsonResponse({
        ok: true,
        token,
        count: data.devices.length,
        max: MAX_DEVICES_PER_TOKEN,
        full: data.devices.length >= MAX_DEVICES_PER_TOKEN,
        deviceAllowed: isAllowed,
        devices: deviceList
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const { token, deviceHash, action } = body;

      if (!token) return jsonResponse({ error: 'missing token' }, 400);

      if (action === 'register') {
        if (!deviceHash) return jsonResponse({ error: 'missing deviceHash' }, 400);
        const data = await getDeviceData(token);
        // 关键:链接已被删除,拒绝任何注册
        if (data.deleted) {
          return jsonResponse({
            ok: true,
            allowed: false,
            reason: 'link_deleted',
            count: data.devices.length,
            max: MAX_DEVICES_PER_TOKEN
          });
        }
        // 已经在列表中,直接通过(不更新 firstSeen)
        if (data.devices.includes(deviceHash)) {
          return jsonResponse({
            ok: true,
            allowed: true,
            alreadyRegistered: true,
            count: data.devices.length,
            max: MAX_DEVICES_PER_TOKEN
          });
        }
        // 已满,拒绝
        if (data.devices.length >= MAX_DEVICES_PER_TOKEN) {
          return jsonResponse({
            ok: true,
            allowed: false,
            reason: 'device_limit_reached',
            count: data.devices.length,
            max: MAX_DEVICES_PER_TOKEN
          });
        }
        // 添加 + 记录首次时间
        data.devices.push(deviceHash);
        data.firstSeen[deviceHash] = Date.now();
        await setDeviceData(token, data);
        return jsonResponse({
          ok: true,
          allowed: true,
          alreadyRegistered: false,
          count: data.devices.length,
          max: MAX_DEVICES_PER_TOKEN,
          firstSeen: data.firstSeen[deviceHash]
        });
      }

      if (action === 'list') {
        const data = await getDeviceData(token);
        return jsonResponse({
          ok: true,
          count: data.devices.length,
          max: MAX_DEVICES_PER_TOKEN
        });
      }

      return jsonResponse({ error: 'unknown action' }, 400);
    }

    if (req.method === 'DELETE') {
      const body = await req.json().catch(() => ({}));
      const { token, deviceHash } = body;
      if (!token) return jsonResponse({ error: 'missing token' }, 400);
      if (!deviceHash) {
        // 删整个 token
        await deleteAll(token);
        return jsonResponse({ ok: true, deleted: 'all' });
      }
      // 删单个设备
      const data = await getDeviceData(token);
      const idx = data.devices.indexOf(deviceHash);
      if (idx === -1) return jsonResponse({ ok: true, found: false });
      data.devices.splice(idx, 1);
      delete data.firstSeen[deviceHash];
      await setDeviceData(token, data);
      return jsonResponse({ ok: true, found: true, count: data.devices.length });
    }

    return jsonResponse({ error: 'method not allowed' }, 405);
  } catch (e) {
    console.error('[device-auth] error:', e);
    return jsonResponse({ error: e.message || 'internal error' }, 500);
  }
}
