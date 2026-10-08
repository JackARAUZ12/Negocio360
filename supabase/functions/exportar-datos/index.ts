// Edge Function: exportar-datos
// Arma, en segundo plano, un ZIP con un CSV por tabla con la informacion del
// usuario que lo pide. Solo lee filas con auth_user_id = usuario autenticado.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { zipSync, strToU8 } from 'https://esm.sh/fflate@0.8.2';

const CAT = {"grupos": [{"k": "ventas", "n": "Ventas", "d": "Ventas con su detalle, garantías y servicio postventa", "t": ["ventas", "venta_detalles", "ventas_items", "garantias_clientes", "servicio_postventa"]}, {"k": "compras", "n": "Compras y proveedores", "d": "Compras, órdenes de compra, devoluciones, proveedores y cuentas por pagar", "t": ["compras", "detalle_compras", "ordenes_compra", "orden_compra_detalles", "devoluciones_proveedor", "proveedores", "cuentas_por_pagar", "cuentas_por_pagar_cuotas", "cuentas_por_pagar_pagos"]}, {"k": "inventario", "n": "Productos e inventario", "d": "Productos, lotes, presentaciones, precios, combos, promociones y movimientos de inventario", "t": ["productos", "producto_lotes", "producto_presentaciones", "precios_escala", "movimientos_inventario", "combos", "combo_items", "combo_precios_escala", "promociones", "promocion_productos", "numeros_serie", "codigos_barras", "unidades_medida", "registro_sustancias_controladas", "log_stock_fallido"]}, {"k": "clientes", "n": "Clientes", "d": "Clientes, interacciones, puntos, pagos recurrentes y rutas", "t": ["clientes", "cliente_interacciones", "puntos_movimientos", "puntos_recompensas", "pagos_clientes_recurrentes", "rutas", "ruta_clientes"]}, {"k": "creditos", "n": "Créditos a clientes", "d": "Créditos, cuotas, pagos e historial", "t": ["creditos", "creditos_cuotas", "creditos_pagos", "creditos_historial"]}, {"k": "proformas", "n": "Proformas", "d": "Proformas y su detalle", "t": ["proformas", "proforma_detalles"]}, {"k": "dinero", "n": "Caja, bancos y movimientos", "d": "Caja, cierres, caja chica, movimientos financieros, bancos, capital, impuestos y métodos de pago", "t": ["caja", "cierres_caja", "caja_chica_sesiones", "movimientos_financieros", "bancos", "conciliaciones_bancarias", "capital_negocio", "metodos_pago", "impuestos", "movimientos_impuestos"]}, {"k": "gastos", "n": "Gastos", "d": "Gastos, gastos programados y su historial", "t": ["gastos", "gastos_programados", "historial_gastos", "categorias_gasto_personalizadas"]}, {"k": "contabilidad", "n": "Contabilidad", "d": "Catálogo de cuentas, asientos y mapeo contable", "t": ["cuentas_contables", "asientos_contables", "asientos_detalle", "contabilidad_mapeo_cuentas"]}, {"k": "personal", "n": "Personal y nómina", "d": "Empleados, pagos, adelantos, vacaciones, liquidaciones, planillas y freelancers", "t": ["empleados", "empleados_pagos", "empleados_adelantos", "empleados_ausencias", "empleados_vacaciones", "empleados_liquidaciones", "empleados_bono_anual_pagos", "empleados_documentos", "empleados_historial_cambios", "nomina_conceptos", "nomina_planillas", "nomina_bono_anual_config", "freelancers", "freelancers_pagos"]}, {"k": "activos", "n": "Activos fijos", "d": "Activos, mantenimientos, mejoras y reasignaciones", "t": ["activos_fijos", "activo_mantenimientos", "activo_mejoras_capitalizadas", "activo_reasignaciones"]}, {"k": "produccion", "n": "Producción y recetas", "d": "Recetas, órdenes de producción y consumos", "t": ["recetas_produccion", "receta_componentes", "receta_despiece_salidas", "ordenes_produccion", "orden_produccion_consumos", "orden_despiece_resultados"]}, {"k": "operaciones", "n": "Operaciones y módulos especiales", "d": "Delivery, agenda, restaurante, hotel, veterinaria, farmacia y convenios", "t": ["delivery_pedidos", "agenda_eventos", "restaurante_mesas", "restaurante_comandas", "restaurante_comanda_items", "hotel_habitaciones", "hotel_reservaciones", "hotel_cargos_estadia", "vet_mascotas", "vet_veterinarios", "vet_citas", "vet_consultas", "vet_vacunas", "vet_estancias", "vet_estancia_notas", "vet_cargos", "vet_recetas_items", "farmacia_medicos", "farmacia_pacientes", "farmacia_recetas", "convenios", "convenio_cuentas", "convenio_empleados", "convenio_consumos", "convenio_gastos", "convenio_pagos", "convenio_pago_detalle"]}, {"k": "auditoria", "n": "Auditoría", "d": "Registro de movimientos y cambios en el sistema", "t": ["auditoria_log"]}, {"k": "config", "n": "Configuración", "d": "Datos de la empresa y preferencias de documentos y ventas", "t": ["configuracion_empresa", "configuracion_venta_rapida", "configuracion_documentos", "configuracion_proforma", "dashboard_configuracion"]}], "sinId": ["configuracion_documentos", "configuracion_proforma"]};
const BOM = String.fromCharCode(0xFEFF); // para que Excel lea bien los acentos
const PAGINA = 1000;
const HORAS_VIGENCIA = 48;

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

function celda(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && /^[=@\t\r]/.test(s)) s = "'" + s; // evita que Excel lo trate como formula
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const anon = Deno.env.get('SUPABASE_ANON_KEY')!;
    const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = req.headers.get('Authorization') ?? '';
    const userClient = createClient(url, anon, { global: { headers: { Authorization: auth } } });
    const { data: { user }, error: eu } = await userClient.auth.getUser();
    if (eu || !user) return json({ error: 'No autorizado' }, 401);

    const { id } = await req.json().catch(() => ({}));
    if (!id) return json({ error: 'Falta el id' }, 400);

    const admin = createClient(url, service);
    const { data: fila } = await admin.from('exportaciones').select('*').eq('id', id).eq('auth_user_id', user.id).maybeSingle();
    if (!fila) return json({ error: 'Solicitud no encontrada' }, 404);
    if (fila.estado !== 'pendiente') return json({ error: 'La solicitud ya fue procesada' }, 409);

    // Una sola exportacion activa por negocio
    const { data: activas } = await admin.from('exportaciones').select('id')
      .eq('auth_user_id', user.id).eq('estado', 'procesando')
      .gte('created_at', new Date(Date.now() - 30 * 60 * 1000).toISOString());
    if (activas && activas.length) return json({ error: 'Ya hay una exportacion en proceso' }, 409);

    // @ts-ignore EdgeRuntime existe en Supabase
    EdgeRuntime.waitUntil(procesar(admin, user.id, fila));
    return json({ ok: true }, 202);
  } catch (e) {
    return json({ error: String((e as Error).message || e) }, 500);
  }
});

async function procesar(admin: any, uid: string, fila: any) {
  const id = fila.id;
  try {
    await admin.from('exportaciones').update({ estado: 'procesando' }).eq('id', id);

    // Limpieza: borra los archivos vencidos de este usuario
    const { data: viejos } = await admin.from('exportaciones').select('id,archivo_path')
      .eq('auth_user_id', uid).eq('estado', 'listo').lt('expira_at', new Date().toISOString());
    if (viejos && viejos.length) {
      await admin.storage.from('exportaciones').remove(viejos.map((v: any) => v.archivo_path).filter(Boolean));
      await admin.from('exportaciones').delete().in('id', viejos.map((v: any) => v.id));
    }

    const permitidos = new Set(CAT.grupos.filter((g: any) => (fila.grupos || []).includes(g.k)).flatMap((g: any) => g.t));
    const tablas: string[] = CAT.grupos.flatMap((g: any) => g.t).filter((t: string) => permitidos.has(t));
    const archivos: Record<string, Uint8Array> = {};
    const resumen: string[] = ['tabla,filas,observacion'];
    let filasTotal = 0, hechas = 0;

    for (const tabla of tablas) {
      let ultimo: unknown = null, n = 0, cols: string[] | null = null;
      const partes: string[] = [];
      const sinId = CAT.sinId.includes(tabla);
      let obs = '';
      for (;;) {
        let q = admin.from(tabla).select('*').eq('auth_user_id', uid).limit(PAGINA);
        if (!sinId) { q = q.order('id', { ascending: true }); if (ultimo !== null) q = q.gt('id', ultimo); }
        const { data, error } = await q;
        if (error) { obs = 'No disponible'; break; }
        if (!data || !data.length) break;
        if (!cols) { cols = Object.keys(data[0]); partes.push(cols.map(celda).join(',') + '\n'); }
        for (const f of data) partes.push(cols.map((c) => celda(f[c])).join(',') + '\n');
        n += data.length;
        if (sinId || data.length < PAGINA) break;
        ultimo = data[data.length - 1].id;
      }
      if (n > 0) { archivos[`${tabla}.csv`] = strToU8(BOM + partes.join('')); }
      else if (!obs) obs = 'Sin datos';
      resumen.push(`${tabla},${n},${obs}`);
      filasTotal += n; hechas++;
      await admin.from('exportaciones').update({ tablas_hechas: hechas, filas_total: filasTotal }).eq('id', id);
    }

    archivos['LEEME.txt'] = strToU8(
      `Exportacion de informacion - Negocio360\nFecha: ${new Date().toISOString()}\nFilas en total: ${filasTotal}\n\n` +
      `Cada archivo .csv es una tabla de tu negocio (abre con Excel: Datos > Desde texto/CSV, codificacion UTF-8).\n` +
      `El archivo resumen.csv lista cuantas filas tiene cada tabla.\n`);
    archivos['resumen.csv'] = strToU8(BOM + resumen.join('\n') + '\n');

    const zip = zipSync(archivos, { level: 6 });
    const path = `${uid}/${id}.zip`;
    const { error: eUp } = await admin.storage.from('exportaciones').upload(path, zip, { contentType: 'application/zip', upsert: true });
    if (eUp) throw eUp;

    await admin.from('exportaciones').update({
      estado: 'listo', archivo_path: path, tamano_bytes: zip.byteLength, filas_total: filasTotal,
      finished_at: new Date().toISOString(),
      expira_at: new Date(Date.now() + HORAS_VIGENCIA * 3600 * 1000).toISOString(),
    }).eq('id', id);
  } catch (e) {
    await admin.from('exportaciones').update({
      estado: 'error', error_msg: 'No se pudo completar. Intenta de nuevo.', finished_at: new Date().toISOString(),
    }).eq('id', id);
    console.error('exportar-datos:', e);
  }
}
