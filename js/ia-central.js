// ========================================================
//  LEYTRIX ISP — IA CENTRAL (Gemini 2.0 Flash)
//  Módulos:
//    1. Asistente conversacional ISP (chat flotante)
//    2. Predicción de clientes con riesgo de mora
//    3. Análisis rápido del negocio (KPIs + sugerencias)
//    4. Resumen de estado de la red con lenguaje natural
//
//  Se integra en todas las páginas via sidebar.js
//  Requiere: geminiApiKey configurada en ajustes IA
// ========================================================

const FASTNET_IA = (() => {

  // ── Modelo Gemini ─────────────────────────────────────
  const GEMINI_MODEL = 'gemini-2.0-flash';
  const GEMINI_URL   = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

  function getApiKey() {
    try {
      const raw = localStorage.getItem('fastnet_ai_config') || localStorage.getItem('leytrix_ai_config');
      if (raw) return JSON.parse(raw).geminiApiKey || '';
    } catch (_) {}
    return '';
  }

  async function callGemini(prompt, { temperature = 0.7, maxTokens = 800 } = {}) {
    const key = getApiKey();
    if (!key || key.trim().length < 10) return null;

    const resp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(key.trim())}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature, maxOutputTokens: maxTokens }
      })
    });

    if (!resp.ok) throw new Error(`Gemini HTTP ${resp.status}`);
    const data = await resp.json();
    const texto = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!texto) throw new Error('Respuesta vacía de Gemini');
    return texto.trim();
  }

  // ── 1. ASISTENTE CONVERSACIONAL ISP ──────────────────
  // Historial de la conversación actual
  let _historialChat = [];

  async function chatISP(preguntaUsuario, contextoNegocio = '') {
    const sistemaPrompt = `Eres el asistente virtual de inteligencia artificial de *Leytrix ISP* (FastNet Loboyacu), una empresa de internet rural en Perú.
Tu rol: ayudar al administrador del sistema ISP con análisis, decisiones de negocio, cobranza, y soporte técnico básico.
Datos de la empresa:
- Zonas de cobertura: Loboyacu, Huayranga, Pacotillo, Ramal de Cachiyacu, Palmeras, Shishiyacu
- Planes: S/. 50 (Básico), S/. 60 (Plus), S/. 65 (Normal)
- Teléfono: +51 993 053 643 | Email: fastnetloboyacu@gmail.com
${contextoNegocio ? `\nContexto actual del sistema:\n${contextoNegocio}` : ''}
Responde en español, de forma concisa y práctica. Usa listas o negritas cuando ayude a la claridad.`;

    const historialTexto = _historialChat.slice(-6).map(h =>
      `${h.rol === 'user' ? 'Usuario' : 'Asistente'}: ${h.texto}`
    ).join('\n');

    const promptCompleto = `${sistemaPrompt}\n\n${historialTexto ? 'Historial:\n' + historialTexto + '\n\n' : ''}Usuario: ${preguntaUsuario}\n\nAsistente:`;

    const respuesta = await callGemini(promptCompleto, { temperature: 0.6, maxTokens: 600 });
    if (respuesta) {
      _historialChat.push({ rol: 'user',      texto: preguntaUsuario });
      _historialChat.push({ rol: 'assistant', texto: respuesta });
      if (_historialChat.length > 20) _historialChat = _historialChat.slice(-20);
    }
    return respuesta;
  }

  function limpiarHistorialChat() {
    _historialChat = [];
  }

  // ── 2. PREDICCIÓN DE RIESGO DE MORA ──────────────────
  async function predecirRiesgoMora(clientes, pagos) {
    if (!clientes || !clientes.length) return [];

    // Calcular historial de pagos por cliente (motor local siempre disponible)
    const mesActualStr = mesActual(); // función de db.js
    const pagosPorCliente = {};
    (pagos || []).forEach(p => {
      if (!pagosPorCliente[p.id_cliente]) pagosPorCliente[p.id_cliente] = [];
      pagosPorCliente[p.id_cliente].push(p);
    });

    const analisis = clientes
      .filter(c => c.estado === 'ACTIVO' || c.estado === 'CORTADO')
      .map(c => {
        const histPagos   = pagosPorCliente[c.id] || [];
        const totalPagos  = histPagos.length;
        const pagoEsteMes = histPagos.some(p => p.mes === mesActualStr);
        const ultimoPago  = histPagos.sort((a, b) => new Date(b.fecha || b.creado_el) - new Date(a.fecha || a.creado_el))[0];
        const diasSinPago = ultimoPago
          ? Math.floor((Date.now() - new Date(ultimoPago.fecha || ultimoPago.creado_el)) / 86400000)
          : 999;

        // Score de riesgo local (0=bajo, 1=medio, 2=alto)
        let riesgo = 0;
        let razones = [];
        if (c.estado === 'CORTADO')      { riesgo += 2; razones.push('Servicio cortado'); }
        if (!pagoEsteMes)                { riesgo += 1; razones.push('Sin pago este mes'); }
        if (diasSinPago > 45)            { riesgo += 1; razones.push(`${diasSinPago} días sin pago`); }
        if (totalPagos < 2)              { riesgo += 1; razones.push('Cliente nuevo (<2 pagos)'); }
        if (diasSinPago > 60)            { riesgo++;    razones.push('Mora prolongada'); }

        return {
          cliente: c,
          riesgo,
          nivel: riesgo >= 4 ? 'ALTO' : riesgo >= 2 ? 'MEDIO' : 'BAJO',
          razones,
          diasSinPago: diasSinPago === 999 ? null : diasSinPago,
          pagoEsteMes
        };
      })
      .filter(r => r.riesgo > 0)
      .sort((a, b) => b.riesgo - a.riesgo);

    // Si hay API key, enriquecer con IA el top 5
    const key = getApiKey();
    if (key && analisis.length > 0) {
      try {
        const resumenCasos = analisis.slice(0, 5).map((r, i) =>
          `${i+1}. ${r.cliente.nombre} (${r.cliente.zona}) - Plan S/.${r.cliente.plan} - Razones: ${r.razones.join(', ')}`
        ).join('\n');

        const prompt = `Analiza estos ${Math.min(5, analisis.length)} clientes en riesgo de mora de FastNet Loboyacu:
${resumenCasos}

Para cada uno, dame en 1 línea: estrategia de cobranza recomendada (sin repetir los datos ya dados).
Formato: "1. [estrategia]" para cada cliente. Máximo 15 palabras por línea.`;

        const sugerencias = await callGemini(prompt, { temperature: 0.5, maxTokens: 300 });
        if (sugerencias) {
          const lineas = sugerencias.split('\n').filter(l => /^\d+\./.test(l.trim()));
          lineas.forEach((linea, i) => {
            if (analisis[i]) {
              analisis[i].sugerenciaIA = linea.replace(/^\d+\.\s*/, '').trim();
            }
          });
        }
      } catch (err) {
        console.warn('[IA mora] Falló enriquecimiento Gemini:', err);
      }
    }

    return analisis;
  }

  // ── 3. ANÁLISIS RÁPIDO DEL NEGOCIO ───────────────────
  async function analizarNegocio(clientes, pagos) {
    if (!clientes) return 'Sin datos disponibles.';

    const total       = clientes.length;
    const activos     = clientes.filter(c => c.estado === 'ACTIVO').length;
    const cortados    = clientes.filter(c => c.estado === 'CORTADO').length;
    const pendientes  = clientes.filter(c => c.estado === 'PENDIENTE').length;
    const ingresoMes  = clientes.filter(c => c.estado === 'ACTIVO').reduce((s, c) => s + (Number(c.plan) || 65), 0);
    const mesStr      = mesActual();
    const pagosEsteMes = (pagos || []).filter(p => p.mes === mesStr);
    const cobradoMes  = pagosEsteMes.reduce((s, p) => s + (Number(p.monto) || 0), 0);
    const tasaActivos = total > 0 ? Math.round((activos / total) * 100) : 0;

    const zonaStats = {};
    clientes.forEach(c => {
      if (!zonaStats[c.zona]) zonaStats[c.zona] = { total: 0, activos: 0 };
      zonaStats[c.zona].total++;
      if (c.estado === 'ACTIVO') zonaStats[c.zona].activos++;
    });
    const mejorZona = Object.entries(zonaStats).sort((a, b) => b[1].activos - a[1].activos)[0];

    const contexto = `Total clientes: ${total} | Activos: ${activos} (${tasaActivos}%) | Cortados: ${cortados} | Pendientes: ${pendientes}
Ingreso mensual potencial: S/. ${ingresoMes} | Cobrado en ${mesStr}: S/. ${cobradoMes.toFixed(2)}
Mejor zona: ${mejorZona ? mejorZona[0] + ' (' + mejorZona[1].activos + ' activos)' : 'N/A'}`;

    const key = getApiKey();
    if (!key || key.trim().length < 10) {
      return `📊 *Resumen ${mesStr}:*\n• ${activos}/${total} activos (${tasaActivos}%)\n• Cortados: ${cortados}\n• Cobrado: S/. ${cobradoMes.toFixed(2)} de S/. ${ingresoMes} potencial\n• Mejor zona: ${mejorZona?.[0] || 'N/A'}`;
    }

    try {
      const prompt = `Eres analista de negocios para FastNet Loboyacu, ISP rural en Perú.
Datos del sistema (${mesStr}):
${contexto}

Dame un análisis ejecutivo en máximo 4 viñetas cortas con:
1. Estado del negocio
2. Principal problema a resolver
3. Oportunidad de mejora
4. Acción inmediata recomendada

Usa emojis relevantes. Sé directo y práctico.`;

      const analisis = await callGemini(prompt, { temperature: 0.5, maxTokens: 400 });
      return analisis || `📊 ${contexto}`;
    } catch (err) {
      console.warn('[IA análisis] Falló Gemini:', err);
      return `📊 *Resumen ${mesStr}:*\n• ${activos}/${total} activos (${tasaActivos}%)\n• Cobrado: S/. ${cobradoMes.toFixed(2)} / S/. ${ingresoMes}`;
    }
  }

  // ── 4. RESUMEN DE RED EN LENGUAJE NATURAL ────────────
  async function resumirEstadoRed(clientes) {
    if (!clientes || !clientes.length) return '📡 Sin datos de red disponibles.';

    const activos   = clientes.filter(c => c.estado === 'ACTIVO').length;
    const cortados  = clientes.filter(c => c.estado === 'CORTADO').length;
    const total     = clientes.length;

    const key = getApiKey();
    if (!key || key.trim().length < 10) {
      return `📡 Red FastNet: ${activos} activos, ${cortados} cortados de ${total} totales.`;
    }

    try {
      const prompt = `Resume en 1 oración corta y amigable el estado de la red de internet FastNet Loboyacu:
- Clientes activos: ${activos} de ${total}
- Cortados: ${cortados}
Máximo 20 palabras, usa un emoji relevante al inicio.`;
      const resumen = await callGemini(prompt, { temperature: 0.4, maxTokens: 80 });
      return resumen || `📡 ${activos}/${total} clientes activos en red.`;
    } catch (_) {
      return `📡 ${activos}/${total} clientes activos en red FastNet.`;
    }
  }

  // ── API PÚBLICA ───────────────────────────────────────
  return {
    chatISP,
    limpiarHistorialChat,
    predecirRiesgoMora,
    analizarNegocio,
    resumirEstadoRed,
    tieneApiKey: () => getApiKey().trim().length > 10
  };

})();


// ========================================================
//  INTERFAZ: CHAT FLOTANTE IA (inyectado en todas las páginas)
// ========================================================

(function inyectarChatIA() {
  // Evitar doble inyección
  if (document.getElementById('fastnet-ia-chat')) return;

  const html = `
  <div id="fastnet-ia-chat" style="
    position:fixed; bottom:24px; right:24px; z-index:99999;
    display:flex; flex-direction:column; align-items:flex-end; gap:10px;
    font-family:'Segoe UI',sans-serif;
  ">
    <!-- Burbuja toggle -->
    <button id="ia-chat-toggle" onclick="toggleChatIA()" title="Asistente IA FastNet" style="
      width:56px; height:56px; border-radius:50%;
      background:linear-gradient(135deg,#7C3AED,#4F46E5);
      border:none; cursor:pointer; box-shadow:0 4px 20px rgba(124,58,237,0.4);
      font-size:1.5rem; color:#fff; transition:transform 0.2s;
      display:flex; align-items:center; justify-content:center;
    ">🤖</button>

    <!-- Ventana del chat -->
    <div id="ia-chat-window" style="
      display:none; width:340px; max-height:480px;
      background:#fff; border-radius:16px;
      box-shadow:0 8px 40px rgba(0,0,0,0.16);
      border:1.5px solid #E5E7EB;
      flex-direction:column; overflow:hidden;
    ">
      <!-- Header -->
      <div style="
        background:linear-gradient(135deg,#7C3AED,#4F46E5);
        padding:14px 16px; display:flex; align-items:center;
        justify-content:space-between;
      ">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:1.4rem">🤖</span>
          <div>
            <div style="color:#fff;font-weight:700;font-size:0.95rem">Asistente IA</div>
            <div style="color:#C4B5FD;font-size:0.72rem">Leytrix ISP</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <button onclick="analizarNegocioIA()" title="Análisis del negocio" style="
            background:rgba(255,255,255,0.15); border:none; color:#fff;
            border-radius:8px; padding:4px 8px; cursor:pointer; font-size:0.75rem;
          ">📊 Análisis</button>
          <button onclick="toggleChatIA()" style="
            background:none;border:none;color:#C4B5FD;cursor:pointer;font-size:1.1rem;
          ">✕</button>
        </div>
      </div>

      <!-- Mensajes -->
      <div id="ia-chat-msgs" style="
        flex:1; overflow-y:auto; padding:14px; display:flex;
        flex-direction:column; gap:10px; max-height:320px;
        background:#F8FAFC;
      ">
        <div class="ia-msg-bot">
          Hola 👋 Soy el asistente IA de <b>Leytrix ISP</b>. Puedo ayudarte con análisis de clientes, cobranza, reportes y decisiones del negocio. ¿En qué te ayudo?
        </div>
      </div>

      <!-- Input -->
      <div style="padding:12px;border-top:1px solid #F1F5F9;background:#fff;display:flex;gap:8px">
        <input id="ia-chat-input" type="text"
          placeholder="Escribe tu consulta..."
          onkeydown="if(event.key==='Enter')enviarMensajeIA()"
          style="
            flex:1; border:1.5px solid #E5E7EB; border-radius:10px;
            padding:8px 12px; font-size:0.85rem; outline:none;
            transition:border-color 0.2s;
          "
          onfocus="this.style.borderColor='#7C3AED'"
          onblur="this.style.borderColor='#E5E7EB'"
        />
        <button onclick="enviarMensajeIA()" style="
          background:#7C3AED; color:#fff; border:none; border-radius:10px;
          padding:8px 14px; cursor:pointer; font-size:1rem;
          transition:background 0.2s;
        " title="Enviar">➤</button>
      </div>
    </div>
  </div>

  <style>
    .ia-msg-bot {
      background:#EFF6FF; color:#1E3A5F;
      border-radius:12px 12px 12px 4px;
      padding:10px 12px; font-size:0.82rem;
      line-height:1.5; max-width:90%; align-self:flex-start;
    }
    .ia-msg-user {
      background:#7C3AED; color:#fff;
      border-radius:12px 12px 4px 12px;
      padding:10px 12px; font-size:0.82rem;
      line-height:1.5; max-width:90%; align-self:flex-end;
    }
    .ia-msg-typing {
      background:#F1F5F9; color:#94A3B8;
      border-radius:12px; padding:10px 12px;
      font-size:0.82rem; align-self:flex-start;
      font-style:italic;
    }
    #ia-chat-toggle:hover { transform: scale(1.08); }
  </style>
  `;

  document.body.insertAdjacentHTML('beforeend', html);
})();

// ── Controles del Chat ────────────────────────────────
function toggleChatIA() {
  const win = document.getElementById('ia-chat-window');
  if (!win) return;
  const visible = win.style.display === 'flex';
  win.style.display = visible ? 'none' : 'flex';
  win.style.flexDirection = 'column';
  if (!visible) {
    document.getElementById('ia-chat-input')?.focus();
  }
}

function agregarMensajeChat(texto, tipo = 'bot') {
  const msgs = document.getElementById('ia-chat-msgs');
  if (!msgs) return;
  const div = document.createElement('div');
  div.className = tipo === 'user' ? 'ia-msg-user' : (tipo === 'typing' ? 'ia-msg-typing' : 'ia-msg-bot');
  // Soportar negritas **texto** → <b>texto</b>
  div.innerHTML = String(texto)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\*(.+?)\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
  msgs.appendChild(div);
  msgs.scrollTop = msgs.scrollHeight;
  return div;
}

async function enviarMensajeIA() {
  const input = document.getElementById('ia-chat-input');
  if (!input) return;
  const texto = input.value.trim();
  if (!texto) return;
  input.value = '';

  agregarMensajeChat(texto, 'user');

  // Indicador "escribiendo..."
  const typing = agregarMensajeChat('⏳ Procesando...', 'typing');

  try {
    // Construir contexto del negocio si los datos están disponibles
    let contexto = '';
    if (typeof IDB !== 'undefined') {
      try {
        const [clis, pags] = await Promise.all([
          IDB.getAll('clientes'),
          IDB.getAll('pagos')
        ]);
        const activos  = clis.filter(c => c.estado === 'ACTIVO').length;
        const cortados = clis.filter(c => c.estado === 'CORTADO').length;
        const mesStr   = mesActual();
        const cobrado  = pags.filter(p => p.mes === mesStr).reduce((s, p) => s + (Number(p.monto) || 0), 0);
        contexto = `Clientes: ${clis.length} total, ${activos} activos, ${cortados} cortados. Cobrado en ${mesStr}: S/. ${cobrado.toFixed(2)}.`;
      } catch (_) {}
    }

    if (!FASTNET_IA.tieneApiKey()) {
      typing.remove();
      agregarMensajeChat(
        '⚠️ Para usar el chat IA necesitas configurar tu clave Gemini API.\n\nVe a ⚙️ *Ajustes IA* en el menú lateral y agrega tu API Key gratuita de Google AI Studio.',
        'bot'
      );
      return;
    }

    const respuesta = await FASTNET_IA.chatISP(texto, contexto);
    typing.remove();
    if (respuesta) {
      agregarMensajeChat(respuesta, 'bot');
    } else {
      agregarMensajeChat('No pude procesar esa solicitud. Intenta de nuevo.', 'bot');
    }
  } catch (err) {
    if (typing) typing.remove();
    agregarMensajeChat('❌ Error al conectar con la IA: ' + (err.message || 'Verifica tu API Key.'), 'bot');
  }
}

async function analizarNegocioIA() {
  const msgs = document.getElementById('ia-chat-msgs');
  if (!msgs) { toggleChatIA(); return; }

  const win = document.getElementById('ia-chat-window');
  if (win) { win.style.display = 'flex'; win.style.flexDirection = 'column'; }

  agregarMensajeChat('📊 ¿Puedes darme un análisis del negocio?', 'user');
  const typing = agregarMensajeChat('⏳ Analizando datos del sistema...', 'typing');

  try {
    let clientes = [], pagos = [];
    if (typeof IDB !== 'undefined') {
      [clientes, pagos] = await Promise.all([IDB.getAll('clientes'), IDB.getAll('pagos')]);
    }

    const analisis = await FASTNET_IA.analizarNegocio(clientes, pagos);
    typing.remove();
    agregarMensajeChat(analisis, 'bot');
  } catch (err) {
    if (typing) typing.remove();
    agregarMensajeChat('❌ No pude obtener el análisis: ' + (err.message || ''), 'bot');
  }
}
