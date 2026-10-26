/**
 * Ginkgo 美食地图 · Service Worker
 * 只做两件事：让页面能离线打开、让"安装到桌面"成立。
 * 数据接口（/api/**）和腾讯地图 CDN 一律不缓存。
 */
'use strict';

const CACHE = 'ginkgo-shell-v2';
const SHELL = [];   // 不预缓存带分享码校验的资源，避免 403

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL).catch(() => null))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (e) { return; }
  if (url.origin !== self.location.origin) return;   // 腾讯地图等外部资源走网络
  if (url.pathname.indexOf('/api/') === 0) return;   // 数据始终要最新

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res && res.ok) {
            // 只缓存真正的应用页面，别把"链接不完整"的提示页也存下来
            res.clone().text().then((text) => {
              if (text.indexOf('Ginkgo 美食地图') >= 0) {
                caches.open(CACHE).then((cache) => cache.put('./index.html', res.clone()));
              }
            }).catch(() => null);
          }
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => hit);
    })
  );
});
