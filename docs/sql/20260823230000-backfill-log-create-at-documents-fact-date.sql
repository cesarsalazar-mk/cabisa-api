-- =============================================================================
-- Backfill en LOTES (evita "Socket closed" / timeout)
-- Ejecutar paso a paso, NO todo de una vez
--
-- Fuente: response_json.fecha → 2026-08-23 21:59:46
-- =============================================================================

-- -----------------------------------------------------------------------------
-- PASO A) Diagnostico rapido (seguro)
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS total_logs FROM log_documents;

SELECT
  COUNT(*) AS create_at_vacios
FROM log_documents
WHERE create_at IS NULL OR create_at = '0000-00-00 00:00:00';

-- -----------------------------------------------------------------------------
-- PASO B) Popular log_documents.create_at EN LOTES
-- Repite el mismo UPDATE hasta que affected rows = 0
-- Ajusta LIMIT 500 / 1000 segun aguante tu conexion
-- -----------------------------------------------------------------------------

-- Lote 1 (repetir)
UPDATE log_documents
SET
  create_at = LEFT(
    REPLACE(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.fecha')), 'T', ' '),
    19
  ),
  update_at = CASE
    WHEN update_at IS NULL OR update_at = '0000-00-00 00:00:00' THEN
      LEFT(
        REPLACE(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.fecha')), 'T', ' '),
        19
      )
    ELSE update_at
  END
WHERE id IN (
  SELECT id FROM (
    SELECT id
    FROM log_documents
    WHERE (create_at IS NULL OR create_at = '0000-00-00 00:00:00')
      AND response_json IS NOT NULL
      AND response_json <> ''
    ORDER BY id
    LIMIT 500
  ) t
)
AND JSON_EXTRACT(response_json, '$.fecha') IS NOT NULL
AND JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.fecha')) <> '';

-- Ver progreso
SELECT
  SUM(CASE WHEN create_at IS NULL OR create_at = '0000-00-00 00:00:00' THEN 1 ELSE 0 END) AS quedan_vacios,
  SUM(CASE WHEN create_at IS NOT NULL AND create_at <> '0000-00-00 00:00:00' THEN 1 ELSE 0 END) AS ya_llenos
FROM log_documents;

-- Muestra
SELECT id, uuid, serie, document_id, error, create_at,
       LEFT(JSON_UNQUOTE(JSON_EXTRACT(response_json, '$.fecha')), 30) AS fecha_json
FROM log_documents
WHERE create_at IS NOT NULL AND create_at <> '0000-00-00 00:00:00'
ORDER BY id DESC
LIMIT 10;

-- -----------------------------------------------------------------------------
-- PASO C) documents.fact_date — match uuid + serie + document_number
-- (este es liviano si ya corriste los indices)
-- -----------------------------------------------------------------------------
UPDATE documents d
INNER JOIN (
  SELECT
    ld.uuid,
    ld.serie,
    ld.document_id,
    MIN(ld.id) AS log_id
  FROM log_documents ld
  WHERE ld.error = 'NO ERRORS'
    AND ld.uuid IS NOT NULL AND ld.uuid <> ''
    AND ld.serie IS NOT NULL AND ld.serie <> ''
    AND ld.document_id IS NOT NULL AND ld.document_id <> ''
    AND ld.create_at IS NOT NULL
    AND ld.create_at <> '0000-00-00 00:00:00'
  GROUP BY ld.uuid, ld.serie, ld.document_id
) matched
  ON matched.uuid = d.uuid
 AND matched.serie = d.serie
 AND matched.document_id = d.document_number
INNER JOIN log_documents ld ON ld.id = matched.log_id
SET d.fact_date = ld.create_at
WHERE d.fact_date IS NULL
  AND d.uuid IS NOT NULL AND d.uuid <> ''
  AND d.document_type IN ('SELL_INVOICE', 'RENT_INVOICE');

-- -----------------------------------------------------------------------------
-- PASO D) Fallback solo por uuid
-- -----------------------------------------------------------------------------
UPDATE documents d
INNER JOIN (
  SELECT ld.uuid, MIN(ld.id) AS log_id
  FROM log_documents ld
  WHERE ld.error = 'NO ERRORS'
    AND ld.uuid IS NOT NULL AND ld.uuid <> ''
    AND ld.create_at IS NOT NULL
    AND ld.create_at <> '0000-00-00 00:00:00'
  GROUP BY ld.uuid
) matched ON matched.uuid = d.uuid
INNER JOIN log_documents ld ON ld.id = matched.log_id
SET d.fact_date = ld.create_at
WHERE d.fact_date IS NULL
  AND d.uuid IS NOT NULL AND d.uuid <> ''
  AND d.document_type IN ('SELL_INVOICE', 'RENT_INVOICE');

-- -----------------------------------------------------------------------------
-- PASO E) Verificar
-- -----------------------------------------------------------------------------
SELECT
  COUNT(*) AS facturas_electronicas,
  SUM(CASE WHEN fact_date IS NOT NULL THEN 1 ELSE 0 END) AS con_fact_date,
  SUM(CASE WHEN fact_date IS NULL THEN 1 ELSE 0 END) AS sin_fact_date
FROM documents
WHERE document_type IN ('SELL_INVOICE', 'RENT_INVOICE')
  AND uuid IS NOT NULL AND uuid <> '';
