-- ============================================================
-- SEGURIDAD: vistas que se saltaban la seguridad por filas (RLS)
-- Auditoría de cuentas demo (20/10/2026).
-- admin_usuarios, ventas_diarias_view, ventas_resumen y
-- resumen_caja_mes eran del dueño "postgres" sin security_invoker:
-- cualquiera (incluso SIN iniciar sesión, con la llave pública) podía
-- leer correos/teléfonos de todos los usuarios y las ventas/caja de
-- todos los negocios. Ningún módulo ni función las usa.
-- Ahora respetan la RLS de quien consulta (cada quien ve solo lo suyo;
-- el admin ve lo que su política le permite) y anon queda sin acceso.
-- ============================================================
alter view public.admin_usuarios      set (security_invoker = true);
alter view public.ventas_diarias_view set (security_invoker = true);
alter view public.ventas_resumen      set (security_invoker = true);
alter view public.resumen_caja_mes    set (security_invoker = true);

revoke all on public.admin_usuarios, public.ventas_diarias_view, public.ventas_resumen,
              public.resumen_caja_mes, public.puntos_saldos from anon;
