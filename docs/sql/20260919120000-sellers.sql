CREATE TABLE `sellers` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `name` VARCHAR(100) NOT NULL,
  `email` VARCHAR(100) DEFAULT NULL,
  `phone` VARCHAR(20) DEFAULT NULL,
  `commission_percentage` DECIMAL(5,2) NOT NULL DEFAULT 5.00,
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_by` INT NOT NULL,
  `updated_at` TIMESTAMP NULL ON UPDATE CURRENT_TIMESTAMP,
  `updated_by` INT DEFAULT NULL,
  CONSTRAINT sellers_pk PRIMARY KEY (id),
  CONSTRAINT sellers_created_by_fk FOREIGN KEY (created_by) REFERENCES users(id),
  CONSTRAINT sellers_updated_by_fk FOREIGN KEY (updated_by) REFERENCES users(id)
) ENGINE=InnoDB;

-- Rollback:
-- DROP TABLE `sellers`;
