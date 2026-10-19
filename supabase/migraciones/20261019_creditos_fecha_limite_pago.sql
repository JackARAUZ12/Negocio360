-- =====================================================================
-- CRÉDITOS: "Fecha límite de pago" en el comprobante de pago
-- Fecha: 19-oct-2026 · Todas las cuentas · No cambia ni borra ningún dato
--
-- PROBLEMA: la modalidad "Un solo pago a fecha fija" se guardaba como un
-- crédito de 1 cuota, sin dejar constancia de que era a fecha fija — así
-- no se puede distinguir de un crédito "En cuotas" de 1 sola cuota.
--
-- QUÉ HACE (solo agrega, todo opcional):
--  1. creditos.modalidad_pago: 'cuotas' | 'fecha_fija'. Los créditos
--     nuevos lo guardan solos; los existentes quedan en NULL (se tratan
--     como hasta hoy) y el negocio puede marcarlos a mano en el detalle.
--  2. configuracion_empresa.creditos_mostrar_fecha_limite: casilla de
--     "Configuración de crédito". Apagada por defecto para toda cuenta:
--     el comprobante queda exactamente igual que antes.
-- =====================================================================

alter table public.creditos
  add column if not exists modalidad_pago text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'creditos_modalidad_pago_chk') then
    alter table public.creditos
      add constraint creditos_modalidad_pago_chk
      check (modalidad_pago is null or modalidad_pago in ('cuotas', 'fecha_fija'));
  end if;
end $$;

comment on column public.creditos.modalidad_pago is
  'Modalidad elegida al crear el crédito: cuotas | fecha_fija. NULL = crédito anterior a este campo (se trata como cuotas).';

alter table public.configuracion_empresa
  add column if not exists creditos_mostrar_fecha_limite boolean not null default false;

comment on column public.configuracion_empresa.creditos_mostrar_fecha_limite is
  'Créditos › Configuración de crédito: mostrar "Fecha límite de pago" en el comprobante de pago de créditos a fecha fija.';
