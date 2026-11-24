// ========================================================
//  LEYTRIX ISP — COMPONENTE DE BARRA LATERAL (SIDEBAR)
//  - Navegación instantánea entre páginas independientes
//  - Destaca la página actual automáticamente
//  - Incluye el estado de Supabase Cloud, modal y footer institucional
// ========================================================

function toggleSidebarMobile() {
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sidebar-overlay');
  const btn = document.getElementById('btnMobileHamburger');
  if (!sb) return;
  const isOpen = sb.classList.toggle('open');
  if (ov) {
    if (isOpen) ov.classList.add('active');
    else ov.classList.remove('active');
  }
  if (btn) {
    btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
}

function cerrarSidebarMobile() {
  const sb  = document.getElementById('sidebar');
  const ov  = document.getElementById('sidebar-overlay');
  const btn = document.getElementById('btnMobileHamburger');
  if (sb) sb.classList.remove('open');
  if (ov) ov.classList.remove('active');
  if (btn) btn.setAttribute('aria-expanded', 'false');
}

function renderSidebar(activePage) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  sidebar.setAttribute('aria-label', 'Menú principal de navegación');

  // 1. Inyectar Barra Superior Móvil si no existe
  if (!document.getElementById('mobile-topbar')) {
    const topbar = document.createElement('header');
    topbar.id = 'mobile-topbar';
    topbar.innerHTML = `
      <button id="btnMobileHamburger" class="mobile-hamburger-btn" onclick="toggleSidebarMobile()" aria-label="Abrir menú de navegación" aria-expanded="false" aria-controls="sidebar">☰</button>
      <div class="mobile-brand">
        <img src="img/logo.png" alt="Logo Leytrix ISP" width="34" height="34" onerror="this.style.display='none'" />
        <div>
          <div class="mobile-brand-title">LEYTRIX</div>
          <span class="mobile-brand-sub">Leytrix • ISP</span>
        </div>
      </div>
      <button type="button" class="mobile-cloud-pill" onclick="abrirModalSupabase()" title="Estado de Supabase Cloud" aria-label="Configuración de Supabase Cloud">
        <span id="mobileSupaDot" class="mobile-cloud-dot"></span>
        <span>☁️</span>
      </button>
    `;
    document.body.prepend(topbar);
  }

  // 2. Inyectar Overlay para cerrar menú en móvil
  if (!document.getElementById('sidebar-overlay')) {
    const overlay = document.createElement('div');
    overlay.id = 'sidebar-overlay';
    overlay.onclick = cerrarSidebarMobile;
    document.body.appendChild(overlay);
  }

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
    <div class="sidebar-logo" style="text-align:center;padding:18px 14px 12px;position:relative">
      <button type="button" onclick="cerrarSidebarMobile()" class="btn-sidebar-close" style="position:absolute;top:10px;right:10px;background:none;border:none;color:#94A3B8;font-size:1.4rem;cursor:pointer;display:none" title="Cerrar Menú" aria-label="Cerrar menú lateral">✕</button>
      <img src="img/logo.png" alt="Logo oficial Leytrix ISP" width="72" height="72" style="width:72px;height:72px;border-radius:50%;object-fit:cover;border:2.5px solid #38BDF8;box-shadow:0 0 18px rgba(56,189,248,0.45);display:block;margin:0 auto 8px;background:#030712" onerror="this.style.display='none'" />
      <div class="sidebar-brand-heading">LEYTRIX ISP</div>
      <p style="font-size:0.75rem;margin:2px 0 0;color:#94A3B8">Leytrix • Velocidad y Confianza</p>
      <div style="margin-top:6px;font-size:0.7rem;color:#38BDF8;font-weight:600">
        📞 +51 993 053 643
      </div>
      <div class="sidebar-supa-pill" role="button" tabindex="0" onclick="abrirModalSupabase()" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();abrirModalSupabase();}" title="Configuración de Supabase Cloud" aria-label="Estado y configuración de Supabase Cloud">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:0.95rem">☁️</span>
          <span id="sidebarSupaStatus" style="font-size:0.75rem;font-weight:700;color:#38BDF8">Supabase Cloud</span>
        </div>
        <span id="sidebarSupaDot" style="width:9px;height:9px;border-radius:50%;background:#F59E0B" title="Estado"></span>
      </div>
    </div>
    <div style="flex:1;padding:8px 0;overflow-y:auto">
      ${links.map(l => {
        const isActive = activePage === l.key;
        return `
        <a href="${l.href}" class="nav-link${isActive ? ' active' : ''}"${isActive ? ' aria-current="page"' : ''} onclick="cerrarSidebarMobile()">
          <span class="nav-icon" aria-hidden="true">${l.icon}</span>
          <span>${l.text}</span>
        </a>`;
      }).join('')}
    </div>
    <div class="sidebar-stats" id="sidebarStats" aria-live="polite">
      <p>📡 Cargando métricas...</p>
    </div>
  `;

  // 3. Inyectar Footer institucional en #main si no existe
  const mainEl = document.getElementById('main');
  if (mainEl && !mainEl.querySelector('.app-footer')) {
    const footer = document.createElement('footer');
    footer.className = 'app-footer';
    footer.innerHTML = `
      <div>
        <strong>Leytrix ISP</strong> — Sistema de Gestión de Red (Loboyacu, Huayranga, Pacotillo, Ramal de Cachiyacu, Palmeras, Shishiyacu)
      </div>
      <div>
        📞 Soporte: <a href="tel:+51993053643">+51 993 053 643</a> • ✉️ <a href="mailto:fastnetloboyacu@gmail.com">fastnetloboyacu@gmail.com</a>
      </div>
    `;
    mainEl.appendChild(footer);
  }

  // 4. Inyectar modal Supabase en el body si no existe
  if (!document.getElementById('modalSupabase')) {
    const modWrap = document.createElement('div');
    modWrap.id = 'modalSupabase';
    modWrap.className = 'modal-bg';
    modWrap.setAttribute('role', 'dialog');
    modWrap.setAttribute('aria-modal', 'true');
    modWrap.setAttribute('aria-labelledby', 'modalSupabaseTitle');
    modWrap.innerHTML = `
      <div class="modal">
        <div class="modal-header">
          <h3 id="modalSupabaseTitle">☁️ Configuración Supabase Cloud</h3>
          <button type="button" class="modal-close" onclick="cerrarModal('modalSupabase')" aria-label="Cerrar ventana">✕</button>
        </div>
        <div style="background:#F8FAFC;border:1px solid var(--borde);border-radius:10px;padding:14px;margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;flex-wrap:wrap;gap:6px">
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
          <h4 style="font-size:0.88rem;color:var(--azul);margin-bottom:6px">⚡ Sincronización Multi-Dispositivo en la Nube</h4>
          <p style="font-size:0.8rem;color:var(--gris);line-height:1.4;margin-bottom:10px">
            Sincroniza clientes, pagos, cortes y fotos con Supabase para que carguen al instante en cualquier celular, tablet o computadora.
          </p>
          <button type="button" class="btn btn-primary btn-full" onclick="sincronizarConSupabase()" style="background:#0D9488;border-color:#0D9488">
            ☁️ Sincronizar Todos los Datos Ahora
          </button>
        </div>
        <div style="border-top:1px solid var(--borde);padding-top:14px">
          <div style="background:#FEF2F2;border:1px solid #FECACA;border-radius:8px;padding:10px;margin-bottom:12px">
            <strong style="color:#DC2626;font-size:0.8rem">⚠️ Migración Rápida (para bases ya creadas):</strong>
            <p style="font-size:0.74rem;color:#991B1B;margin:3px 0 6px">Si actualizaste desde una versión previa, ejecuta el Script SQL Completo de abajo en Supabase SQL Editor para asegurar compatibilidad total de fotos y servicio de cable.</p>
          </div>
          <h4 style="font-size:0.88rem;margin-bottom:6px">📋 Script SQL Completo para Supabase</h4>
          <p style="font-size:0.78rem;color:var(--gris);margin-bottom:8px">
            Copia este código, entra a <strong>Supabase Dashboard &gt; SQL Editor &gt; New Query</strong>, pégalo y presiona <strong>Run</strong>:
          </p>
          <pre id="codigoSqlSupa" style="background:#0F172A;color:#38BDF8;padding:12px;border-radius:8px;font-size:0.72rem;max-height:140px;overflow:auto;user-select:all"></pre>
          <div style="display:flex;gap:10px;margin-top:12px;flex-wrap:wrap">
            <button type="button" class="btn btn-primary btn-sm" onclick="copiarSqlSupabase()" style="background:#16A34A;border-color:#16A34A;flex:1;min-width:140px">
              📋 Copiar Código SQL
            </button>
            <a href="https://supabase.com/dashboard/project/baeobhvgfrdbwyqapqzf/sql/new" target="_blank" rel="noopener noreferrer" class="btn btn-primary btn-sm" style="background:#0284C7;border-color:#0284C7;flex:1;min-width:160px;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;gap:6px">
              🔗 Abrir SQL Editor
            </a>
            <button type="button" class="btn btn-outline btn-sm" onclick="verificarSupabase(true)" style="flex:1;min-width:120px">
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
  } catch (err) {
    statsEl.innerHTML = '<p>Leytrix ISP v3.0</p>';
  }
}
