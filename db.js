// =============================================
// SIGA - Banco de Dados Local (IndexedDB)
// =============================================

const DB_NAME = 'SIGA_Offline';
const DB_VERSION = 1;

class SIGADatabase {
    constructor() {
        this.db = null;
        this.inicializado = false;
        this.init();
    }

    async init() {
        try {
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
                        store.createIndex('dataCriacao', 'dataCriacao', { unique: false });
                    }
                    
                    if (!db.objectStoreNames.contains('fatos')) {
                        const store = db.createObjectStore('fatos', { 
                            keyPath: 'idLocal', 
                            autoIncrement: false 
                        });
                        store.createIndex('aluno', 'aluno', { unique: false });
                        store.createIndex('sincronizado', 'sincronizado', { unique: false });
                        store.createIndex('dataCriacao', 'dataCriacao', { unique: false });
                    }
                    
                    if (!db.objectStoreNames.contains('documentos')) {
                        const store = db.createObjectStore('documentos', { 
                            keyPath: 'idLocal', 
                            autoIncrement: false 
                        });
                        store.createIndex('aluno', 'aluno', { unique: false });
                        store.createIndex('sincronizado', 'sincronizado', { unique: false });
                    }
                };
                
                request.onsuccess = (event) => {
                    this.db = event.target.result;
                    this.inicializado = true;
                    console.log('✅ Banco de dados local inicializado!');
                    resolve(this.db);
                };
                
                request.onerror = (event) => {
                    console.error('❌ Erro ao abrir banco de dados:', event.target.error);
                    reject(event.target.error);
                };
            });
        } catch (error) {
            console.error('❌ Erro ao inicializar banco:', error);
            this.inicializado = false;
        }
    }

    // =============================================
    // APONTAMENTOS
    // =============================================
    
    async salvarApontamento(dados) {
        if (!this.db || !this.inicializado) {
            console.warn('⚠️ Banco não inicializado, tentando inicializar...');
            await this.init();
            if (!this.db) throw new Error('Banco de dados não disponível');
        }
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['apontamentos'], 'readwrite');
                const store = transaction.objectStore('apontamentos');
                
                const apontamento = {
                    ...dados,
                    sincronizado: false,
                    dataCriacao: new Date().toISOString(),
                    idLocal: 'apo_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
                };
                
                const request = store.put(apontamento);
                request.onsuccess = () => resolve(apontamento);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    async getApontamentosNaoSincronizados() {
        if (!this.db || !this.inicializado) return [];
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['apontamentos'], 'readonly');
                const store = transaction.objectStore('apontamentos');
                const index = store.index('sincronizado');
                
                const request = index.getAll(false);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            } catch (error) {
                resolve([]);
            }
        });
    }

    async marcarApontamentoSincronizado(idLocal) {
        if (!this.db || !this.inicializado) return;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['apontamentos'], 'readwrite');
                const store = transaction.objectStore('apontamentos');
                
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
            } catch (error) {
                resolve();
            }
        });
    }

    async getTodosApontamentos() {
        if (!this.db || !this.inicializado) return [];
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['apontamentos'], 'readonly');
                const store = transaction.objectStore('apontamentos');
                
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            } catch (error) {
                resolve([]);
            }
        });
    }

    // =============================================
    // FATOS SEED
    // =============================================
    
    async salvarFato(dados) {
        if (!this.db || !this.inicializado) {
            await this.init();
            if (!this.db) throw new Error('Banco de dados não disponível');
        }
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['fatos'], 'readwrite');
                const store = transaction.objectStore('fatos');
                
                const fato = {
                    ...dados,
                    sincronizado: false,
                    dataCriacao: new Date().toISOString(),
                    idLocal: 'fat_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6)
                };
                
                const request = store.put(fato);
                request.onsuccess = () => resolve(fato);
                request.onerror = () => reject(request.error);
            } catch (error) {
                reject(error);
            }
        });
    }

    async getFatosNaoSincronizados() {
        if (!this.db || !this.inicializado) return [];
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['fatos'], 'readonly');
                const store = transaction.objectStore('fatos');
                const index = store.index('sincronizado');
                
                const request = index.getAll(false);
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            } catch (error) {
                resolve([]);
            }
        });
    }

    async marcarFatoSincronizado(idLocal) {
        if (!this.db || !this.inicializado) return;
        
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction(['fatos'], 'readwrite');
                const store = transaction.objectStore('fatos');
                
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
            } catch (error) {
                resolve();
            }
        });
    }
}

// Instância global
let db = null;

// Inicializa o banco de dados
try {
    db = new SIGADatabase();
    console.log('📦 Banco de dados local criado!');
} catch (error) {
    console.warn('⚠️ Banco de dados local não disponível:', error);
    db = null;
}

// Exporta para uso global
window.db = db;
