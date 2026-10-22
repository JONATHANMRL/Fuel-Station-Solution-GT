-- SOLO PARA REVISION DEL DBA. Este archivo NO es ejecutado por la aplicación.
-- Ejecutar únicamente tras aprobación, conectado a FREEPDB1 con cuenta DBA.
-- Crear primero GASOLINAGT_ADMIN con contraseña fuerte desde la herramienta
-- administrativa privada. No guardar esa contraseña ni su CREATE USER en Git.
-- GASOLINAGT_API conserva exclusivamente los permisos de lectura que ya tiene.
-- SQL*Plus / SQLcl: ESQUEMA es el propietario REAL de USUARIO, no la cuenta API.
WHENEVER SQLERROR EXIT SQL.SQLCODE ROLLBACK
ACCEPT ESQUEMA CHAR PROMPT 'Esquema propietario de USUARIO: '

BEGIN
  IF SYS_CONTEXT('USERENV', 'CON_NAME') <> 'FREEPDB1' THEN
    RAISE_APPLICATION_ERROR(-20090, 'Conectar a FREEPDB1 antes de preparar permisos.');
  END IF;
END;
/

GRANT CREATE SESSION TO GASOLINAGT_ADMIN;
GRANT SELECT ON &&ESQUEMA..USUARIO TO GASOLINAGT_ADMIN;

-- NO conceder DBA, SELECT ANY TABLE, DML sobre PRECIO/USUARIO ni EXECUTE sobre
-- REGISTRAR_PRECIO en esta fase. La cuenta administrativa solo verifica usuarios.
-- Una fase posterior revisará por separado EXECUTE sobre REGISTRAR_PRECIO.
UNDEFINE ESQUEMA
