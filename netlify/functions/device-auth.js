// netlify/functions/device-auth.js
// 副链接设备绑定管理:5 台设备上限
// - GET  /api/device-auth?token=xxx&device=yyy  查询设备是否在列表中(返回剩余额度)
// - POST /api/device-auth   body: {token, deviceHash, action:'register'}  注册新设备
// - DELETE /api/device-auth  body: {token, deviceHash}  移除设备

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

async function getDevices(token) {
  if (!token) return [];
  try {
    // 显式传 store config - 用 netlify.toml 里的 siteID 推断
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    const data = await store.get(token, { type: 'json' });
    console.log('[getDevices]', token, '->', JSON.stringify(data));
    return Array.isArray(data) ? data : [];
  } catch (e) {
    console.error('[getDevices] error:', e.message);
    return [];
  }
}

async function setDevices(token, devices) {
  try {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    await store.setJSON(token, devices);
    console.log('[setDevices]', token, '<-', devices.length, 'devices');
  } catch (e) {
    console.error('[setDevices] error:', e.message);
    throw e;
  }
}

async function deleteAll(token) {
  try {
    const store = getStore({ name: STORE_NAME, consistency: 'strong' });
    await store.delete(token);
  } catch (e) {
    console.error('[deleteAll] error:', e.message);
    throw e;
  }
}

export default async (req, context) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('', { status: 204, headers: CORS_HEADERS });
  }

  // 调试信息
  console.log('[device-auth]', req.method, '| siteID:', context.site?.id, '| deployID:', context.deploy?.id);

  try {
    const url = new URL(req.url);

    if (req.method === 'GET') {
      // 查询某 token 的设备列表 + 当前设备是否在列表中
      const token = url.searchParams.get('token');
      const device = url.searchParams.get('device') || '';
      if (!token) return jsonResponse({ error: 'missing token' }, 400);

      const devices = await getDevices(token);
      const isAllowed = device ? devices.includes(device) : false;
      return jsonResponse({
        ok: true,
        token,
        count: devices.length,
        max: MAX_DEVICES_PER_TOKEN,
        full: devices.length >= MAX_DEVICES_PER_TOKEN,
        deviceAllowed: isAllowed,
        devices: devices.map(d => d.substring(0, 12) + '...'), // 不返回完整 hash,保护隐私
      });
    }

    if (req.method === 'POST') {
      const body = await req.json().catch(() => ({}));
      const { token, deviceHash, action } = body;

      if (!token) return jsonResponse({ error: 'missing token' }, 400);

      if (action === 'register') {
        if (!deviceHash) return jsonResponse({ error: 'missing deviceHash' }, 400);
        const devices = await getDevices(token);
        // 已经在列表中,直接通过
        if (devices.includes(deviceHash)) {
          return jsonResponse({
            ok: true,
            allowed: true,
            alreadyRegistered: true,
            count: devices.length,
            max: MAX_DEVICES_PER_TOKEN,
          });
        }
        // 已满,拒绝
        if (devices.length >= MAX_DEVICES_PER_TOKEN) {
          return jsonResponse({
            ok: true,
            allowed: false,
            reason: 'device_limit_reached',
            count: devices.length,
            max: MAX_DEVICES_PER_TOKEN,
          });
        }
        // 添加
        devices.push(deviceHash);
        await setDevices(token, devices);
        return jsonResponse({
          ok: true,
          allowed: true,
          alreadyRegistered: false,
          count: devices.length,
          max: MAX_DEVICES_PER_TOKEN,
        });
      }

      if (action === 'list') {
        const devices = await getDevices(token);
        return jsonResponse({ ok: true, count: devices.length, max: MAX_DEVICES_PER_TOKEN });
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
      const devices = await getDevices(token);
      const idx = devices.indexOf(deviceHash);
      if (idx === -1) return jsonResponse({ ok: true, found: false });
      devices.splice(idx, 1);
      await setDevices(token, devices);
      return jsonResponse({ ok: true, found: true, count: devices.length });
    }

    return jsonResponse({ error: 'method not allowed' }, 405);
  } catch (e) {
    console.error('[device-auth] error:', e);
    return jsonResponse({ error: e.message || 'internal error' }, 500);
  }
}

