// Service Worker do SIGA Anchieta
const CACHE_NAME = 'siga-cache-v3';

const urlsToCache = [
    '/restrito.html',
    '/responsaveis.html',
    '/painel-responsavel.html',
    '/style.css',
    '/script.js',
    '/img/SIGA.png'
];

// Instalação
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then(cache => cache.addAll(urlsToCache))
    );
    self.skipWaiting();
});

// Ativação
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
    self.clients.claim();
});

// Fetch (cache first, fallback to network)
self.addEventListener('fetch', event => {
    event.respondWith(
        caches.match(event.request)
            .then(response => response || fetch(event.request))
    );
});

// Push Notification
self.addEventListener('push', event => {
    let data = {};
    
    if (event.data) {
        try {
            data = event.data.json();
        } catch (e) {
            data = {
                title: 'SIGA Anchieta',
                body: event.data.text(),
                url: 'https://www.ccmanchieta.com.br/responsaveis.html'
            };
        }
    }
    
    const options = {
        body: data.body || 'Novo apontamento registrado.',
        icon: '/img/SIGA.png',
        badge: '/img/SIGA.png',
        vibrate: [200, 100, 200],
        data: {
            url: data.url || 'https://www.ccmanchieta.com.br/responsaveis.html'
        },
        actions: [
            {
                action: 'open',
                title: 'Ver detalhes'
            }
        ],
        requireInteraction: true,
        tag: 'siga-notificacao-' + Date.now()
    };
    
    event.waitUntil(
        self.registration.showNotification(
            data.title || 'SIGA Anchieta',
            options
        )
    );
});

// Clique na notificação
self.addEventListener('notificationclick', event => {
    event.notification.close();
    
    const urlToOpen = event.notification.data?.url || 'https://www.ccmanchieta.com.br/responsaveis.html';
    
    event.waitUntil(
        clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
            // Verifica se já tem uma aba aberta
            for (const client of windowClients) {
                if (client.url.includes('responsaveis') && 'focus' in client) {
                    return client.focus();
                }
            }
            // Abre nova aba
            if (clients.openWindow) {
                return clients.openWindow(urlToOpen);
            }
        })
    );
});
