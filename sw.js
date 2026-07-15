const CACHE_NAME = 'field-note-v13';
// 단일 HTML 구조 — pdf.js/JSZip/로고는 각 HTML에 인라인되어 별도 캐시 불필요
// 루트(index.html)는 BRG 엔지니어링 허브, field-note.html은 현장조사노트, monitoring.html은 계측
const ASSETS = [
  './',
  './index.html',
  './field-note.html',
  './monitoring.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // 교차 출처(Firebase·gstatic 등)는 서비스워커가 관여하지 않음 — 실시간 동기화 방해 방지
  if (new URL(req.url).origin !== self.location.origin) return;

  // HTML 문서는 항상 네트워크 우선 (최신 배포 즉시 반영)
  if (req.mode === 'navigate' || req.destination === 'document') {
    event.respondWith(
      fetch(req).then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        return response;
      }).catch(() =>
        caches.match(req).then((c) => c || caches.match('./index.html'))
      )
    );
    return;
  }

  // 그 외 정적 자원은 캐시 우선
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return response;
      });
    })
  );
});
