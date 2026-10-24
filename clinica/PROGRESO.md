# Progreso — Módulo Clínica

| Fase | Estado | Integrada a main | Notas |
|---|---|---|---|
| 1 — Base para atender y cobrar | ✅ Terminada y probada | Ver bitácora | Agenda, pacientes/expediente con candado, consulta firmada, equipo y seguridad, cobro por Ventas |
| 2 — Documentos | Pendiente | | |
| 3 — Operación diaria | Pendiente | | |
| 4 — Especialidades | Pendiente | | |
| 5 — Crecimiento y cierre | Pendiente | | |

## Fase 1 — qué se hizo

**Pantallas nuevas** (solo aparecen si la cuenta enciende "Módulo de Clínica"):
- `clinica-agenda.html` — citas por día o semana, filtro por médico, estados (programada,
  confirmada, en sala de espera, en consulta, atendida, no asistió, cancelada con motivo),
  paciente nuevo al vuelo, choque de horarios (también en el servidor), recordatorio por
  WhatsApp, cuenta de la visita y "Cobrar en Ventas".
- `clinica-pacientes.html` — pacientes (número de expediente automático, edad automática,
  cédula sin duplicados, contacto de emergencia, vínculo con Clientes), expediente clínico
  con PIN médico: alergias como alerta, antecedentes (con copia de cada versión anterior),
  consulta de medicina general (motivo, enfermedad actual, signos vitales con IMC y avisos,
  examen, diagnóstico, plan, indicaciones, próximo control → agendar cita), borrador,
  "Cerrar y firmar", adendas y anulación con motivo.
- `clinica-equipo.html` — personal (médico / recepción / administración) con su PIN,
  consultorios, especialidades, bitácora de accesos, cambiar mi PIN.
- Utilidades: `clinica-comun.js` (cálculos puros), `clinica-sesion.js` (candado), `clinica.css`.

**Cambios en archivos compartidos** (no cambian nada para cuentas sin Clínica; probado):
- `modulos-registro.js`: 3 módulos con `flagPropio: 'usa_modulo_clinica'`; Lotes y
  Vencimientos también se muestran a Clínica.
- `modulos-guard.js`: lee el interruptor `usa_modulo_clinica` (consulta aparte, como los demás).
- `ventas.js`: `aplicarCobroClinica()` (mismo camino que Veterinaria: `sessionStorage`
  `n360_clinica_cobro`), liga la venta a la cita, no deja cobrar dos veces la misma visita,
  y aplica FEFO/bloqueo de vencidos también a cuentas con Clínica.
- `lotes.js`, `vencimientos.js`: aceptan cuentas con Clínica.
- `configuracion.html`: tarjeta "Módulo de Clínica" con interruptor y especialidades.
- `personalizacion.html`: rubro "Clínica / Consultorio médico" con selección de especialidades.
- Versiones de scripts actualizadas en las páginas (para que el navegador tome lo nuevo).

**Base de datos** (`supabase/migraciones/20261023_clinica_fase1.sql`, aplicada): solo agrega.
2 columnas en `configuracion_empresa` (apagadas por defecto) y tablas/funciones `clinica_*`.

## Decisión de seguridad: candado en el servidor para el contenido clínico
Todo el personal entra con el mismo usuario de Supabase (los perfiles multiusuario se
eligen en pantalla y su PIN hoy se valida en el navegador). Por eso un permiso de RLS
"`auth_user_id = auth.uid()`" no protege el expediente: recepción tiene el mismo `auth.uid()`.
- Antecedentes, consultas, adendas y bitácora tienen RLS **sin ninguna política** y sin
  permisos de tabla: el navegador no puede leerlas ni escribirlas directo.
- Solo se accede por funciones `SECURITY DEFINER` (`search_path = public`, verifican
  `auth.uid()`, no ejecutables por `anon`) que exigen una **sesión clínica**: token aleatorio
  de 256 bits que el servidor entrega tras verificar el PIN personal del médico/administrador
  (guardado con bcrypt en una tabla inaccesible). Bloqueo progresivo tras 5 intentos fallidos
  (5 min, luego 10, 20… máx. 60). La sesión vence a los 30 min sin uso y a las 12 h; en la base
  solo se guarda el hash del token. En pantalla se bloquea sola a los 15 min sin actividad y
  se descarta si cambian de perfil (usuario) en el mismo navegador.
- Recepción no tiene acceso clínico (el servidor rechaza su inicio de sesión clínica).
- Administrar personal y ver la bitácora exige el **código de administrador** de la cuenta
  (verificado en el servidor con su bloqueo de siempre) o una sesión clínica de rol admin.
- **Bitácora**: quién entró, quién abrió cada expediente, quién creó/editó/cerró/anuló notas;
  no se puede editar ni borrar (trigger).
- **Nota cerrada = firmada** (hash SHA-256 del contenido + autor + hora) e **inmutable** por
  trigger; solo admite adendas fechadas o anulación con motivo. Nada clínico se borra
  (trigger), ni siquiera con permisos de servidor, salvo mantenimiento explícito.
- Una visita ya cobrada no cambia su cuenta (trigger) → evita descuadres.
- Adjuntos en bucket privado: Fase 2.

## Pruebas de la Fase 1 (todas en verde)
- **SQL revertido** (antes de aplicar): 45+ verificaciones — expediente automático, cédula
  única, PIN incorrecto/bloqueo, recepción sin acceso clínico, token falso rechazado, otra
  cuenta no ve nada, `anon` sin acceso, choque de horario, cita que pasa medianoche, una nota
  por cita, IMC 22.86, nota cerrada inmutable, no se borra, adendas/bitácora inmutables,
  anulación con motivo, historial de antecedentes, desactivar médico cierra su sesión.
- **Unitarias** `node clinica/pruebas/unitarias.js`: 26 (edad, IMC, signos, choques, semana…).
- **Navegador** `NODE_PATH=/opt/node22/lib/node_modules node clinica/pruebas/navegador.js`
  (base simulada `clinica/pruebas/supabase-simulado.js`): 123 verificaciones, en computadora
  (1280 px) y celular (360 px) sin desborde: flujo completo agenda → llegó → atender con PIN →
  nota firmada → adenda → bloquear → cuenta → cobro en Ventas; XSS (nombres, alergias y
  diagnósticos con código HTML no se ejecutan); candado sin PIN; especialidad única;
  módulo apagado redirige; regresión de 14 páginas existentes.
- **Cuadre**: la misma venta cobrada desde la Clínica y hecha directo en Ventas envía
  exactamente los mismos datos a `venta_registrar_atomica` (venta, detalle, inventario, caja,
  total del cliente) → caja, bancos, inventario, lotes, impuestos y contabilidad iguales. La
  única escritura extra es ligar la cita a la venta. Una visita cobrada no se cobra dos veces.
- **Regresión de Ventas contra `main`**: la misma venta directa con el código de `main` y con
  el nuevo escribe exactamente lo mismo.

## Bitácora
- 2026-10-23: creada la rama `modulo-clinica` con el plan (`PLAN.md`).
- 2026-10-23: Fase 1 — base de datos aplicada en producción tras prueba revertida.
- 2026-10-24: Fase 1 — pantallas, integración con Ventas/Configuración/Personalización,
  pruebas en navegador y cuadre; traído `main` (venta atómica, agenda general, certificados).
