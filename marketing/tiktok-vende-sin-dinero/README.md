# TikTok — “Tu negocio vende, pero tú sigues sin dinero”

Montaje vertical 1080×1920, 30 fps, para Negocio360.

**Versión actual: 100 % generada, sin grabaciones.** El video `salida/negocio360_tiktok.mp4` ya está terminado y listo para subir:
- Las escenas del presentador y el B-roll son animaciones generadas por código (`generado.py`): fondo animado, bolsa de dinero, billetera vacía, billetes que se van, cajas, libreta de fiados, facturas, signos de pregunta y alerta.
- La interfaz es real. Son capturas del código de este repositorio (Ventas, Gastos, Caja, Créditos, menú de módulos y Dashboard), sacadas con `capturar_ui.mjs` en una cuenta sin datos, por eso todo aparece en 0 y no hay cifras inventadas. Están en `assets/ui/`.
- Si después grabas tomas reales y las pones en `clips/`, se usan en lugar de lo generado. El montaje incluye voz, subtítulos sincronizados palabra por palabra, titulares, música, efectos, transiciones y cierre con el logotipo original. Faltan **solo las tomas reales**. Cada toma que falta aparece como un recuadro “INSERTAR …” en `salida/negocio360_tiktok.mp4`.

## Duración
La locución recibida dura 41,1 s. Solo se acortaron los silencios largos entre frases, a 0,30 s como máximo, y se conservó la pausa antes de “vender mucho no significa ganar mucho”. **No se cambió la velocidad ni el tono de la voz**, así que el video dura **39,9 s**. Para bajar de 30 s habría que grabar una locución más ágil o acortar el guion.

## Cómo terminarlo
1. Graba las tomas de la tabla y colócalas en `clips/` con el nombre exacto. Se aceptan `.mp4`, `.mov`, `.jpg` y `.png`.
2. Ejecuta `python3 build.py`. Necesitas Python 3, numpy, Pillow y ffmpeg. El render tarda unos 80 s.
3. El resultado queda en `salida/negocio360_tiktok.mp4`.

Para revisar un instante concreto: `python3 build.py --frame 15.2` genera un PNG en `salida/`.

| Archivo en `clips/` | Momento | Qué grabar |
|---|---|---|
| `presentador.mp4` | 0–25,8 s (con cortes) | **Una sola toma vertical continua.** Empresario o asesor joven en un local real (tienda, mostrador, bodega), mirando a cámara con expresión seria, segura y algo preocupada. Debe hacer lip-sync del guion completo mientras escucha `assets/voz.wav` con un audífono. El segundo 0 de la toma tiene que coincidir con el segundo 0 de la voz: recórtala para que empiece justo en la primera sílaba. Coloca los ojos a ~40 % de la altura del cuadro, con luz suave lateral y el fondo con algo de profundidad. El programa hace los acercamientos. |
| `b_proveedores.mp4` | 6,2–7,6 s | Pago a un proveedor: billetes entregados o una transferencia en el celular |
| `b_mercancia.mp4` | 7,6–8,9 s | Cajas o mercancía que llega o se acomoda |
| `b_libreta.mp4` | 8,9–10,3 s | Libreta de cuentas pendientes o de fiado, con una mano que anota |
| `b_facturas.mp4` | 10,3–11,4 s | Facturas sobre el mostrador |
| `ui_ventas.mp4` | 25,8–26,6 s | Grabación real de la pantalla de Ventas |
| `ui_gastos.mp4` | 26,6–27,3 s | Grabación real de Gastos |
| `ui_caja.mp4` | 27,3–27,9 s | Grabación real de Caja |
| `ui_cuentas_pendientes.mp4` | 27,9–28,8 s | Grabación real de Créditos, Fiados o Cuentas por pagar |
| `ui_general.mp4` | 28,8–34,7 s | Recorrido real por el sistema: panel y módulos |

**Interfaz:** usa grabaciones del sistema real con datos reales o de una cuenta de demostración real. No se inventan cifras ni pantallas. Si la grabación es del celular (vertical), ocupa toda la pantalla. Si es de escritorio (horizontal), se muestra como tarjeta flotante con un acercamiento suave para que se lea en el teléfono. Cada toma se usa desde su segundo 0, así que recórtala para que empiece en la acción.

## Estructura
| Tiempo | Escena |
|---|---|
| 0–6,2 s | **Gancho.** Primer plano con acercamiento sutil. El titular “¿VENDES, PERO NO TIENES DINERO?” se ve desde el primer cuadro. |
| 6,2–13,9 s | **Problema.** Cortes de B-roll y vuelta al rostro. Se resaltan *proveedores*, *crédito* y *dónde quedó… dinero*. |
| 13,9–23,7 s | **Impacto.** Punch-in con “VENDER MUCHO / NO SIGNIFICA / GANAR MUCHO” y luego tres tarjetas separadas: VENTAS, GASTOS y DINERO DISPONIBLE. No se suman ni se igualan. |
| 23,7–34,7 s | **Solución.** “Por eso necesitas…” en el rostro, transición rápida a la interfaz real (ventas, gastos, caja, cuentas pendientes) y recorrido general. La música cambia a un tono positivo. |
| 34,7–39,9 s | **Cierre.** Logotipo original sobre fondo limpio, “NO ADMINISTRES TU NEGOCIO A CIEGAS” y “ESCRÍBENOS”. |

## Archivos
- `assets/voz_original.mp3`: locución entregada (ElevenLabs, Diego).
- `assets/voz.wav`: locución con las pausas ajustadas y normalizada. La genera `preparar_voz.py`.
- `assets/palabras.json`: tiempo de cada palabra de `voz.wav`, para sincronizar los subtítulos y los cortes.
- `audio.py`: música instrumental original sintetizada (sin derechos de terceros) y efectos sonoros discretos. La música baja automáticamente debajo de la voz.
- `build.py`: montaje completo. Ahí se editan los tiempos (`ESCENAS`), los subtítulos (`SUBS`) y los efectos (`SFX`).
- Logotipo: `negocio360-logo-light-bg.png`, en la raíz del repositorio, sin modificaciones.
