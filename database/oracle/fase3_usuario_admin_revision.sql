-- SOLO PARA REVISION. No crea tablas, roles ni permisos automáticamente.
-- Conectar a FREEPDB1 COMO PROPIETARIO de USUARIO, tras aprobación del equipo.
-- Generar hash con: python -m backend.passwords (entrada oculta, sal aleatoria).
-- El operador debe enlazar :admin_nombre, :admin_correo y :admin_hash mediante
-- su cliente Oracle. NO pegar contraseña en texto plano ni datos reales en Git.
-- El bloque no contiene COMMIT: revisar el resultado y confirmar expresamente.

DECLARE
  V_ID USUARIO.ID_USUARIO%TYPE;
  V_HASH VARCHAR2(255) := :admin_hash;
BEGIN
  IF SYS_CONTEXT('USERENV', 'CON_NAME') <> 'FREEPDB1' THEN
    RAISE_APPLICATION_ERROR(-20090, 'Conectar a FREEPDB1.');
  END IF;
  IF :admin_nombre IS NULL OR :admin_correo IS NULL
     OR V_HASH IS NULL OR V_HASH NOT LIKE 'scrypt$131072$8$1$%' THEN
    RAISE_APPLICATION_ERROR(-20091, 'Faltan datos o hash scrypt generado por la herramienta.');
  END IF;
  INSERT INTO USUARIO (NOMBRE, CORREO, CLAVE_HASH, ESTADO)
  VALUES (:admin_nombre, LOWER(TRIM(:admin_correo)), V_HASH, 'ACTIVO')
  RETURNING ID_USUARIO INTO V_ID;
  DBMS_OUTPUT.PUT_LINE('ID administrativo propuesto: ' || V_ID);
END;
/

-- Revisar el registro. Solo después ejecutar COMMIT manualmente y configurar
-- AUTH_ADMIN_USER_IDS con el ID retornado. No se selecciona ni convierte al
-- usuario 1 de demostración. Ante colisión de identidad, detenerse y pedir al
-- DBA revisar la secuencia; no sobrescribir usuarios ni alterar el esquema aquí.
