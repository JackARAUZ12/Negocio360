// ============================================================
// asistente-ia
// Asistente inteligente de Negocio360: el dueño le pregunta en
// lenguaje normal sobre su negocio ("¿cuánto vendí hoy?", "¿cómo
// van mis gastos este mes?"), Claude decide QUE datos reales
// necesita consultar (via tool calling), este codigo ejecuta esas
// consultas SIEMPRE limitadas al auth_user_id de quien pregunta
// (nunca datos de otro negocio), y Claude responde en español
// claro con los numeros reales.
//
// La clave de Anthropic NUNCA esta en este codigo -- se lee en vivo
// desde la boveda cifrada de Supabase (mismo patron ya usado para
// Resend), via una funcion que solo service_role puede llamar.
//
// ENDURECIDA (noviembre 2026), sin cambiar lo que ya hacia:
//  - Tope de preguntas por usuario (por hora y por dia) para no gastar
//    la cuenta de Anthropic (tabla asistente_uso, solo el servidor).
//  - Limite de largo de la pregunta y de la conversacion.
//  - El idioma de dinero y el pais se toman de la cuenta (Costa Rica
//    responde en colones; el resto sigue igual que siempre: Nicaragua).
//  - Los errores internos ya no se le muestran al usuario con detalle.
// ============================================================
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LIMITE_POR_HORA = 30;
const LIMITE_POR_DIA = 150;
const MAX_LARGO_PREGUNTA = 1500;
const MAX_MENSAJES_HISTORIAL = 40;

const TOOLS = [
  {
    name: "resumen_ventas",
    description: "Total de ventas, número de ventas, y ticket promedio en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha fin YYYY-MM-DD" },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "resumen_gastos",
    description: "Total de gastos (activos, no cancelados) en un rango de fechas, agrupado por categoría.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha fin YYYY-MM-DD" },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "resumen_compras",
    description: "Total de compras completadas en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha fin YYYY-MM-DD" },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "resumen_salarios",
    description: "Total pagado en salarios en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha fin YYYY-MM-DD" },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "saldo_caja_actual",
    description: "El saldo actual real de Caja (efectivo + otros métodos), ahora mismo.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "productos_mas_vendidos",
    description: "Los productos más vendidos (por cantidad) en un rango de fechas.",
    input_schema: {
      type: "object",
      properties: {
        desde: { type: "string", description: "Fecha inicio YYYY-MM-DD" },
        hasta: { type: "string", description: "Fecha fin YYYY-MM-DD" },
        limite: { type: "number", description: "Cuántos mostrar, por defecto 5" },
      },
      required: ["desde", "hasta"],
    },
  },
  {
    name: "productos_stock_bajo",
    description: "Productos cuyo stock actual está en o por debajo de su stock mínimo configurado.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "creditos_pendientes",
    description: "Total y número de créditos (ventas a crédito) que todavía no se han pagado por completo.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "cuentas_por_pagar_pendientes",
    description: "Total y número de cuentas por pagar (deudas con proveedores) todavía pendientes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "top_clientes",
    description: "Los clientes que más le han comprado al negocio, por monto total.",
    input_schema: {
      type: "object",
      properties: { limite: { type: "number", description: "Cuántos mostrar, por defecto 5" } },
    },
  },
];

async function ejecutarHerramienta(supabase: any, authUserId: string, nombre: string, input: any) {
  switch (nombre) {
    case "resumen_ventas": {
      const { data } = await supabase.from("ventas").select("total")
        .eq("auth_user_id", authUserId).eq("estado", "completada")
        .gte("fecha", input.desde).lte("fecha", `${input.hasta} 23:59:59`);
      const total = (data || []).reduce((s: number, v: any) => s + Number(v.total || 0), 0);
      const cantidad = (data || []).length;
      return { total_vendido: round2(total), numero_de_ventas: cantidad, ticket_promedio: cantidad ? round2(total / cantidad) : 0 };
    }
    case "resumen_gastos": {
      const { data } = await supabase.from("gastos").select("monto, categoria")
        .eq("auth_user_id", authUserId).eq("estado", "activo")
        .gte("fecha", input.desde).lte("fecha", input.hasta);
      const porCategoria: Record<string, number> = {};
      let total = 0;
      (data || []).forEach((g: any) => {
        total += Number(g.monto || 0);
        const cat = g.categoria || "Sin categoría";
        porCategoria[cat] = round2((porCategoria[cat] || 0) + Number(g.monto || 0));
      });
      return { total_gastado: round2(total), por_categoria: porCategoria };
    }
    case "resumen_compras": {
      const { data } = await supabase.from("compras").select("total")
        .eq("auth_user_id", authUserId).eq("estado", "completada")
        .gte("fecha", input.desde).lte("fecha", input.hasta);
      const total = (data || []).reduce((s: number, c: any) => s + Number(c.total || 0), 0);
      return { total_comprado: round2(total), numero_de_compras: (data || []).length };
    }
    case "resumen_salarios": {
      const { data } = await supabase.from("empleados_pagos").select("total_pagado")
        .eq("auth_user_id", authUserId).eq("estado", "pagado")
        .gte("fecha", input.desde).lte("fecha", input.hasta);
      const total = (data || []).reduce((s: number, p: any) => s + Number(p.total_pagado || 0), 0);
      return { total_pagado_en_salarios: round2(total), numero_de_pagos: (data || []).length };
    }
    case "saldo_caja_actual": {
      const { data } = await supabase.from("movimientos_financieros").select("saldo_resultante")
        .eq("auth_user_id", authUserId).eq("estado", "completado")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      return { saldo_actual: round2(Number(data?.saldo_resultante || 0)) };
    }
    case "productos_mas_vendidos": {
      const { data, error } = await supabase.rpc("asistente_productos_mas_vendidos", {
        p_auth_user_id: authUserId, p_desde: input.desde, p_hasta: input.hasta, p_limite: input.limite || 5,
      });
      if (error) return { error: error.message };
      return { productos: data };
    }
    case "productos_stock_bajo": {
      const { data } = await supabase.from("productos").select("nombre, stock_actual, stock_minimo")
        .eq("auth_user_id", authUserId).eq("activo", true)
        .not("stock_minimo", "is", null).order("stock_actual", { ascending: true }).limit(20);
      const bajos = (data || []).filter((p: any) => Number(p.stock_actual) <= Number(p.stock_minimo));
      return { productos_con_stock_bajo: bajos };
    }
    case "creditos_pendientes": {
      const { data } = await supabase.from("ventas").select("total, monto_pagado")
        .eq("auth_user_id", authUserId).eq("estado", "completada").eq("metodo_pago", "credito")
        .neq("estado_credito", "pagado");
      const totalPendiente = (data || []).reduce((s: number, v: any) => s + (Number(v.total || 0) - Number(v.monto_pagado || 0)), 0);
      return { total_pendiente_de_cobrar: round2(totalPendiente), numero_de_creditos: (data || []).length };
    }
    case "cuentas_por_pagar_pendientes": {
      const { data } = await supabase.from("cuentas_por_pagar").select("saldo_pendiente")
        .eq("auth_user_id", authUserId).gt("saldo_pendiente", 0);
      const total = (data || []).reduce((s: number, c: any) => s + Number(c.saldo_pendiente || 0), 0);
      return { total_pendiente_de_pagar: round2(total), numero_de_cuentas: (data || []).length };
    }
    case "top_clientes": {
      const { data, error } = await supabase.rpc("asistente_top_clientes", {
        p_auth_user_id: authUserId, p_limite: input.limite || 5,
      });
      if (error) return { error: error.message };
      return { clientes: data };
    }
    default:
      return { error: "Herramienta desconocida" };
  }
}

function round2(n: number) { return Math.round((Number(n) || 0) * 100) / 100; }

function respuestaJson(cuerpo: unknown, status = 200) {
  return new Response(JSON.stringify(cuerpo), { status, headers: { ...CORS_HEADERS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace("Bearer ", "");
    const { data: callerData, error: errCaller } = await supabase.auth.getUser(token);
    if (errCaller || !callerData?.user) {
      return respuestaJson({ ok: false, error: "No autorizado" }, 401);
    }
    const authUserId = callerData.user.id;

    const cuerpo = await req.json().catch(() => ({}));
    const { pregunta, historial } = cuerpo as { pregunta?: unknown; historial?: unknown };
    if (!pregunta || typeof pregunta !== "string") {
      return respuestaJson({ ok: false, error: "Falta la pregunta" }, 400);
    }
    if (pregunta.length > MAX_LARGO_PREGUNTA) {
      return respuestaJson({ ok: false, error: "La pregunta es demasiado larga. Hazla más corta." }, 400);
    }
    if (Array.isArray(historial) && historial.length > MAX_MENSAJES_HISTORIAL) {
      return respuestaJson({ ok: false, error: "La conversación ya es muy larga. Empieza una nueva." }, 400);
    }

    // Tope de preguntas por usuario. Si el conteo fallara por cualquier motivo, NO se bloquea al usuario (solo se avisa en el registro).
    try {
      const hace1h = new Date(Date.now() - 3600 * 1000).toISOString();
      const hace24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
      const [h, d] = await Promise.all([
        supabase.from("asistente_uso").select("id", { count: "exact", head: true }).eq("auth_user_id", authUserId).gte("creado_at", hace1h),
        supabase.from("asistente_uso").select("id", { count: "exact", head: true }).eq("auth_user_id", authUserId).gte("creado_at", hace24h),
      ]);
      if (!h.error && !d.error) {
        if ((h.count ?? 0) >= LIMITE_POR_HORA) {
          return respuestaJson({ ok: false, error: "Llegaste al límite de preguntas por hora. Intenta más tarde." }, 429);
        }
        if ((d.count ?? 0) >= LIMITE_POR_DIA) {
          return respuestaJson({ ok: false, error: "Llegaste al límite de preguntas de hoy. Intenta mañana." }, 429);
        }
      } else {
        console.error("asistente-ia: no se pudo contar el uso", h.error || d.error);
      }
      await supabase.from("asistente_uso").insert({ auth_user_id: authUserId });
    } catch (eUso) {
      console.error("asistente-ia: control de uso", eUso);
    }

    // País y moneda de la cuenta (Costa Rica responde en colones; lo demás queda como siempre).
    let esCostaRica = false;
    try {
      const { data: cfg } = await supabase.from("configuracion_empresa").select("pais, moneda")
        .eq("auth_user_id", authUserId).limit(1).maybeSingle();
      esCostaRica = cfg?.pais === "CR" && cfg?.moneda === "CRC";
    } catch (_) { /* si falla, se usa el comportamiento de siempre */ }

    const { data: apiKey, error: errClave } = await supabase.rpc("obtener_secreto_anthropic");
    if (errClave || !apiKey) {
      console.error("asistente-ia: no se pudo leer la clave desde la bóveda", errClave?.message);
      return respuestaJson({ ok: false, error: "El asistente no está disponible en este momento." }, 503);
    }

    const hoy = new Date().toISOString().slice(0, 10);
    const sistema = esCostaRica
      ? `Eres el asistente de Negocio360, un sistema de gestión de negocios en Costa Rica. Hoy es ${hoy}. Responde en español, de forma breve, clara y en colones (₡) cuando hables de dinero; nunca menciones córdobas. Usa las herramientas para consultar datos REALES del negocio antes de responder cualquier pregunta sobre números -- nunca inventes cifras. Si una herramienta devuelve un error o datos vacíos, dilo con naturalidad.`
      : `Eres el asistente de Negocio360, un sistema de gestión de negocios en Nicaragua. Hoy es ${hoy}. Responde en español, de forma breve, clara y en córdobas (C$) cuando hables de dinero. Usa las herramientas para consultar datos REALES del negocio antes de responder cualquier pregunta sobre números -- nunca inventes cifras. Si una herramienta devuelve un error o datos vacíos, dilo con naturalidad.`;

    const mensajes: any[] = [
      ...(Array.isArray(historial) ? historial : []),
      { role: "user", content: pregunta },
    ];

    let respuestaFinal = "";
    for (let vuelta = 0; vuelta < 5; vuelta++) {
      const resp = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1024,
          system: sistema,
          tools: TOOLS,
          messages: mensajes,
        }),
      });

      if (!resp.ok) {
        const textoError = await resp.text();
        console.error(`asistente-ia: Anthropic API error ${resp.status}: ${textoError.slice(0, 300)}`);
        return respuestaJson({ ok: false, error: "El asistente no pudo responder ahora. Intenta de nuevo en un momento." }, 502);
      }
      const data = await resp.json();
      mensajes.push({ role: "assistant", content: data.content });

      if (data.stop_reason !== "tool_use") {
        respuestaFinal = (data.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        break;
      }

      const bloquesHerramienta = (data.content || []).filter((b: any) => b.type === "tool_use");
      const resultados = [];
      for (const bloque of bloquesHerramienta) {
        const resultado = await ejecutarHerramienta(supabase, authUserId, bloque.name, bloque.input || {});
        resultados.push({ type: "tool_result", tool_use_id: bloque.id, content: JSON.stringify(resultado) });
      }
      mensajes.push({ role: "user", content: resultados });
    }

    return respuestaJson({ ok: true, respuesta: respuestaFinal || "No pude generar una respuesta, intenta de nuevo.", mensajes });
  } catch (e) {
    console.error("asistente-ia:", e);
    return respuestaJson({ ok: false, error: "El asistente tuvo un problema. Intenta de nuevo." }, 500);
  }
});
