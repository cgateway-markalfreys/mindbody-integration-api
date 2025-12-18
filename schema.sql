-- Schema and seed data for Cayman Mindbody integration backend
-- Import this file into a MySQL 8.x database (e.g. mysql < schema.sql)

START TRANSACTION;

CREATE TABLE IF NOT EXISTS `api_configs` (
  `site_key` VARCHAR(191) NOT NULL,
  `cayman_api_key` VARCHAR(255) NOT NULL,
  `cayman_api_username` VARCHAR(255) NOT NULL,
  `cayman_api_password` VARCHAR(255) NOT NULL,
  `mindbody_api_key` VARCHAR(255) DEFAULT NULL,
  `mindbody_source_name` VARCHAR(255) DEFAULT NULL,
  `mindbody_source_password` VARCHAR(255) DEFAULT NULL,
  `mindbody_site_id` VARCHAR(64) DEFAULT NULL,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`site_key`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed row used by the application when no API credentials exist yet.
-- Replace the placeholder values below with your production credentials before importing.
INSERT INTO `api_configs` (
  `site_key`,
  `cayman_api_key`,
  `cayman_api_username`,
  `cayman_api_password`,
  `mindbody_api_key`,
  `mindbody_source_name`,
  `mindbody_source_password`,
  `mindbody_site_id`
) VALUES
  (
    'default',
    'CHANGE_ME_CAYMAN_API_KEY',
    'CHANGE_ME_CAYMAN_USERNAME',
    'CHANGE_ME_CAYMAN_PASSWORD',
    'CHANGE_ME_MINDBODY_API_KEY',
    'CHANGE_ME_MINDBODY_SOURCE_NAME',
    'CHANGE_ME_MINDBODY_SOURCE_PASSWORD',
    'CHANGE_ME_MINDBODY_SITE_ID'
  )
ON DUPLICATE KEY UPDATE
  `cayman_api_key` = VALUES(`cayman_api_key`),
  `cayman_api_username` = VALUES(`cayman_api_username`),
  `cayman_api_password` = VALUES(`cayman_api_password`),
  `mindbody_api_key` = VALUES(`mindbody_api_key`),
  `mindbody_source_name` = VALUES(`mindbody_source_name`),
  `mindbody_source_password` = VALUES(`mindbody_source_password`),
  `mindbody_site_id` = VALUES(`mindbody_site_id`),
  `updated_at` = CURRENT_TIMESTAMP;

COMMIT;
