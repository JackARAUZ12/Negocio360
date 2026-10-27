-- =====================================================================
-- MÓDULO CLÍNICA — Pacientes que llegan sin cita (pedido de Jack)
-- La visita se crea en la Agenda de siempre (agenda_cita_guardar) y se marca como llegada.
-- Aquí solo se agregan dos datos a la información clínica de la visita:
--   prioridad: 'normal' o 'urgente' (los urgentes van primero en la fila de espera)
--   sin_cita:  la persona llegó sin reserva (para distinguirla en la Sala y en reportes)
-- Solo agrega columnas con valor por defecto: no cambia ningún dato existente.
-- =====================================================================
alter table public.clinica_cita_info add column if not exists prioridad text not null default 'normal' check (prioridad in ('normal','urgente'));
alter table public.clinica_cita_info add column if not exists sin_cita boolean not null default false;
