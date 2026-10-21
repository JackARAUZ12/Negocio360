# Negocio360 Escritorio (piloto con modo sin conexión)

Guía del proyecto: [`PLAN.md`](PLAN.md). Avance: [`PROGRESO.md`](PROGRESO.md).

## Carpetas
| Carpeta | Qué hay |
|---|---|
| `src/main/` | Proceso principal de Electron (ventana, impresión, base local, sincronizador) — Fase 1 en adelante |
| `src/preload/` | Puente seguro página ↔ programa (`window.negocio360Print`, etc.) — Fase 1 |
| `herramientas/` | Scripts: inventario de librerías (`librerias.json` con versiones fijas), instalación de Electron, empaquetado de las páginas |
| `docs/` | `INVENTARIO-VENTA.md`: qué escribe hoy una venta en la base (referencia de la Fase 2) |
| `pruebas/unitarias/` | Pruebas automáticas (`npm run pruebas`) |
| `pruebas/electron/` | Prueba de humo de Electron con Playwright (`npm run humo`) |
| `pruebas/sql/` | Pruebas SQL que se corren dentro de una transacción revertida |
| `referencia-v1.0.1/` | Código recuperado del instalador anterior (solo referencia) |

Migraciones de base: `../supabase/migraciones/20261021_offline_*.sql`.

## Preparar una sesión nueva
```
cd escritorio
npm install                 # versiones exactas (package-lock.json)
npm run instalar-electron   # binario de Electron verificado (la descarga de npm falla tras el proxy)
npm run librerias           # comprueba que todas las librerías tienen copia local fija
npm run pruebas             # pruebas unitarias
npm run humo                # Electron + SQLite arrancan (usa xvfb)
```
