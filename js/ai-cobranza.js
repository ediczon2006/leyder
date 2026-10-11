// ========================================================
//  LEYTRIX ISP — ASISTENTE DE INTELIGENCIA ARTIFICIAL (IA)
//  - Cobranza inteligente y persuasiva por WhatsApp
//  - Adaptación automática de tono (Amable, Formal, Urgente/Pre-corte, Convenio)
//  - Motor neural local ISP + Compatibilidad opcional con Gemini API
// ========================================================

const AI_CONFIG_KEY = 'leytrix_ai_config';

function obtenerConfiguracionIA() {
  try {
    const raw = localStorage.getItem(AI_CONFIG_KEY);
    if (raw) return JSON.parse(raw);
  } catch(_) {}
  return {
    geminiApiKey: '',
    nombreEmpresa: 'Leytrix Internet Rural',
    numeroYape: '987654321',
    titularYape: 'Leytrix ISP',
    cuentaBcp: '191-98234812-0-45',
    cciBcp: '002191009823481204592',
    titularBcp: 'Leyder - Leytrix Internet'
  };
}

function guardarConfiguracionIA(config) {
  localStorage.setItem(AI_CONFIG_KEY, JSON.stringify(config));
}

// ══ MOTOR DE GENERACIÓN IA ══════════════════════════════
async function generarMensajeCobranzaIA({ cliente, mes, monto, tono = 'amable' }) {
  const cfg = obtenerConfiguracionIA();
  const nombre = cliente.nombre || 'Estimado(a) Cliente';
  const primerNombre = nombre.split(' ')[0];
  const zona = cliente.zona || 'su sector';
  const planMonto = Number(monto || cliente.plan || 65).toFixed(2);
  const planTipo = (cliente.plan == 65) ? 'Plan Normal' : (cliente.plan == 60 ? 'Plan Plus' : 'Plan Básico');

  // Si el usuario configuró una clave de Gemini, intentamos generar con Gemini
  if (cfg.geminiApiKey && cfg.geminiApiKey.trim().length > 10) {
    try {
      const prompt = `Eres el asistente virtual de cobranzas de la empresa de internet rural "${cfg.nombreEmpresa}".
Redacta un mensaje de WhatsApp para el cliente "${nombre}" de la zona "${zona}".
Datos del cobro:
- Mes pendiente: ${mes}
- Monto a pagar: S/. ${planMonto} (${planTipo})
- Tono solicitado: ${tono} (amable, formal, urgente o facilidad de pago).
- Métodos de pago disponibles: Yape/Plin al ${cfg.numeroYape} (${cfg.titularYape}) o BCP Cuenta ${cfg.cuentaBcp}.
Instrucciones:
- El mensaje debe ser claro, educado pero muy efectivo para que pague hoy.
- Usa emoticones apropiados y formato de negrita de WhatsApp (*texto*).
- Pide amablemente que al pagar envíe la foto o captura del comprobante por este chat para registrar su recibo.
- Devuelve SOLAMENTE el texto del mensaje listo para enviar, sin explicaciones ni comillas adicionales.`;

      const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${encodeURIComponent(cfg.geminiApiKey.trim())}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.7, maxOutputTokens: 350 }
        })
      });

      if (resp.ok) {
        const data = await resp.json();
        const textoIA = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (textoIA && textoIA.trim()) {
          return textoIA.trim();
        }
      }
    } catch(err) {
      console.warn('Fallo Gemini API, usando motor neural integrado:', err);
    }
  }

  // MOTOR NEURAL INTEGRADO (Funciona 100% offline sin necesidad de clave externa)
  switch (tono) {
    case 'amable':
      return `¡Hola *${primerNombre}*! 👋 Esperamos te encuentres muy bien.

Te saludamos de *${cfg.nombreEmpresa}* 📡 para recordarte de manera preventiva que ya está disponible el recibo de tu servicio de internet:

📌 *Detalles del Servicio:*
👤 *Abonado:* ${nombre}
📍 *Zona:* ${zona}
📅 *Mes:* ${mes}
💰 *Total:* S/. ${planMonto} (${planTipo})

💳 *Puedes pagar rápido y fácil por:*
📲 *Yape / Plin:* ${cfg.numeroYape} (${cfg.titularYape})
🏦 *BCP Cuenta:* ${cfg.cuentaBcp}
🏢 *Titular:* ${cfg.titularBcp}

Por favor, al realizar tu abono envíanos la captura de tu comprobante por este mismo chat para emitir tu *Recibo Oficial*. ¡Muchas gracias por tu preferencia! ✨`;

    case 'formal':
      return `*AVISO DE COBRANZA — ${cfg.nombreEmpresa.toUpperCase()}* 📡
━━━━━━━━━━━━━━━━━━━━━━━━━
Estimado(a) *${nombre}*, le saludamos cordialmente.

Le comunicamos que a la fecha registramos pendiente la mensualidad de su servicio de internet correspondiente al periodo *${mes}*.

📋 *ESTADO DE CUENTA:*
• *Titular:* ${nombre}
• *Zona / Sector:* ${zona}
• *Importe a Regularizar:* S/. ${planMonto}
• *Estado en Red:* Servicio Activo

Le solicitamos regularizar su pago el día de hoy a través de nuestros canales autorizados:
📱 *Yape / Plin:* ${cfg.numeroYape}
🏦 *Banco BCP:* ${cfg.cuentaBcp} (CCI: ${cfg.cciBcp})
👤 *Titular:* ${cfg.titularBcp}

Agradeceremos remitir la constancia o voucher de pago por este medio para validar su abono en el sistema.

Atentamente,
*Administración Leytrix ISP*`;

    case 'urgente':
      return `⚠️ *AVISO URGENTE DE CORTE DE SERVICIO* ⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━
Estimado(a) *${nombre}* (${zona}):

Le informamos que su servicio de internet se encuentra programado para *SUSPENSIÓN TEMPORAL* debido a la mensualidad pendiente de *${mes}*.

🚨 *Deuda Pendiente:* S/. ${planMonto}
⛔ *Estado:* Próximo a corte en sistema

Para evitar la interrupción de su señal de internet y costos adicionales por reconexión, por favor realice su pago de inmediato:

📲 *Yape o Plin al:* ${cfg.numeroYape} (${cfg.titularYape})
🏦 *BCP Cuenta:* ${cfg.cuentaBcp}

⚠️ *IMPORTANTE:* Envíe la captura o foto de su voucher por este chat de forma inmediata para cancelar la orden de corte y mantener su señal 100% activa.

*Área Técnica y Cobranzas — ${cfg.nombreEmpresa}*`;

    case 'convenio':
      return `Hola estimado(a) *${primerNombre}* (${zona}) 👋

Nos comunicamos de *${cfg.nombreEmpresa}* porque valoramos mucho que seas parte de nuestra red.

Notamos que tienes pendiente tu mensualidad de *${mes}* por un importe de *S/. ${planMonto}*. Si has tenido algún inconveniente o deseas coordinar una facilidad de pago o fecha de compromiso, por favor escríbenos por este medio para ayudarte y evitar que te quedes sin internet en casa.

Si ya puedes cancelarlo hoy:
📱 *Yape / Plin:* ${cfg.numeroYape}
🏦 *BCP:* ${cfg.cuentaBcp}

¡Quedamos atentos a tu respuesta para ayudarte! Que tengas un excelente día.`;

    default:
      return `Estimado(a) *${nombre}*, le recordamos el pago pendiente de su internet Leytrix del mes *${mes}* por S/. ${planMonto}. Pague por Yape al ${cfg.numeroYape} y envíe su voucher por aquí. ¡Gracias!`;
  }
}

// Enviar a WhatsApp con codificación segura
function abrirWhatsAppConMensaje(celular, mensaje) {
  const numLimpio = String(celular || '').replace(/\D/g, '');
  if (!numLimpio || numLimpio.length < 9) {
    alert('El cliente no tiene un número de celular o WhatsApp válido registrado.');
    return;
  }
  const codificado = encodeURIComponent(mensaje);
  const destino = numLimpio.startsWith('51') ? numLimpio : ('51' + numLimpio);
  const url = `https://api.whatsapp.com/send?phone=${destino}&text=${codificado}`;
  window.open(url, '_blank');
}
