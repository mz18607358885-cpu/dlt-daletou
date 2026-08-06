#!/usr/bin/env node
/**
 * 抓取最新大乐透数据并更新 data/history.json
 * 由 GitHub Actions 每周一/三/六 北京时间 21:35 自动运行
 *
 * 数据源:中国体育彩票官方 API
 *   https://webapi.sporttery.cn/gateway/lottery/getHistoryPageListV1.qry
 *   参数:gameNo=85(超级大乐透),pageSize=50
 *
 * 失败时:保持现有 data/history.json 不变
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const SPORTTERY_HOST = 'webapi.sporttery.cn';
const SPORTTERY_PATH = '/gateway/lottery/getHistoryPageListV1.qry?gameNo=85&provinceId=0&pageSize=100&isTester=0&pageNo=1';
const DATA_PATH = path.join(__dirname, '..', 'data', 'history.json');

function parseDrawResult(s) {
  if (!s || typeof s !== 'string') return null;
  const parts = s.trim().split(/\s+/).map(n => parseInt(n, 10));
  if (parts.length !== 7 || parts.some(isNaN)) return null;
  return {
    前区: parts.slice(0, 5).sort((a, b) => a - b),
    后区: parts.slice(5, 7).sort((a, b) => a - b),
  };
}

function fetchFromApi() {
  return new Promise((resolve, reject) => {
    const req = https.get({
      hostname: SPORTTERY_HOST,
      path: SPORTTERY_PATH,
      method: 'GET',
      headers: {
        // 用浏览器风格 UA,降低 WAF 拦截概率
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Language': 'zh-CN,zh;q=0.9',
        // 关键:接受 gzip 压缩,否则 Node 默认不接收,服务器强制返回 403 代替
        'Accept-Encoding': 'gzip, deflate, br',
        'Referer': 'https://www.sporttery.cn/',
        'Origin': 'https://www.sporttery.cn',
      },
      timeout: 15000,
    }, (res) => {
      const zlib = require('zlib');
      const encoding = (res.headers['content-encoding'] || '').toLowerCase();
      const stream = encoding === 'gzip' ? res.pipe(zlib.createGunzip())
                  : encoding === 'br' ? res.pipe(zlib.createBrotliDecompress())
                  : encoding === 'deflate' ? res.pipe(zlib.createInflate())
                  : res;
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('JSON parse failed: ' + e.message + ' | body前200: ' + body.substring(0, 200)));
        }
      });
      stream.on('error', reject);
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.end();
  });
}

async function main() {
  console.log('[fetch-lottery] 开始抓取大乐透数据...');

  // 读取现有数据(失败时保留)
  let existing = null;
  try {
    existing = JSON.parse(fs.readFileSync(DATA_PATH, 'utf-8'));
    console.log(`[fetch-lottery] 现有数据: ${existing.draws.length} 期, 最新 ${existing.draws[existing.draws.length - 1].期号}`);
  } catch (e) {
    console.log('[fetch-lottery] 没有现有数据');
  }

  // 重试 3 次
  let apiResp = null;
  let lastErr = null;
  for (let i = 1; i <= 3; i++) {
    try {
      apiResp = await fetchFromApi();
      console.log(`[fetch-lottery] 第 ${i} 次抓取成功`);
      break;
    } catch (e) {
      lastErr = e;
      console.log(`[fetch-lottery] 第 ${i} 次失败: ${e.message}`);
      if (i < 3) await new Promise(r => setTimeout(r, 2000 * i));
    }
  }

  if (!apiResp) {
    console.error('[fetch-lottery] 三次抓取均失败,保持现有数据');
    console.error('错误:', lastErr?.message);
    process.exit(1);
  }

  if (!apiResp.success || !apiResp.value || !Array.isArray(apiResp.value.list)) {
    console.error('[fetch-lottery] API 返回格式不正确');
    process.exit(1);
  }

  // 转换数据
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

  if (draws.length === 0) {
    console.error('[fetch-lottery] 无有效数据');
    process.exit(1);
  }

  // 按期号排序(从旧到新)
  draws.sort((a, b) => parseInt(a.期号, 10) - parseInt(b.期号, 10));

  // 模拟下一期
  const last = draws[draws.length - 1];
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

  const out = {
    draws: draws,
    nextDraw: nextDraw,
    meta: {
      source: 'sporttery.cn',
      fetchedAt: new Date().toISOString(),
      totalDraws: draws.length,
      note: 'GitHub Actions 自动更新',
    },
  };

  // 比较是否真的有新数据
  const oldLatest = existing ? existing.draws[existing.draws.length - 1] : null;
  const newLatest = draws[draws.length - 1];
  if (oldLatest && oldLatest.期号 === newLatest.期号) {
    console.log(`[fetch-lottery] 最新期号无变化 (${newLatest.期号}),只更新 fetchedAt`);

    // 仍然写文件,因为 fetchedAt 变了
  } else {
    console.log(`[fetch-lottery] ✓ 新数据! ${oldLatest?.期号 || '无'} → ${newLatest.期号}`);
  }

  // 写文件
  const json = JSON.stringify(out, null, 2);
  fs.writeFileSync(DATA_PATH, json, 'utf-8');
  console.log(`[fetch-lottery] 已写入 ${DATA_PATH}`);
  console.log(`[fetch-lottery] draws=${draws.length}, 首期=${draws[0].期号}, 末期=${newLatest.期号}, 下一期=${nextDraw.期号}`);
}

main().catch(e => {
  console.error('[fetch-lottery] 失败:', e);
  process.exit(1);
});
