-- Fecha automática de modificación en proformas (para el caché incremental de la lista).
-- Solo escribe updated_at; no toca montos, estados ni los triggers existentes.
-- Respaldo previo: public.respaldo_proformas_20261102
drop trigger if exists trg_proformas_updated_at on public.proformas;
create trigger trg_proformas_updated_at
  before update on public.proformas
  for each row execute function public.set_updated_at();
