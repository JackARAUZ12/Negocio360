# Progreso — Módulo Clínica

| Fase | Estado | Integrada a main | Notas |
|---|---|---|---|
| 1 — Base para atender y cobrar | ✅ Terminada y probada | ✅ Sí (2026-10-24, commit 7add681) | Agenda, pacientes/expediente con candado, consulta firmada, equipo y seguridad, cobro por Ventas |
| 2 — Documentos | ✅ Terminada y probada | ✅ Sí (2026-10-24) | Recetas (a Farmacia y a la cuenta), órdenes, constancias, certificados, referencias, consentimiento, CIE-10, adjuntos privados |
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

## Fase 2 — qué se hizo
- **Documentos** (desde el expediente o desde cada consulta): receta, orden de laboratorio,
  orden de imágenes/estudios, constancia de atención, certificado médico (con días de reposo
  y fechas calculadas), referencia/interconsulta (marca de urgente) y consentimiento informado
  (firmas de paciente/representante, médico y testigo). Se imprimen en **hoja carta o ticket
  80 mm** con datos de la clínica, del paciente (edad, cédula, expediente) y del médico
  (especialidad y **código MINSA**). Numerados por tipo (RX-000001, LAB-…, IMG-…, CON-…, CER-…,
  REF-…, CI-…), **inmutables** (solo se anulan con motivo; el impreso de uno anulado lleva el
  sello ANULADO) y registrados en la bitácora. Mismo candado de servidor que las notas.
- **Receta → Farmacia** (si la cuenta tiene Farmacia): queda registrada en Farmacia · Recetas
  con su número y se puede vender de inmediato por el camino de siempre
  (`n360_receta_a_vender` → Ventas; las sustancias controladas siguen yendo por su módulo).
  **Receta → cuenta de la visita**: los medicamentos ligados al inventario se suman a la cuenta
  y recepción los cobra con la consulta (no se puede si la visita ya se cobró).
- **Diagnósticos CIE-10**: catálogo en español de 300+ diagnósticos frecuentes (`clinica-cie10.js`),
  búsqueda por código o palabras sin importar tildes, diagnóstico principal, y texto libre para
  lo que no esté. Se guardan codificados en la nota (`clinica_consultas.diagnosticos`) para los
  reportes de la Fase 3.
- **Archivos adjuntos**: PDF/JPG/PNG/WEBP hasta 10 MB en el bucket **privado** `clinica-adjuntos`
  (sin políticas: el navegador no puede leerlo ni escribirlo). La función de borde
  `clinica-adjuntos` valida la sesión médica y entrega enlaces firmados temporales (subida de un
  uso; vista de 2 minutos), confirma que el archivo llegó, y cada vista queda en la bitácora.
  Se anulan con motivo; no se borran.
- Base de datos: `supabase/migraciones/20261024_clinica_fase2.sql` (aplicada; solo agrega).
  Función de borde: `supabase/functions/clinica-adjuntos/index.ts` (publicada).

## Pruebas de la Fase 2 (todas en verde)
- **SQL revertido**: numeración por tipo, documento inmutable y sin borrado, validación de cada
  tipo, consulta de otro paciente rechazada, sin sesión rechazado, receta a Farmacia una sola
  vez, solo el autor o administración anula, adjunto: tipo y tamaño, ruta dentro de la carpeta de
  la cuenta, no se ve antes de confirmarse ni después de anularse, expediente sin rutas internas,
  bucket privado y sin políticas, todo en la bitácora, `anon` sin acceso.
- **Unitarias**: 50 (24 nuevas: búsqueda CIE-10, los 7 documentos en carta y ticket escapan todo
  texto y no aceptan enlaces peligrosos, días de reposo, sello de anulado).
- **Navegador**: 179 verificaciones (56 nuevas en computadora y celular 360 px): diagnósticos
  CIE-10 y texto libre, receta ligada al inventario e impresa, los 7 tipos con su número,
  certificado en ticket, anulación, receta a la cuenta, receta a Farmacia → carrito de Ventas,
  subir/ver/anular archivo, rechazo de archivos no permitidos o de más de 10 MB, sin errores, sin
  XSS, sin desborde. Regresión de Ventas contra `main`: idéntica.
- Revisor de seguridad de Supabase: solo los avisos esperados por diseño (tablas con candado sin
  políticas y funciones con su propia verificación de sesión).

## Bitácora
- 2026-10-23: creada la rama `modulo-clinica` con el plan (`PLAN.md`).
- 2026-10-23: Fase 1 — base de datos aplicada en producción tras prueba revertida.
- 2026-10-24: Fase 1 — pantallas, integración con Ventas/Configuración/Personalización,
  pruebas en navegador y cuadre; traído `main` (venta atómica, agenda general, certificados).
- 2026-10-24: Fase 1 integrada a `main` (avance rápido, commit 7add681). El módulo sigue apagado para todas las cuentas.
- 2026-10-24: Fase 2 terminada, probada e integrada a `main`. El módulo sigue apagado para todas las cuentas.
