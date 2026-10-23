# Módulo especializado "Clínica" — Negocio360

Rama de trabajo: `modulo-clinica`. Sistema web (vanilla JS, una página por
módulo, Supabase `zvlincmqmmoclqhykejv`). Se construye por fases. El módulo
queda **apagado para todas las cuentas** hasta que una cuenta lo active
(interruptor `configuracion_empresa.usa_modulo_clinica`), igual que Hotel,
Restaurante, Veterinaria, Transporte o Diseño.

## Lo que pidió el dueño (obligatorio)
- Clínica de **medicina general con todas las especialidades**. Si la clínica
  es de una sola especialidad, se indica en **Personalización/Configuración**
  y el sistema muestra **solo** los submódulos y plantillas de esa(s)
  especialidad(es).
- **Pruebas obligatorias para evitar descuadres** (caja, bancos, caja chica,
  inventario, impuestos, contabilidad, reportes).
- **Candados de seguridad.**
- **Ultra responsive** (celular 360 px a computadora), **fácil de entender y
  de usar**, todo en español sencillo.
- **Por fases.** No dañar absolutamente nada del sistema existente.

## Reglas de trabajo (no negociables)
1. Trabajar en la rama `modulo-clinica`. Al terminar **cada fase**, y solo si
   pasan TODAS las pruebas (las nuevas y las de regresión), se integra a
   `main` (que es lo publicado). Es seguro porque el módulo está apagado para
   todos; aun así, cualquier cambio en archivos compartidos
   (`modulos-registro.js`, `modulos-guard.js`, `configuracion.html`,
   `personalizacion.html`, `ventas.js`, `perfiles-guard.js`, etc.) debe dejar
   **idéntico** el comportamiento de todos los demás módulos y cuentas.
2. **Base de datos: solo agregar.** Tablas/columnas/funciones nuevas
   (prefijo `clinica_`). Nunca modificar ni borrar lo existente ni datos de
   clientes. Si algo existente debe comportarse distinto, se agrega al lado.
3. Toda tabla nueva con RLS (cada negocio solo lo suyo, mismo patrón que el
   resto, incluido el grupo central/sucursales si aplica). Funciones nuevas
   `security definer` + `set search_path = public` + verificación de
   `auth.uid()`; nada ejecutable por `anon`.
4. Cada cambio de base se prueba primero en una transacción revertida
   (DO … raise exception con resultados). La herramienta SQL se cuelga con
   DROP/DELETE/TRUNCATE literales: armarlos con `'de'||'lete'` en `execute`.
5. Pruebas por fase: SQL revertido; Playwright (Chromium en
   `/opt/pw-browsers`, servidor `python3 -m http.server`, Supabase simulado)
   en computadora y celular 360 px, sin desborde horizontal; y **regresión**:
   cargar las páginas existentes y verificar que nada cambió. Para el cobro,
   prueba de **cuadre**: la venta generada desde la clínica debe dejar caja,
   inventario, lotes e impuestos exactamente igual que la misma venta hecha
   directo en Ventas.
6. Auto-revisión de cada fase (seguridad, XSS: todo dato escrito por usuarios
   se escapa al mostrarse; casos borde; móvil). Escribir el avance en
   `clinica/PROGRESO.md`. Commits con el pie de autoría del entorno.
7. El dueño no revisa cada fase: la sesión prueba, se auto-revisa, integra y
   sigue. Al final de cada fase, un resumen corto en español sin
   tecnicismos.

## Reutilizar lo que ya existe (no reinventar)
- **Veterinaria** es el modelo a seguir: `mascotas.js` (expediente,
  consultas, vacunas), `vet-agenda.js` (citas por profesional),
  `vet-estancias.js` (hospitalización con cargos diarios),
  `vet-recordatorios.js`, `vet-comun.js`.
- **Cobro:** mismo mecanismo que Veterinaria → `sessionStorage`
  (`n360_vet_cobro`) + `aplicarCobroVeterinaria()` en `ventas.js`. Crear el
  equivalente `n360_clinica_cobro` / `aplicarCobroClinica()` que solo actúa
  si `usa_modulo_clinica` es true, y ligar la venta a la consulta como hace
  Veterinaria. Así caja, inventario, lotes FEFO, impuestos, créditos,
  fiados, pago dividido y contabilidad siguen el flujo probado de siempre.
- **Farmacia** (`farmacia_medicos`, `farmacia_pacientes`, `farmacia_recetas`,
  sustancias controladas, lotes/vencimientos): si la cuenta también tiene
  Farmacia, la receta puede cargarse a una venta.
- Registro de módulos (`modulos-registro.js`, `flagPropio`), guardia
  (`modulos-guard.js`), tarjeta de activación en Configuración, rubro en
  Personalización, tutoriales (`tutorial-motor.js`), perfiles multiusuario
  (`perfiles-guard.js`), Convenios, Salarios, Créditos, Fiados.

## Especialidades
`configuracion_empresa.clinica_especialidades text[]` (nuevo). Vacío o
`{multiespecialidad}` = todas. Cada especialidad aporta plantillas de consulta
y, si corresponde, su propio submódulo:
medicina general, medicina interna, pediatría (crecimiento, vacunas),
ginecología y obstetricia (FUM, FPP, control prenatal), cardiología,
dermatología, oftalmología, otorrinolaringología, ortopedia/traumatología,
neurología, psicología/psiquiatría (notas con confidencialidad reforzada),
nutrición, fisioterapia (sesiones), odontología (odontograma), urología,
endocrinología, laboratorio clínico. Fácil de ampliar (catálogo, no código
fijo por especialidad).

## Seguridad y confidencialidad (Normativa 004 MINSA; Reglamento Ley 423)
- Expediente solo para personal autorizado. **Roles:** Médico (ve y escribe
  expedientes), Recepción (agenda, sala de espera, cobro; **no** notas
  clínicas), Administrador (todo). Investigar el sistema multiusuario actual
  (`perfiles_acceso`, PIN; hoy el PIN se valida solo en pantalla) y diseñar
  un **candado en el servidor** para el contenido clínico (p. ej. sesión
  clínica emitida por el servidor tras verificar el PIN del perfil médico,
  con límite de intentos y vencimiento). Documentar la decisión.
- **Bitácora de acceso**: quién abrió qué expediente y cuándo.
- **Nota cerrada = firmada e inmutable** (trigger que impide editarla);
  correcciones solo como adenda fechada. Nada clínico se borra: anulación
  con motivo.
- **Adjuntos** (exámenes, imágenes) en un bucket **privado** con enlaces
  temporales firmados, límite de tamaño y tipos permitidos.
- Alergias siempre visibles como alerta.

## Fases
- **Fase 1 — Base para atender y cobrar:** activación (Configuración y
  Personalización con selección de especialidades); médicos y consultorios;
  pacientes/expediente (datos generales, cédula, edad automática, tipo de
  sangre, alergias, antecedentes, contacto de emergencia, vínculo con
  Clientes para cobrar); agenda (día/semana, por médico, estados: programada,
  confirmada, en espera, en consulta, atendida, no asistió, cancelada);
  consulta de medicina general (motivo, enfermedad actual, signos vitales con
  IMC automático, examen físico, diagnóstico, plan, próximo control → cita);
  cierre/firma; cobro vía Ventas; roles + candado de servidor + bitácora;
  tutorial.
- **Fase 2 — Documentos:** receta (y paso a Farmacia), órdenes de
  laboratorio/imágenes, constancia/certificado, referencia, consentimiento
  informado (imprimibles carta y ticket con datos del médico); catálogo de
  diagnósticos CIE-10 en español (fuente libre de uso; si no hay, un
  subconjunto frecuente + texto libre); adjuntos privados.
- **Fase 3 — Operación diaria:** sala de espera (turnos del día), recordatorio
  por WhatsApp (como Veterinaria), honorarios por médico (porcentaje o monto
  por consulta) conectados a reportes/Salarios, reportes (atendidos por
  médico, diagnósticos frecuentes, ingresos por médico/servicio, inasistencias).
- **Fase 4 — Especialidades:** plantillas y submódulos por especialidad
  (incluido odontograma) cargados según la configuración.
- **Fase 5 — Crecimiento y cierre:** observación/hospitalización (modelo
  `vet-estancias`), seguros/convenios, cuenta demo "Clínica" (registrada en
  `cuentas_prueba` como demo pública, con datos de ejemplo, sin datos reales)
  y en el selector de demos del login, guía de uso. Informe final.
