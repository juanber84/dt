-- Google ha dejado de mandar el id del aparato de Apple Health (com.apple.health.<UUID>): ahora
-- todo lo de Apple Health es un único origen, ya combinado como en la app Salud (el reloj manda y
-- el iPhone rellena lo que el reloj no mide). La prioridad del Apple Watch dentro de Google pasa a
-- ese origen. Lo ya guardado se arregla re-normalizando (make renormalize provider=google-health).
update origin_priorities
set origin_pattern = 'HEALTH_KIT|com.apple.health'
where provider = 'google-health' and origin_pattern = 'HEALTH_KIT|com.apple.health.%';
