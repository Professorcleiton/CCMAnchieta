const CACHE_NAME = 'siga-cache-v18'; // v18: importar do BI e painel do professor

const urlsToCache = [
    '/', '/index.html', '/restrito.html', '/responsaveis.html',
    '/painel-responsavel.html', '/horarios-filho.html', '/manifest-pais.json', '/img/app-pais-192.png', '/img/app-pais-512.png', '/img/siga-192.png', '/style.css', '/siga-core.js', '/script.js', '/db.js',
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
    // 🔒 Só o próprio site passa pelo cache. Dados da escola (Apps Script,
    // planilhas, CDNs) nunca ficam guardados no aparelho pelo service worker.
    if (url.origin !== self.location.origin || event.request.method !== 'GET') return;

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

// =============================================
// PUSH — o servidor envia a notificação SEM conteúdo (privacidade/LGPD):
// a ocorrência do aluno não aparece na tela bloqueada. O detalhe fica no Portal.
// =============================================
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
        body: data.body || 'Há uma nova atualização sobre seu(sua) filho(a). Toque para ver no Portal.',
        icon: '/img/SIG.png',
        badge: '/img/SIG.png',
        vibrate: [200, 100, 200],
        tag: 'siga-atualizacao',   // várias seguidas viram uma só
        renotify: true,
        data: { url: data.url || '/painel-responsavel.html' },
        actions: [{ action: 'open', title: 'Ver detalhes' }],
        requireInteraction: true
    };
    event.waitUntil(
        self.registration.showNotification(data.title || 'SIGA Anchieta', options)
    );
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const urlToOpen = event.notification.data?.url || '/painel-responsavel.html';
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            for (const client of windowClients) {
                if ((client.url.includes('painel-responsavel') || client.url.includes('responsaveis')) && 'focus' in client) {
                    if ('navigate' in client) client.navigate(urlToOpen);
                    return client.focus();
                }
            }
            if (clients.openWindow) return clients.openWindow(urlToOpen);
        })
    );
});
