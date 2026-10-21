# Código del instalador anterior (Negocio360-Setup.exe 1.0.1)

Este código **no estaba** en el repositorio. Se recuperó el 2026-10-21 abriendo
el propio `Negocio360-Setup.exe` de `main` (instalador NSIS → `app-64.7z` →
`resources/app.asar`). Es solo **referencia** para rehacer el programa; no se
empaqueta ni se ejecuta.

## Qué hacía la 1.0.1
- Electron **30.5.1**. Ventana que abre la web en línea
  (`https://negocio360oficial.com/login.html`): sin internet no funciona y
  muestra `offline.html` con un botón de reintentar.
- Pantalla de bienvenida (`splash.html`, 2,6 s, sonido `assets/inicio.wav`) y
  aparición suave de la ventana.
- Menú propio (Recargar, Términos, Privacidad, Acerca de), sin herramientas de
  desarrollador. Los enlaces externos se abren en el navegador de Windows.
- **Impresión directa** (lo que hay que conservar idéntico para la web):
  `preload.js` expone `window.negocio360Print = { disponible: true,
  listarImpresoras(), imprimir(nombreImpresora, bytes) }`.
  - `listarImpresoras()` → `{ ok, impresoras: [nombres], motivo? }` usando
    `Get-Printer` de PowerShell.
  - `imprimir(nombre, Uint8Array)` → `{ ok, motivo? }`. Escribe los bytes
    ESC/POS a un archivo temporal y ejecuta un script PowerShell con
    WinSpool (`OpenPrinter` / `StartDocPrinter` tipo **RAW** /
    `WritePrinter`).
  - La web (`ventas.js`) lo usa si existe y si hay una impresora guardada en
    `localStorage('n360_impresora_nativa')`; si falla, cae a Bluetooth, USB
    del navegador o impresión normal.

## Problemas encontrados (se corrigen en la versión 2)
1. **Seguridad:** el nombre de la impresora se pega dentro del script de
   PowerShell entre comillas dobles escapando solo `"`. Un nombre con
   `$(...)` se ejecutaría como comando. Como la ventana carga una página web,
   cualquier fallo de seguridad en el sitio podría terminar ejecutando
   programas en la computadora. → En la v2 el nombre nunca se mete en el
   código del script: se valida contra la lista real de impresoras de Windows
   y se pasa como dato (archivo/variable), no como texto del programa.
2. Archivos temporales con nombre predecible (`Date.now()`), y si
   PowerShell tarda más de 15 s se pierde el ticket sin aviso claro.
3. Varias instancias abiertas a la vez (no tenía "una sola instancia").
4. Sin actualización automática: cada versión había que reinstalarla.
5. Sin modo sin conexión (objetivo de este proyecto).
