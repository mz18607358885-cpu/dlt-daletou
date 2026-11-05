// Service Worker for 大乐透专业智能杀号系统 v29
// 策略:文档网络优先(失败用缓存兜底),静态资源缓存优先(后台异步更新)
//
// 注意:预缓存列表必须与 v29 站点的实际文件结构一致。
// cache.addAll() 遇到任一 404 会整体 reject,导致 SW 安装失败,
// 因此这里只列出确定存在的文件。

const CACHE_VERSION = 'dlt-v29-pwa-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const PRECACHE_URLS = [
  './',
  './index.html',
  './app.js',
  './formulas.js',
  './data.js',
  './devices.js',
  './styles.css',
  './manifest.json',
  './icon.svg',
  './icon-192.png',
  './favicon.ico'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      // 逐个添加,单个失败不影响整体安装
      .then(cache => Promise.all(
        PRECACHE_URLS.map(url => cache.add(url).catch(err => {
          console.warn('[SW] 预缓存跳过', url, err && err.message);
        }))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map(key => {
            console.log('[SW] 删除旧缓存:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只处理 GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  // 跨域请求不接管
  if (url.origin !== location.origin) return;

  // 云端拉数端点(当前部署在 CF Pages 上不存在,可能返回 HTML 兜底页)不缓存
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/.netlify/functions/')) {
    return;
  }

  // HTML 文档:网络优先,失败用缓存
  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request).then(cached => cached || caches.match('./index.html')))
    );
    return;
  }

  // 静态资源:缓存优先 + 后台更新
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) {
          fetch(request)
            .then(response => {
              if (response.ok) {
                caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(request)
          .then(response => {
            if (response.ok) {
              const clone = response.clone();
              caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
            }
            return response;
          })
          .catch(() => new Response('Offline', { status: 503 }));
      })
  );
});

// 接收消息:跳过等待
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
