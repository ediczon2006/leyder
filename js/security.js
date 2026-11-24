// ====================================================================
//  LEYTRIX ISP - CAPA DE SEGURIDAD DEFENSIVA (SECURITY.JS)
//  Estándar: OWASP Top 10 Client-Side Hardening
// ====================================================================

const LeytrixSecurity = (() => {

  // 1. Sanitización estricta contra Cross-Site Scripting (XSS)
  function sanitizeHTML(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;')
      .replace(/`/g, '&#96;');
  }

  // 1b. Formateo seguro de Markdown básico (negritas y saltos de línea) sin riesgo XSS
  function formatMarkdownSafe(str) {
    const limpio = sanitizeHTML(str);
    return limpio
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br>');
  }

  // 2. Validadores de formato estricto (Entradas PII y Red)
  const Validators = {
    celular(num) {
      if (!num) return false;
      const clean = String(num).replace(/[\s\-\+\(\)]/g, '');
      // Válido si tiene 9 dígitos (Perú) o formato internacional +51 (9 a 15 dígitos numéricos)
      return /^(51)?9\d{8}$/.test(clean) || /^\d{9,15}$/.test(clean);
    },
    ip(ipStr) {
      if (!ipStr) return false;
      // Formato IPv4 válido (ej. 192.168.10.45)
      const parts = String(ipStr).trim().split('.');
      if (parts.length !== 4) return false;
      return parts.every(p => {
        if (!/^\d{1,3}$/.test(p)) return false;
        const n = parseInt(p, 10);
        return !isNaN(n) && n >= 0 && n <= 255 && String(n) === p;
      });
    },
    monto(valor) {
      const n = Number(valor);
      return Number.isFinite(n) && n > 0 && n <= 50000;
    },
    nombre(str) {
      if (!str) return false;
      const s = String(str).trim();
      return s.length >= 2 && s.length <= 150 && !/[<>]/.test(s);
    }
  };

  // 3. Control y Verificación de Sesión (Supabase Auth Guard)
  async function verificarSesionActiva() {
    if (typeof _supa === 'undefined' || !_supa || !_supa.auth) {
      return { autenticado: false, usuario: null };
    }
    try {
      const { data: { session }, error } = await _supa.auth.getSession();
      if (error || !session) {
        return { autenticado: false, usuario: null };
      }
      return { autenticado: true, usuario: session.user };
    } catch (_) {
      return { autenticado: false, usuario: null };
    }
  }

  // 4. Rate Limiting en el Cliente (Prevención de DoS y flooding)
  const _actionTimestamps = new Map();
  function checkRateLimit(actionKey, maxCalls = 5, windowMs = 10000) {
    const now = Date.now();
    const timestamps = (_actionTimestamps.get(actionKey) || []).filter(t => now - t < windowMs);
    if (timestamps.length >= maxCalls) {
      return false; // Bloqueado por exceso de peticiones
    }
    timestamps.push(now);
    _actionTimestamps.set(actionKey, timestamps);
    return true;
  }

  // 5. Inyección de Cabeceras y Metaetiquetas de Seguridad en el DOM
  function aplicarSecurityHeaders() {
    // Prevenir Clickjacking mediante iframes no autorizados
    if (window.top !== window.self) {
      try {
        window.top.location = window.self.location;
      } catch (_) {}
    }

    // Inyectar meta referrer seguro si no existe
    if (!document.querySelector('meta[name="referrer"]')) {
      const metaRef = document.createElement('meta');
      metaRef.name = 'referrer';
      metaRef.content = 'strict-origin-when-cross-origin';
      document.head.appendChild(metaRef);
    }
  }

  // Ejecución preventiva al cargar
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', aplicarSecurityHeaders);
    } else {
      aplicarSecurityHeaders();
    }
  }

  return {
    sanitize: sanitizeHTML,
    formatMarkdown: formatMarkdownSafe,
    isValid: Validators,
    verificarSesion: verificarSesionActiva,
    rateLimit: checkRateLimit
  };

})();

// Exportación explícita al contexto global (Window / GlobalScope)
if (typeof window !== 'undefined') {
  window.LeytrixSecurity = LeytrixSecurity;
  window.FastNetSecurity = LeytrixSecurity;
}

// Retrocompatibilidad con scripts existentes
const FastNetSecurity = LeytrixSecurity;
