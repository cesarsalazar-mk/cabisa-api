-- Reparacion log_documents 9614 (FEL existe, documents no)
-- SODEPSA NIT 81932650 / S35 / GTQ 4500 / FEL 2026-08-17 10:22:09
--
-- Crea nota RENT_PRE_INVOICE + factura RENT_INVOICE y enlaza el log.
-- NO mueve inventario (si S35 es SERVICE, Cabisa tampoco lo haria).
--
-- Uso:
--   1) Corre BLOQUE A. Cada SELECT debe devolver 1 fila y A2 debe ir vacio.
--   2) Corre BLOQUE B. Revisa el SELECT de variables (nada NULL).
--   3) COMMIT si cuadra; ROLLBACK si no.

-- =============================================================================
-- BLOQUE A) DIAGNOSTICO
-- =============================================================================

-- A1. Log 9614 (debe existir, coincidir uuid/serie/numero y estar huerfano)
SELECT
  ld.id AS log_id,
  ld.uuid,
  ld.serie,
  ld.document_id AS fel_numero,
  ld.error,
  ld.cabisa_document_id,
  ld.create_at,
  ld.created_by
FROM log_documents ld
WHERE ld.id = 9614
  AND ld.uuid = 'E566F95E-DA2E-4CCC-B965-51331AF82F4F'
  AND ld.serie = 'E566F95E'
  AND ld.document_id = '3660467404';

-- A2. Debe ir VACIO. Si hay fila, NO corras el INSERT.
SELECT id, document_type, status, uuid, serie, document_number, fact_date, total_amount
FROM documents
WHERE uuid = 'E566F95E-DA2E-4CCC-B965-51331AF82F4F'
   OR (serie = 'E566F95E' AND document_number = '3660467404');

-- A3. Cliente SODEPSA (tabla stakeholders, NO users)
SELECT id, name, nit, credit_limit, total_credit, paid_credit, status
FROM stakeholders
WHERE nit IN ('81932650', '8193265-0')
   OR name LIKE '%SODEPSA%';

-- A4. Producto S35 + impuesto
SELECT p.id, p.code, p.description, p.product_type, p.status, p.stock, COALESCE(t.fee, 12) AS tax_fee
FROM products p
LEFT JOIN taxes t ON t.id = p.tax_id
WHERE p.code = 'S35';

-- A5. Proyecto 184 (debe pertenecer al stakeholder de A3)
--     users.id 9 = usuario interno Cabisa (created_by / updated_by), no es el cliente
SELECT id, name, stakeholder_id, is_active FROM projects WHERE id = 184;
SELECT id, full_name FROM users WHERE id = 9;


-- =============================================================================
-- BLOQUE B) INSERT
-- =============================================================================

START TRANSACTION;

SET @log_id = 9614;
SET @user_id = 9;         -- users.id: quien registra el ajuste (created_by)
SET @project_id = 184;
-- @stakeholder_id se resuelve abajo desde stakeholders (cliente SODEPSA)
SET @fel_uuid = 'E566F95E-DA2E-4CCC-B965-51331AF82F4F';
SET @fel_serie = 'E566F95E';
SET @fel_numero = '3660467404';

SELECT id INTO @stakeholder_id
FROM stakeholders
WHERE nit IN ('81932650', '8193265-0') OR name LIKE '%SODEPSA%'
LIMIT 1;

SELECT p.id, COALESCE(t.fee, 12), p.product_type
INTO @product_id, @tax_fee, @product_type
FROM products p
LEFT JOIN taxes t ON t.id = p.tax_id
WHERE p.code = 'S35'
LIMIT 1;

SET @total_amount = 4500.00;
SET @total_tax_amount = 482.14;
SET @subtotal_amount = 4017.86;
SET @total_discount_amount = 0;
SET @product_price = 4017.86;
SET @unit_tax_amount = 482.14;
SET @qty = 1;
SET @credit_days = 15;
SET @fact_date = '2026-08-17 10:22:09';
SET @start_date = '2026-07-18 00:00:00';
SET @end_date = '2026-08-16 23:59:59';
SET @credit_due_date = '2026-09-01 00:00:00';
SET @observaciones = 'MARTILLO ELECTRICO DE 27 KILOS EN RENTA - DEL 18 DE JULIO AL 16 DE AGOSTO 2026 / PROYECTO ZONA 07 / ENVIO #8790';

-- Nada de esto debe ser NULL. cabisa_document_id del log debe ser NULL.
SELECT
  @log_id AS log_id,
  @fel_uuid AS uuid,
  @fel_serie AS serie,
  @fel_numero AS fel_numero,
  @stakeholder_id AS stakeholder_id,
  @product_id AS product_id,
  @product_type AS product_type,
  @project_id AS project_id,
  @user_id AS user_id,
  (SELECT cabisa_document_id FROM log_documents WHERE id = @log_id) AS log_cabisa_document_id,
  (SELECT COUNT(*) FROM documents WHERE uuid = @fel_uuid) AS uuid_ya_existe;

INSERT INTO operations (operation_type, created_by)
VALUES ('RENT', @user_id);

SET @operation_id = LAST_INSERT_ID();

INSERT INTO documents (
  document_type,
  stakeholder_id,
  operation_id,
  project_id,
  related_internal_document_id,
  status,
  comments,
  start_date,
  end_date,
  subtotal_amount,
  sales_commission_amount,
  total_discount_amount,
  total_tax_amount,
  total_amount,
  description,
  payment_method,
  credit_days,
  credit_status,
  paid_credit_amount,
  credit_due_date,
  created_at,
  created_by,
  updated_by
) VALUES (
  'RENT_PRE_INVOICE',
  @stakeholder_id,
  @operation_id,
  @project_id,
  NULL,
  'APPROVED',
  @observaciones,
  @start_date,
  @end_date,
  @subtotal_amount,
  NULL,
  @total_discount_amount,
  @total_tax_amount,
  @total_amount,
  @observaciones,
  'CARD',
  @credit_days,
  'UNPAID',
  0,
  @credit_due_date,
  @fact_date,
  @user_id,
  @user_id
);

SET @pre_id = LAST_INSERT_ID();

INSERT INTO documents_products (
  service_type,
  document_id,
  product_id,
  product_price,
  product_quantity,
  tax_fee,
  unit_tax_amount,
  discount_percentage,
  unit_discount_amount,
  parent_product_id
) VALUES (
  'SERVICE',
  @pre_id,
  @product_id,
  @product_price,
  @qty,
  @tax_fee,
  @unit_tax_amount,
  0,
  0,
  NULL
);

INSERT INTO documents (
  document_type,
  stakeholder_id,
  operation_id,
  project_id,
  related_internal_document_id,
  status,
  comments,
  start_date,
  end_date,
  subtotal_amount,
  sales_commission_amount,
  total_discount_amount,
  total_tax_amount,
  total_amount,
  description,
  payment_method,
  credit_days,
  credit_status,
  paid_credit_amount,
  credit_due_date,
  created_at,
  created_by,
  updated_by,
  serie,
  document_number,
  uuid,
  fact_date
) VALUES (
  'RENT_INVOICE',
  @stakeholder_id,
  @operation_id,
  @project_id,
  @pre_id,
  'APPROVED',
  @observaciones,
  @start_date,
  @end_date,
  @subtotal_amount,
  NULL,
  @total_discount_amount,
  @total_tax_amount,
  @total_amount,
  @observaciones,
  'CARD',
  @credit_days,
  'UNPAID',
  0,
  @credit_due_date,
  @fact_date,
  @user_id,
  @user_id,
  @fel_serie,
  @fel_numero,
  @fel_uuid,
  @fact_date
);

SET @invoice_id = LAST_INSERT_ID();

INSERT INTO documents_products (
  service_type,
  document_id,
  product_id,
  product_price,
  product_quantity,
  tax_fee,
  unit_tax_amount,
  discount_percentage,
  unit_discount_amount,
  parent_product_id
) VALUES (
  'SERVICE',
  @invoice_id,
  @product_id,
  @product_price,
  @qty,
  @tax_fee,
  @unit_tax_amount,
  0,
  0,
  NULL
);

UPDATE documents
SET related_internal_document_id = @invoice_id,
    operation_id = @operation_id,
    status = 'APPROVED',
    updated_by = @user_id
WHERE id = @pre_id;

UPDATE log_documents
SET cabisa_document_id = @invoice_id,
    update_at = @fact_date
WHERE id = @log_id
  AND cabisa_document_id IS NULL;

UPDATE stakeholders
SET total_credit = COALESCE(total_credit, 0) + @total_amount,
    updated_by = @user_id
WHERE id = @stakeholder_id;

SELECT
  @pre_id AS nota_servicio_id,
  @invoice_id AS factura_id,
  @operation_id AS operation_id,
  @log_id AS log_id;

-- COMMIT;
-- ROLLBACK;


-- =============================================================================
-- BLOQUE C) VERIFICACION
-- =============================================================================

-- SELECT d.id, d.document_type, d.status, d.uuid, d.serie, d.document_number,
--        d.fact_date, d.total_amount, d.related_internal_document_id, d.operation_id,
--        s.name, s.nit
-- FROM documents d
-- JOIN stakeholders s ON s.id = d.stakeholder_id
-- WHERE d.id IN (@pre_id, @invoice_id);

-- SELECT * FROM documents_products WHERE document_id IN (@pre_id, @invoice_id);

-- SELECT id, uuid, serie, document_id, cabisa_document_id
-- FROM log_documents WHERE id = 9614;
