const CACHE_NAME = 'siga-cache-v4'; // Versão incrementada para forçar atualização
const urlsToCache = [
    '/restrito.html',
    '/responsaveis.html',
    '/painel-responsavel.html',
    '/style.css',
    '/script.js',
    '/img/SIGA.png',
    '/img/logoA.png'
];

// Instalação: guarda os recursos essenciais no cache
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
    self.skipWaiting(); // Ativa o novo SW imediatamente
});

// Ativação: limpa caches antigos
self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys().then(cacheNames => {
            return Promise.all(
                cacheNames.map(cache => {
                    if (cache !== CACHE_NAME) {
                        return caches.delete(cache);
                    }
                })
            );
        })
    );
    self.clients.claim(); // Assume controle de todas as abas
});

// Fetch: network-first para arquivos críticos, cache-first para imagens/estáticos
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Para imagens e fontes, use cache-first (mais rápido)
    if (url.pathname.match(/\.(png|jpg|jpeg|gif|svg|ico|woff|woff2|ttf|eot)$/)) {
        event.respondWith(
            caches.match(request).then(cached => cached || fetch(request))
        );
        return;
    }

    // Para HTML, CSS, JS: network-first, com fallback para cache
    event.respondWith(
        fetch(request)
            .then(response => {
                // Se a resposta for válida, atualiza o cache
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => {
                        cache.put(request, responseClone);
                    });
                }
                return response;
            })
            .catch(() => {
                // Se falhar a rede (offline), serve do cache
                return caches.match(request);
            })
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
        requireInteraction: true,
        tag: 'siga-notificacao-' + Date.now()
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
                if (client.url.includes('responsaveis') && 'focus' in client) {
                    return client.focus();
                }
            }
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
