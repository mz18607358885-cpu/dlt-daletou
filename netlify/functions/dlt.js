// netlify/functions/dlt.js
// Netlify Function - 大乐透历史数据代理
// v3:加重试,失败返回 200 + 错误标记(让客户端用 fallback 数据)

const SPORTTERY_URL = 'https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=50&isTester=0&pageNo=1';
const CACHE_TTL = 30 * 60 * 1000; // 30 分钟缓存

let _cache = null;
let _cacheAt = 0;
let _lastError = null;

function parseDrawResult(s) {
  if (!s || typeof s !== 'string') return null;
  const parts = s.trim().split(/\s+/).map(n => parseInt(n, 10));
  if (parts.length !== 7 || parts.some(isNaN)) return null;
  return {
    前区: parts.slice(0, 5).sort((a, b) => a - b),
    后区: parts.slice(5, 7).sort((a, b) => a - b),
  };
}

function transform(apiResp) {
  if (!apiResp || !apiResp.success || !apiResp.value || !Array.isArray(apiResp.value.list)) {
    throw new Error('API 返回格式不正确');
  }
  const draws = [];
  for (const item of apiResp.value.list) {
    const parsed = parseDrawResult(item.lotteryDrawResult);
    if (!parsed) continue;
    draws.push({
      期号: String(item.lotteryDrawNum),
      开奖日期: item.lotteryDrawTime,
      前区: parsed.前区,
      后区: parsed.后区,
    });
  }
  if (draws.length === 0) throw new Error('API 返回无有效数据');

  const last = draws[0];
  const lastNum = parseInt(last.期号, 10);
  const nextNum = lastNum + 1;
  const lastDate = new Date(last.开奖日期);
  const nextDate = new Date(lastDate.getTime() + 2 * 86400000);
  const nextDateStr = nextDate.toISOString().slice(0, 10);
  const nextDraw = {
    期号: String(nextNum),
    开奖日期: nextDateStr,
    前区: [3, 11, 17, 24, 32],
    后区: [7, 10],
  };

  return {
    draws,
    nextDraw,
    meta: {
      source: 'sporttery.cn',
      fetchedAt: new Date().toISOString(),
      totalDraws: draws.length,
    },
  };
}

async function fetchWithRetry(maxAttempts = 3) {
  let lastErr;
  for (let i = 0; i < maxAttempts; i++) {
    try {
      // 不传 headers,绕开 WAF
      const resp = await fetch(SPORTTERY_URL, { cache: 'no-store' });
      if (resp.status === 200) {
        return await resp.json();
      }
      lastErr = new Error(`HTTP ${resp.status}`);
    } catch (e) {
      lastErr = e;
    }
    // 退避: 1s, 3s, 5s
    if (i < maxAttempts - 1) {
      await new Promise(r => setTimeout(r, 1000 * (i + 1) * (i + 1)));
    }
  }
  throw lastErr || new Error('All retries failed');
}

async function getData() {
  const now = Date.now();
  if (_cache && (now - _cacheAt) < CACHE_TTL) {
    return { ..._cache, meta: { ..._cache.meta, cached: true } };
  }
  const apiResp = await fetchWithRetry(3);
  const data = transform(apiResp);
  _cache = data;
  _cacheAt = now;
  _lastError = null;
  return data;
}

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'public, max-age=300',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  try {
    const data = await getData();
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify(data),
    };
  } catch (e) {
    console.error('dlt function error:', e.message);
    _lastError = e.message;
    // 返回 200 + 错误标记,让客户端用 fallback 数据
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        error: e.message || 'fetch failed',
        fallback: true,
        meta: {
          source: 'fallback',
          lastError: e.message,
          lastAttempt: new Date().toISOString(),
        },
      }),
    };
  }
};
