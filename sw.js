const CACHE_NAME = 'siga-cache-v12'; // Versão atualizada

const urlsToCache = [
    '/', '/index.html', '/restrito.html', '/responsaveis.html',
    '/painel-responsavel.html', '/style.css', '/script.js', '/db.js',
    '/img/SIGA.png', '/img/logoA.png'
];

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(urlsToCache)));
    self.skipWaiting();
});

self.addEventListener('activate', event => {
    event.waitUntil(caches.keys().then(cacheNames => {
        return Promise.all(cacheNames.filter(cache => cache !== CACHE_NAME).map(cache => caches.delete(cache)));
    }));
    self.clients.claim();
});

self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    if (url.hostname.includes('script.google.com')) return;

    // 🆕 Código do app NUNCA vem do cache (evita tela travada no mobile)
    if (/\.(js|css|html)$/i.test(url.pathname)) {
        event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
        return;
    }

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

// Manter as funções de push notification iguais (não precisa mexer)
self.addEventListener('push', event => {
    let data = {};
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = { title: 'SIGA Anchieta', body: event.data.text() };
        }
    }
    const options = {
        body: data.body || 'Novo apontamento registrado.',
        icon: '/img/SIGA.png',
        badge: '/img/SIGA.png',
        vibrate: [200, 100, 200],
        data: { url: data.url || '/responsaveis.html' },
        actions: [{ action: 'open', title: 'Ver detalhes' }],
        requireInteraction: true
    };
    event.waitUntil(
        self.registration.showNotification(data.title || 'SIGA Anchieta', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || '/responsaveis.html';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if (client.url.includes('responsaveis') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(urlToOpen);
        })
    );
});
