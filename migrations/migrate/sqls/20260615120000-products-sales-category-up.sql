ALTER TABLE products
ADD COLUMN sales_category ENUM('sc', 'se', 'sf', 'so') NULL AFTER product_category;
