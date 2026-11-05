-- Zona / barrio del cliente para ordenar la ruta de cobro del Panel Microfinanciera.
-- Aditivo: columna opcional, vacía por defecto. No cambia nada de lo existente.
alter table public.clientes add column if not exists zona text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'clientes_zona_largo_chk') then
    alter table public.clientes add constraint clientes_zona_largo_chk check (zona is null or length(zona) <= 60);
  end if;
end $$;
create index if not exists clientes_zona_idx on public.clientes (auth_user_id, zona) where zona is not null;
