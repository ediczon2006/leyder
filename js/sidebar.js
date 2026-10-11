// ========================================================
//  LEYTRIX ISP — COMPONENTE DE BARRA LATERAL (SIDEBAR)
//  - Navegación instantánea entre páginas independientes
//  - Destaca la página actual automáticamente
//  - Incluye el estado de Supabase Cloud y el modal en cada página
// ========================================================

function renderSidebar(activePage) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;

  const links = [
    { href: 'index.html',        icon: '🏠', text: 'Panel ISP',            key: 'index' },
    { href: 'clientes.html',     icon: '👥', text: 'Clientes',             key: 'clientes' },
    { href: 'agregar.html',      icon: '➕', text: 'Agregar Cliente',      key: 'agregar' },
    { href: 'pagos.html',        icon: '💰', text: 'Registrar Pago',       key: 'pagos' },
    { href: 'cortes.html',       icon: '✂️', text: 'Cortes & Reconexión',  key: 'cortes' },
    { href: 'zonas.html',        icon: '🗺️', text: 'Vista por Zona',       key: 'zonas' },
    { href: 'pendientes.html',   icon: '📅', text: 'Pendientes del Mes',   key: 'pendientes' },
    { href: 'importexport.html', icon: '📊', text: 'Importar / Exportar',  key: 'importexport' },
    { href: 'explorador.html',   icon: '📸', text: 'Fotos & Comprobantes', key: 'explorador' }
  ];

  sidebar.innerHTML = `
    <div class="sidebar-logo">
      <span class="icon">📡</span>
      <h1>FASTNET LOBOYACU</h1>
      <p>Internet Banda Ancha</p>
      <div style="margin-top:6px;font-size:0.7rem;color:#38BDF8;font-weight:600">
        📞 +51 993 053 643
      </div>
      <div class="sidebar-supa-pill" onclick="abrirModalSupabase()" title="Configuración de Supabase Cloud">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:0.95rem">☁️</span>
          <span id="sidebarSupaStatus" style="font-size:0.75rem;font-weight:700;color:#38BDF8">Supabase Cloud</span>
        </div>
        <span id="sidebarSupaDot" style="width:9px;height:9px;border-radius:50%;background:#F59E0B" title="Estado"></span>
      </div>
    </div>
    <div style="flex:1;padding:8px 0;overflow-y:auto">
      ${links.map(l => `
        <a href="${l.href}" class="nav-link${activePage === l.key ? ' active' : ''}">
          <span class="nav-icon">${l.icon}</span>
          <span>${l.text}</span>
        </a>
      `).join('')}
    </div>
    <div class="sidebar-stats" id="sidebarStats">
      <p>📡 Cargando métricas...</p>
    </div>
  `;

  // Inyectar modal Supabase en el body si no existe
  if (!document.getElementById('modalSupabase')) {
    const modWrap = document.createElement('div');
    modWrap.id = 'modalSupabase';
    modWrap.className = 'modal-bg';
    modWrap.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3>☁️ Configuración Supabase Cloud</h3>
          <button class="modal-close" onclick="cerrarModal('modalSupabase')">✕</button>
        </div>
        <div style="background:#F8FAFC;border:1px solid var(--borde);border-radius:10px;padding:14px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="font-size:0.85rem">Estado de Conexión:</strong>
            <span id="modalSupaStatusBadge" style="font-size:0.78rem;font-weight:700;padding:4px 10px;border-radius:12px;background:#FFFBEB;color:#B45309">
              🟡 Modo Local (Pendiente SQL)
            </span>
          </div>
          <div style="font-size:0.78rem;color:var(--gris);word-break:break-all">
            <strong>URL:</strong> https://baeobhvgfrdbwyqapqzf.supabase.co
          </div>
        </div>
        <div style="margin-bottom:16px">
          <h4 style="font-size:0.88rem;color:var(--azul);margin-bottom:6px">⚡ Sincronización en la Nube</h4>
          <p style="font-size:0.8rem;color:var(--gris);line-height:1.4;margin-bottom:10px">
            Sube todos tus clientes, pagos, cortes y fotos hacia Supabase para que puedas usarlos desde cualquier dispositivo y en GitHub Pages.
          </p>
          <button class="btn btn-primary btn-full" onclick="sincronizarConSupabase()" style="background:#0D9488;border-color:#0D9488">
            ☁️ Sincronizar Todos los Datos a Supabase Cloud
          </button>
        </div>
        <div style="border-top:1px solid var(--borde);padding-top:14px">
          <h4 style="font-size:0.88rem;margin-bottom:6px">📋 Script SQL para crear tablas en Supabase</h4>
          <p style="font-size:0.78rem;color:var(--gris);margin-bottom:8px">
            Si aún no has creado las tablas en tu proyecto, copia este código, entra a <strong>Supabase Dashboard &gt; SQL Editor &gt; New Query</strong>, pégalo y presiona <strong>Run</strong>:
          </p>
          <pre id="codigoSqlSupa" style="background:#0F172A;color:#38BDF8;padding:12px;border-radius:8px;font-size:0.72rem;max-height:140px;overflow:auto;user-select:all"></pre>
          <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
            <button class="btn btn-primary btn-sm" onclick="copiarSqlSupabase()" style="background:#16A34A;border-color:#16A34A;flex:1;min-width:140px">
              📋 Copiar Código SQL
            </button>
            <a href="https://supabase.com/dashboard/project/baeobhvgfrdbwyqapqzf/sql/new" target="_blank" class="btn btn-primary btn-sm" style="background:#0284C7;border-color:#0284C7;flex:1;min-width:160px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px">
              🔗 Abrir SQL Editor
            </a>
            <button class="btn btn-outline btn-sm" onclick="verificarSupabase(true)" style="flex:1;min-width:120px">
              🔄 Probar Conexión
            </button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modWrap);
  }

  // Actualizar métricas del sidebar
  actualizarEstadisticasSidebar();
  verificarSupabase(false);
}

async function actualizarEstadisticasSidebar() {
  const statsEl = document.getElementById('sidebarStats');
  if (!statsEl) return;
  try {
    const mes = mesActual();
    const [total, activos, cortados, pagosMes] = await Promise.all([
      IDB.count('clientes'),
      IDB.countByIndex('clientes', 'estado', 'ACTIVO'),
      IDB.countByIndex('clientes', 'estado', 'CORTADO'),
      IDB.getByIndex('pagos', 'mes', mes)
    ]);
    const cobrado = (pagosMes || []).reduce((s, p) => s + (Number(p.monto) || 0), 0);
    statsEl.innerHTML = `
      <p>📡 <strong>Total:</strong> ${total.toLocaleString()}</p>
      <p>✅ <strong>Activos:</strong> ${activos.toLocaleString()}</p>
      <p>✂️ <strong>Cortados:</strong> ${cortados.toLocaleString()}</p>
      <p>💰 <strong>Cobrado:</strong> S/. ${cobrado.toFixed(2)}</p>
    `;
  } catch(err) {
    statsEl.innerHTML = '<p>FASTNET LOBOYACU v2.0</p>';
  }
}
