-- La imagen de Timescale ya la crea en la BD inicial; esto cubre cualquier otra BD (tests...)
create extension if not exists timescaledb;
