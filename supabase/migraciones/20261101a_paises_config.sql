-- PAÍSES: los datos que cambian de un país a otro (moneda, zona horaria, formato, IVA, documentos fiscales) viven en una
-- tabla, no en el código. Agregar un país = agregar una fila. Es solo LECTURA para las cuentas: nadie puede modificarla
-- desde la app. Es una tabla NUEVA: no cambia ni toca ninguna tabla ni dato existente.
-- "verificado" = true solo cuando los datos fiscales fueron revisados con fuentes; false = valores iniciales a validar con un
-- contador del país antes de ofrecerlos como definitivos.
create table if not exists public.paises_config (
  codigo               text primary key check (codigo ~ '^[A-Z]{2}$'),
  nombre               text not null,
  moneda               text not null check (moneda ~ '^[A-Z]{3}$'),
  simbolo              text not null,
  locale               text not null,
  zona_horaria         text not null,
  decimales            integer not null default 2 check (decimales between 0 and 4),
  iva_nombre           text,
  iva_porcentaje       numeric(5,2) check (iva_porcentaje is null or (iva_porcentaje >= 0 and iva_porcentaje <= 100)),
  id_fiscal_etiqueta   text,
  tipos_identificacion jsonb not null default '[]'::jsonb,
  plantilla_nomina     text,
  factura_electronica  text not null default 'ninguna' check (factura_electronica in ('ninguna', 'proveedor', 'directa')),
  verificado           boolean not null default false,
  nota                 text,
  orden                integer not null default 100,
  updated_at           timestamptz not null default now()
);
alter table public.paises_config enable row level security;
drop policy if exists paises_config_leer on public.paises_config;
create policy paises_config_leer on public.paises_config for select to authenticated using (true);
revoke all on public.paises_config from anon;
revoke insert, update, delete, truncate on public.paises_config from authenticated;
grant select on public.paises_config to authenticated;

insert into public.paises_config(codigo, nombre, moneda, simbolo, locale, zona_horaria, iva_nombre, iva_porcentaje, id_fiscal_etiqueta, tipos_identificacion, plantilla_nomina, factura_electronica, verificado, nota, orden) values
 ('NI','Nicaragua','NIO','C$','es-NI','America/Managua','IVA',15,'RUC','[{"codigo":"ruc","nombre":"RUC"},{"codigo":"cedula","nombre":"Cédula"}]','NI','ninguna',true,null,1),
 ('CR','Costa Rica','CRC','₡','es-CR','America/Costa_Rica','IVA',13,'Cédula / ID fiscal','[{"codigo":"01","nombre":"Cédula física"},{"codigo":"02","nombre":"Cédula jurídica"},{"codigo":"03","nombre":"DIMEX"},{"codigo":"04","nombre":"NITE"}]',null,'ninguna',true,'Factura electrónica de Hacienda (v4.4) obligatoria: aún NO integrada. Planilla CCSS pendiente de plantilla. Validar tarifas con contador.',2),
 ('GT','Guatemala','GTQ','Q','es-GT','America/Guatemala','IVA',12,'NIT','[{"codigo":"nit","nombre":"NIT"},{"codigo":"dpi","nombre":"DPI"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',10),
 ('SV','El Salvador','USD','$','es-SV','America/El_Salvador','IVA',13,'NIT','[{"codigo":"nit","nombre":"NIT"},{"codigo":"dui","nombre":"DUI"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',11),
 ('HN','Honduras','HNL','L','es-HN','America/Tegucigalpa','ISV',15,'RTN','[{"codigo":"rtn","nombre":"RTN"},{"codigo":"dni","nombre":"Identidad"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',12),
 ('PA','Panamá','PAB','B/','es-PA','America/Panama','ITBMS',7,'RUC','[{"codigo":"ruc","nombre":"RUC"},{"codigo":"cedula","nombre":"Cédula"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',13),
 ('MX','México','MXN','$','es-MX','America/Mexico_City','IVA',16,'RFC','[{"codigo":"rfc","nombre":"RFC"},{"codigo":"curp","nombre":"CURP"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',14),
 ('CO','Colombia','COP','$','es-CO','America/Bogota','IVA',19,'NIT','[{"codigo":"nit","nombre":"NIT"},{"codigo":"cc","nombre":"Cédula de ciudadanía"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',15),
 ('PE','Perú','PEN','S/','es-PE','America/Lima','IGV',18,'RUC','[{"codigo":"ruc","nombre":"RUC"},{"codigo":"dni","nombre":"DNI"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',16),
 ('CL','Chile','CLP','$','es-CL','America/Santiago','IVA',19,'RUT','[{"codigo":"rut","nombre":"RUT"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',17),
 ('AR','Argentina','ARS','$','es-AR','America/Argentina/Buenos_Aires','IVA',21,'CUIT','[{"codigo":"cuit","nombre":"CUIT"},{"codigo":"dni","nombre":"DNI"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',18),
 ('DO','República Dominicana','DOP','RD$','es-DO','America/Santo_Domingo','ITBIS',18,'RNC','[{"codigo":"rnc","nombre":"RNC"},{"codigo":"cedula","nombre":"Cédula"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',19),
 ('ES','España','EUR','€','es-ES','Europe/Madrid','IVA',21,'NIF','[{"codigo":"nif","nombre":"NIF"},{"codigo":"nie","nombre":"NIE"}]',null,'ninguna',false,'Valores iniciales: validar con un contador.',20),
 ('US','Estados Unidos','USD','$','en-US','America/New_York','Sales tax',null,'EIN','[{"codigo":"ein","nombre":"EIN"},{"codigo":"ssn","nombre":"SSN"}]',null,'ninguna',false,'El impuesto a las ventas varía por estado: se configura a mano.',21)
on conflict (codigo) do nothing;
