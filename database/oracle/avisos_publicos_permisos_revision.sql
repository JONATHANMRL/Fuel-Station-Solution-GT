-- SOLO REVISION. No ejecutado por Codex. Revisar en FREEPDB1 como propietario/DBA.
-- Se reutiliza el usuario lector existente. NO crear cuentas ni cambiar passwords.
-- La cuenta ya consulta V_MAPA_GASOLINERA y las otras vistas de la fase 1.
-- Unico permiso adicional si no existe: leer el historial, sin DML ni EXECUTE.
GRANT SELECT ON GASOLINAGT.PRECIO TO GASOLINAGT_API;

-- Para comprobar antes/despues conectado como GASOLINAGT_API:
-- SELECT OWNER, TABLE_NAME, PRIVILEGE FROM USER_TAB_PRIVS_RECD
-- WHERE OWNER='GASOLINAGT' AND TABLE_NAME IN ('PRECIO','V_MAPA_GASOLINERA');
-- No conceder USUARIO, CLAVE_HASH, NOTIFICACION, preferencias, procedimientos,
-- privilegios ANY, DBA, INSERT, UPDATE o DELETE para este endpoint publico.
