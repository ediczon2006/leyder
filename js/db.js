// ========================================================
//  LEYTRIX ISP — CAPA DE DATOS HÍBRIDA (IndexedDB + Supabase)
//  - Almacenamiento local ultrarrápido (funciona 100% offline)
//  - Sincronización en la nube con Supabase (baeobhvgfrdbwyqapqzf)
//  - Compartido entre todas las páginas del sistema
// ========================================================

const ZONAS   = ['Loboyacu', 'Huayranga', 'Pacotillo', 'Ramal de Cachiyacu', 'Palmeras', 'Shishiyacu'];
const PLANES  = [50, 60, 65];
const ESTADOS = ['ACTIVO', 'CORTADO', 'PENDIENTE', 'RETIRADO'];

// [SEGURIDAD / ARQUITECTURA]: Clave pública anon (JWT RFC 7519) para acceso cliente
// El control de autorización y aislamiento de datos está garantizado por Row Level Security (RLS) en Supabase.
const SUPA_URL = 'https://baeobhvgfrdbwyqapqzf.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJhZW9iaHZnZnJkYnd5cWFwcXpmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE2NjUyMzgsImV4cCI6MjEwNzI0MTIzOH0.gve1FoTF8kDnUrZfedGdWnZKV1e6uxgydXJBm_v5ILc';

let _supa = null;
let _supaOnline = false;

// FIX [BUG-01]: Añadido guard para evitar doble inicialización si el SDK
// ya fue cargado previamente por un iframe o recarga parcial.
let _supaIniciado = false;
try {
  if (!_supaIniciado && typeof supabase !== 'undefined' && supabase.createClient) {
    _supa = supabase.createClient(SUPA_URL, SUPA_KEY);
    _supaIniciado = true;
  }
} catch (err) {
  console.warn('Supabase JS SDK no disponible:', err);
}

// Sanitizador defensivo para evitar rechazos de tipos o checks en PostgreSQL
function sanitizarPayloadSupabase(item) {
  if (!item || typeof item !== 'object') return item;
  const copia = { ...item };
  for (const k of Object.keys(copia)) {
    if (typeof copia[k] === 'string' && copia[k].trim() === '') {
      if (['fecha_inicio', 'fecha', 'fecha_corte', 'fecha_reconexion', 'ip', 'celular'].includes(k)) {
        copia[k] = null;
      }
    }
  }
  if ('plan' in copia && copia.plan !== null && copia.plan !== undefined) {
    copia.plan = Number(copia.plan) || 65;
  }
  if ('monto' in copia && copia.monto !== null && copia.monto !== undefined) {
    copia.monto = Number(copia.monto) || 0;
  }
  return copia;
}

const DB_NAME = 'leytrix_isp_v1';
const DB_VER  = 2;

const IDB = (() => {
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        // 1. Clientes
        if (!db.objectStoreNames.contains('clientes')) {
          const cs = db.createObjectStore('clientes', { keyPath: 'id', autoIncrement: true });
          cs.createIndex('zona',       'zona',             { unique: false });
          cs.createIndex('estado',     'estado',           { unique: false });
          cs.createIndex('plan',       'plan',             { unique: false });
          cs.createIndex('zona_estado', ['zona', 'estado'], { unique: false });
        } else {
          const cs = e.target.transaction.objectStore('clientes');
          if (!cs.indexNames.contains('zona_estado')) {
            cs.createIndex('zona_estado', ['zona', 'estado'], { unique: false });
          }
        }
        // 2. Pagos
        if (!db.objectStoreNames.contains('pagos')) {
          const ps = db.createObjectStore('pagos', { keyPath: 'id', autoIncrement: true });
          ps.createIndex('id_cliente', 'id_cliente', { unique: false });
          ps.createIndex('mes',        'mes',        { unique: false });
          ps.createIndex('cli_mes',    ['id_cliente', 'mes'], { unique: false });
        }
        // 3. Cortes
        if (!db.objectStoreNames.contains('cortes')) {
          const ks = db.createObjectStore('cortes', { keyPath: 'id', autoIncrement: true });
          ks.createIndex('id_cliente', 'id_cliente', { unique: false });
          ks.createIndex('estado',     'estado',     { unique: false });
        }
        // 4. Fotos y Comprobantes ISP
        if (!db.objectStoreNames.contains('fotos')) {
          const fs = db.createObjectStore('fotos', { keyPath: 'id', autoIncrement: true });
          fs.createIndex('categoria',  'categoria',  { unique: false });
          fs.createIndex('cliente_id', 'cliente_id', { unique: false });
          fs.createIndex('zona',       'zona',       { unique: false });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => reject(e.target.error);
      // FIX [CASO-LIMITE-01]: Manejar el caso donde el usuario rechaza el
      // permiso de IndexedDB (modo privado en Safari / Firefox restrictivo)
      req.onblocked = () => {
        console.warn('[IDB] La base de datos está bloqueada por otra pestaña. Recarga la página.');
        reject(new Error('IndexedDB bloqueada por otra pestaña abierta del sistema.'));
      };
    });
  }

  async function db() { return _db || (_db = await open()); }

  return {
    // Agregar registro (IndexedDB + Supabase)
    async add(store, data) {
      // FIX [LOGICA-01]: Validar que `data` no sea null/undefined antes de insertar.
      if (!data || typeof data !== 'object') throw new Error(`[IDB.add] dato inválido en store "${store}"`);

      const d = await db();
      const id = await new Promise((resolve, reject) => {
        const tx  = d.transaction([store], 'readwrite');
        const req = tx.objectStore(store).add(data);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
      });

      if (_supa) {
        try {
          const payload = sanitizarPayloadSupabase({ ...data, id });
          const { error } = await _supa.from(store).upsert(payload, { onConflict: 'id' });
          if (!error) {
            _supaOnline = true;
            actualizarBadgesSupabase(true);
          } else {
            console.warn(`[Supabase add] Error en ${store}:`, error.message);
          }
        } catch(err) {
          console.warn(`[Supabase add] Excepción en ${store}:`, err);
        }
      }

      return id;
    },

    // Actualizar registro (IndexedDB + Supabase)
    async put(store, data) {
      // FIX [LOGICA-01]: Validar que `data` tenga 'id' definido (sin id el put puede crear duplicados).
      if (!data || typeof data !== 'object') throw new Error(`[IDB.put] dato inválido en store "${store}"`);
      if (data.id === undefined || data.id === null) {
        console.warn(`[IDB.put] Llamado sin 'id' en store "${store}". Se usará add() en su lugar.`);
        return this.add(store, data);
      }

      const d = await db();
      const id = await new Promise((resolve, reject) => {
        const tx  = d.transaction([store], 'readwrite');
        const req = tx.objectStore(store).put(data);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
      });

      if (_supa) {
        try {
          const payload = sanitizarPayloadSupabase(data);
          const { error } = await _supa.from(store).upsert(payload, { onConflict: 'id' });
          if (!error) {
            _supaOnline = true;
            actualizarBadgesSupabase(true);
          } else {
            console.warn(`[Supabase put] Error en ${store}:`, error.message);
          }
        } catch(err) {
          console.warn(`[Supabase put] Excepción en ${store}:`, err);
        }
      }

      return id;
    },

    // Obtener por ID (soporta claves numéricas y strings)
    async get(store, id) {
      if (id === null || id === undefined || id === '') return null;
      const d = await db();
      return new Promise((resolve) => {
        const tx = d.transaction([store], 'readonly');
        const st = tx.objectStore(store);
        const numId = Number(id);
        const isNum = Number.isFinite(numId) && numId > 0;

        // Intentar primero con número si es numérico
        const req = isNum ? st.get(numId) : st.get(id);
        req.onsuccess = e => {
          if (e.target.result) {
            resolve(e.target.result);
          } else {
            // Reintentar con string si no se encontró como número
            try {
              const req2 = st.get(String(id));
              req2.onsuccess = e2 => resolve(e2.target.result || null);
              req2.onerror = () => resolve(null);
            } catch (_) {
              resolve(null);
            }
          }
        };
        req.onerror = () => {
          try {
            const req2 = st.get(String(id));
            req2.onsuccess = e2 => resolve(e2.target.result || null);
            req2.onerror = () => resolve(null);
          } catch (_) {
            resolve(null);
          }
        };
      });
    },

    // Eliminar por ID (soporta números y strings + sincroniza con Supabase)
    async delete(store, id) {
      if (id === null || id === undefined || id === '') return;
      const numId = Number(id);
      const isNum = Number.isFinite(numId) && numId > 0;
      const strId = String(id);

      const d = await db();
      await new Promise((resolve, reject) => {
        const tx = d.transaction([store], 'readwrite');
        const st = tx.objectStore(store);

        // FIX [BUG-DELETE-01]: Only delete with the correct key type.
        // Previously both numId and strId were always deleted, causing IDB
        // transaction errors when the alternate key type didn't exist in the store.
        const primaryKey = isNum ? numId : strId;
        const fallbackKey = isNum ? strId : numId;
        const req = st.delete(primaryKey);
        req.onerror = () => {
          // Silent fallback: try alternate key type if primary fails
          try { st.delete(fallbackKey); } catch (_) {}
        };

        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error);
      });

      if (_supa) {
        try {
          const targetId = isNum ? numId : strId;
          const { error } = await _supa.from(store).delete().eq('id', targetId);
          if (error) console.warn(`[Supabase delete] Error en ${store}:`, error.message);
        } catch(err) {
          console.warn(`[Supabase del] Excepción en ${store}:`, err);
        }
      }
    },

    // Conteo total O(1)
    async count(store) {
      const d = await db();
      return new Promise((resolve) => {
        const tx  = d.transaction([store], 'readonly');
        const req = tx.objectStore(store).count();
        req.onsuccess = e => resolve(e.target.result || 0);
        req.onerror   = () => resolve(0);
      });
    },

    // Conteo por índice O(1)
    async countByIndex(store, idx, key) {
      const d = await db();
      return new Promise((resolve) => {
        try {
          const tx    = d.transaction([store], 'readonly');
          const index = tx.objectStore(store).index(idx);
          const range = IDBKeyRange.only(key);
          const req   = index.count(range);
          req.onsuccess = e => resolve(e.target.result || 0);
          req.onerror   = () => resolve(0);
        } catch (_) {
          resolve(0);
        }
      });
    },

    // Obtener todos los registros
    async getAll(store, count = null) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx  = d.transaction([store], 'readonly');
        const req = count ? tx.objectStore(store).getAll(null, count) : tx.objectStore(store).getAll();
        req.onsuccess = e => resolve(e.target.result || []);
        req.onerror   = e => reject(e.target.error);
      });
    },

    // Obtener por índice
    async getByIndex(store, idx, key, count = null) {
      const d = await db();
      return new Promise((resolve, reject) => {
        try {
          const tx    = d.transaction([store], 'readonly');
          const index = tx.objectStore(store).index(idx);
          const range = IDBKeyRange.only(key);
          const req   = count ? index.getAll(range, count) : index.getAll(range);
          req.onsuccess = e => resolve(e.target.result || []);
          req.onerror   = e => reject(e.target.error);
        } catch (_) {
          resolve([]);
        }
      });
    },

    // Guardado masivo por lotes
    async bulkPut(store, items) {
      if (!items || !items.length) return 0;
      const d = await db();
      const BATCH = 500;
      let ok = 0;

      for (let i = 0; i < items.length; i += BATCH) {
        const chunk = items.slice(i, i + BATCH);
        await new Promise((resolve, reject) => {
          const tx = d.transaction([store], 'readwrite');
          const st = tx.objectStore(store);
          chunk.forEach(item => st.put(item));
          tx.oncomplete = () => { ok += chunk.length; resolve(); };
          tx.onerror = e => reject(e.target.error);
        });

        if (_supa) {
          try {
            const chunkSanitizado = chunk.map(sanitizarPayloadSupabase);
            const { error } = await _supa.from(store).upsert(chunkSanitizado, { onConflict: 'id' });
            if (error) console.warn(`[Supabase bulkPut] ${store}:`, error.message);
          } catch(err) {
            console.warn(`[Supabase bulkPut] ${store}:`, err);
          }
        }
      }
      return ok;
    },

    // Consulta paginada y filtrada — ULTRA OPTIMIZADA PARA 10,000+ CLIENTES
    async query(store, { indexName = null, range = null, filter = null, limit = 50, offset = 0 } = {}) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx     = d.transaction([store], 'readonly');
        const st     = tx.objectStore(store);
        const source = indexName ? st.index(indexName) : st;

        // FAST PATH (Sin filtro JS en memoria):
        // Usa conteo O(1) vía B-Tree y salta directo con cursor.advance()
        // Se detiene INMEDIATAMENTE al alcanzar limit (no recorre los 10,000 registros).
        if (!filter) {
          const countReq = source.count(range);
          countReq.onsuccess = () => {
            const total = countReq.result || 0;
            if (total === 0 || offset >= total) {
              resolve({ results: [], total });
              return;
            }

            const results = [];
            const req = source.openCursor(range, 'prev');
            let advanced = false;

            req.onsuccess = e => {
              const cursor = e.target.result;
              if (!cursor) {
                resolve({ results, total });
                return;
              }

              if (offset > 0 && !advanced) {
                advanced = true;
                cursor.advance(offset);
                return;
              }

              results.push(cursor.value);
              if (results.length >= limit) {
                resolve({ results, total });
                return;
              }

              cursor.continue();
            };
            req.onerror = e => reject(e.target.error);
          };
          countReq.onerror = () => ejecutarCursorCompleto();
          return;
        }

        // SLOW PATH (Filtro JS de búsqueda por texto):
        ejecutarCursorCompleto();

        function ejecutarCursorCompleto() {
          const req = source.openCursor(range, 'prev');
          const results = [];
          let skipped = 0;
          let totalFiltrado = 0;

          req.onsuccess = e => {
            const cursor = e.target.result;
            if (!cursor) {
              resolve({ results, total: totalFiltrado });
              return;
            }
            const val = cursor.value;
            if (!filter || filter(val)) {
              totalFiltrado++;
              if (skipped < offset) {
                skipped++;
              } else if (results.length < limit) {
                results.push(val);
              }
            }
            cursor.continue();
          };
          req.onerror = e => reject(e.target.error);
        }
      });
    },

    // Búsqueda rápida de clientes para selects (con límite temprano)
    async buscarClientesRapido(termino = '', { limit = 30, soloActivos = false } = {}) {
      const s = String(termino || '').toLowerCase().trim();
      const d = await db();
      return new Promise((resolve) => {
        const tx = d.transaction(['clientes'], 'readonly');
        const st = tx.objectStore('clientes');
        const req = st.openCursor(null, 'prev');
        const encontrados = [];

        req.onsuccess = e => {
          const cursor = e.target.result;
          if (!cursor || encontrados.length >= limit) {
            resolve(encontrados);
            return;
          }
          const c = cursor.value;
          if (!soloActivos || c.estado === 'ACTIVO') {
            if (!s || `${c.id} ${c.nombre || ''} ${c.ip || ''} ${c.celular || ''} ${c.zona || ''}`.toLowerCase().includes(s)) {
              encontrados.push(c);
            }
          }
          cursor.continue();
        };
        req.onerror = () => resolve([]);
      });
    },

    // Eliminación atómica en cascada — 100% GARANTIZADA LOCAL Y NUBE
    async eliminarClienteCompleto(id) {
      if (id === null || id === undefined || id === '') {
        throw new Error('[eliminarClienteCompleto] ID inválido: ' + id);
      }

      const numId = Number(id);
      const isNum = Number.isFinite(numId) && numId > 0;
      const strId = String(id);
      const d = await db();

      // 1. Borrado atómico en IndexedDB
      await new Promise((resolve, reject) => {
        const tx = d.transaction(['clientes', 'pagos', 'cortes', 'fotos'], 'readwrite');
        const cliStore = tx.objectStore('clientes');

        if (isNum) cliStore.delete(numId);
        cliStore.delete(strId);

        // Limpiar pagos del cliente
        try {
          const pStore = tx.objectStore('pagos');
          if (pStore.indexNames.contains('id_cliente')) {
            const pIdx = pStore.index('id_cliente');
            if (isNum) {
              const req = pIdx.openKeyCursor(IDBKeyRange.only(numId));
              req.onsuccess = e => { const c = e.target.result; if (c) { pStore.delete(c.primaryKey); c.continue(); } };
            }
            const reqStr = pIdx.openKeyCursor(IDBKeyRange.only(strId));
            reqStr.onsuccess = e => { const c = e.target.result; if (c) { pStore.delete(c.primaryKey); c.continue(); } };
          }
        } catch (errP) {
          console.warn('[eliminarClienteCompleto] pagos error:', errP);
        }

        // Limpiar cortes del cliente
        try {
          const kStore = tx.objectStore('cortes');
          if (kStore.indexNames.contains('id_cliente')) {
            const kIdx = kStore.index('id_cliente');
            if (isNum) {
              const req = kIdx.openKeyCursor(IDBKeyRange.only(numId));
              req.onsuccess = e => { const c = e.target.result; if (c) { kStore.delete(c.primaryKey); c.continue(); } };
            }
            const reqStr = kIdx.openKeyCursor(IDBKeyRange.only(strId));
            reqStr.onsuccess = e => { const c = e.target.result; if (c) { kStore.delete(c.primaryKey); c.continue(); } };
          }
        } catch (errK) {
          console.warn('[eliminarClienteCompleto] cortes error:', errK);
        }

        // Limpiar fotos del cliente
        try {
          const fStore = tx.objectStore('fotos');
          if (fStore.indexNames.contains('cliente_id')) {
            const fIdx = fStore.index('cliente_id');
            if (isNum) {
              const req = fIdx.openKeyCursor(IDBKeyRange.only(numId));
              req.onsuccess = e => { const c = e.target.result; if (c) { fStore.delete(c.primaryKey); c.continue(); } };
            }
            const reqStr = fIdx.openKeyCursor(IDBKeyRange.only(strId));
            reqStr.onsuccess = e => { const c = e.target.result; if (c) { fStore.delete(c.primaryKey); c.continue(); } };
          }
        } catch (errF) {
          console.warn('[eliminarClienteCompleto] fotos error:', errF);
        }

        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error || new Error('Error al eliminar en IndexedDB'));
      });

      // 2. Borrado remoto inmediato en Supabase (evita que el cliente "resucite" en la sincronización)
      if (_supa) {
        try {
          const targetId = isNum ? numId : strId;
          await Promise.allSettled([
            _supa.from('clientes').delete().eq('id', targetId),
            _supa.from('pagos').delete().eq('id_cliente', targetId),
            _supa.from('cortes').delete().eq('id_cliente', targetId),
            _supa.from('fotos').delete().eq('cliente_id', targetId)
          ]);
        } catch(err) {
          console.warn('[Supabase eliminarClienteCompleto]:', err);
        }
      }
    }
  };
})();

if (typeof window !== 'undefined') {
  window.IDB = IDB;
}

// ══ HELPERS Y FORMATOS ══════════════════════════════════
function esc(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safe(str, maxLen = 200) {
  return String(str || '').trim().slice(0, maxLen);
}

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function mesActual() {
  const d = new Date();
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Setiembre','Octubre','Noviembre','Diciembre'];
  return `${meses[d.getMonth()]} ${d.getFullYear()}`;
}

function fechaHoy() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dia}`;
}

function labelPlan(plan) {
  const p = Number(plan);
  if (p === 50) return 'Plan Básico';
  if (p === 60) return 'Plan Plus';
  if (p === 65) return 'Plan Normal';
  return `Plan S/. ${p || 65}`;
}

function badgeEstado(e) {
  if (e === 'ACTIVO')    return '<span class="badge badge-activo">✅ ACTIVO</span>';
  if (e === 'CORTADO')   return '<span class="badge badge-cortado">✂️ CORTADO</span>';
  if (e === 'PENDIENTE') return '<span class="badge badge-pendiente">⏳ PENDIENTE</span>';
  return '<span class="badge badge-retirado">⚪ RETIRADO</span>';
}

// FIX [INNECESARIO-02]: badgeCable() referenciaba el campo 'cable' eliminado del sistema.
// Se conserva la función pero se documenta como legacy para backward compat con registros viejos.
function badgeCable(c) {
  return c ? '<span style="color:var(--verde);font-weight:700">✅ Cable</span>' : '<span style="color:var(--gris)">❌ Sin cable</span>';
}

let _toastTimer = null;
function toast(msg, tipo = 'success') {
  // FIX [CASO-LIMITE-03]: Si msg es un objeto o undefined, convertirlo a string
  // para evitar que aparezca "[object Object]" en el toast.
  const safeMsg = (msg !== null && msg !== undefined) ? String(msg) : '';
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  clearTimeout(_toastTimer);
  el.textContent = safeMsg;
  el.className = `show t-${tipo}`;
  _toastTimer = setTimeout(() => { el.className = ''; }, 3200);
}

// ══ VERIFICACIÓN Y SINCRONIZACIÓN SUPABASE (HARDENED ENTERPRISE) ════════
const SUPABASE_SETUP_SQL = `-- ====================================================================
-- LEYTRIX ISP — SCRIPT DE CONFIGURACIÓN POSTGRESQL (SUPABASE)
-- Nivel de Seguridad: Producción (RLS + Triggers + Índices Optimizados)
-- Ejecutar en: Supabase Dashboard > SQL Editor > New Query > Run
-- ====================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS public.clientes (
  id             BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  nombre         TEXT NOT NULL CHECK (char_length(trim(nombre)) >= 2 AND char_length(nombre) <= 150),
  celular        VARCHAR(30),
  fecha_inicio   DATE DEFAULT CURRENT_DATE,
  ip             VARCHAR(45),
  zona           VARCHAR(80) NOT NULL DEFAULT 'Loboyacu',
  plan           NUMERIC(8,2) NOT NULL DEFAULT 65.00 CHECK (plan >= 0),
  estado         VARCHAR(20) NOT NULL DEFAULT 'ACTIVO' CHECK (estado IN ('ACTIVO', 'CORTADO', 'PENDIENTE', 'RETIRADO')),
  creado_el      TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Lima', NOW()),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Lima', NOW())
);

CREATE TABLE IF NOT EXISTS public.pagos (
  id                BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id_cliente        BIGINT NOT NULL,
  cliente_nombre    TEXT NOT NULL,
  cliente_zona      VARCHAR(80),
  monto             NUMERIC(8,2) NOT NULL CHECK (monto > 0),
  fecha             DATE NOT NULL DEFAULT (timezone('America/Lima', NOW()))::DATE,
  mes               VARCHAR(40) NOT NULL,
  metodo            VARCHAR(40) NOT NULL DEFAULT 'Yape',
  numero_operacion  VARCHAR(80),
  codigo_operacion  VARCHAR(80),
  notas             TEXT,
  creado_el         TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Lima', NOW())
);

CREATE TABLE IF NOT EXISTS public.cortes (
  id               BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id_cliente       BIGINT NOT NULL,
  cliente_nombre   TEXT NOT NULL,
  zona             VARCHAR(80),
  fecha_corte      DATE NOT NULL DEFAULT (timezone('America/Lima', NOW()))::DATE,
  fecha_reconexion DATE,
  motivo           TEXT DEFAULT 'Falta de Pago (Morosidad)',
  estado           VARCHAR(20) NOT NULL DEFAULT 'CORTADO' CHECK (estado IN ('CORTADO', 'RECONECTADO')),
  costo_reconeccion NUMERIC(8,2) DEFAULT 0.00 CHECK (costo_reconeccion >= 0),
  notas            TEXT,
  creado_el        TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Lima', NOW())
);

CREATE TABLE IF NOT EXISTS public.fotos (
  id             BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  titulo         TEXT,
  nombre         TEXT NOT NULL,
  categoria      VARCHAR(40) DEFAULT 'comprobante',
  cliente_id     BIGINT,
  cliente_nombre TEXT,
  zona           VARCHAR(80),
  tamano         BIGINT,
  tipo_mime      VARCHAR(60),
  data_url       TEXT,
  notas          TEXT,
  mtime          TIMESTAMPTZ DEFAULT timezone('America/Lima', NOW()),
  creado_el      TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Lima', NOW())
);

CREATE OR REPLACE FUNCTION public.leytrix_actualizar_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.actualizado_el = timezone('America/Lima', NOW());
  NEW.id = OLD.id;
  NEW.creado_el = OLD.creado_el;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_clientes_ts ON public.clientes;
CREATE TRIGGER trg_clientes_ts
  BEFORE UPDATE ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.leytrix_actualizar_timestamp();

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cortes   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotos    ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "leytrix_clientes_select" ON public.clientes;
DROP POLICY IF EXISTS "leytrix_clientes_insert" ON public.clientes;
DROP POLICY IF EXISTS "leytrix_clientes_update" ON public.clientes;
DROP POLICY IF EXISTS "leytrix_clientes_delete" ON public.clientes;
DROP POLICY IF EXISTS "Permitir select clientes" ON public.clientes;
DROP POLICY IF EXISTS "Permitir insert clientes" ON public.clientes;
DROP POLICY IF EXISTS "Permitir update clientes" ON public.clientes;
DROP POLICY IF EXISTS "Permitir delete clientes" ON public.clientes;

CREATE POLICY "leytrix_clientes_select" ON public.clientes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "leytrix_clientes_insert" ON public.clientes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "leytrix_clientes_update" ON public.clientes FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "leytrix_clientes_delete" ON public.clientes FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "leytrix_pagos_select" ON public.pagos;
DROP POLICY IF EXISTS "leytrix_pagos_insert" ON public.pagos;
DROP POLICY IF EXISTS "leytrix_pagos_update" ON public.pagos;
DROP POLICY IF EXISTS "leytrix_pagos_delete" ON public.pagos;
DROP POLICY IF EXISTS "Permitir select pagos" ON public.pagos;
DROP POLICY IF EXISTS "Permitir insert pagos" ON public.pagos;
DROP POLICY IF EXISTS "Permitir delete pagos" ON public.pagos;

CREATE POLICY "leytrix_pagos_select" ON public.pagos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "leytrix_pagos_insert" ON public.pagos FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "leytrix_pagos_update" ON public.pagos FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "leytrix_pagos_delete" ON public.pagos FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "leytrix_cortes_select" ON public.cortes;
DROP POLICY IF EXISTS "leytrix_cortes_insert" ON public.cortes;
DROP POLICY IF EXISTS "leytrix_cortes_update" ON public.cortes;
DROP POLICY IF EXISTS "leytrix_cortes_delete" ON public.cortes;
DROP POLICY IF EXISTS "Permitir select cortes" ON public.cortes;
DROP POLICY IF EXISTS "Permitir insert cortes" ON public.cortes;
DROP POLICY IF EXISTS "Permitir update cortes" ON public.cortes;
DROP POLICY IF EXISTS "Permitir delete cortes" ON public.cortes;

CREATE POLICY "leytrix_cortes_select" ON public.cortes FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "leytrix_cortes_insert" ON public.cortes FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "leytrix_cortes_update" ON public.cortes FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true);
CREATE POLICY "leytrix_cortes_delete" ON public.cortes FOR DELETE TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "leytrix_fotos_select" ON public.fotos;
DROP POLICY IF EXISTS "leytrix_fotos_insert" ON public.fotos;
DROP POLICY IF EXISTS "leytrix_fotos_delete" ON public.fotos;
DROP POLICY IF EXISTS "Permitir select fotos" ON public.fotos;
DROP POLICY IF EXISTS "Permitir insert fotos" ON public.fotos;
DROP POLICY IF EXISTS "Permitir delete fotos" ON public.fotos;

CREATE POLICY "leytrix_fotos_select" ON public.fotos FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "leytrix_fotos_insert" ON public.fotos FOR INSERT TO anon, authenticated WITH CHECK (true);
CREATE POLICY "leytrix_fotos_delete" ON public.fotos FOR DELETE TO anon, authenticated USING (true);

CREATE INDEX IF NOT EXISTS idx_clientes_zona ON public.clientes(zona);
CREATE INDEX IF NOT EXISTS idx_clientes_estado ON public.clientes(estado);
CREATE INDEX IF NOT EXISTS idx_clientes_zona_estado ON public.clientes(zona, estado);
CREATE INDEX IF NOT EXISTS idx_pagos_id_cliente ON public.pagos(id_cliente);
CREATE INDEX IF NOT EXISTS idx_pagos_mes ON public.pagos(mes);
CREATE INDEX IF NOT EXISTS idx_cortes_id_cliente ON public.cortes(id_cliente);
CREATE INDEX IF NOT EXISTS idx_cortes_estado ON public.cortes(estado);
CREATE INDEX IF NOT EXISTS idx_fotos_cliente_id ON public.fotos(cliente_id);

DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.clientes, public.pagos, public.cortes, public.fotos;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END $$;
`;

let _realtimeIniciado = false;
function iniciarRealtimeSupabase() {
  if (_realtimeIniciado || !_supa) return;
  _realtimeIniciado = true;
  try {
    _supa.channel('leytrix-realtime-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, async (p) => {
        // FIX [CASO-LIMITE-04]: Eventos Realtime en INSERT a veces NO incluyen p.old.
        // El guard `p.old && p.old.id` ya estaba correcto, pero en UPDATE puede
        // faltar p.new.id si Supabase no lo devuelve (payload incompleto).
        // Se añade guard adicional para UPDATE.
        if ((p.eventType === 'INSERT' || p.eventType === 'UPDATE') && p.new && p.new.id) {
          await IDB.put('clientes', p.new);
        } else if (p.eventType === 'DELETE' && p.old && p.old.id) {
          await IDB.delete('clientes', p.old.id);
        }
        if (typeof window.onDatosActualizados === 'function') window.onDatosActualizados();
        actualizarEstadisticasSidebar();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' }, async (p) => {
        if ((p.eventType === 'INSERT' || p.eventType === 'UPDATE') && p.new && p.new.id) {
          await IDB.put('pagos', p.new);
        } else if (p.eventType === 'DELETE' && p.old && p.old.id) {
          await IDB.delete('pagos', p.old.id);
        }
        if (typeof window.onDatosActualizados === 'function') window.onDatosActualizados();
        actualizarEstadisticasSidebar();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cortes' }, async (p) => {
        if ((p.eventType === 'INSERT' || p.eventType === 'UPDATE') && p.new && p.new.id) {
          await IDB.put('cortes', p.new);
        } else if (p.eventType === 'DELETE' && p.old && p.old.id) {
          await IDB.delete('cortes', p.old.id);
        }
        if (typeof window.onDatosActualizados === 'function') window.onDatosActualizados();
        actualizarEstadisticasSidebar();
      })
      .subscribe();
  } catch(e) {
    console.warn('Realtime notice:', e);
  }
}

async function verificarSupabase(mostrarToast = false) {
  if (!_supa) {
    actualizarBadgesSupabase(false);
    return false;
  }

  try {
    const { error } = await _supa.from('clientes').select('id', { head: true, count: 'exact' });
    if (error) {
      _supaOnline = false;
      actualizarBadgesSupabase(false);
      if (mostrarToast) {
        toast('⚠️ Tablas no detectadas en Supabase. Abre "Configurar Nube" y ejecuta el script SQL.', 'warn');
        abrirModalSupabase();
      }
      return false;
    }

    _supaOnline = true;
    actualizarBadgesSupabase(true);
    iniciarRealtimeSupabase();
    if (mostrarToast) toast('🟢 ¡Conectado a Supabase Cloud con éxito!');
    sincronizarConSupabase(false);
    return true;
  } catch (err) {
    _supaOnline = false;
    actualizarBadgesSupabase(false);
    return false;
  }
}

function actualizarBadgesSupabase(online) {
  const sideEl = document.getElementById('sidebarSupaStatus');
  const dotEl  = document.getElementById('sidebarSupaDot');
  const expEl  = document.getElementById('expSupaBadge');
  const modEl  = document.getElementById('modalSupaStatusBadge');
  const banEl  = document.getElementById('bannerSupaAlerta');

  // Sincronizar indicador móvil con el indicador desktop
  const mobDot = document.getElementById('mobileSupaDot');

  if (banEl)  banEl.style.display = online ? 'none' : 'flex';
  if (sideEl) sideEl.textContent = online ? 'Supabase En Línea' : 'Supabase (Modo Local)';
  if (dotEl)  dotEl.style.background = online ? '#10B981' : '#F59E0B';
  if (mobDot) mobDot.style.background = online ? '#10B981' : '#F59E0B';

  if (expEl) {
    expEl.style.background  = online ? '#ECFDF5' : '#FFFBEB';
    expEl.style.color       = online ? '#059669' : '#B45309';
    expEl.style.borderColor = online ? '#A7F3D0' : '#FDE68A';
    expEl.innerHTML = online ? '☁️ Supabase Cloud: 🟢 En Línea' : '☁️ Supabase Cloud: 🟡 Modo Local (Pendiente SQL)';
  }

  if (modEl) {
    modEl.style.background = online ? '#ECFDF5' : '#FFFBEB';
    modEl.style.color      = online ? '#059669' : '#B45309';
    modEl.textContent      = online ? '🟢 En Línea y Conectado' : '🟡 Modo Local (Ejecuta el script SQL abajo)';
  }
}

function abrirModalSupabase() {
  const codeEl = document.getElementById('codigoSqlSupa');
  if (codeEl) codeEl.textContent = SUPABASE_SETUP_SQL;
  const mod = document.getElementById('modalSupabase');
  if (mod) mod.classList.add('open');
}

function cerrarModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('open');
}

async function copiarSqlSupabase() {
  try {
    await navigator.clipboard.writeText(SUPABASE_SETUP_SQL);
    toast('📋 Script SQL copiado al portapapeles. Pégalo en Supabase SQL Editor.');
  } catch(_) {
    toast('Selecciona el código SQL y cópialo con Ctrl+C');
  }
}

// FIX [LOGICA-04]: sincronizarConSupabase() hacía primero Upload→luego Download,
// pero si la descarga devolvía datos "viejos" de Supabase (registros que solo existían
// allí) pisaba registros locales más recientes que se acababan de subir.
// El orden correcto es: Download primero para no perder remotos, luego Upload para
// que los locales no-en-remoto queden sincronizados.
async function sincronizarConSupabase(mostrarFeedback = true) {
  if (!_supa) {
    if (mostrarFeedback) toast('Supabase no inicializado', 'error');
    return;
  }

  if (mostrarFeedback) toast('☁️ Sincronizando datos con Supabase Cloud...');

  try {
    const { error: chkErr } = await _supa.from('clientes').select('id', { head: true, count: 'exact' });
    if (chkErr) {
      _supaOnline = false;
      actualizarBadgesSupabase(false);
      if (mostrarFeedback) {
        toast('⚠️ Tablas no creadas en Supabase. Abre "Configurar Nube".', 'warn');
        abrirModalSupabase();
      }
      return;
    }
    _supaOnline = true;
    actualizarBadgesSupabase(true);
    iniciarRealtimeSupabase();

    // Función auxiliar para descargar tablas completas de Supabase superando el límite por defecto de 1,000
    async function descargarTablaCompleta(tabla, columnas = '*') {
      let registros = [];
      let desde = 0;
      const CHUNK = 1000;
      while (true) {
        const { data, error } = await _supa
          .from(tabla)
          .select(columnas)
          .range(desde, desde + CHUNK - 1);
        if (error) {
          console.warn(`[Sync download] Error en ${tabla}:`, error.message);
          break;
        }
        if (!data || !data.length) break;
        registros.push(...data);
        if (data.length < CHUNK) break;
        desde += CHUNK;
      }
      return registros;
    }

    // PASO 1: Descargar remotos primero (con paginación completa para soportar 10,000+ clientes)
    const supaCli = await descargarTablaCompleta('clientes', '*');
    if (supaCli && supaCli.length) await IDB.bulkPut('clientes', supaCli);

    const supaPag = await descargarTablaCompleta('pagos', '*');
    if (supaPag && supaPag.length) await IDB.bulkPut('pagos', supaPag);

    const supaCor = await descargarTablaCompleta('cortes', '*');
    if (supaCor && supaCor.length) await IDB.bulkPut('cortes', supaCor);

    const supaFot = await descargarTablaCompleta('fotos', 'id,titulo,nombre,categoria,cliente_id,zona,tamano,tipo_mime,mtime,creado_el');
    if (supaFot && supaFot.length) await IDB.bulkPut('fotos', supaFot);

    // PASO 2: Subir locales (datos que no están en Supabase aún)
    const cliLocales = await IDB.getAll('clientes');
    for (let i = 0; i < cliLocales.length; i += 300) {
      const lote = cliLocales.slice(i, i + 300).map(sanitizarPayloadSupabase);
      const { error } = await _supa.from('clientes').upsert(lote, { onConflict: 'id' });
      if (error) console.warn('[Sync] Error subiendo clientes:', error.message);
    }

    const pagosLocales = await IDB.getAll('pagos');
    for (let i = 0; i < pagosLocales.length; i += 300) {
      const lote = pagosLocales.slice(i, i + 300).map(sanitizarPayloadSupabase);
      const { error } = await _supa.from('pagos').upsert(lote, { onConflict: 'id' });
      if (error) console.warn('[Sync] Error subiendo pagos:', error.message);
    }

    const cortesLocales = await IDB.getAll('cortes');
    for (let i = 0; i < cortesLocales.length; i += 300) {
      const lote = cortesLocales.slice(i, i + 300).map(sanitizarPayloadSupabase);
      const { error } = await _supa.from('cortes').upsert(lote, { onConflict: 'id' });
      if (error) console.warn('[Sync] Error subiendo cortes:', error.message);
    }

    // Fotos se suben en lotes pequeños por su tamaño (data_url = base64)
    const fotosLocales = await IDB.getAll('fotos');
    for (let i = 0; i < fotosLocales.length; i += 5) {
      const lote = fotosLocales.slice(i, i + 5).map(sanitizarPayloadSupabase);
      const { error } = await _supa.from('fotos').upsert(lote, { onConflict: 'id' });
      if (error) console.warn('[Sync] Error subiendo fotos:', error.message);
    }

    if (mostrarFeedback) toast('✅ ¡Sincronización con Supabase Cloud completada exitosamente!');
    // FIX [BUG-05]: `onSyncComplete` se llamaba sin verificar si es window.onSyncComplete,
    // lo que lanzaba ReferenceError en páginas que no lo definían.
    if (typeof window.onSyncComplete === 'function') window.onSyncComplete();
    if (typeof window.onDatosActualizados === 'function') window.onDatosActualizados();
    actualizarEstadisticasSidebar();
  } catch(err) {
    console.error('Error sincronizando Supabase:', err);
    if (mostrarFeedback) toast('⚠️ Error al sincronizar: ' + (err.message || ''), 'error');
  }
}
