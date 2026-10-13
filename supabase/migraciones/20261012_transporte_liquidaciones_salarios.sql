-- Transporte · Liquidaciones conectadas con Salarios (ya aplicada en la base).
-- Guarda el id del pago de salario (empleados_pagos) que genera una liquidación de un conductor vinculado a un empleado.
-- Solo agrega una columna; las liquidaciones anteriores quedan como están.
alter table public.transporte_liquidaciones add column if not exists empleado_pago_id uuid;
