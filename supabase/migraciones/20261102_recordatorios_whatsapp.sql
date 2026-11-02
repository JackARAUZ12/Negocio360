-- =====================================================================
-- RECORDATORIOS POR WHATSAPP (2-nov-2026) — Fase 2.
-- Los recordatorios (cuota por vencer, cuota vencida, cita de mañana) viven en
-- Clientes → Campañas y SOLO LEEN créditos y Agenda: no cambian cuotas, saldos, Caja ni citas.
-- Esta migración solo:
--   1) agrega el interruptor "avisarme en el Panel" (APAGADO para todos los negocios);
--   2) permite guardar editados los 3 mensajes nuevos (se amplía la lista de tipos; los 8 de antes siguen igual).
-- =====================================================================

alter table public.configuracion_empresa add column if not exists recordatorios_panel boolean not null default false;

alter table public.crm_mensajes_sistema drop constraint if exists crm_mensajes_sistema_tipo_check;
alter table public.crm_mensajes_sistema add constraint crm_mensajes_sistema_tipo_check check (tipo = any (array[
  'cumple', 'extranamos', 'gracias', 'bienvenida', 'promocion', 'novedades', 'fiestas', 'libre',
  'cuota_vence', 'cuota_vencida', 'cita_manana'
]::text[]));
