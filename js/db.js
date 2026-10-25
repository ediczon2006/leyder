// ========================================================
//  LEYTRIX ISP — CAPA DE DATOS HÍBRIDA (IndexedDB + Supabase) — v3
//  - Almacenamiento local ultrarrápido (funciona 100% offline)
//  - Sincronización en la nube con Supabase
//  - Compartido entre todas las páginas del sistema
//
//  CAMBIOS v3 (resumen):
//  1. La base local se AUTO-REPARA: si falta un almacén o índice, sube la
//     versión sola (arregla "One of the specified object stores was not found").
//  2. La sincronización ya no sube de nuevo lo que acaba de descargar,
//     ni pisa las fotos locales (data_url) con registros sin imagen.
//  3. Realtime y descargas usan escritura LOCAL (sin rebote hacia Supabase).
//  4. Capa de login opcional con Supabase Auth (REQUIRE_AUTH).
//  5. Políticas SQL corregidas (fotos ahora tiene UPDATE, necesario para upsert).
//
//  ADICIONES (solo se agregó, no se cambió nada existente):
//  [CABLE] campo cable (+S/. 10): sanitizador y columna en el SQL de Supabase.
//  [ORDEN] IDB.query acepta { orden: 'next' } para listar de menor a mayor ID.
// ========================================================

const ZONAS   = ['Loboyacu', 'Huayranga', 'Pacotillo', 'Ramal de Cachiyacu', 'Palmeras', 'Shishiyacu'];
const PLANES  = [50, 60, 65];
const ESTADOS = ['ACTIVO', 'CORTADO', 'PENDIENTE', 'RETIRADO'];

// [SEGURIDAD]: La clave "anon" es pública por diseño (viaja al navegador).
// Lo que protege los datos son las políticas RLS. Con REQUIRE_AUTH = false las
// políticas dejan entrar a cualquiera que tenga la clave. Para proteger los
// datos: crea tu usuario en Supabase, ejecuta supabase_seguridad.sql,
// desactiva los registros públicos y cambia REQUIRE_AUTH a true.
const REQUIRE_AUTH = false;

const SUPA_URL = 'https://nbgysgbizjyndcqsvvea.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5iZ3lzZ2Jpemp5bmRjcXN2dmVhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI5NDYxNDAsImV4cCI6MjEwODUyMjE0MH0.6rTUz8JnqJe5Xh6_tugBKE-UmqT0zthnyTGEXlVJzh0';

let _supa = null;
let _supaOnline = false;

try {
  if (typeof supabase !== 'undefined' && supabase.createClient) {
    _supa = supabase.createClient(SUPA_URL, SUPA_KEY, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
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
  // [CABLE] Siempre booleano para la columna BOOLEAN de Supabase
  if ('cable' in copia) {
    copia.cable = copia.cable === true || copia.cable === 'true' || copia.cable === 1;
  }
  return copia;
}

// ══ ESQUEMA LOCAL (única fuente de verdad) ════════════════
const DB_NAME = 'leytrix_isp_v1';
const DB_VER  = 3;

const ESQUEMA = {
  clientes: [['zona', 'zona'], ['estado', 'estado'], ['plan', 'plan'], ['zona_estado', ['zona', 'estado']]],
  pagos:    [['id_cliente', 'id_cliente'], ['mes', 'mes'], ['cli_mes', ['id_cliente', 'mes']]],
  cortes:   [['id_cliente', 'id_cliente'], ['estado', 'estado']],
  fotos:    [['categoria', 'categoria'], ['cliente_id', 'cliente_id'], ['zona', 'zona']]
};

function refrescarUI() {
  if (typeof window.onDatosActualizados === 'function') window.onDatosActualizados();
  if (typeof actualizarEstadisticasSidebar === 'function') actualizarEstadisticasSidebar();
}

const IDB = (() => {
  let _db = null;
  let _dbPromise = null;

  // Crea los almacenes e índices que falten (se usa dentro de onupgradeneeded)
  function asegurarEsquema(database, tx) {
    for (const [nombre, indices] of Object.entries(ESQUEMA)) {
      const store = database.objectStoreNames.contains(nombre)
        ? tx.objectStore(nombre)
        : database.createObjectStore(nombre, { keyPath: 'id', autoIncrement: true });
      for (const [idxNombre, idxClave] of indices) {
        if (!store.indexNames.contains(idxNombre)) {
          store.createIndex(idxNombre, idxClave, { unique: false });
        }
      }
    }
  }

  // ¿Falta algún almacén o índice en la base actual?
  function esquemaIncompleto(database) {
    for (const [nombre, indices] of Object.entries(ESQUEMA)) {
      if (!database.objectStoreNames.contains(nombre)) return true;
      const store = database.transaction([nombre], 'readonly').objectStore(nombre);
      for (const [idxNombre] of indices) {
        if (!store.indexNames.contains(idxNombre)) return true;
      }
    }
    return false;
  }

  function abrir(version) {
    return new Promise((resolve, reject) => {
      const req = version ? indexedDB.open(DB_NAME, version) : indexedDB.open(DB_NAME);
      req.onupgradeneeded = e => asegurarEsquema(e.target.result, e.target.transaction);
      req.onsuccess = e => {
        const conn = e.target.result;
        // Si otra pestaña necesita actualizar la base, ésta se cierra y se reabre sola
        conn.onversionchange = () => { conn.close(); _db = null; _dbPromise = null; };
        resolve(conn);
      };
      req.onerror = e => reject(e.target.error);
      req.onblocked = () => {
        console.warn('[IDB] Actualización en espera: cierra otras pestañas abiertas del sistema.');
      };
    });
  }

  async function conectar() {
    let conn;
    try {
      conn = await abrir(DB_VER);
    } catch (err) {
      // La base local ya tiene una versión mayor: abrirla tal cual está
      if (err && err.name === 'VersionError') conn = await abrir();
      else throw err;
    }
    if (esquemaIncompleto(conn)) {
      const nuevaVersion = conn.version + 1;
      conn.close();
      conn = await abrir(nuevaVersion);
    }
    return conn;
  }

  function db() {
    if (_db) return Promise.resolve(_db);
    if (!_dbPromise) {
      _dbPromise = conectar()
        .then(conn => { _db = conn; return conn; })
        .catch(err => { _dbPromise = null; throw err; });
    }
    return _dbPromise;
  }

  // Claves candidatas para un id (número y/o texto)
  function clavesDe(id) {
    const n = Number(id);
    return (Number.isFinite(n) && n > 0) ? [n, String(id)] : [String(id)];
  }

  // Sube un registro a Supabase (si hay conexión). Nunca lanza error.
  async function subir(store, data) {
    if (!_supa) return;
    try {
      const { error } = await _supa.from(store).upsert(sanitizarPayloadSupabase(data), { onConflict: 'id' });
      if (error) {
        console.warn(`[Supabase upsert] Error en ${store}:`, error.message);
      } else {
        _supaOnline = true;
        actualizarBadgesSupabase(true);
      }
    } catch (err) {
      console.warn(`[Supabase upsert] Excepción en ${store}:`, err);
    }
  }

  function borrarPorIndice(tx, nombreStore, nombreIndice, valores) {
    const st = tx.objectStore(nombreStore);
    if (!st.indexNames.contains(nombreIndice)) return;
    const idx = st.index(nombreIndice);
    valores.forEach(v => {
      const req = idx.openKeyCursor(IDBKeyRange.only(v));
      req.onsuccess = e => {
        const c = e.target.result;
        if (c) { st.delete(c.primaryKey); c.continue(); }
      };
    });
  }

  return {
    // ── Escritura SOLO local (sin tocar Supabase) ──────────
    async addLocal(store, data) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx  = d.transaction([store], 'readwrite');
        const req = tx.objectStore(store).add(data);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
      });
    },

    async putLocal(store, data) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx  = d.transaction([store], 'readwrite');
        const req = tx.objectStore(store).put(data);
        req.onsuccess = e => resolve(e.target.result);
        req.onerror   = e => reject(e.target.error);
      });
    },

    async deleteLocal(store, id) {
      if (id === null || id === undefined || id === '') return;
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx = d.transaction([store], 'readwrite');
        const st = tx.objectStore(store);
        clavesDe(id).forEach(k => st.delete(k));
        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error);
        tx.onabort = e => reject(e.target.error);
      });
    },

    // ── Escritura local + nube ─────────────────────────────
    async add(store, data) {
      if (!data || typeof data !== 'object') throw new Error(`[IDB.add] dato inválido en store "${store}"`);
      const id = await this.addLocal(store, data);
      await subir(store, { ...data, id });
      return id;
    },

    async put(store, data) {
      if (!data || typeof data !== 'object') throw new Error(`[IDB.put] dato inválido en store "${store}"`);
      if (data.id === undefined || data.id === null) {
        console.warn(`[IDB.put] Llamado sin 'id' en store "${store}". Se usará add() en su lugar.`);
        return this.add(store, data);
      }
      const id = await this.putLocal(store, data);
      await subir(store, data);
      return id;
    },

    async delete(store, id) {
      if (id === null || id === undefined || id === '') return;
      await this.deleteLocal(store, id);
      if (_supa) {
        try {
          const n = Number(id);
          const targetId = (Number.isFinite(n) && n > 0) ? n : String(id);
          const { error } = await _supa.from(store).delete().eq('id', targetId);
          if (error) console.warn(`[Supabase delete] Error en ${store}:`, error.message);
        } catch (err) {
          console.warn(`[Supabase delete] Excepción en ${store}:`, err);
        }
      }
    },

    // ── Lectura ────────────────────────────────────────────
    // Obtener por ID (soporta claves numéricas y strings)
    async get(store, id) {
      if (id === null || id === undefined || id === '') return null;
      const d = await db();
      return new Promise((resolve) => {
        const st = d.transaction([store], 'readonly').objectStore(store);
        const claves = clavesDe(id);

        const intentar = (i) => {
          if (i >= claves.length) { resolve(null); return; }
          let req;
          try { req = st.get(claves[i]); } catch (_) { intentar(i + 1); return; }
          req.onsuccess = e => {
            if (e.target.result) resolve(e.target.result);
            else intentar(i + 1);
          };
          req.onerror = () => intentar(i + 1);
        };
        intentar(0);
      });
    },

    // Conteo total O(1)
    async count(store) {
      const d = await db();
      return new Promise((resolve) => {
        const req = d.transaction([store], 'readonly').objectStore(store).count();
        req.onsuccess = e => resolve(e.target.result || 0);
        req.onerror   = () => resolve(0);
      });
    },

    // Conteo por índice O(1)
    async countByIndex(store, idx, key) {
      const d = await db();
      return new Promise((resolve) => {
        try {
          const index = d.transaction([store], 'readonly').objectStore(store).index(idx);
          const req   = index.count(IDBKeyRange.only(key));
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
        const st  = d.transaction([store], 'readonly').objectStore(store);
        const req = count ? st.getAll(null, count) : st.getAll();
        req.onsuccess = e => resolve(e.target.result || []);
        req.onerror   = e => reject(e.target.error);
      });
    },

    // Obtener por índice
    async getByIndex(store, idx, key, count = null) {
      const d = await db();
      return new Promise((resolve, reject) => {
        try {
          const index = d.transaction([store], 'readonly').objectStore(store).index(idx);
          const range = IDBKeyRange.only(key);
          const req   = count ? index.getAll(range, count) : index.getAll(range);
          req.onsuccess = e => resolve(e.target.result || []);
          req.onerror   = e => reject(e.target.error);
        } catch (_) {
          resolve([]);
        }
      });
    },

    // Guardado masivo por lotes. { remoto: false } = solo local (para descargas)
    async bulkPut(store, items, { remoto = true } = {}) {
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
          tx.onabort = e => reject(e.target.error);
        });

        if (remoto && _supa) {
          try {
            const { error } = await _supa.from(store).upsert(chunk.map(sanitizarPayloadSupabase), { onConflict: 'id' });
            if (error) console.warn(`[Supabase bulkPut] ${store}:`, error.message);
          } catch (err) {
            console.warn(`[Supabase bulkPut] ${store}:`, err);
          }
        }
      }
      return ok;
    },

    // Consulta paginada y filtrada — optimizada para 10,000+ clientes
    // [ORDEN] Parámetro nuevo opcional: orden = 'prev' (por defecto, como siempre: más nuevo primero)
    //         o 'next' (de menor a mayor ID).
    async query(store, { indexName = null, range = null, filter = null, limit = 50, offset = 0, orden = 'prev' } = {}) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const st     = d.transaction([store], 'readonly').objectStore(store);
        const source = indexName ? st.index(indexName) : st;

        // Recorrido completo con filtro JS (búsqueda por texto)
        function ejecutarCursorCompleto() {
          const req = source.openCursor(range, orden);
          const results = [];
          let skipped = 0;
          let totalFiltrado = 0;

          req.onsuccess = e => {
            const cursor = e.target.result;
            if (!cursor) { resolve({ results, total: totalFiltrado }); return; }
            const val = cursor.value;
            if (!filter || filter(val)) {
              totalFiltrado++;
              if (skipped < offset) skipped++;
              else if (results.length < limit) results.push(val);
            }
            cursor.continue();
          };
          req.onerror = e => reject(e.target.error);
        }

        // Ruta rápida: sin filtro, conteo O(1) y salto directo con advance()
        if (!filter) {
          const countReq = source.count(range);
          countReq.onsuccess = () => {
            const total = countReq.result || 0;
            if (total === 0 || offset >= total) { resolve({ results: [], total }); return; }

            const results = [];
            const req = source.openCursor(range, orden);
            let advanced = false;

            req.onsuccess = e => {
              const cursor = e.target.result;
              if (!cursor) { resolve({ results, total }); return; }
              if (offset > 0 && !advanced) {
                advanced = true;
                cursor.advance(offset);
                return;
              }
              results.push(cursor.value);
              if (results.length >= limit) { resolve({ results, total }); return; }
              cursor.continue();
            };
            req.onerror = e => reject(e.target.error);
          };
          countReq.onerror = () => ejecutarCursorCompleto();
          return;
        }

        ejecutarCursorCompleto();
      });
    },

    // Búsqueda rápida de clientes para selects (con límite temprano)
    async buscarClientesRapido(termino = '', { limit = 30, soloActivos = false } = {}) {
      const s = String(termino || '').toLowerCase().trim();
      const d = await db();
      return new Promise((resolve) => {
        const req = d.transaction(['clientes'], 'readonly').objectStore('clientes').openCursor(null, 'prev');
        const encontrados = [];

        req.onsuccess = e => {
          const cursor = e.target.result;
          if (!cursor || encontrados.length >= limit) { resolve(encontrados); return; }
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

    // Descarga bajo demanda la imagen (data_url) de una foto que solo existe en la nube
    async cargarFotoRemota(id) {
      const local = await this.get('fotos', id);
      if (local && local.data_url) return local;
      if (!_supa) return local;
      try {
        const { data, error } = await _supa.from('fotos').select('*').eq('id', id).single();
        if (error || !data) return local;
        await this.putLocal('fotos', data);
        return data;
      } catch (_) {
        return local;
      }
    },

    // Eliminación atómica en cascada — local y nube
    async eliminarClienteCompleto(id) {
      if (id === null || id === undefined || id === '') {
        throw new Error('[eliminarClienteCompleto] ID inválido: ' + id);
      }
      const claves = clavesDe(id);
      const d = await db();

      // 1. Borrado atómico en IndexedDB
      await new Promise((resolve, reject) => {
        const tx = d.transaction(['clientes', 'pagos', 'cortes', 'fotos'], 'readwrite');
        const cli = tx.objectStore('clientes');
        claves.forEach(k => cli.delete(k));
        borrarPorIndice(tx, 'pagos',  'id_cliente', claves);
        borrarPorIndice(tx, 'cortes', 'id_cliente', claves);
        borrarPorIndice(tx, 'fotos',  'cliente_id', claves);
        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error || new Error('Error al eliminar en IndexedDB'));
        tx.onabort = e => reject(e.target.error || new Error('Eliminación cancelada'));
      });

      // 2. Borrado remoto (evita que el cliente "resucite" en la sincronización)
      if (_supa) {
        const targetId = claves[0];
        const res = await Promise.allSettled([
          _supa.from('pagos').delete().eq('id_cliente', targetId),
          _supa.from('cortes').delete().eq('id_cliente', targetId),
          _supa.from('fotos').delete().eq('cliente_id', targetId),
          _supa.from('clientes').delete().eq('id', targetId)
        ]);
        res.forEach(r => {
          if (r.status === 'rejected') console.warn('[Supabase eliminarClienteCompleto]:', r.reason);
          else if (r.value && r.value.error) console.warn('[Supabase eliminarClienteCompleto]:', r.value.error.message);
        });
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

// Legacy: el campo 'cable' ya no existe; se conserva por compatibilidad con registros viejos.
// [CABLE] Nota: el campo 'cable' (+S/. 10) vuelve a usarse desde clientes.html y agregar.html.
function badgeCable(c) {
  return c ? '<span style="color:var(--verde);font-weight:700">✅ Cable</span>' : '<span style="color:var(--gris)">❌ Sin cable</span>';
}

let _toastTimer = null;
function toast(msg, tipo = 'success') {
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

// ══ LOGIN OPCIONAL (Supabase Auth) ══════════════════════
const Auth = {
  async sesion() {
    if (!_supa) return null;
    try {
      const { data } = await _supa.auth.getSession();
      return (data && data.session) || null;
    } catch (_) {
      return null;
    }
  },
  async login(email, password) {
    if (!_supa) throw new Error('Supabase no disponible');
    const { data, error } = await _supa.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data.session;
  },
  async logout() {
    if (_supa) await _supa.auth.signOut();
    location.reload();
  }
};
if (typeof window !== 'undefined') window.Auth = Auth;

function mostrarLogin() {
  return new Promise(resolve => {
    if (document.getElementById('leytrixLogin')) return;
    const campo = 'width:100%;box-sizing:border-box;padding:12px;margin-bottom:10px;border:1px solid #CBD5E1;border-radius:10px;font-size:15px';
    const ov = document.createElement('div');
    ov.id = 'leytrixLogin';
    ov.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#0F172A;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,sans-serif';
    ov.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:28px;width:100%;max-width:360px;box-shadow:0 20px 60px rgba(0,0,0,.4)">
        <h2 style="margin:0 0 4px;font-size:22px;color:#0F172A">Leytrix ISP</h2>
        <p style="margin:0 0 18px;color:#64748B;font-size:14px">Inicia sesión para continuar</p>
        <input id="lgEmail" type="email" placeholder="Correo" autocomplete="username" style="${campo}">
        <input id="lgPass" type="password" placeholder="Contraseña" autocomplete="current-password" style="${campo}">
        <div id="lgError" style="color:#DC2626;font-size:13px;min-height:18px;margin-bottom:8px"></div>
        <button id="lgBtn" style="width:100%;padding:12px;border:0;border-radius:10px;background:#2563EB;color:#fff;font-size:15px;font-weight:700;cursor:pointer">Entrar</button>
      </div>`;
    document.body.appendChild(ov);

    const emailEl = ov.querySelector('#lgEmail');
    const passEl  = ov.querySelector('#lgPass');
    const errEl   = ov.querySelector('#lgError');
    const btn     = ov.querySelector('#lgBtn');

    const entrar = async () => {
      errEl.textContent = '';
      btn.disabled = true;
      btn.textContent = 'Entrando...';
      try {
        await Auth.login(emailEl.value.trim(), passEl.value);
        ov.remove();
        resolve(true);
      } catch (err) {
        errEl.textContent = 'Correo o contraseña incorrectos.';
        btn.disabled = false;
        btn.textContent = 'Entrar';
      }
    };
    btn.addEventListener('click', entrar);
    passEl.addEventListener('keydown', e => { if (e.key === 'Enter') entrar(); });
    emailEl.focus();
  });
}

async function exigirLogin() {
  if (!REQUIRE_AUTH || !_supa) return true;
  const s = await Auth.sesion();
  if (!s) await mostrarLogin();
  verificarSupabase(false);
  return true;
}

if (REQUIRE_AUTH && _supa && typeof document !== 'undefined') {
  _supa.auth.onAuthStateChange(ev => { if (ev === 'SIGNED_OUT') location.reload(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', exigirLogin);
  else exigirLogin();
}

// ══ SQL DE CONFIGURACIÓN (se muestra en el modal "Configurar Nube") ═════
const _ROL_RLS = REQUIRE_AUTH ? 'authenticated' : 'anon, authenticated';

function _sqlPoliticas(tabla) {
  const drops = ['select', 'insert', 'update', 'delete'].map(op =>
    `DROP POLICY IF EXISTS "leytrix_${tabla}_${op}" ON public.${tabla};\n` +
    `DROP POLICY IF EXISTS "Permitir ${op} ${tabla}" ON public.${tabla};`
  ).join('\n');
  return `${drops}
CREATE POLICY "leytrix_${tabla}_select" ON public.${tabla} FOR SELECT TO ${_ROL_RLS} USING (true);
CREATE POLICY "leytrix_${tabla}_insert" ON public.${tabla} FOR INSERT TO ${_ROL_RLS} WITH CHECK (true);
CREATE POLICY "leytrix_${tabla}_update" ON public.${tabla} FOR UPDATE TO ${_ROL_RLS} USING (true) WITH CHECK (true);
CREATE POLICY "leytrix_${tabla}_delete" ON public.${tabla} FOR DELETE TO ${_ROL_RLS} USING (true);
`;
}

const SUPABASE_SETUP_SQL = `-- ====================================================================
-- LEYTRIX ISP — SCRIPT DE CONFIGURACIÓN POSTGRESQL (SUPABASE)
-- Ejecutar en: Supabase Dashboard > SQL Editor > New Query > Run
-- Acceso de las políticas: ${_ROL_RLS}
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
  cable          BOOLEAN NOT NULL DEFAULT false,
  creado_el      TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Lima', NOW()),
  actualizado_el TIMESTAMPTZ NOT NULL DEFAULT timezone('America/Lima', NOW())
);

-- [CABLE] Para bases ya creadas: agrega la columna cable (+S/. 10) si falta
ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS cable BOOLEAN NOT NULL DEFAULT false;

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

${_sqlPoliticas('clientes')}
${_sqlPoliticas('pagos')}
${_sqlPoliticas('cortes')}
${_sqlPoliticas('fotos')}
CREATE INDEX IF NOT EXISTS idx_clientes_zona ON public.clientes(zona);
CREATE INDEX IF NOT EXISTS idx_clientes_estado ON public.clientes(estado);
CREATE INDEX IF NOT EXISTS idx_clientes_zona_estado ON public.clientes(zona, estado);
CREATE INDEX IF NOT EXISTS idx_pagos_id_cliente ON public.pagos(id_cliente);
CREATE INDEX IF NOT EXISTS idx_pagos_mes ON public.pagos(mes);
CREATE INDEX IF NOT EXISTS idx_cortes_id_cliente ON public.cortes(id_cliente);
CREATE INDEX IF NOT EXISTS idx_cortes_estado ON public.cortes(estado);
CREATE INDEX IF NOT EXISTS idx_fotos_cliente_id ON public.fotos(cliente_id);

-- Realtime: cada tabla por separado (si una ya estaba, no afecta a las demás)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['clientes','pagos','cortes','fotos'] LOOP
    BEGIN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END LOOP;
END $$;
`;

// ══ REALTIME ════════════════════════════════════════════
let _realtimeIniciado = false;

async function _aplicarCambioRealtime(tabla, p) {
  // Escritura LOCAL: evita que el cambio rebote de vuelta a Supabase
  if ((p.eventType === 'INSERT' || p.eventType === 'UPDATE') && p.new && p.new.id !== undefined) {
    await IDB.putLocal(tabla, p.new);
  } else if (p.eventType === 'DELETE' && p.old && p.old.id !== undefined) {
    await IDB.deleteLocal(tabla, p.old.id);
  }
  refrescarUI();
}

function iniciarRealtimeSupabase() {
  if (_realtimeIniciado || !_supa) return;
  _realtimeIniciado = true;
  try {
    _supa.channel('leytrix-realtime-all')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'clientes' }, p => _aplicarCambioRealtime('clientes', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pagos' },    p => _aplicarCambioRealtime('pagos', p))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cortes' },   p => _aplicarCambioRealtime('cortes', p))
      .subscribe();
  } catch (e) {
    console.warn('Realtime notice:', e);
  }
}

// ══ VERIFICACIÓN Y SINCRONIZACIÓN SUPABASE ══════════════
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
  } catch (_) {
    toast('Selecciona el código SQL y cópialo con Ctrl+C');
  }
}

// Sincronización: 1) descarga remotos → local (sin rebote)  2) sube SOLO lo que
// existe en local y aún no está en la nube. (Lo descargado ya es idéntico al remoto,
// por eso volver a subirlo era trabajo inútil.)
let _sincronizando = false;

async function sincronizarConSupabase(mostrarFeedback = true) {
  if (!_supa) {
    if (mostrarFeedback) toast('Supabase no inicializado', 'error');
    return;
  }
  if (_sincronizando) return;
  _sincronizando = true;

  if (mostrarFeedback) toast('☁️ Sincronizando datos con Supabase Cloud...');

  let errores = 0;

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

    // Descarga tablas completas superando el límite de 1,000 filas (con orden estable)
    async function descargarTablaCompleta(tabla, columnas = '*') {
      const registros = [];
      let desde = 0;
      const CHUNK = 1000;
      while (true) {
        const { data, error } = await _supa
          .from(tabla)
          .select(columnas)
          .order('id', { ascending: true })
          .range(desde, desde + CHUNK - 1);
        if (error) {
          console.warn(`[Sync download] Error en ${tabla}:`, error.message);
          errores++;
          break;
        }
        if (!data || !data.length) break;
        registros.push(...data);
        if (data.length < CHUNK) break;
        desde += CHUNK;
      }
      return registros;
    }

    // Sube a Supabase los registros locales que no existen en la nube
    async function subirFaltantes(tabla, remotos, tamLote, filtro = null) {
      const idsRemotos = new Set(remotos.map(r => String(r.id)));
      let locales = (await IDB.getAll(tabla)).filter(l => !idsRemotos.has(String(l.id)));
      if (filtro) locales = locales.filter(filtro);
      for (let i = 0; i < locales.length; i += tamLote) {
        const lote = locales.slice(i, i + tamLote).map(sanitizarPayloadSupabase);
        const { error } = await _supa.from(tabla).upsert(lote, { onConflict: 'id' });
        if (error) { console.warn(`[Sync] Error subiendo ${tabla}:`, error.message); errores++; }
      }
    }

    // PASO 1: descargar (solo escritura local)
    const supaCli = await descargarTablaCompleta('clientes');
    const supaPag = await descargarTablaCompleta('pagos');
    const supaCor = await descargarTablaCompleta('cortes');
    const supaFot = await descargarTablaCompleta('fotos', 'id,titulo,nombre,categoria,cliente_id,cliente_nombre,zona,tamano,tipo_mime,notas,mtime,creado_el');

    if (supaCli.length) await IDB.bulkPut('clientes', supaCli, { remoto: false });
    if (supaPag.length) await IDB.bulkPut('pagos',    supaPag, { remoto: false });
    if (supaCor.length) await IDB.bulkPut('cortes',   supaCor, { remoto: false });

    // Fotos: no pisar las locales (tienen data_url); solo agregar las que faltan
    if (supaFot.length) {
      const idsLocales = new Set((await IDB.getAll('fotos')).map(f => String(f.id)));
      const nuevas = supaFot.filter(f => !idsLocales.has(String(f.id)));
      if (nuevas.length) await IDB.bulkPut('fotos', nuevas, { remoto: false });
    }

    // PASO 2: subir lo que solo existe en local
    await subirFaltantes('clientes', supaCli, 300);
    await subirFaltantes('pagos',    supaPag, 300);
    await subirFaltantes('cortes',   supaCor, 300);
    await subirFaltantes('fotos',    supaFot, 5, f => !!f.data_url); // base64 pesado: lotes pequeños

    if (mostrarFeedback) {
      if (errores) toast(`⚠️ Sincronización terminada con ${errores} aviso(s). Revisa la consola (F12).`, 'warn');
      else toast('✅ ¡Sincronización con Supabase Cloud completada exitosamente!');
    }
    if (typeof window.onSyncComplete === 'function') window.onSyncComplete();
    refrescarUI();
  } catch (err) {
    console.error('Error sincronizando Supabase:', err);
    if (mostrarFeedback) toast('⚠️ Error al sincronizar: ' + (err.message || ''), 'error');
  } finally {
    _sincronizando = false;
  }
}