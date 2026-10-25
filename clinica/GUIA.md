# Guía de uso — Módulo Clínica de Negocio360

Esta guía explica, paso a paso y sin palabras técnicas, cómo usar el Módulo Clínica.

> **Para probarlo sin tocar tu cuenta:** en la pantalla de inicio toca
> "Probar cuenta de demostración" → **🏥 Clínica**. La demo no usa el sistema de usuarios:
> para abrir un expediente solo eliges el médico (en una clínica real se pide su código).

---

## 0. El Panel de Clínica (todo en un solo lugar)

En el menú, la sección **Clínica** tiene una sola entrada: **🏥 Panel**. Ahí está todo:

- **Arriba**, todas las partes en orden: Agenda → Sala de espera → Pacientes y expediente →
  Observación | Seguros → Reportes y honorarios | Médicos y seguridad. Cada una se abre
  **dentro del panel**; el botón **🏥 Panel** siempre te regresa al inicio.
- **El ciclo de cada paciente, hoy**: 1 Agendar → 2 Llega y espera → 3 Consulta →
  4 Cobrar → 5 Control (y vuelve a empezar). Cada paso dice cuántos pacientes hay ahí y
  se puede tocar. Dentro de cada pantalla verás en qué paso vas y **"Siguiente paso →"**.
- **🧰 Prepara tu clínica**: la lista de lo que falta para empezar (médicos, su columna en
  la Agenda, servicios con precio…), cada uno con su botón. Se marca ✅ solo.
- **📌 Pendientes**: visitas sin cobrar, pacientes en observación, quién espera.
- **▶ Ver recorrido**: una explicación paso a paso (sale sola la primera vez).

Un usuario con permisos limitados solo ve en el panel las partes que le diste.

## 1. Encenderlo (una sola vez)

1. Entra a **Configuración** → tarjeta **🏥 Módulo de Clínica** → actívalo.
2. Elige las **especialidades** que atiende tu clínica (o "Todas").
   Solo esas aparecerán en las consultas.
3. En el menú aparece la sección **Clínica**.

## 2. Los médicos son usuarios del sistema

1. Crea a cada médico como **usuario** en el menú de usuarios (arriba a la derecha),
   con **su código** y los módulos que va a usar (Pacientes, Sala de espera, etc.).
2. En la **Agenda**, toca **Profesionales** y crea la **columna** de cada médico.
3. Ve a **Clínica · Médicos y seguridad** → **"+ Marcar un usuario como médico"**:
   elige el usuario, su columna de la Agenda, especialidad, consultorio y, si cobra
   honorarios, el porcentaje o monto fijo. Se pide el código de administrador.

Cuando un médico abre un expediente, escribe **su mismo código de usuario**.
Los demás usuarios (caja, recepción) **no pueden ver** notas clínicas.

## 3. Las citas: en la Agenda de siempre

Las citas se hacen en la **Agenda** del sistema (también desde el Panel), en la columna
del médico. En "Cliente" puedes elegir:

- un **cliente** que ya existe,
- un **🩺 paciente** de la clínica aunque todavía no sea cliente (al guardar la cita se le
  crea su cliente y queda ligado a su expediente), o
- escribir el nombre de una **persona nueva** en el mismo campo (la lista ofrece "➕ Persona nueva"): con la casilla **"Guardar como cliente nuevo"** queda
  guardada para las próximas veces (si ya hay un cliente con ese nombre, te avisa para no
  repetirlo). Sin la casilla, queda solo "de paso", como antes.

## 4. El día a día: Sala de espera

**Clínica · Sala de espera** muestra las citas de hoy:

- **🪑 Llegó** → el paciente pasa a "Esperando" y recibe su turno.
- **📢 Llamar** → aparece **al instante** en la **📺 pantalla de la sala** (una TV, otra
  computadora o un teléfono), con un "ding-dong" y el nombre resaltado. Muestra solo el
  nombre y la inicial del apellido, nunca datos médicos.

**Pantalla de la sala en otro equipo (TV, computadora o teléfono):** entra con la misma
cuenta, abre **Sala de espera → 📺 Modo pantalla** (o la dirección
`clinica-sala.html?pantalla=1`). Arriba aparece **● En vivo**. Si sale el botón naranja
**"🔊 Toca aquí para activar el sonido"**, tócalo una vez: los navegadores no dejan sonar
nada hasta que alguien toca la pantalla. Todas las computadoras con la Sala abierta
también se actualizan solas al instante.
- **🩺 Atender** → abre el expediente. Si la cita aún no tiene expediente, lo buscas o
  lo creas ahí mismo con los datos de la cita.
- **🚫 No asistió** / **↩ Aún no llega**.
- **📲 Recordatorios** → las citas de mañana, cada una con su mensaje de WhatsApp listo.

## 5. La consulta (expediente)

1. **📝 Nueva consulta**: motivo, signos vitales (el IMC sale solo), examen,
   diagnóstico (busca por nombre o código CIE-10), plan e indicaciones.
2. Según la **especialidad** aparecen sus datos y cálculos automáticos. Por ejemplo:
   semanas de embarazo y fecha de parto, escala de Glasgow, tests de depresión y
   ansiedad, riesgo por cintura, y el **odontograma** (toca un diente para marcarlo).
3. **💾 Guardar borrador** para seguir después, o **✅ Cerrar y firmar**.
   Una nota firmada ya no se cambia: si hay que corregir, se agrega una **adenda**.
4. **📄 Documento**: receta, orden de laboratorio o de imágenes, constancia,
   certificado de reposo, referencia o consentimiento, en hoja o en ticket.
   La receta se puede pasar a **Farmacia** o agregar a la **cuenta de la visita**.
5. **📎 Subir archivo**: resultados en PDF o imagen (máximo 10 MB), en un lugar privado.

Cada vez que alguien abre un expediente queda anotado en la **bitácora**
(Clínica · Médicos y seguridad → Bitácora, con código de administrador).

## 6. Cobrar la visita

En la Sala de espera, en la tarjeta del paciente atendido, toca
**💳 Cuenta y cobro**. Ahí ves el servicio de la cita y lo que se agregó
(medicamentos de la receta, insumos). Al cobrar **no sales de la Clínica**: se abre una
ventana de cobro aquí mismo con la venta lista en **"Método de pago"** (el paciente ya
como cliente). Eliges cómo paga y confirmas. Si cierras la ventana sin confirmar, no se
registra nada. Lo mismo al cobrar una estancia, facturar a una aseguradora, vender los
medicamentos de una receta o cobrar una cita desde la Agenda.
El cobro es una venta normal: caja, inventario, impuestos y reportes quedan exactos.
También puedes cobrar desde la misma Agenda: incluye lo agregado a la cuenta.

### Con seguro o convenio

1. En **Clínica · Seguros y convenios** agrega la aseguradora o empresa y su
   **% de cobertura**.
2. En la ficha del paciente elige su seguro, el número de póliza y cuándo vence.
3. Al cobrar desde la Sala, la cuenta muestra cuánto paga el paciente y cuánto la
   aseguradora. El paciente paga solo su parte.
4. En **Seguros y convenios → Por facturar** aparece lo que cubrió cada aseguradora.
   **"Facturar"** abre Ventas a nombre de la aseguradora: si te paga después, elige
   **Crédito**, y su pago se registra en Créditos como cualquier cliente.
   Una cita nunca se factura dos veces.

## 7. Observación y hospitalización

**Clínica · Observación y hospitalización**:

1. **+ Ingreso**: paciente, observación u hospitalización, cama, médico, el servicio
   que se cobra (por día en hospitalización) y la nota de ingreso.
2. **📝 Notas y signos**: evolución, enfermería, indicaciones y alta, con signos
   vitales. Solo con el código del médico.
3. **💊 Cuenta**: medicamentos, sueros e insumos que se usan.
4. **🏁 Dar de alta** y luego **💳 Cobrar**: Ventas abre la cuenta completa (días +
   lo usado). Una estancia cobrada ya no cambia.

## 8. Reportes y honorarios

**Clínica · Reportes y honorarios**: citas, atendidos, inasistencias, lo cobrado
(igual que en Ventas, menos devoluciones), lo cubierto por seguros, ingresos por
servicio, honorarios por médico y diagnósticos más frecuentes (con código).
**"Pagar en Salarios"** abre el pago del médico con sus honorarios como bonificación.
Las consultas pagadas no se vuelven a contar. Todo se exporta a Excel.

## 9. Seguridad, en resumen

- Solo los usuarios marcados como médicos abren expedientes, con su código.
  Tras 5 intentos fallidos se bloquea un rato.
- La sesión médica se cierra sola tras 15 minutos sin usar la pantalla.
- Las notas firmadas, adendas, documentos, archivos y la bitácora no se borran ni se
  cambian: se anulan con motivo.
- **Recomendación:** que cada médico use un código de 6 números y no lo comparta.
