# Informe final — Módulo Clínica de Negocio360

**Fecha:** 24 de octubre de 2026 · **Rama:** `modulo-clinica` (integrada a `main`)
**Estado:** las 5 fases están terminadas, probadas e integradas. El módulo viene **apagado**
para todas las cuentas y se enciende en Configuración. Hay una cuenta demo pública "Clínica".

## 1. Qué se construyó

| Fase | Contenido |
|---|---|
| 1 — Base | Pacientes y expediente con candado en el servidor, antecedentes y alergias, consulta de medicina general con signos e IMC, cerrar y firmar, adendas, anulación con motivo, bitácora de accesos, cobro por Ventas. |
| 2 — Documentos | Recetas (a Farmacia o a la cuenta), órdenes de laboratorio e imágenes, constancias, certificados, referencias, consentimientos (hoja o ticket), diagnósticos CIE-10, archivos adjuntos privados. |
| 3 — Operación diaria | Sala de espera con turnos y pantalla para TV, recordatorios por WhatsApp, honorarios por médico pagados por Salarios, reportes que cuadran con Ventas. |
| Ajuste (pedido de Jack) | Sin agenda propia: se usa la **Agenda** del sistema. Los médicos son **usuarios del multiusuario** y abren el expediente con su mismo código. |
| 4 — Especialidades | Plantilla propia de las 16 especialidades con cálculos automáticos (edad gestacional, Glasgow, PHQ-9/GAD-7, cintura, HbA1c, IPSS…) y **odontograma**. |
| 5 — Crecimiento | **Observación y hospitalización** (ingreso, notas y signos con candado, cuenta por día, alta y cobro), **seguros y convenios** (el paciente paga su parte y lo cubierto se factura a la aseguradora por Ventas), **cuenta demo "Clínica"**, guía de uso (`GUIA.md`) y este informe. |

Pantallas (solo con el módulo encendido): Pacientes, Sala de espera, Observación y
hospitalización, Seguros y convenios, Reportes y honorarios, Médicos y seguridad.

## 2. Cómo se protegió el sistema existente

- **Base de datos: solo se agregó.** Todas las tablas nuevas empiezan con `clinica_`,
  tienen RLS y validan que todo pertenezca a la misma cuenta. No se modificó ni borró
  ninguna tabla, función ni dato de otros módulos. Cada cambio se probó primero en una
  transacción que se revierte (comprobaciones por fase: 25–27 cada una).
- **Contenido clínico con candado en el servidor:** las tablas clínicas no tienen acceso
  directo; solo se leen y escriben por funciones que exigen la sesión médica (código del
  usuario médico verificado en el servidor, bloqueo tras 5 intentos, vence a los 30 min sin
  uso y a las 12 h). Todo acceso queda en una bitácora que no se puede borrar ni cambiar.
- **Archivos compartidos tocados (con la Clínica apagada se comportan igual que antes,
  comprobado contra `main`):**
  - `ventas.js`: cobro de estancias y facturas a aseguradoras (mismo patrón que
    Veterinaria; solo si la cuenta usa Clínica). FEFO también para Clínica.
  - `agenda-citas.js`: al cobrar una cita, si la cuenta usa Clínica, incluye lo que el
    médico agregó a la cuenta.
  - `salarios.js`: recibe los honorarios como bonificación (solo con Clínica).
  - `modulos-registro.js`, `modulos-guard.js`, `lotes.js`, `vencimientos.js`,
    `configuracion.html`, `personalizacion.html`, `login.html` (demo).
- **Dinero sin descuadres:** todo cobro de la Clínica pasa por Ventas como una venta
  normal. Se comprobó que escribe **exactamente lo mismo** que la misma venta hecha a mano
  (caja, inventario, lotes, impuestos, cliente y detalle) para: cobro de citas, cobro de
  estancias y factura a la aseguradora. La única escritura extra es ligar la venta.
  No se puede cobrar dos veces una cita, una estancia ni una factura de seguro.

## 3. Pruebas (todas en verde al cierre)

- **Unitarias:** 70 (cálculos clínicos, honorarios, reparto del seguro al centavo,
  odontograma, días de estancia, etc.).
- **Navegador (Chromium, base simulada), computadora y celular de 360 px:** todas las
  pantallas, sin errores, sin desbordes y sin ejecución de texto escrito por usuarios (XSS).
- **Regresión contra `main`:** Ventas, Salarios y el cobro de la Agenda escriben lo mismo
  que antes con la Clínica apagada; las páginas existentes cargan sin cambios.
- **Revisor de seguridad de Supabase:** solo los avisos esperados por diseño.

## 4. Cuenta demo

- Login → "Probar cuenta de demostración" → **🏥 Clínica**
  (`demo-clinica@negocio360oficial.com`). Como todas las demos, **no usa el sistema
  multiusuario**: el expediente se abre eligiendo el médico, sin código. El servidor solo
  permite esa entrada en cuentas demo (`clinica_iniciar_sesion_demo`); las clínicas reales
  siempre usan el código del usuario médico.
- Datos de ejemplo: 3 médicos (medicina general, pediatría, odontología), 5 pacientes,
  antecedentes, un seguro (80 %), citas de hoy y mañana, dos notas firmadas (una con
  odontograma) y un paciente en observación. Sin ventas ni movimientos de caja.
- Registrada en `cuentas_prueba` como demo pública (protegida como las demás demos).

## 5. Pendientes y límites conocidos (para decidir)

1. **No se pudo probar en vivo** desde este entorno (la red bloquea la conexión directa):
   la función que entrega los archivos adjuntos y el inicio de sesión de la demo.
   La contraseña de la demo se verificó dentro de la base de datos. Conviene que Jack
   entre una vez a la demo y suba un archivo de prueba.
2. **Seguro al cobrar desde la Agenda:** el reparto con la aseguradora se hace al cobrar
   desde la **Sala de espera**; si se cobra desde la Agenda, se cobra todo al paciente.
3. **Estancias con seguro:** las estancias se cobran completas al paciente (sin reparto).
4. **Enfermería:** las notas de estancia las escriben usuarios marcados como médicos o
   administración clínica; no hay un rol aparte de enfermería.
5. **Fuerza del candado (cuentas reales):** el expediente queda tan protegido como los códigos de los
   usuarios. Recomendación: códigos de 6 números y no compartirlos.
6. Tablas de la primera versión que quedaron sin uso (vacías, no se borran):
   `clinica_citas`, `clinica_cargos`, `clinica_personal_secretos`.

## 6. Archivos

- Plan y avance: `clinica/PLAN.md`, `clinica/PROGRESO.md`, guía `clinica/GUIA.md`.
- Base de datos: `supabase/migraciones/20261023_clinica_fase1.sql` … `20261024_clinica_fase5.sql`,
  `20261024_clinica_usuarios_agenda.sql`, `20261024_clinica_demo.sql`.
- Pruebas: `clinica/pruebas/` (`unitarias.js`, `navegador.js`, `supabase-simulado.js`).
