# Leytrix ISP v2.0 — Sistema Modular de Gestión de Clientes Internet

Sistema web profesional para administrar clientes de internet (ISP) en zonas rurales y urbanas.
100% compatible con **GitHub Pages** (`https://ediczon2006.github.io/leyder/`) y sincronización en la nube con **Supabase Cloud**.

## 🚀 Arquitectura Multi-Página Independiente

Cada sección funciona de manera autónoma en su propio archivo HTML con carga instantánea y sin bloqueos de scripts:

- 🏠 **[`index.html`](index.html)** — Panel de control principal con KPIs, resumen de las 6 zonas y pendientes del mes.
- 👥 **[`clientes.html`](clientes.html)** — Directorio completo de abonados con búsqueda en vivo, filtros, historial de pagos, edición y botón directo 💳 Pagar.
- ➕ **[`agregar.html`](agregar.html)** — Formulario rápido para nuevo abonado con botones de selección de planes (50, 60, 65 Plan Normal), cálculo de cable y zona.
- 💰 **[`pagos.html`](pagos.html)** — Registro de mensualidades, autocompletado de clientes, prellenado de monto por plan y emisión del **Comprobante estilo BCP / Banca Móvil**.
- ✂️ **[`cortes.html`](cortes.html)** — Gestión de cortes de servicio por morosidad, reconexión inmediata a estado ACTIVO y avisos por WhatsApp.
- 🗺️ **[`zonas.html`](zonas.html)** — Tarjetas de control y padrón por cada una de las 6 zonas (Loboyacu, Huayranga, Pacotillo, Ramal de Cachiyacu, Palmeras, Shishiyacu).
- 📅 **[`pendientes.html`](pendientes.html)** — Detección automática de abonados sin pago en el mes actual, cálculo de deuda acumulada y cobranza por WhatsApp en 1 clic.
- 📸 **[`explorador.html`](explorador.html)** — Archivo fotográfico exclusivo ISP para comprobantes Yape/BCP, routers ONT, cajas NAP en postes y fachadas de clientes (compatible con el explorador de archivos de Windows).
- 📊 **[`importexport.html`](importexport.html)** — Exportación e importación en Microsoft Excel (.xlsx), copias de seguridad completas en JSON y volcado SQL (MySQL).

---

## ☁️ Integración Supabase Cloud

- **URL Supabase:** `https://baeobhvgfrdbwyqapqzf.supabase.co`
- **Script SQL:** Archivo [`supabase_setup.sql`](supabase_setup.sql) listo para ejecutar en el SQL Editor de Supabase (tablas `clientes`, `pagos`, `cortes`, `fotos` con políticas RLS e índices optimizados).
- **Almacenamiento Híbrido:**
  - **Local First (IndexedDB):** Funciona al 100% incluso sin conexión a internet en campo.
  - **Nube (Supabase Cloud):** Sincronización bidireccional automática para acceder desde cualquier celular o PC.

---

## 📋 Reglas de Negocio ISP

1. **Zonas de Cobertura:**
   - Loboyacu
   - Huayranga
   - Pacotillo
   - Ramal de Cachiyacu
   - Palmeras
   - Shishiyacu

2. **Planes de Internet:**
   - **S/. 50** — Plan Básico
   - **S/. 60** — Plan Plus
   - **S/. 65** — Plan Normal

3. **Recibo / Voucher Bancario BCP & Guardado en la Nube:**
   - Formato idéntico a comprobante oficial de **Agente BCP** con N° de Operación, código de autorización y código QR dinámico de validación electrónica.
   - **Guardado Automático:** Cada voucher emitido se convierte a imagen PNG de alta resolución y se guarda automáticamente en la tabla `fotos` de Supabase Cloud y la galería local, para no perder ningún comprobante.
   - **Compartir Multicanal:** Envío directo al WhatsApp del cliente (`wa.me`), compartir archivo nativo en celulares (`navigator.share`), descarga de imagen PNG e impresión térmica / PDF (`@media print`).

4. **🤖 Asistente de Cobranzas con Inteligencia Artificial (IA WhatsApp):**
   - Redacción inteligente de mensajes persuasivos con selector de tonos (Amable, Formal de fin de mes, Urgente pre-corte y Convenio de pago).
   - Inclusión automática de datos de pago (Yape, Plin y BCP) y monto personalizado.
   - Motor neural local integrado (funciona 100% offline) con opción de conectar la API de Google Gemini para personalización avanzada.
