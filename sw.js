// Service Worker for 大乐透智能选号 PWA
// 策略:网络优先 + 缓存兜底
// 缓存关键静态资源,支持离线访问

const CACHE_VERSION = 'dlt-pwa-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

// 安装时预缓存关键资源
const PRECACHE_URLS = [
  './',
  './index.html',
  './css/styles.css',
  './js/app.js',
  './js/security.js',
  './js/selector.js',
  './js/stats.js',
  './js/cwl_source.js',
  './data/history.json',
  './favicon.svg',
  './favicon.ico',
  './manifest.json',
  './netlify.toml'
];

self.addEventListener('install', (event) => {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
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
            console.log('[SW] Deleting old cache:', key);
            return caches.delete(key);
          })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // 只处理 GET 请求
  if (request.method !== 'GET') return;

  // 跳过跨域请求(API 等)
  const url = new URL(request.url);
  if (url.origin !== location.origin) return;

  // Netlify Function 请求不缓存(走网络)
  if (url.pathname.startsWith('/.netlify/functions/')) {
    return; // 让请求走网络
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
        .catch(() => {
          return caches.match(request).then(cached => {
            return cached || caches.match('./index.html');
          });
        })
    );
    return;
  }

  // 静态资源:缓存优先,失败走网络
  event.respondWith(
    caches.match(request)
      .then(cached => {
        if (cached) {
          // 后台更新缓存(后台异步)
          fetch(request).then(response => {
            if (response.ok) {
              caches.open(RUNTIME_CACHE).then(cache => cache.put(request, response.clone()));
            }
          }).catch(() => {});
          return cached;
        }
        // 缓存没命中,走网络
        return fetch(request).then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(RUNTIME_CACHE).then(cache => cache.put(request, clone));
          }
          return response;
        }).catch(() => {
          // 网络也失败,返回离线 fallback
          if (request.destination === 'image') {
            return new Response('', { status: 503 });
          }
          return new Response('Offline', { status: 503 });
        });
      })
  );
});

// 接收消息:跳过等待
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
