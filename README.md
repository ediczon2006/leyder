# Leytrix ISP — Sistema de Gestión de Clientes

Sistema web para administrar clientes de internet (ISP) en zonas rurales.
No requiere instalación. Funciona abriendo `index.html` en cualquier navegador.

## ¿Cómo usar?

### En tu laptop (sin internet)
Doble clic en `index.html` — se abre directamente en el navegador.

### Como link de GitHub Pages
1. Sube el repositorio a GitHub
2. Ve a **Settings → Pages → Branch: main → / (root)**
3. Comparte el link generado

## Funciones

- ➕ **Agregar clientes** con: nombre, DNI, celular, fecha de inicio, dirección, IP, zona, plan y cable (sí/no)
- 👥 **Lista de clientes** con columna de fecha de inicio, búsqueda y filtros por zona, estado y plan
- 💰 **Registrar pagos** mensuales (Efectivo, Yape, Plin…)
- ✂️ **Cortes y reconexiones** de servicio
- 🗺️ **Vista por zona**: Loboyacu, Huayranga, Pacotillo, Ramal de Cachiyacu, Palmeras, Shishiyacu
- 📅 **Pendientes del mes** con corte masivo
- 📊 **Importar y exportar Excel** de clientes (incluye fecha de inicio), pagos y cortes

## Zonas disponibles
- Loboyacu · Huayranga · Pacotillo · Ramal de Cachiyacu · Palmeras · Shishiyacu

## Planes
- S/. 50 — Plan Básico
- S/. 60 — Plan Plus
- S/. 65 — Plan Normal

## Recibos, Impresión y WhatsApp
- 🧾 **Comprobante estilo banca móvil** con N° de operación único y diseño profesional.
- 💬 **Enviar por WhatsApp al Cliente**: Abre directamente el chat con el número del cliente (`wa.me`), mensaje detallado del pago y descarga automática de la imagen para adjuntar.
- 🖨️ **Impresión nativa**: Optimizado con `@media print` para imprimir directo en impresora o guardar como PDF en PC y móvil sin bloqueos de popups.
- 📸 **Descargar imagen PNG**: Comprobante en alta resolución para enviar por cualquier red social o correo.
- 📤 **Compartir nativo**: Web Share API en teléfonos móviles.

## Guardado de Datos y Cómo Compartir entre Dispositivos
- 🛡️ **Almacenamiento Persistente**: Los datos se almacenan en **IndexedDB persistente** del navegador. No se borran al cerrar el navegador o reiniciar el equipo.
- 📦 **Copia de Seguridad Completa (.json)**: En la pestaña *Importar / Exportar*, puedes descargar un respaldo con todos los clientes, pagos y cortes.
- 🔄 **Compartir Base de Datos**: Para pasar los datos a otra laptop o celular, descarga el archivo de respaldo (`.json`) y cárgalo con un solo clic en el otro equipo mediante *Restaurar Respaldo*.
- 🐬 **Exportar a MySQL (.sql)**: Genera un script SQL con la estructura de tablas (`clientes`, `pagos`, `cortes`) y todos los datos en sentencias `INSERT` para importar directamente en **MySQL, MariaDB, XAMPP o phpMyAdmin**.
- 📊 **Excel (.xlsx)**: También puedes importar y exportar en formato Excel en cualquier momento.

> **Nota sobre MySQL / Servidores Cloud:**
> GitHub Pages es un hosting estático (no ejecuta servidores de backend como `mysqld.exe` directamente). Por eso, el sistema almacena todo en **IndexedDB persistente local** (sin límite de capacidad) y te permite **descargar tu base de datos en formato MySQL (.sql)** en cualquier momento para usarla en cualquier servidor MySQL.



