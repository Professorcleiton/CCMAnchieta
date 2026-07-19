// =============================================
// SIGA - Banco de Dados Local (IndexedDB)
// =============================================

const DB_NAME = 'SIGA_Offline';
const DB_VERSION = 1;

class SIGADatabase {
    constructor() {
        this.db = null;
        this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                
                if (!db.objectStoreNames.contains('apontamentos')) {
                    const store = db.createObjectStore('apontamentos', { 
                        keyPath: 'idLocal', 
                        autoIncrement: false 
                    });
                    store.createIndex('aluno', 'aluno', { unique: false });
                    store.createIndex('setor', 'setor', { unique: false });
                    store.createIndex('sincronizado', 'sincronizado', { unique: false });
                }
                
                if (!db.objectStoreNames.contains('fatos')) {
                    const store = db.createObjectStore('fatos', { 
                        keyPath: 'idLocal', 
                        autoIncrement: false 
                    });
                    store.createIndex('aluno', 'aluno', { unique: false });
                    store.createIndex('sincronizado', 'sincronizado', { unique: false });
                }
            };
            
            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };
            
            request.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    // =============================================
    // APONTAMENTOS
    // =============================================
    
    async salvarApontamento(dados) {
        const transaction = this.db.transaction(['apontamentos'], 'readwrite');
        const store = transaction.objectStore('apontamentos');
        
        const apontamento = {
            ...dados,
            sincronizado: false,
            dataCriacao: new Date().toISOString(),
            idLocal: 'apo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
        };
        
        return new Promise((resolve, reject) => {
            const request = store.put(apontamento);
            request.onsuccess = () => resolve(apontamento);
            request.onerror = () => reject(request.error);
        });
    }

    async getApontamentosNaoSincronizados() {
        const transaction = this.db.transaction(['apontamentos'], 'readonly');
        const store = transaction.objectStore('apontamentos');
        const index = store.index('sincronizado');
        
        return new Promise((resolve, reject) => {
            const request = index.getAll(false);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async marcarApontamentoSincronizado(idLocal) {
        const transaction = this.db.transaction(['apontamentos'], 'readwrite');
        const store = transaction.objectStore('apontamentos');
        
        return new Promise((resolve, reject) => {
            const request = store.get(idLocal);
            request.onsuccess = () => {
                const dados = request.result;
                if (dados) {
                    dados.sincronizado = true;
                    dados.dataSincronizacao = new Date().toISOString();
                    const updateRequest = store.put(dados);
                    updateRequest.onsuccess = () => resolve();
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }

    async getTodosApontamentos() {
        const transaction = this.db.transaction(['apontamentos'], 'readonly');
        const store = transaction.objectStore('apontamentos');
        
        return new Promise((resolve, reject) => {
            const request = store.getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    // =============================================
    // FATOS SEED
    // =============================================
    
    async salvarFato(dados) {
        const transaction = this.db.transaction(['fatos'], 'readwrite');
        const store = transaction.objectStore('fatos');
        
        const fato = {
            ...dados,
            sincronizado: false,
            dataCriacao: new Date().toISOString(),
            idLocal: 'fat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
        };
        
        return new Promise((resolve, reject) => {
            const request = store.put(fato);
            request.onsuccess = () => resolve(fato);
            request.onerror = () => reject(request.error);
        });
    }

    async getFatosNaoSincronizados() {
        const transaction = this.db.transaction(['fatos'], 'readonly');
        const store = transaction.objectStore('fatos');
        const index = store.index('sincronizado');
        
        return new Promise((resolve, reject) => {
            const request = index.getAll(false);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }

    async marcarFatoSincronizado(idLocal) {
        const transaction = this.db.transaction(['fatos'], 'readwrite');
        const store = transaction.objectStore('fatos');
        
        return new Promise((resolve, reject) => {
            const request = store.get(idLocal);
            request.onsuccess = () => {
                const dados = request.result;
                if (dados) {
                    dados.sincronizado = true;
                    dados.dataSincronizacao = new Date().toISOString();
                    const updateRequest = store.put(dados);
                    updateRequest.onsuccess = () => resolve();
                    updateRequest.onerror = () => reject(updateRequest.error);
                } else {
                    resolve();
                }
            };
            request.onerror = () => reject(request.error);
        });
    }
}

// Instância global
const db = new SIGADatabase();

console.log('📦 Banco de dados local inicializado!');
