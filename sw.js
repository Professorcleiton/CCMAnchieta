const CACHE_NAME = 'siga-cache-v5';
const urlsToCache = [
    '/restrito.html',
    '/responsaveis.html',
    '/painel-responsavel.html',
    '/style.css',
    '/script.js',
    '/img/SIGA.png',
    '/img/logoA.png'
];

self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache))
    );
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.filter(cache => cache !== CACHE_NAME).map(cache => caches.delete(cache))
            );
        })
    );
    self.clients.claim();
});

// NÃO intercepta chamadas para o Google Apps Script
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.hostname.includes('script.google.com')) return;

    event.respondWith(
        fetch(event.request)
            .then(response => {
                if (response && response.status === 200) {
                    const clone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(event.request, clone));
                }
                return response;
            })
            .catch(() => caches.match(event.request))
    );
});

// Push notification (mantenha o código já existente)
self.addEventListener('push', event => {
    let data = {};
    if (event.data) {
        try { data = event.data.json(); } catch (e) {
            data = { title: 'SIGA Anchieta', body: event.data.text() };
        }
    }
    const options = {
        body: data.body || 'Novo apontamento registrado.',
        icon: '/img/SIGA.png',
        badge: '/img/SIGA.png',
        vibrate: [200, 100, 200],
        data: { url: data.url || 'https://www.ccmanchieta.com.br/responsaveis.html' },
        actions: [{ action: 'open', title: 'Ver detalhes' }],
        requireInteraction: true
    };
    event.waitUntil(
        self.registration.showNotification(data.title || 'SIGA Anchieta', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || 'https://www.ccmanchieta.com.br/responsaveis.html';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes('responsaveis') && 'focus' in client) return client.focus();
            }
            if (clients.openWindow) return clients.openWindow(urlToOpen);
        })
    );
});
