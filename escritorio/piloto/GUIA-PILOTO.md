# Negocio360 Escritorio — Guía del piloto (versión 2.0.0-piloto.2)

Esta es una versión **de prueba** solo para la cuenta piloto
(jackarauz2008@gmail.com). Las demás cuentas pueden instalarla y funciona
igual que la web, pero **sin** el modo sin conexión.

## 1. Antes de instalar
- Computadora con **Windows 10 u 11 de 64 bits**.
- Si tienes instalado el Negocio360 anterior (1.0.1), **desinstálalo primero**
  (Inicio → Configuración → Aplicaciones → Negocio360 → Desinstalar). No se
  pierde nada: tus datos están en el servidor.
- Ten **internet** la primera vez.

## 2. Instalar
1. Abre `Negocio360-Escritorio-Piloto-2.0.0-piloto.2.exe`.
2. Windows puede decir "Windows protegió su PC" (el programa no tiene firma
   digital, igual que la versión anterior): toca **Más información** →
   **Ejecutar de todas formas**.
3. Elige la carpeta (o deja la que propone) y termina. Queda un acceso
   directo "Negocio360" en el escritorio.

Opcional: para comprobar que el archivo no se dañó al copiarlo, su huella
SHA-256 está en `SHA256.txt`.

## 3. Primera vez (con internet) — importante
1. Abre Negocio360 e **inicia sesión** con tu correo y contraseña.
2. Entra a **Ventas** y espera unos segundos. En ese momento el programa:
   - registra esta computadora para el modo sin conexión,
   - aparta 50 números de factura para esta computadora,
   - guarda una copia de productos, clientes, métodos de pago y bancos.
3. Elige la impresora: en Ventas, en la configuración de la impresora del
   ticket (junto a "Conectar impresora USB") aparece **"🖥️ Detectamos la app de
   escritorio — elige tu impresora"** → **EPSON TM-U220** (o la que uses).
   Haz una venta de prueba para ver que imprime.
4. Si usas **perfiles con código** (administradores): cada administrador debe
   escribir su código **una vez con internet** en esta computadora. Solo así
   podrá entrar sin internet. (Los perfiles de empleado funcionan sin
   internet desde el principio.)
5. Abre el menú **Negocio360 → Sincronización** y revisa que diga "Números de
   venta apartados: 50".

## 4. Uso diario
- Abajo a la izquierda hay un indicador:
  - 🟢 **En línea**: todo normal.
  - 🟠 **Conexión inestable** o **"N venta(s) por subir"**: hay ventas guardadas
    en la computadora que se están subiendo.
  - 🔴 **Sin conexión**: no hay internet.
- **Con internet** todo funciona igual que la web. Las ventas de contado y
  pago dividido se guardan primero en la computadora y suben en segundos.
- **Sin internet**:
  - **Ventas** sigue funcionando: venta normal y venta rápida, de contado o
    con pago dividido. El ticket se imprime igual.
  - Puedes buscar productos y clientes y ver las ventas recientes.
  - **No se puede sin internet**: fiado, crédito, crear un cliente nuevo,
    vender stock de otra sucursal, recetas, números de serie, canje de
    puntos. El programa te avisa y no guarda nada.
  - Las demás pantallas muestran "Requiere conexión" con un botón **Ir a
    Ventas**.
- **Al volver el internet**, las ventas suben solas, una por una. No hay que
  hacer nada.
- **Cierre de caja**: el programa no te deja cerrar caja mientras queden
  ventas de esta computadora por subir. Espera a que el indicador vuelva a 🟢.
- Si se va la luz o se apaga la computadora, las ventas ya registradas **no
  se pierden**: al volver a abrir, siguen ahí y se suben.

## 5. Pantalla "Sincronización"
Menú **Negocio360 → Sincronización** (o toca el indicador de abajo).
- Ventas por subir, ventas con problema, números apartados, última subida.
- **Subir ahora**: intenta subir de inmediato.
- **Exportar ventas pendientes**: guarda un archivo con las ventas que aún no
  subieron (respaldo extra; útil si hubiera que revisar algo con soporte).
- **Anular**: solo para ventas que **todavía no subieron**. Las ya subidas se
  anulan desde Ventas, con internet, como siempre.
- **Avisos del servidor**: cosas para revisar, por ejemplo:
  - *stock en negativo* (dos cajas vendieron la última unidad: las dos ventas
    son válidas, revisa el inventario),
  - *precio distinto* (se cobró el precio que tenía la computadora),
  - *número reemplazado* (si se acabaron los números apartados sin internet,
    el servidor le pone el siguiente número libre),
  - *reloj desfasado* (la hora de la computadora estaba mal; se usó la del
    servidor).
  Toca **Revisado** cuando lo atiendas.

## 6. Qué hacer si…
- **"Necesita internet"** al cobrar: la venta tiene algo que sin internet no
  se permite (fiado, cliente nuevo…). Cóbrala de contado o espera internet.
- **Una venta "con problema"** en Sincronización: toca **Reintentar**. Si
  sigue, usa **Exportar ventas pendientes** y avísale a soporte; la venta
  nunca se borra sola.
- **"La sesión necesita renovarse"**: se arregla sola al volver internet. Si
  pasaron muchos días, vuelve a iniciar sesión (las ventas pendientes se
  conservan y se suben después).
- **No imprime**: revisa que la impresora esté encendida y elegida en Ventas.
  La venta ya quedó guardada aunque no imprima.

## 7. Datos técnicos (para soporte)
- Base local: `%APPDATA%\Negocio360\local\negocio360.db`; respaldos diarios
  (últimos 7) en `%APPDATA%\Negocio360\local\respaldos\`.
- Desinstalar no borra esa carpeta (por seguridad de ventas pendientes).
- Las actualizaciones automáticas no se instalan mientras haya ventas sin
  subir.
