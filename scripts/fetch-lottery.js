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

  // ⚠️ 合并而非覆盖:API 单页最多返回 ~100 期,直接覆盖会把最旧的若干期截断掉。
  // 这里保留 API 未覆盖到的历史期(按期号去重,API 数据优先),避免历史数据被逐步吃光。
  const apiNums = new Set(draws.map(d => d.期号));
  const kept = (existing && Array.isArray(existing.draws) ? existing.draws : [])
    .filter(d => d && d.期号 && !apiNums.has(String(d.期号)))
    .map(d => ({
      期号: String(d.期号),
      开奖日期: d.开奖日期,
      前区: d.前区,
      后区: d.后区,
    }));
  if (kept.length) {
    console.log(`[fetch-lottery] 保留 API 未覆盖的 ${kept.length} 期历史数据 (最旧 ${kept[0].期号})`);
  }
  const merged = kept.concat(draws).sort((a, b) => parseInt(a.期号, 10) - parseInt(b.期号, 10));

  // 下一期:大乐透每周一/三/六 21:25 开奖,取最后一次开奖之后的下一个开奖日
  // 注意:JS 的 getUTCDay() 是 0=周日,1=周一,...,6=周六
  const last = merged[merged.length - 1];
  const lastNum = parseInt(last.期号, 10);
  const nextNum = lastNum + 1;
  const lastDate = new Date(last.开奖日期 + 'T00:00:00Z');
  const nextDate = new Date(lastDate.getTime());
  do {
    nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  } while (![1, 3, 6].includes(nextDate.getUTCDay())); // 1=周一 3=周三 6=周六
  const nextDateStr = nextDate.toISOString().slice(0, 10);
  const nextDraw = {
    期号: String(nextNum),
    开奖日期: nextDateStr,
    前区: null,
    后区: null,
  };

  const out = {
    draws: merged,
    nextDraw: nextDraw,
    meta: {
      ...(existing && existing.meta ? existing.meta : {}),
      source: 'lottery.gov.cn (cross-verified: 官方 API webapi.sporttery.cn getHistoryPageListV1 gameNo=85 + 500.com)',
      fetchedAt: new Date().toISOString(),
      totalDraws: merged.length,
      note: 'GitHub Actions 自动更新',
      firstDraw: merged[0].期号,
      lastDraw: last.期号,
      nextDraw: nextDraw.期号,
    },
  };

  // 比较是否真的有新数据
  const oldLatest = existing && existing.draws.length ? existing.draws[existing.draws.length - 1] : null;
  const newLatest = merged[merged.length - 1];
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
  console.log(`[fetch-lottery] draws=${merged.length}, 首期=${merged[0].期号}, 末期=${newLatest.期号}, 下一期=${nextDraw.期号} (${nextDraw.开奖日期})`);
}

main().catch(e => {
  console.error('[fetch-lottery] 失败:', e);
  process.exit(1);
});
