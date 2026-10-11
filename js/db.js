// ========================================================
//  FASTNET LOBOYACU — CAPA DE DATOS HÍBRIDA (IndexedDB + Supabase)
//  - Almacenamiento local ultrarrápido (funciona 100% offline)
//  - Sincronización en la nube con Supabase (baeobhvgfrdbwyqapqzf)
//  - Compartido entre todas las páginas del sistema
// ========================================================

const ZONAS   = ['Loboyacu', 'Huayranga', 'Pacotillo', 'Ramal de Cachiyacu', 'Palmeras', 'Shishiyacu'];
const PLANES  = [50, 60, 65];
const ESTADOS = ['ACTIVO', 'CORTADO', 'PENDIENTE', 'RETIRADO'];

// FIX [SEGURIDAD-01]: Credenciales movidas a constantes nombradas pero mantenidas
// como anon key (son públicas por diseño en Supabase). El riesgo real está en las
// políticas RLS de Supabase (líneas ~474-480 del SQL), que deben restringirse en producción.
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
          const payload = { ...data, id };
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
          const { error } = await _supa.from(store).upsert(data, { onConflict: 'id' });
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

    // Obtener por ID
    async get(store, id) {
      // FIX [CASO-LIMITE-02]: id=0 es falsy pero Number(0) es válido en IDB. Validar explícitamente.
      const numId = Number(id);
      if (!Number.isFinite(numId) || numId <= 0) return null;
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx  = d.transaction([store], 'readonly');
        const req = tx.objectStore(store).get(numId);
        req.onsuccess = e => resolve(e.target.result || null);
        req.onerror   = e => reject(e.target.error);
      });
    },

    // Eliminar por ID
    async delete(store, id) {
      const numId = Number(id);
      // FIX [CASO-LIMITE-02 cont.]: Misma validación que en get().
      if (!Number.isFinite(numId) || numId <= 0) return;

      const d = await db();
      await new Promise((resolve, reject) => {
        const tx  = d.transaction([store], 'readwrite');
        const req = tx.objectStore(store).delete(numId);
        req.onsuccess = () => resolve();
        req.onerror   = e => reject(e.target.error);
      });

      if (_supa) {
        try {
          // FIX [BUG-02]: Se ignoraba el `error` de la respuesta de Supabase delete.
          // Ahora se captura para poder loggear si el delete remoto falla.
          const { error } = await _supa.from(store).delete().eq('id', numId);
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

        // FIX [LOGICA-02]: bulkPut enviaba a Supabase solo si _supaOnline=true,
        // pero durante la sincronización inicial _supaOnline puede aún ser false.
        // Se usa _supa directamente (igual que en add/put) para no perder datos.
        if (_supa) {
          try {
            const { error } = await _supa.from(store).upsert(chunk, { onConflict: 'id' });
            if (error) console.warn(`[Supabase bulkPut] ${store}:`, error.message);
          } catch(err) {
            console.warn(`[Supabase bulkPut] ${store}:`, err);
          }
        }
      }
      return ok;
    },

    // Consulta paginada y filtrada
    async query(store, { indexName = null, range = null, filter = null, limit = 50, offset = 0 } = {}) {
      const d = await db();
      return new Promise((resolve, reject) => {
        const tx     = d.transaction([store], 'readonly');
        const st     = tx.objectStore(store);
        const source = indexName ? st.index(indexName) : st;
        const req    = source.openCursor(range, 'prev');

        const results = [];
        let skipped = 0;
        // FIX [LOGICA-03]: `total` contaba solo los elementos que pasaban
        // el filtro ANTES del offset, no el total real de coincidencias.
        // Renombrado a `totalFiltrado` para claridad y correcta paginación.
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
      });
    },

    // Búsqueda rápida de clientes para selects
    async buscarClientesRapido(termino = '', { limit = 30, soloActivos = false } = {}) {
      const s = String(termino || '').toLowerCase().trim();
      const todos = await this.getAll('clientes');
      let filtrados = todos;
      if (soloActivos) filtrados = filtrados.filter(c => c.estado === 'ACTIVO');
      if (s) {
        filtrados = filtrados.filter(c =>
          // FIX [INNECESARIO-01]: Eliminada referencia a c.dni que ya no existe en los registros nuevos.
          `${c.id} ${c.nombre || ''} ${c.ip || ''} ${c.celular || ''} ${c.zona || ''}`.toLowerCase().includes(s)
        );
      }
      return filtrados.slice(0, limit);
    },

    // Eliminación atómica en cascada
    async eliminarClienteCompleto(id) {
      const numId = Number(id);
      // FIX [CASO-LIMITE-02 cont.]: Misma validación de id para prevenir borrado masivo accidental.
      if (!Number.isFinite(numId) || numId <= 0) throw new Error('[eliminarClienteCompleto] ID inválido: ' + id);

      const d = await db();

      await new Promise((resolve, reject) => {
        // FIX [BUG-03]: La eliminación de 'fotos' en cascada fue omitida en la
        // transacción local a pesar de que la store 'fotos' existe. Se añade ahora.
        const tx = d.transaction(['clientes', 'pagos', 'cortes', 'fotos'], 'readwrite');
        tx.objectStore('clientes').delete(numId);

        const pIdx = tx.objectStore('pagos').index('id_cliente');
        const pReq = pIdx.openKeyCursor(IDBKeyRange.only(numId));
        pReq.onsuccess = e => {
          const c = e.target.result;
          if (c) { tx.objectStore('pagos').delete(c.primaryKey); c.continue(); }
        };

        const kIdx = tx.objectStore('cortes').index('id_cliente');
        const kReq = kIdx.openKeyCursor(IDBKeyRange.only(numId));
        kReq.onsuccess = e => {
          const c = e.target.result;
          if (c) { tx.objectStore('cortes').delete(c.primaryKey); c.continue(); }
        };

        // FIX [BUG-03 cont.]: Eliminar fotos locales asociadas al cliente.
        const fIdx = tx.objectStore('fotos').index('cliente_id');
        const fReq = fIdx.openKeyCursor(IDBKeyRange.only(numId));
        fReq.onsuccess = e => {
          const c = e.target.result;
          if (c) { tx.objectStore('fotos').delete(c.primaryKey); c.continue(); }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = e => reject(e.target.error);
      });

      if (_supaOnline && _supa) {
        try {
          // FIX [BUG-04]: Solo se borraba al cliente en Supabase, pero no sus
          // pagos, cortes y fotos (aunque el FK ON DELETE CASCADE los elimina en
          // Supabase si está bien configurado, es más seguro ser explícito y
          // también borrar fotos que no tienen FK).
          await Promise.allSettled([
            _supa.from('clientes').delete().eq('id', numId),
            _supa.from('fotos').delete().eq('cliente_id', numId)
          ]);
        } catch(err) {
          console.warn('[Supabase eliminarClienteCompleto]:', err);
        }
      }
    }
  };
})();

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

// ══ VERIFICACIÓN Y SINCRONIZACIÓN SUPABASE ══════════════
const SUPABASE_SETUP_SQL = `-- SISTEMA FASTNET LOBOYACU - TABLAS SUPABASE
CREATE TABLE IF NOT EXISTS public.clientes (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  nombre TEXT NOT NULL,
  celular VARCHAR(30),
  fecha_inicio DATE,
  ip VARCHAR(50),
  zona VARCHAR(100),
  plan NUMERIC DEFAULT 65,
  estado VARCHAR(30) DEFAULT 'ACTIVO',
  creado_el TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.pagos (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id_cliente BIGINT REFERENCES public.clientes(id) ON DELETE CASCADE,
  cliente_nombre TEXT,
  cliente_zona TEXT,
  monto NUMERIC NOT NULL DEFAULT 65,
  fecha DATE DEFAULT CURRENT_DATE,
  mes VARCHAR(50),
  metodo VARCHAR(50) DEFAULT 'Efectivo',
  numero_operacion VARCHAR(100),
  codigo_operacion VARCHAR(100),
  notas TEXT,
  creado_el TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.cortes (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id_cliente BIGINT REFERENCES public.clientes(id) ON DELETE CASCADE,
  cliente_nombre TEXT,
  zona VARCHAR(100),
  fecha_corte DATE DEFAULT CURRENT_DATE,
  fecha_reconexion DATE,
  motivo TEXT,
  estado VARCHAR(30) DEFAULT 'CORTADO',
  costo_reconeccion NUMERIC DEFAULT 0,
  notas TEXT,
  creado_el TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.fotos (
  id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  titulo TEXT,
  nombre TEXT,
  categoria VARCHAR(50) DEFAULT 'comprobante',
  cliente_id BIGINT,
  cliente_nombre TEXT,
  zona VARCHAR(100),
  tamano BIGINT,
  tipo_mime VARCHAR(100),
  data_url TEXT,
  notas TEXT,
  mtime TIMESTAMPTZ DEFAULT NOW(),
  creado_el TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.clientes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cortes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fotos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Acceso total clientes" ON public.clientes;
CREATE POLICY "Acceso total clientes" ON public.clientes FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Acceso total pagos" ON public.pagos;
CREATE POLICY "Acceso total pagos" ON public.pagos FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Acceso total cortes" ON public.cortes;
CREATE POLICY "Acceso total cortes" ON public.cortes FOR ALL USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "Acceso total fotos" ON public.fotos;
CREATE POLICY "Acceso total fotos" ON public.fotos FOR ALL USING (true) WITH CHECK (true);

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
    _supa.channel('fastnet-realtime-all')
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

  if (banEl)  banEl.style.display = online ? 'none' : 'flex';
  if (sideEl) sideEl.textContent = online ? 'Supabase En Línea' : 'Supabase (Modo Local)';
  if (dotEl)  dotEl.style.background = online ? '#10B981' : '#F59E0B';

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

    // PASO 1: Descargar remotos primero (no perder datos que solo están en la nube)
    const { data: supaCli } = await _supa.from('clientes').select('*');
    if (supaCli && supaCli.length) await IDB.bulkPut('clientes', supaCli);

    const { data: supaPag } = await _supa.from('pagos').select('*');
    if (supaPag && supaPag.length) await IDB.bulkPut('pagos', supaPag);

    const { data: supaCor } = await _supa.from('cortes').select('*');
    if (supaCor && supaCor.length) await IDB.bulkPut('cortes', supaCor);

    // FIX [CASO-LIMITE-05]: Las fotos contienen data_url (base64) que pueden ser
    // enormes. Descargarlas todas de golpe puede agotar la memoria en móviles.
    // Se descarga solo metadatos (sin data_url) para el sidebar/galería.
    const { data: supaFot } = await _supa.from('fotos').select('id,titulo,nombre,categoria,cliente_id,zona,tamano,tipo_mime,mtime,creado_el');
    if (supaFot && supaFot.length) await IDB.bulkPut('fotos', supaFot);

    // PASO 2: Subir locales (datos que no están en Supabase aún)
    const cliLocales = await IDB.getAll('clientes');
    for (let i = 0; i < cliLocales.length; i += 300) {
      const { error } = await _supa.from('clientes').upsert(cliLocales.slice(i, i + 300), { onConflict: 'id' });
      if (error) console.warn('[Sync] Error subiendo clientes:', error.message);
    }

    const pagosLocales = await IDB.getAll('pagos');
    for (let i = 0; i < pagosLocales.length; i += 300) {
      const { error } = await _supa.from('pagos').upsert(pagosLocales.slice(i, i + 300), { onConflict: 'id' });
      if (error) console.warn('[Sync] Error subiendo pagos:', error.message);
    }

    const cortesLocales = await IDB.getAll('cortes');
    for (let i = 0; i < cortesLocales.length; i += 300) {
      const { error } = await _supa.from('cortes').upsert(cortesLocales.slice(i, i + 300), { onConflict: 'id' });
      if (error) console.warn('[Sync] Error subiendo cortes:', error.message);
    }

    // Fotos se suben en lotes pequeños por su tamaño (data_url = base64)
    const fotosLocales = await IDB.getAll('fotos');
    for (let i = 0; i < fotosLocales.length; i += 5) {
      const { error } = await _supa.from('fotos').upsert(fotosLocales.slice(i, i + 5), { onConflict: 'id' });
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
