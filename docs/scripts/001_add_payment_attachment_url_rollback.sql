-- Rollback del script 001_add_payment_attachment_url.sql

ALTER TABLE payments DROP COLUMN attachment_url;

ALTER TABLE manual_payments_detail DROP COLUMN attachment_url;
