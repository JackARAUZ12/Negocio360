# Progreso — Módulo Clínica

| Fase | Estado | Integrada a main | Notas |
|---|---|---|---|
| 1 — Base para atender y cobrar | ✅ Terminada y probada | ✅ Sí (2026-10-24, commit 7add681) | Agenda, pacientes/expediente con candado, consulta firmada, equipo y seguridad, cobro por Ventas |
| 2 — Documentos | ✅ Terminada y probada | ✅ Sí (2026-10-24) | Recetas (a Farmacia y a la cuenta), órdenes, constancias, certificados, referencias, consentimiento, CIE-10, adjuntos privados |
| 3 — Operación diaria | ✅ Terminada y probada | ✅ Sí (2026-10-24) | Sala de espera con turnos y pantalla, recordatorios por WhatsApp, honorarios → Salarios, reportes que cuadran con Ventas |
| Ajuste — Agenda y usuarios del sistema | ✅ Terminado y probado | ✅ Sí (2026-10-24) | Sin agenda propia (se usa la Agenda), médicos = usuarios del multiusuario con su mismo código |
| 4 — Especialidades | ✅ Terminada y probada | ✅ Sí (2026-10-24) | Plantilla propia de las 16 especialidades con cálculos automáticos y odontograma |
| 5 — Crecimiento y cierre | ✅ Terminada y probada | ✅ Sí (2026-10-24) | Observación/hospitalización, seguros y convenios, demo "Clínica", guía e informe final |

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

## Fase 3 — qué se hizo

**Pantallas nuevas** (solo con "Módulo de Clínica" encendido):
- `clinica-sala.html` — sala de espera del día: turno por orden de llegada, minutos esperando,
  "Llegó", "Llamar" (queda la hora del llamado), "Atender", "No asistió" y "Aún no llega".
  Se actualiza sola cada 20 s. **Modo pantalla** para una TV en la sala: solo muestra nombre e
  inicial del apellido (nunca el nombre completo ni datos clínicos), el consultorio y suena un
  aviso cuando llaman a alguien. También se abre con `clinica-sala.html?pantalla=1`.
- `clinica-reportes.html` — por rango de fechas: citas, atendidas, inasistencia, lo cobrado
  (ventas de las citas **menos devoluciones**, igual que en Ventas), tabla por médico con su
  honorario, ingresos por servicio y producto, inasistencias con teléfono, diagnósticos más
  frecuentes (solo con PIN médico o código de administrador, queda en la bitácora),
  liquidaciones de honorarios y exportar a Excel (CSV).

**Cambios en pantallas de la clínica**:
- Agenda: botón "📲 Recordatorios" con las citas de mañana, mensaje de WhatsApp listo y marca
  de "avisado".
- Equipo: honorario de cada médico (ninguno, % de los servicios cobrados o monto fijo por
  consulta cobrada) y el empleado de Salarios al que se le paga.

**Honorarios → Salarios** (sin tocar cómo Salarios mueve Caja ni contabilidad):
- Reportes calcula el honorario solo de consultas **cobradas**, descontando devoluciones, y sin
  repetir consultas ya liquidadas (la base de datos también lo impide).
- "Pagar en Salarios" guarda la liquidación y abre Salarios con el pago del empleado listo y el
  honorario como una **bonificación** más. El monto se lee de la base de datos, no de la
  página. Al confirmar, el pago sigue el camino de siempre de Salarios; la liquidación queda
  "pagada" y ligada a ese pago solo si la bonificación realmente se pagó.
- `salarios.js`: único archivo compartido tocado; si la cuenta no tiene Clínica, no hace nada.
- Base de datos: `supabase/migraciones/20261024_clinica_fase3.sql` (aplicada; solo agrega):
  hora del llamado en citas, honorario en el personal, tabla `clinica_honorarios` (no se borra;
  lo calculado no cambia; no se paga dos veces una consulta) y `clinica_reporte_clinico`.

## Pruebas de la Fase 3 (todas en verde)
- **SQL revertido**: honorario y empleado validados, liquidación solo nace "enviada", no se paga
  dos veces la misma consulta, lo calculado no se puede cambiar, no se borra, el pago ligado
  debe ser de la misma cuenta, reporte clínico solo con sesión médica o código de administrador
  y queda en la bitácora.
- **Unitarias**: 57 (7 nuevas: turnos, espera, neto con devoluciones, honorario % y fijo,
  consultas ya pagadas excluidas, resumen, CSV).
- **Navegador**: 224 verificaciones (computadora y celular 360 px), nuevas: sala (conteos,
  turnos, llegó, llamar, pantalla sin apellidos completos), recordatorio por WhatsApp y marcado,
  reportes (cobrado 937.50 = ventas − devolución; honorario 30 % = 270; inasistencia; servicios;
  diagnósticos con código y texto escapado; CSV), pagar en Salarios → pago registrado con la
  bonificación → liquidación pagada y ligada → esas consultas ya no se vuelven a contar.
- **Regresión contra `main`**: Ventas escribe exactamente lo mismo; Salarios (pago normal con
  bonificación, Clínica apagada) escribe exactamente lo mismo y no lee los honorarios.

## Ajuste pedido por Jack: una sola Agenda y médicos = usuarios del sistema

Jack pidió (2026-10-24) no duplicar lo que el sistema ya tiene:
- **Sin agenda propia de la clínica.** Las citas se hacen en la **Agenda** de siempre
  (`agenda.html`: citas por profesional, estados y "Cobrar"). `clinica-agenda.html` quedó solo
  como redirección a la Agenda; su lógica se borró.
- **Sin médicos ni PIN aparte.** Un médico ES un **usuario del multiusuario**. En
  "Clínica · Médicos y seguridad" (antes "Equipo") solo se marca qué usuarios son médicos,
  su columna en la Agenda, especialidad, consultorio y honorario. Para abrir un expediente
  escriben **su mismo código de usuario** (si el usuario activo es médico, ni siquiera elige
  nombre). El servidor lo verifica y bloquea tras 5 intentos fallidos; los usuarios de tipo
  administrador usan su código de administrador con su propio candado.

**Cómo encaja con la Agenda:**
- El médico de una cita es el profesional de la Agenda ligado a ese médico.
- Lo propio de la clínica va aparte (`clinica_cita_info`: expediente, consultorio, llegada,
  llamado, recordatorio), sin tocar las tablas de la Agenda.
- **Sala de espera**: muestra las citas de hoy de la Agenda; "Llegó", "Llamar", "Atender"
  (si la cita no tiene expediente, se busca o se crea con los datos de la cita), "No asistió",
  modo pantalla, **recordatorios por WhatsApp** (pasaron aquí) y **"Cuenta y cobro"**.
- Al escribir la nota la cita pasa a "en atención" en la Agenda; al cobrar queda
  "completada" con su venta, por el camino que la Agenda ya tenía.
- **Cobro**: un solo camino, el de la Agenda (`n360_agenda_cobro` en Ventas). Lo que el médico
  deja en la cuenta (medicamentos de la receta, `clinica_cita_cargos`) se cobra junto con la
  cita, desde la Sala o desde la misma Agenda (pequeño agregado en `agenda-citas.js` que solo
  actúa si la cuenta usa Clínica). Se quitó de `ventas.js` el cobro propio de la clínica.
- Reportes y honorarios leen las citas de la Agenda (cuadran con las ventas igual que antes).

**Base de datos** (`supabase/migraciones/20261024_clinica_usuarios_agenda.sql`, aplicada; solo
agrega): `clinica_personal.perfil_id` y `.agenda_profesional_id`, `clinica_perfil_intentos`,
`clinica_cita_info`, `clinica_cita_cargos`, `clinica_consultas.agenda_cita_id`, la función
`clinica_iniciar_sesion_perfil` y nuevas versiones de `clinica_personal_guardar`,
`clinica_consulta_guardar/cerrar/anular`, `clinica_iniciar_sesion` (redirige al usuario) y
`clinica_cambiar_pin` (el código se cambia en el menú de usuarios). `clinica_citas`,
`clinica_cargos` y `clinica_personal_secretos` quedan sin uso (no se borran; estaban vacías).

**Nota de seguridad (para Jack):** el expediente queda tan protegido como los códigos de los
usuarios. Recomendación: que los médicos usen códigos de 6 números y no los compartan.

**Pruebas (todas en verde):**
- SQL revertido (25 comprobaciones): marcar médico solo con código de administrador, usuario
  repetido, columna de la Agenda repetida, usuario de otra cuenta, sesión con el código del
  usuario (incorrecto, bloqueo tras 5), usuario no médico sin acceso, nota ligada a la cita de
  la Agenda (pasa a "en atención", no dos notas por cita, anular la regresa), no se cambia el
  paciente de una cita con nota, cuenta de una visita cobrada bloqueada, otra cuenta no puede
  tocar ni ver nada, intentos fallidos invisibles.
- Unitarias: 59 (cita de la Agenda vista por la clínica; cobro = servicios + cuenta).
- Navegador: 241 en computadora y celular 360 px (sala sobre la Agenda, crear expediente desde
  la cita, código de usuario, nota, cuenta y cobro, médicos como usuarios, redirección de la
  agenda vieja) y regresión contra `main`: Ventas, Salarios y el cobro de la Agenda con Clínica
  apagada mandan exactamente lo mismo que antes. Cuadre: el cobro desde la Clínica escribe lo
  mismo que una venta directa (única diferencia: la cita queda ligada a su venta).

## Fase 4 — qué se hizo (Especialidades)

Sin cambios en la base de datos: lo propio de cada especialidad se guarda dentro de la nota
(`clinica_consultas.datos`), con el mismo candado, la misma firma y la misma inmutabilidad.
Solo aparecen las especialidades elegidas en Configuración / Médicos y seguridad.

**Plantilla por especialidad** (catálogo en `clinica-comun.js`; agregar campos es una línea):
- Medicina interna: revisión por sistemas, control de crónicas.
- Pediatría: perímetro cefálico, percentiles, desarrollo, alimentación, vacunas · edad en
  meses y avisos (vacunas pendientes, retraso del desarrollo).
- Ginecología y obstetricia: embarazo, FUM, G/P/C/A, FCF, altura uterina, movimientos,
  presentación, edema, PAP, planificación · **edad gestacional y fecha probable de parto
  automáticas**, avisos de FCF fuera de rango, movimientos disminuidos y edema (preeclampsia).
- Cardiología (NYHA, ritmo, ECG, riesgo), dermatología (lesión, tamaño, distribución),
  oftalmología (agudeza visual, presión intraocular con aviso >21), otorrino, ortopedia
  (escala de dolor 0–10, fuerza, movilidad), neurología (**Glasgow** calculado y clasificado),
  psicología (**PHQ-9, GAD-7** clasificados y aviso de riesgo suicida), nutrición (riesgo por
  cintura e índice cintura/cadera según sexo), fisioterapia (cambio del dolor en la sesión),
  urología (IPSS y PSA), endocrinología (HbA1c en meta o no, TSH), laboratorio.
- Los números se validan por rango antes de guardar.

**Odontograma** (numeración FDI): permanente (32), temporal (20) o mixta (52). Se toca un
diente y se marca su estado (sano, caries, obturado, sellante, endodoncia, corona, fractura,
extracción indicada, ausente, implante), las caras afectadas y una nota. Una consulta dental
nueva parte del último odontograma del paciente. Índices **CPO-D / ceo-d** automáticos. En
la nota firmada queda el odontograma de solo lectura. Funciona en celular de 360 px.

**Pruebas (todas en verde):** unitarias 66 (7 nuevas: catálogo válido, edad gestacional,
Glasgow, escalas, cintura, índices dentales y limpieza del odontograma, validación de rangos);
navegador 289 (34 nuevas en computadora y celular: solo especialidades elegidas, odontograma
que parte del anterior, dentición mixta, marcar diente y caras, índice recalculado, guardado
dentro de la nota firmada, notas escapadas, FUM futura rechazada, edad gestacional y FCF,
rangos, Glasgow); regresión contra `main` idéntica.

## Fase 5 — qué se hizo (Crecimiento y cierre)

- **Observación y hospitalización** (`clinica-hospital.html`, modelo de las estancias de
  Veterinaria): ingreso (OBS-/HOS- numerado), cama, médico, servicio por día; notas de
  ingreso, evolución, enfermería, indicaciones y alta con signos vitales **con candado**
  (`clinica_estancia_notas`, solo con sesión médica, solo agregar, en la bitácora); cuenta de
  medicamentos e insumos; alta (no se reabre) y cobro por Ventas. Una estancia cobrada o
  anulada ya no cambia su cuenta; un paciente solo puede tener una estancia activa.
- **Seguros y convenios** (`clinica-seguros.html`): aseguradoras/empresas con % de
  cobertura (cada una ligada a un cliente), convenio y póliza del paciente, reparto en la
  cuenta de la Sala (el paciente paga su parte, la aseguradora el resto, al centavo), lo
  cubierto queda anotado en la cita y se **factura a la aseguradora por Ventas** (normalmente
  a crédito). Una cita nunca se factura dos veces. Reportes muestra lo cubierto y los
  honorarios se calculan sobre el total (paciente + seguro).
- `ventas.js`: cobro de estancias y facturas a aseguradoras (solo con Clínica encendida,
  mismo patrón que Veterinaria). `agenda-citas.js`: al cobrar desde la Agenda se cobra todo
  al paciente (se borra un reparto con seguro preparado antes).
- **Cuenta demo "Clínica"** (`demo-clinica@negocio360oficial.com`, en el selector del login),
  registrada en `cuentas_prueba` como demo pública, con datos de ejemplo y sin ventas ni caja.
  Script: `supabase/migraciones/20261024_clinica_demo.sql`. **Ajuste (pedido de Jack): las demos
  no usan multiusuario** → se quitaron los usuarios de ejemplo de la demo y en cuentas demo el
  expediente se abre eligiendo el médico, sin código (`clinica_iniciar_sesion_demo`, solo para
  cuentas demo; `20261025_clinica_demo_sin_usuarios.sql`).
- **Guía de uso** (`clinica/GUIA.md`) e **informe final** (`clinica/INFORME_FINAL.md`).
- Base de datos: `supabase/migraciones/20261024_clinica_fase5.sql` (aplicada; solo agrega).

**Pruebas:** SQL revertido 27/27 (convenio ajeno, numeración, una estancia activa, notas con
sesión y rangos, solo agregar, alta sin reabrir, cuenta cerrada al cobrar/anular, factura sin
duplicar e inmutable, permisos y RLS entre cuentas); unitarias 70; navegador en computadora y
celular (ingreso con nota, notas y signos, cuenta, alta, cobro y ligado; seguro: reparto,
cobro del paciente, factura a la aseguradora a su nombre, sin duplicar; convenios); **cuadre**:
cobro de estancia y factura a aseguradora escriben lo mismo que la venta directa; con la
Clínica apagada Ventas ignora estos cobros; regresión contra `main`.

## Bitácora
- 2026-10-23: creada la rama `modulo-clinica` con el plan (`PLAN.md`).
- 2026-10-23: Fase 1 — base de datos aplicada en producción tras prueba revertida.
- 2026-10-24: Fase 1 — pantallas, integración con Ventas/Configuración/Personalización,
  pruebas en navegador y cuadre; traído `main` (venta atómica, agenda general, certificados).
- 2026-10-24: Fase 1 integrada a `main` (avance rápido, commit 7add681). El módulo sigue apagado para todas las cuentas.
- 2026-10-24: Fase 2 terminada, probada e integrada a `main`. El módulo sigue apagado para todas las cuentas.
- 2026-10-24: Fase 3 terminada, probada e integrada a `main`. El módulo sigue apagado para todas las cuentas.
- 2026-10-24: Ajuste pedido por Jack — sin agenda propia (se usa la Agenda) y médicos = usuarios del sistema. Probado e integrado a `main`.
- 2026-10-24: Fase 4 terminada, probada e integrada a `main`. El módulo sigue apagado para todas las cuentas.
- 2026-10-24: Fase 5 terminada, probada e integrada a `main`. Módulo completo; apagado por defecto. Demo "Clínica" publicada.
- 2026-10-25: La demo "Clínica" ya no usa multiusuario: el expediente se abre eligiendo el médico (solo en cuentas demo).
- 2026-10-25: Sala de espera **en vivo** (pedido de Jack): al oprimir "Llamar", la pantalla de la sala en otro equipo (TV, computadora o teléfono) lo muestra al instante, suena un "ding-dong" y resalta a la persona. Aviso por Supabase Realtime (broadcast) sin datos del paciente; cada equipo vuelve a leer la sala con su sesión. Respaldo cada 15 s. Sin cambios en la base de datos.
- 2026-10-25: **Panel de Clínica** (pedido de Jack): una sola entrada en el menú; todas las pantallas de Clínica (y la Agenda) se abren dentro del panel, en orden (día a día, cierre, ajustes), con el ciclo del paciente (agendar → sala → consulta → cobro → control) y "Siguiente paso", lista para preparar la clínica, pendientes y recorrido guiado. Cada pantalla conserva su permiso por usuario. **Agenda**: ahora se puede agendar a un paciente de la Clínica (se le crea su cliente y se liga) o a una persona nueva guardándola como cliente. Sin cambios en la base de datos.
- 2026-10-25: Tema oscuro arreglado en todas las pantallas de Clínica y el Panel (los cuadros usaban nombres de color que el tema no define y quedaban blancos; etiquetas, avisos e íconos con colores suaves). La pantalla abierta dentro del Panel cambia de tema junto con él.
- 2026-10-25: Agenda: un solo campo para el cliente (antes había dos cajas parecidas y el nombre nuevo se borraba al salir del buscador). Se busca el cliente o paciente; si no está, lo escrito queda como persona nueva ("➕ Persona nueva: «…»"). Opción nueva y opcional en select-buscable.js (textoLibre): las demás pantallas que lo usan no cambian.
- 2026-10-25: **Cobrar sin salir de la Clínica** (pedido de Jack): la cita (Sala y Agenda), la estancia, la factura a la aseguradora y la receta se cobran en una ventana dentro de la Clínica que usa la MISMA pantalla de Ventas (mismos pasos, caja, inventario, lotes, impuestos, contabilidad y reportes), abierta directo en "Método de pago". Candado nuevo en Ventas (solo con Clínica): no registra la venta si la visita, estancia o factura ya se cobró (otra ventana u otro equipo). Respaldo: si Ventas no alcanzó a ligar, la Clínica liga solo si sigue libre. El paciente sin cliente se vuelve cliente al cobrar. Cuadre probado: idéntico a la venta directa. Sin cambios en la base de datos.
- 2026-10-25: **Pantalla de cobro propia de la Clínica** (pedido de Jack, como Restaurante pero registrando la venta): conceptos, impuestos, total, forma de pago, banco, recibido y cambio, "Cobrar" y "✅ Cobrado · V-…". La venta se registra con el MISMO motor de Ventas sin mostrarlo (`ventas.html?clinica_cobro=1&motor=1`, `N360MotorVenta`, solo dentro de la Clínica y con el módulo): mismos pasos y `confirmarVenta`, por eso Caja, inventario, lotes, impuestos, contabilidad y reportes quedan idénticos (cuadre probado). "Otras opciones" muestra la venta completa para pago separado, puntos o certificados. Candado de doble cobro y respaldo de ligado se mantienen.
- 2026-10-25: Pedido de Jack (punto 2 + mejoras): **Agenda** carga todos los clientes (de 1000 en 1000) con apellido y búsqueda por teléfono; **usuarios limitados** entran al Panel; **cobro**: imprimir ticket (misma ruta de Ventas), WhatsApp y PDF, sin PDF automático en la Clínica; **voz** en la pantalla de la sala; **seguro al cobrar desde la Agenda** y **en hospitalización** (casilla "Aplicar seguro" en la pantalla de cobro; las estancias aparecen en Seguros › Por facturar); **rol de Enfermería** (notas de enfermería con signos y alergias; el servidor le niega expediente, consultas, documentos y antecedentes). Migración `20261025_clinica_seguro_estancias_enfermeria.sql` (probada en transacción revertida y aplicada).
- 2026-10-27: **Paciente sin cita** en la Sala de espera (pedido de Jack): "🚶 Llegó sin cita" busca o registra al paciente (y su cliente), elige médico, consultorio, servicio, motivo y prioridad **🚨 Urgente**; crea la cita de hoy por la misma función de la Agenda (`agenda_cita_guardar`) y la marca como llegada. Los urgentes van primero (lista y pantalla). Avisa si ya tenía cita hoy. No crea ventas ni mueve caja. Migración `20261027_clinica_sin_cita.sql` (columnas `prioridad` y `sin_cita` en `clinica_cita_info`).
- 2026-10-27: **Nueva demo "Centro Médico San Rafael"** con datos de simulación (migración `20261027_clinica_demo_simulacion.sql`, probada en transacción revertida: ventas = detalle = caja, 96 874,80; sin existencias negativas; ninguna visita completada sin venta). Se renueva sola cada día con `clinica_demo_preparar()` (solo en esa demo). El login abre la demo nueva; la anterior quedó intacta. Pruebas: 72 unitarias y 537 en navegador (computadora, 360 px y regresión contra `main`) en verde.
- 2026-10-27: **Pasar a consulta** (Jack no veía cómo entra un paciente): en la Sala, "▶️ Pasar a consulta" lo mueve de Esperando a En consulta (Agenda "En atención", y lo anuncia en la pantalla si no lo habían llamado); en En consulta, "✅ Terminó la consulta" lo pasa a Atendidos (falta cobrar) y "↩ Regresar a la fila" lo devuelve. Antes solo pasaba cuando el médico escribía/firmaba su nota (eso sigue igual). Ayuda de pasos en la Sala. No mueve dinero; sin cambios en la base de datos. Pruebas: 555 en navegador + 72 unitarias.
- 2026-10-27: **Atención de hoy en Pacientes** (pedido de Jack): arriba de la lista, quién está en consulta y quién espera (urgentes primero, tiempo de espera, médico y consultorio), con "Mis pacientes / Todos" cuando el médico entró con su código y actualización en vivo (mismo aviso de la Sala). "🩺 Atender" lo llama, lo pasa a En consulta y abre la nota de la cita; sin expediente, lleva a la Sala a elegirlo o crearlo. Sala: "🩺 Atender (médico)" y "🛏️ Dejar en observación" (abre el ingreso con paciente y médico). Observación: recuadro "Cómo funciona". Sin cambios en la base de datos ni en dinero. Pruebas: 583 en navegador + 72 unitarias.
- 2026-10-27: **Buscador del ingreso** a Observación/Hospitalización (pedido de Jack): filtra mientras se escribe desde la primera letra, sin acentos, con varias palabras, por nombre, apellido, cédula, teléfono o expediente; incluye clientes del sistema sin expediente (se les abre al ingresar, ligado a su mismo cliente); marca a quien ya está internado; flechas y Enter; "➕ Paciente nuevo" con formulario (crea expediente y cliente) y aviso si ya existe uno igual. Solo lee hasta registrar; no mueve dinero. Simulador de pruebas: `_` de ilike como comodín (igual que la base real). Pruebas: 615 en navegador + 72 unitarias.
