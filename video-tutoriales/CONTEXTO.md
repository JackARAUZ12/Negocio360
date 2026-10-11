# Videos de Negocio360: contexto para continuar en otro chat

Este documento resume todo lo hecho en el chat anterior para que un nuevo chat de Claude siga el mismo trabajo.
**Primer paso en el chat nuevo:** "Leé `video-tutoriales/CONTEXTO.md` de la rama `claude/laughing-faraday-s3hexs` y seguimos".

## Reglas del dueño (respetar siempre)
- **Negocio360 no tiene "fiados"**: siempre decir **créditos**.
- **No inventar funciones ni números.** Usar solo pantallas reales del sistema, con datos demo.
- El usuario habla español de Nicaragua (voseo): "conocés", "tenés", "tocá".
- **Tutoriales**: 16:9 1920×1080, con la voz de ElevenLabs que manda el usuario sin modificarla, música lo-fi que baja sola cuando habla (ducking) y efectos. Él pide "solo el video final".
- **Anuncios verticales (9:16)**: si el brief dice "sin música", va sin música y con los efectos en una pista aparte.
- Si se envía un archivo con SendUserFile, debe pesar **menos de 30 MiB**. Si se pasa, comprimir con crf 26–27 y `-tune stillimage`.
- Al terminar cada tutorial, ofrecer el guion del siguiente.

## Entregado hasta ahora
- **Anuncios verticales**:
  - promo
  - 3 errores
  - Farmacia
  - Distribuidoras (con unidades de medida, 5 usuarios a la vez, lector de código de barras, impresoras, proformas)
  - Reels
  - anuncio "Diego"
  - anuncio "Renata" (sin música, "DESDE $10 AL MES", CTA "COMENTÁ 'QUIERO VERLO'")
- **Tutoriales 16:9**:
  - Dashboard (sin voz)
  - **Ventas**
  - **Productos/Servicios**
  - **Clientes** (190.43 s, 10 capítulos, cierra con "Próximo tutorial: Compras")
  - **Compras** (172.51 s, 10 capítulos, cierra con "Próximo tutorial: Gastos"). Archivos: `capco.js`, `tco_script.js`, `rtco.js`, `tco_sfx.py`, `tco_music.py`.

## Siguiente: tutorial de GASTOS
Falta escribir el guion de Gastos (`gastos.html` / `gastos.js`), entregárselo al usuario y esperar el audio. Para las capturas, crear `capg.js` copiando `capco.js`.

## Compras (ya entregado): secciones del guion

1. Intro
2. KPIs: compras hoy/mes, cantidad, productos ingresados, inversión inventario, proveedores activos
3. Historial y filtros: Hoy/Semana/Mes/Año/Personalizado, búsqueda
4. Nueva Compra:
   - producto existente o nuevo
   - asistente de 7 pasos
   - Paso 1: proveedor, con "Crear nuevo proveedor"
5. Buscar productos y carrito:
   - cantidad, costo unitario, descuento
   - 🎀 regalía (costo C$0)
   - IVA 15 %
   - lote y vencimiento
6. Resumen, método de pago y banco, Caja Chica / Caja General, estado Completada o Pendiente
7. Guardar: sube el stock, crea un EGRESO en Caja y actualiza el Dashboard. "Dinero → Inventario"
8. Producto nuevo: crea el producto, registra la compra y descuenta de caja en un solo paso
9. Compra Directa: gasto de contado que no toca inventario
10. Órdenes de Compra: cotización en PDF, "Convertir en Compra"
11. Pestaña Proveedores (última compra, monto acumulado, editar, activar/desactivar) y Anular compra (revierte stock y caja)
12. Cierre: "Próximo tutorial: Gastos"

Notas:
- Las compras a crédito entran por **Cuentas por Pagar**, por eso no se mencionaron.
- En el paso 6 aparece el texto "(Cuentas por pagar disponibles en futuras versiones)", que está desactualizado. Conviene ocultarlo en la captura.
- Funciones del módulo en `compras.js`:
  - `abrirNuevaCompra`, `elegirTipoNuevaCompra('existente'|'nuevo')`, `irAPaso(n)`, `pasoSiguiente`
  - `toggleNuevoProveedor(true)`, `buscarProductoNuevaCompra`, `alternarRegaliaCompra(idx)`, `toggleIVA`
  - `abrirCompraDirecta`, `mostrarSeccionOrdenes`, `setSeccion('proveedores')`
  - `verDetalleCompra(id)`, `confirmarAnularCompra(id)`, `abrirPersonalizarDocumentos`

## Cómo se hacen los videos (carpeta `tools/`)
Todo se hace con código: Playwright (Chromium), ffmpeg y numpy. Pasos:

1. **Preparar**:
   - Copiar `tools/` al scratchpad.
   - Instalar fuentes y librerías: `cd deps && npm ci`. Trae chart.js, lucide y las fuentes; los CDN están bloqueados por el proxy.
   - Playwright se carga desde `/opt/node-tools/node_modules/playwright`.
   - `REPO = /home/user/Negocio360` en `open.js` y `mob.js`.
2. **Mock de datos** (`fake-supabase.js`):
   - Reemplaza supabase-js con datos demo: negocio "Distribuidora Torres", usuario Carlos, reloj fijo 2026-10-10 10:24 hora de Managua.
   - Ya tiene: productos, ventas (con ids string), clientes (Mini Súper Jireh es el id 4 con perfil completo), proveedores, compras, combos, promociones, lotes, bancos (BANPRO, LAFISE, BAC) y métodos de pago.
   - Flags activos: `maneja_lotes_vencimiento`, `usa_puntos`, `maneja_presentaciones`, `usa_numero_serie`.
   - **Para Compras:** revisar y ampliar los datos de `compras`, `detalle_compras`, `proveedores` y `ordenes_compra`.
3. **Capturar** (por ejemplo `capc.js` para Clientes):
   - Abre la página real con `openDash(browser,{file:'clientes.html', dpr:2, clean:true})`.
   - Ejecuta funciones de la app para llegar a cada estado.
   - Guarda capturas `Xshots/<estado>_top.jpg` y `meta.json` con los rectángulos de cada elemento.
   - Para Compras, crear `capco.js` copiando `capc.js`.
4. **Transcribir el audio**:
   - Usar sherpa-onnx (pip) con whisper-small int8, descargado del release de GitHub `k2-fsa/sherpa-onnx` `asr-models`.
   - Cortar en segmentos con ffmpeg `silencedetect noise=-35dB d=0.14`, de hasta 29.5 s cada uno.
   - De ahí salen los tiempos de cada frase.
5. **Escribir el guion del video** (por ejemplo `tc_script.js`):
   - Keyframes de cámara/zoom, estados, `sl()` para spotlight con etiqueta, cursor y clics, capítulos y la tarjeta final.
   - El HTML del video se arma con `cat tv_head.html tc_script.js > tc.html`.
6. **Renderizar**:
   - `rtc.js` (modos `info` / `stills` / `video f0 f1 out`) avanza `render(t)` cuadro por cuadro a 30 fps y lo pasa a ffmpeg.
   - Se usan 4 procesos en paralelo, uno por parte (`tcpart0..3.mp4`).
   - Para esperar el render: `pgrep -f "[n]ode rtc.js video"`.
7. **Audio**:
   - Efectos: `tc_sfx.py`, que usa `sfxlib.py`.
   - Música: `tc_music.py`.
   - Para Compras, copiar como `tco_*`.
8. **Mezcla final** (mismo método que Clientes):
```
ffmpeg -f concat -safe 0 -i list.txt -c:v libx264 -preset slow -crf 26 -tune stillimage -pix_fmt yuv420p video.mp4
ffmpeg -i VOZ.mp3 -i music.wav -filter_complex "[0:a]aresample=44100,pan=stereo|c0=c0|c1=c0[key];[1:a]volume=0.5[m];[m][key]sidechaincompress=threshold=0.05:ratio=2.5:attack=30:release=500[md]" -map "[md]" -t DUR music_ducked.wav
ffmpeg -i video.mp4 -i VOZ.mp3 -i sfx.wav -i music_ducked.wav -filter_complex "[1:a]aresample=44100,pan=stereo|c0=c0|c1=c0[v];[2:a]volume=0.6[s];[v][s][3:a]amix=inputs=3:normalize=0:duration=first,alimiter=limit=0.95:level=disabled[a]" -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 160k -t DUR -movflags +faststart Tutorial-X-Negocio360.mp4
```
9. **Verificar antes de enviar**:
   - La duración coincide con el audio.
   - El video decodifica sin errores: `ffmpeg -v error -f null`.
   - Revisar volumen con volumedetect y una tira de cuadros de muestra.
   - Peso menor de 30 MiB.

## Errores ya resueltos (no repetir)
- **Recurrentes salían todos los clientes**: los clientes del mock necesitan `tipo_cliente:'normal'`.
- **El detalle de venta no abría**: la app compara ids como texto, así que los ids de ventas del mock van como string.
- **Tipo de interacción salía "Otro"**: usar `'mensaje'`, no `'whatsapp'`.
- **Fracción en input numérico**: usar `permite_fraccion` y `cambiarCantidad`.
- **Overlays detrás de las vistas**: `#views` con z-index 0 y overlays con 5 o más.
- **Cámara muy lejos en modales**: `sl()` enfoca automáticamente los spots que están dentro de un modal.
- **Elementos fijos**: detectarlos con `getClientRects().length`, no con `offsetParent`.
- **Separador de selectores en `capc.js`**: es `||`. No usar `^` porque choca con los selectores `[onclick^=...]`.
- **Música inaudible en la mezcla**: hacer el ducking por separado antes de mezclar.
- **Datos de Compras en el mock**: compras, proveedores y órdenes usan ids de texto (`cmp1`, `pv1`, `oc1`) porque la app los compara con `===` contra el valor del `onclick` o del select. Los productos siguen con ids numéricos: llamar `agregarProductoAlCarrito(1)` con número.
- **Caja Chica / Caja General** en el paso 6 solo aparece si hay una sesión abierta hoy. El mock trae una en `caja_chica_sesiones`.
- **"Convertir en Compra" abre el paso 0** ("¿Qué vas a comprar?") en vez del carrito. Es un bug real de `convertirOrdenACompra`: no oculta `nc-paso-0` ni muestra `nc-wizard-body` y `nc-steps`. En la captura se corrigió a mano con el DOM.
- **Música y efectos**: `sfxlib.py` pide las variables de entorno `DUR`, `DROP` y `BPM` (Compras: `DUR=172.51 DROP=0 BPM=80`).
- **HTML del video**: envolver el script en `<script>…</script>`: `(cat tv_head.html; echo '<script>'; cat tco_script.js; echo '</script></body></html>') > tco.html`.
- **Esperar procesos**: no usar `while pgrep -f "texto"` en el mismo comando que contiene ese texto, porque se encuentra a sí mismo y nunca termina.
