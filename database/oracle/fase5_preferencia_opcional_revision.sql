-- PROPUESTA OPCIONAL, SOLO PARA REVISION. No ejecutada. No modifica el esquema.
-- Sin una preferencia ACTIVA del titular, no corresponde generar avisos para el.
-- El titular/DBA debe elegir :id_usuario, :id_combustible y :precio_maximo.
-- No usar automaticamente el usuario demo; no cambiar preferencias ya existentes.
INSERT INTO GASOLINAGT.PREFERENCIA_ALERTA (ID_USUARIO, ID_COMBUSTIBLE, PRECIO_MAXIMO, ESTADO)
SELECT U.ID_USUARIO, C.ID_COMBUSTIBLE, :precio_maximo, 'ACTIVA'
FROM GASOLINAGT.USUARIO U CROSS JOIN GASOLINAGT.COMBUSTIBLE C
WHERE U.ID_USUARIO = :id_usuario AND U.ESTADO = 'ACTIVO'
  AND C.ID_COMBUSTIBLE = :id_combustible AND C.ESTADO = 'ACTIVO'
  AND :precio_maximo > 0 AND :precio_maximo <= 999999.99
  AND ROUND(:precio_maximo, 2) = :precio_maximo
  AND NOT EXISTS (SELECT 1 FROM GASOLINAGT.PREFERENCIA_ALERTA PA
                  WHERE PA.ID_USUARIO = U.ID_USUARIO AND PA.ID_COMBUSTIBLE = C.ID_COMBUSTIBLE);
-- Revisar filas afectadas y valores ANTES de decidir COMMIT o ROLLBACK manualmente.
-- No hay COMMIT automatico ni modificacion del usuario o su password.
