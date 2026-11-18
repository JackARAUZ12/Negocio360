-- =====================================================================
-- ALL PLASTIC · correcciones de auditoría de noviembre 2026 (autorizadas por el dueño del sistema)
-- 1) MAYORISTA: anula el asiento AS-002414 (C$ 4,072,860 "Inventario inicial") — nació de +1,089 u. cargadas como inventario inicial
--    y revertidas 70 s después con un conteo físico (-1,089) que NO tiene asiento: dejaba inventario/capital inflados.
--    Se deja un asiento ANULADO de marcador para el conteo físico, así el sistema no genera después una baja de C$ 4.07 M.
-- 2) COMERCIAL: registra el asiento en borrador AS-009189 (V-005280, ya cuadrado) y elimina el borrador vacío AS-009215 (V-005304,
--    sin líneas) para que el sistema lo regenere completo.
-- Respalda antes de tocar (tablas respaldo_allplastic_20261117_*).
-- =====================================================================
do $f$
declare
  may uuid := '90e89966-68e9-486d-a9c4-9d9000cb76ae'; com uuid := '46521033-5d43-40d5-844d-33ca2ff59c14';
  a_may uuid; a_ok uuid; a_vacio uuid; n_nuevo text; v_num integer; v_debe numeric; v_haber numeric;
begin
  create table if not exists public.respaldo_allplastic_20261117_asientos as
    select now() as respaldado_en, a.* from public.asientos_contables a
     where (a.auth_user_id = may and a.numero = 'AS-002414') or (a.auth_user_id = com and a.numero in ('AS-009189','AS-009215'));
  create table if not exists public.respaldo_allplastic_20261117_detalle as
    select now() as respaldado_en, d.* from public.asientos_detalle d
     where d.asiento_id in (select id from public.respaldo_allplastic_20261117_asientos);
  alter table public.respaldo_allplastic_20261117_asientos enable row level security;
  alter table public.respaldo_allplastic_20261117_detalle enable row level security;

  select id into a_may from public.asientos_contables where auth_user_id = may and numero = 'AS-002414' and estado = 'registrado'
     and referencia_tipo = 'ajuste_inventario_inicial' and total_debe = 4072860;
  if a_may is null then raise exception 'AS-002414 no está como se esperaba: no se aplica.'; end if;
  update public.asientos_contables set estado = 'anulado', anulado_en = now(),
    anulado_motivo = 'Corrección de auditoría: +1,089 u. como inventario inicial revertidas con conteo físico (-1,089) sin asiento; el stock real no cambió'
   where id = a_may;

  if not exists (select 1 from public.asientos_contables where auth_user_id = may and referencia_tipo = 'ajuste_inventario_salida' and referencia_id = '988ee6d3-dec1-4bcf-9377-8a13fc49e38d') then
    insert into public.asientos_numeracion(auth_user_id, ultimo_numero) values (may, 1) on conflict (auth_user_id) do update set ultimo_numero = asientos_numeracion.ultimo_numero + 1 returning ultimo_numero into v_num; n_nuevo := 'AS-' || lpad(v_num::text, 6, '0');
    insert into public.asientos_contables(auth_user_id, numero, fecha, concepto, estado, origen, referencia_tipo, referencia_id, total_debe, total_haber, usuario_nombre, anulado_en, anulado_motivo)
    values (may, n_nuevo, '2026-11-16', 'Marcador: conteo físico revertido (no genera baja contable)', 'anulado', 'automatico', 'ajuste_inventario_salida',
            '988ee6d3-dec1-4bcf-9377-8a13fc49e38d', 0, 0, 'Auditoría', now(), 'Corrección de auditoría: reversa del inventario inicial AS-002414; evita registrar una baja de C$ 4,072,860');
  end if;

  select id into a_ok from public.asientos_contables where auth_user_id = com and numero = 'AS-009189' and estado = 'borrador';
  if a_ok is not null then
    select coalesce(sum(debe),0), coalesce(sum(haber),0) into v_debe, v_haber from public.asientos_detalle where asiento_id = a_ok;
    if v_debe > 0 and round(v_debe,2) = round(v_haber,2) then
      update public.asientos_contables set estado = 'registrado', total_debe = v_debe, total_haber = v_haber, registrado_en = now() where id = a_ok;
    else raise exception 'AS-009189 no cuadra (% / %)', v_debe, v_haber; end if;
  end if;

  select id into a_vacio from public.asientos_contables where auth_user_id = com and numero = 'AS-009215' and estado = 'borrador';
  if a_vacio is not null and not exists (select 1 from public.asientos_detalle where asiento_id = a_vacio) then
    delete from public.asientos_contables where id = a_vacio;
  end if;
end $f$;
