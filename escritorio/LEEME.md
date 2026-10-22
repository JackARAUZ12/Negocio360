# Negocio360 Escritorio (piloto con modo sin conexión)

Guía del proyecto: [`PLAN.md`](PLAN.md). Avance: [`PROGRESO.md`](PROGRESO.md).

## Carpetas
| Carpeta | Qué hay |
|---|---|
| `src/main/` | Proceso principal: `main.js` (ventanas, menú, una sola instancia), `rutas.js` (páginas empaquetadas en `app://negocio360`), `seguridad.js` (qué se abre y dónde), `impresion.js` (RAW a Windows), `conexion.js` (indicador 🟢🟠🔴), `actualizador.js`, `config.js`, `base-local.js` (SQLite: catálogo, bandeja, números, códigos, respaldo), `sincronizador.js` (sube las ventas) |
| `web/` | Scripts y pantallas propias del programa que el empaquetador agrega a la copia (modo sin conexión, pantalla Sincronización) |
| `src/preload/` | Puente seguro página ↔ programa: `window.negocio360Print` (igual que la 1.0.1) y `window.negocio360Escritorio`; dibuja el indicador y el aviso "Requiere conexión" |
| `recursos/` | Pantalla de bienvenida, "Acerca de", ícono y `imprimir-raw.ps1` (WinSpool) |
| `herramientas/` | `empaquetar-web.js` (copia las páginas y cambia las librerías de internet por las locales), `librerias.json` (versiones fijas), `inventario-librerias.js`, `instalar-electron.sh` |
| `electron-builder.yml` | Fabricación del instalador de Windows (NSIS) |
| `docs/` | `INVENTARIO-VENTA.md` (qué escribe hoy una venta) y `PAQUETE-VENTA.md` (contrato de la venta sin conexión) |
| `src/compartido/` | Código que usan el programa y las pruebas: `registro-a-payload.js`, `motor-local.js` |
| `pruebas/referencia-web/` | Ventas reales de `ventas.js` con Supabase simulado + generador de la prueba SQL centavo por centavo (`npm run referencia`) |
| `pruebas/unitarias/` | `npm run pruebas` |
| `pruebas/e2e/` | Programa real con Playwright (`npm run e2e`), con Supabase simulado (`servidor-falso.js`) |
| `pruebas/navegador/` | Pantalla real de Ventas sin internet en Chromium (`npm run navegador`) |
| `pruebas/electron/` | Prueba de humo de Electron + SQLite (`npm run humo`) |
| `pruebas/sql/` | Pruebas SQL que se corren dentro de una transacción revertida |
| `piloto/` | **Entregables del piloto**: instalador, SHA-256, guía de uso e informe final |
| `referencia-v1.0.1/` | Código recuperado del instalador anterior (solo referencia) |

Migraciones de base: `../supabase/migraciones/20261021_offline_*.sql`.
Lo generado (`build/`, `dist/`) no se guarda en git.

## Preparar una sesión nueva
```
cd escritorio
npm install                 # versiones exactas (package-lock.json)
npm run instalar-electron   # binario de Electron verificado (la descarga de npm falla tras el proxy)
npm run librerias           # comprueba que todas las librerías tienen copia local fija
npm run pruebas             # pruebas unitarias
npm run e2e                 # empaqueta las páginas y prueba el programa real (xvfb)
npm run iniciar             # abre el programa
```

## Fabricar el instalador de Windows (desde Linux)
Necesita `wine` de 64 y 32 bits (para armar el desinstalador):
```
apt-get install -y --no-install-recommends wine64 wine
dpkg --add-architecture i386 && apt-get update && apt-get install -y --no-install-recommends wine32:i386
npm run instalador-win      # -> dist/Negocio360-Escritorio-Piloto-<versión>.exe
```
El instalador no va firmado digitalmente (Windows mostrará "editor
desconocido" la primera vez; igual que la 1.0.1).

## Variables solo para pruebas
Se aceptan únicamente si el programa NO está instalado (`app.isPackaged`
falso) y `N360_PRUEBA=1`: `N360_URL_SALUD`, `N360_WEB_DIR`, `N360_DATOS_DIR`,
`N360_SIN_SPLASH`, `N360_IMPRESION_SIMULADA` (guarda los tickets en una
carpeta en vez de mandarlos a Windows), `N360_SUPABASE_URL` (servidor
simulado) y `N360_INTERVALO_CONEXION_MS`.
