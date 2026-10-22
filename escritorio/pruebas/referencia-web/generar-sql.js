// Genera la prueba SQL "centavo por centavo" (todo dentro de un DO que al
// final se revierte con raise exception):
//   1. crea lo de la migración de la Fase 2 y una cuenta FALSA con los datos
//      de fixtures.js (nunca toca cuentas reales);
//   2. por cada escenario capturado de la web real:
//        A) reproduce, como usuario autenticado y con RLS, cada escritura que
//           hizo ventas.js (cada una por separado, como las llamadas de la web)
//           y toma una "foto" de lo que quedó;
//        B) deshace A y registra la misma venta con offline_registrar_venta;
//           toma la misma foto; deshace B;
//        C) compara las fotos campo por campo.
//   node generar-sql.js capturas.json salida.sql [indices]
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const F = require('./fixtures');
const { convertir } = require('../../src/compartido/registro-a-payload');

const MIGRACIONES = path.join(__dirname, '..', '..', '..', 'supabase', 'migraciones');
// --migracion=<archivo>: migración a probar dentro de la transacción (por defecto la de la Fase 2).
const argMig = process.argv.find((a) => a.startsWith('--migracion='));
const MIGRACION = path.join(MIGRACIONES, argMig ? argMig.slice('--migracion='.length) : '20261021_offline_fase2_registrar_venta.sql');
// --sin-migracion: la migración ya está aplicada (solo se prueban los escenarios).
const SIN_MIGRACION = process.argv.includes('--sin-migracion');
// --sin-auditoria: deja fuera la bitácora (para enviar menos texto cuando solo se prueba caja/stock/lotes/gastos).
const SIN_AUDITORIA = process.argv.includes('--sin-auditoria');
const [entrada = path.join(__dirname, 'capturas.json'), salida = '/dev/stdout', indices] = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error('identificador raro: ' + s); return s; };
function json(obj) {
  const t = JSON.stringify(obj);
  if (t.includes('$j$')) throw new Error('json con $j$');
  return `$j$${t}$j$::jsonb`;
}
function insertarVarias(tabla, filas) {
  const cols = [...new Set(filas.flatMap((f) => Object.keys(f)))].map(ident).join(', ');
  return `insert into public.${ident(tabla)} (${cols}) select ${cols} from jsonb_populate_recordset(null::public.${ident(tabla)}, ${json(filas)});`;
}
function lit(v) { return v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`; }

const CLIENTE = F.IDS.cliente;
const FOTO = `jsonb_build_object(
      'venta', (select to_jsonb(v) - array['id','created_at','updated_at','referencia_caja']
                 || jsonb_build_object('ref_caja_ok', exists (select 1 from public.movimientos_financieros m where m.id = v.referencia_caja and m.referencia_id = v.id))
                from public.ventas v where v.auth_user_id = '${F.U}' and v.numero_venta = 'V-000777'),
      'detalles', (select jsonb_agg(to_jsonb(d) - array['id','venta_id','created_at'] order by d.producto_nombre, d.cantidad)
                   from public.venta_detalles d join public.ventas v on v.id = d.venta_id where v.auth_user_id = '${F.U}' and v.numero_venta = 'V-000777'),
      'caja', (select jsonb_agg(jsonb_build_object('ref', m.referencia_tipo, 'flujo', m.tipo_flujo, 'tipo', m.tipo_movimiento, 'concepto', m.concepto, 'monto', m.monto,
                 'metodo', m.metodo_pago_id, 'metodo_nombre', m.metodo_pago_nombre, 'banco', m.banco_id, 'monto_banco', m.monto_moneda_banco,
                 'obs', m.observaciones, 'fecha', m.fecha, 'estado', m.estado, 'saldo_ant', m.saldo_anterior, 'saldo_res', m.saldo_resultante,
                 'origen_caja', m.origen_caja) order by m.created_at, m.id)
               from public.movimientos_financieros m join public.ventas v on v.id = m.referencia_id where v.auth_user_id = '${F.U}' and v.numero_venta = 'V-000777'),
      'saldo_caja', (select saldo_resultante from public.movimientos_financieros where auth_user_id = '${F.U}' and estado = 'completado' order by created_at desc, id desc limit 1),
      'impuestos', (select jsonb_agg(jsonb_build_object('tipo', i.tipo_movimiento, 'concepto', i.concepto, 'monto', i.monto, 'imp', i.impuesto_id,
                 'imp_nombre', i.impuesto_nombre, 'fecha', i.fecha, 'saldo_ant', i.saldo_anterior, 'saldo_res', i.saldo_resultante) order by i.created_at, i.id)
               from public.movimientos_impuestos i join public.ventas v on v.id = i.referencia_venta_id where v.auth_user_id = '${F.U}' and v.numero_venta = 'V-000777'),
      'venta_impuestos', (select jsonb_agg(to_jsonb(x) - array['id','venta_id','created_at'] order by x.nombre) from public.venta_impuestos x
               join public.ventas v on v.id = x.venta_id where v.auth_user_id = '${F.U}' and v.numero_venta = 'V-000777'),
      'retenciones', (select jsonb_agg(to_jsonb(x) - array['id','venta_id','created_at']) from public.retenciones_ir x
               join public.ventas v on v.id = x.venta_id where v.auth_user_id = '${F.U}' and v.numero_venta = 'V-000777'),
      'garantias', (select jsonb_agg(to_jsonb(g) - array['id','venta_id','created_at','updated_at'] order by g.producto_nombre) from public.garantias_clientes g
               where g.auth_user_id = '${F.U}'),
      'gastos', (select jsonb_agg(to_jsonb(g) - array['id','created_at','venta_id','movimiento_financiero_id']
                   || jsonb_build_object('de_la_venta', g.venta_id = v.id, 'mov_ligado', exists (select 1 from public.movimientos_financieros m
                        where m.id = g.movimiento_financiero_id and m.referencia_tipo = 'gasto' and m.referencia_id = g.id)))
                 from public.gastos g left join public.ventas v on v.auth_user_id = g.auth_user_id and v.numero_venta = 'V-000777'
                 where g.auth_user_id = '${F.U}'),
      'caja_gastos', (select jsonb_agg(jsonb_build_object('flujo', m.tipo_flujo, 'tipo', m.tipo_movimiento, 'concepto', m.concepto, 'monto', m.monto,
                 'metodo', m.metodo_pago_id, 'metodo_nombre', m.metodo_pago_nombre, 'banco', m.banco_id, 'monto_banco', m.monto_moneda_banco,
                 'fecha', m.fecha, 'estado', m.estado, 'saldo_ant', m.saldo_anterior, 'saldo_res', m.saldo_resultante) order by m.created_at, m.id)
               from public.movimientos_financieros m join public.gastos g on g.id = m.referencia_id and m.referencia_tipo = 'gasto' where g.auth_user_id = '${F.U}'),
      'stock', (select jsonb_object_agg(nombre, stock_actual) from public.productos where auth_user_id = '${F.U}'),
      'lotes', (select jsonb_object_agg(numero_lote, cantidad_actual) from public.producto_lotes where auth_user_id = '${F.U}'),
      'cliente', (select jsonb_build_object('total', total_compras, 'num', num_compras) from public.clientes where id = '${CLIENTE}'),
      'auditoria', (select jsonb_agg(jsonb_build_object('perfil', perfil_nombre, 'tipo', perfil_tipo, 'modulo', modulo, 'tabla', tabla, 'accion', accion, 'resumen', resumen)
                    order by tabla, accion, resumen) from public.auditoria_log where auth_user_id = '${F.U}'),
      'alertas_stock', (select count(*) from public.dashboard_alertas where auth_user_id = '${F.U}')
    )`;

function preparacion() {
  const t = F.tablas;
  const s = [];
  s.push(`perform set_config('n360.alta_directa', 'on', true);`);
  s.push(`insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
    values ('${F.U}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'prueba-offline@negocio360.test', '{"nombre":"Prueba"}', '{}', now(), now());`);
  for (const m of t.metodos_pago) s.push(`update public.metodos_pago set id = '${m.id}' where auth_user_id = '${F.U}' and nombre = ${lit(m.nombre)};`);
  s.push(insertarVarias('configuracion_empresa', t.configuracion_empresa));
  for (const [tabla, filas] of [['bancos', t.bancos], ['productos', t.productos], ['combos', t.combos], ['combo_items', t.combo_items],
    ['promociones', t.promociones], ['clientes', t.clientes], ['impuestos', t.impuestos], ['producto_lotes', t.producto_lotes],
    ['producto_presentaciones', t.producto_presentaciones]]) {
    s.push(insertarVarias(tabla, filas));
  }
  s.push(`insert into public.movimientos_financieros (auth_user_id, tipo_flujo, tipo_movimiento, concepto, monto, fecha, created_at)
    values ('${F.U}', 'INGRESO', 'CAPITAL_AGREGADO', 'Saldo inicial de prueba', 5000, current_date, now() - interval '1 hour');`);
  s.push(`insert into public.movimientos_impuestos (auth_user_id, tipo_movimiento, concepto, monto, saldo_anterior, saldo_resultante, fecha, created_at)
    values ('${F.U}', 'IVA_VENTA', 'Saldo inicial de prueba', 100, 0, 100, current_date, now() - interval '1 hour');`);
  s.push(`insert into public.offline_cuentas_habilitadas (auth_user_id, habilitado) values ('${F.U}', true);`);
  s.push(`insert into public.offline_dispositivos (auth_user_id, dispositivo_uid, nombre) values ('${F.U}', '${F.IDS.dispositivo}', 'Caja de prueba');`);
  return s.join('\n  ');
}

function datosEscenario(cap) {
  const ops = cap.registro.filter((o) => o.op !== 'select' && (o.op !== 'rpc' || /^descontar_lote_(fefo|venta)$/.test(o.nombre)))
    .filter((o) => !(SIN_AUDITORIA && o.tabla === 'auditoria_log'))
    .map((o) => (o.op === 'rpc' ? { op: o.op, nombre: o.nombre, args: o.args } : { op: o.op, tabla: o.tabla, payload: o.payload, ids: o.ids, filtros: o.filtros }));
  const { payload, noPermitido } = convertir(cap.registro, {
    tipo: cap.tipo, uuid: crypto.randomUUID(), dispositivo_uid: F.IDS.dispositivo,
    fecha_hoy: cap.extra.fecha_hoy, vendida_en: new Date().toISOString(),
    componentes_promo: cap.extra.componentes_promo, precios_catalogo: cap.extra.precios_catalogo,
  });
  if (noPermitido.length) throw new Error(`${cap.nombre}: ${noPermitido.join(', ')}`);
  if (SIN_AUDITORIA) payload.auditoria = [];
  payload.reloj_envio = payload.vendida_en;
  return { nombre: cap.nombre, ops, payload };
}

// Cada escenario: A) escrituras de la web, foto, deshacer; B) función nueva, foto, deshacer; C) comparar.
function escenariosSql(lista) {
  return `
  v_nom := array[${lista.map((d) => lit(d.nombre)).join(', ')}];
  v_ops := array[${lista.map((d) => json(d.ops)).join(',\n  ')}];
  v_pay := array[${lista.map((d) => json(d.payload)).join(',\n  ')}];
  for v_n in 1 .. array_length(v_nom, 1) loop
    v_err := '[]'; v_web := null; v_off := null; v_res := null;
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', '{"sub":"${F.U}","role":"authenticated"}', true);
      v_err := v_err || pg_temp.n360_web(v_ops[v_n]);
      v_web := pg_temp.n360_foto();
      raise exception 'N360_DESHACER';
    exception when others then
      if sqlerrm <> 'N360_DESHACER' then v_err := v_err || jsonb_build_array('web: ' || sqlerrm); end if;
    end;
    begin
      perform set_config('role', 'authenticated', true);
      perform set_config('request.jwt.claims', '{"sub":"${F.U}","role":"authenticated"}', true);
      v_res := public.offline_registrar_venta(v_pay[v_n]);
      v_off := pg_temp.n360_foto();
      raise exception 'N360_DESHACER';
    exception when others then
      if sqlerrm <> 'N360_DESHACER' then v_err := v_err || jsonb_build_array('offline: ' || sqlerrm); end if;
    end;
    v_dif := '{}';
    for v_k in select jsonb_object_keys(coalesce(v_web, '{}') || coalesce(v_off, '{}')) loop
      if (v_web -> v_k) is distinct from (v_off -> v_k) then
        v_dif := v_dif || jsonb_build_object(v_k, jsonb_build_object('web', v_web -> v_k, 'offline', v_off -> v_k));
      end if;
    end loop;
    r := r || jsonb_build_object(v_nom[v_n], jsonb_build_object('iguales', v_dif = '{}', 'errores', v_err,
           'diferencias', v_dif, 'alertas', v_res -> 'alertas', 'total', v_web -> 'venta' -> 'total', 'stock', v_off -> 'stock', 'saldo', v_off -> 'saldo_caja'));
  end loop;`;
}

const capturas = JSON.parse(fs.readFileSync(entrada, 'utf8'));
const elegidos = indices ? indices.split(',').map(Number) : capturas.map((_, i) => i);
// En la prueba se usan sin comentarios (mismo SQL, menos texto).
const migracion = fs.readFileSync(MIGRACION, 'utf8').split('\n').filter((l) => !/^\s*--/.test(l)).join('\n');
const sql = `do $prueba$
declare r jsonb := '{}'; v_web jsonb; v_off jsonb; v_res jsonb; v_err jsonb; v_dif jsonb; v_k text; v_ops jsonb[]; v_pay jsonb[]; v_nom text[]; v_n int;
begin
${SIN_MIGRACION ? '' : `-- ---------- Migración a probar (se revierte al final) ----------\n${migracion}`}
-- ---------- Cuenta falsa de prueba ----------
  ${preparacion()}
  create function pg_temp.n360_foto() returns jsonb language sql as $fn$ select ${FOTO} $fn$;
  create function pg_temp.n360_web(p_ops jsonb) returns jsonb language plpgsql as $fn$
  declare o jsonb; f jsonb; i int; c text; w text; e jsonb := '[]';
  begin
    for o in select * from jsonb_array_elements(p_ops) loop
      begin
        if o->>'op' in ('insert', 'upsert') then
          i := 0;
          for f in select * from jsonb_array_elements(case when jsonb_typeof(o->'payload') = 'array' then o->'payload' else jsonb_build_array(o->'payload') end) loop
            f := f || jsonb_build_object('id', o->'ids'->>i); i := i + 1;
            select string_agg(quote_ident(k), ', ') into c from jsonb_object_keys(f) k;
            execute format('insert into public.%I (%s) select %s from jsonb_populate_record(null::public.%I, $1)', o->>'tabla', c, c, o->>'tabla') using f;
          end loop;
        elsif o->>'op' = 'update' then
          select string_agg(quote_ident(k), ', ') into c from jsonb_object_keys(o->'payload') k;
          select string_agg(format('%I = %L', x->>1, x->>2), ' and ') into w from jsonb_array_elements(o->'filtros') x where x->>0 = 'eq';
          execute format('update public.%I set (%s) = (select %s from jsonb_populate_record(null::public.%I, $1)) where %s',
                         o->>'tabla', c, c, o->>'tabla', w) using o->'payload';
        elsif o->>'op' = 'rpc' and o->>'nombre' = 'descontar_lote_fefo' then
          perform public.descontar_lote_fefo((o->'args'->>'p_producto_id')::uuid, (o->'args'->>'p_cantidad')::numeric);
        elsif o->>'op' = 'rpc' and o->>'nombre' = 'descontar_lote_venta' then
          perform public.descontar_lote_venta((o->'args'->>'p_lote_id')::uuid, (o->'args'->>'p_producto_id')::uuid, (o->'args'->>'p_cantidad')::numeric);
        end if;
      exception when others then e := e || jsonb_build_array(coalesce(o->>'tabla', o->>'nombre') || ': ' || sqlerrm);
      end;
    end loop;
    return e;
  end $fn$;
${escenariosSql(elegidos.map((i) => datosEscenario(capturas[i])))}
  raise exception 'RESULTADO_PRUEBA %', r;
end $prueba$;
`;
fs.writeFileSync(salida, SIN_AUDITORIA ? sql.replace(/^[ \t]+/gm, '') : sql);
if (salida !== '/dev/stdout') console.error(`SQL generado: ${sql.length} caracteres, ${elegidos.length} escenario(s)`);
