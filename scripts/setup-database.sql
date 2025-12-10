-- IXFLIX Database Setup Script
-- Run this script to create the database

CREATE DATABASE IF NOT EXISTS ixflix_db 
  CHARACTER SET utf8mb4 
  COLLATE utf8mb4_unicode_ci;

USE ixflix_db;

-- Grant privileges (adjust as needed)
GRANT ALL PRIVILEGES ON ixflix_db.* TO 'root'@'localhost';
FLUSH PRIVILEGES;

-- Show database
SHOW DATABASES LIKE 'ixflix_db';

