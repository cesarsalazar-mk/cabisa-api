-- Agrega la categoria de venta 'st' (ST - Trailer)
ALTER TABLE products
MODIFY COLUMN sales_category ENUM('sc', 'se', 'sf', 'so', 'st') NULL;

-- Rollback (primero reasignar productos con 'st'):
-- UPDATE products SET sales_category = NULL WHERE sales_category = 'st';
-- ALTER TABLE products MODIFY COLUMN sales_category ENUM('sc', 'se', 'sf', 'so') NULL;
