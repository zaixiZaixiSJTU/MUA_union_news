import mysql from 'mysql2/promise';
import { initialSources } from './seed.js';

export function makePool(url) {
  return mysql.createPool({ uri: url, waitForConnections: true, connectionLimit: 8, timezone: 'Z', dateStrings: true });
}

export async function initializeDatabase(pool, bootstrapAdminEmails = []) {
  await pool.query(`CREATE TABLE IF NOT EXISTS sources (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    school VARCHAR(120) NOT NULL,
    name VARCHAR(160) NOT NULL,
    site_url VARCHAR(1000) NOT NULL,
    icon_url VARCHAR(1000) NULL,
    rule_json JSON NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    last_checked_at DATETIME NULL,
    last_success_at DATETIME NULL,
    last_error TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_enabled (enabled)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS articles (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    source_id BIGINT UNSIGNED NOT NULL,
    original_id VARCHAR(255) NULL,
    title VARCHAR(500) NOT NULL,
    abstract TEXT NULL,
    link VARCHAR(2048) NOT NULL,
    image_url VARCHAR(2048) NULL,
    keywords VARCHAR(1000) NOT NULL,
    published_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_source_link (source_id, link(512)),
    INDEX idx_published (published_at, id),
    CONSTRAINT fk_article_source FOREIGN KEY (source_id) REFERENCES sources(id) ON DELETE CASCADE
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS settings (
    name VARCHAR(100) NOT NULL PRIMARY KEY,
    value VARCHAR(1000) NOT NULL
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS admins (
    email VARCHAR(254) NOT NULL PRIMARY KEY,
    created_by VARCHAR(254) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE IF NOT EXISTS web_sessions (
    session_id VARCHAR(128) NOT NULL PRIMARY KEY,
    expires_at DATETIME NOT NULL,
    data JSON NOT NULL,
    INDEX idx_expires (expires_at)
  ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await pool.query(`INSERT IGNORE INTO settings (name, value) VALUES ('crawl_interval_minutes', '60')`);
  const [[{ adminCount }]] = await pool.query('SELECT COUNT(*) AS adminCount FROM admins');
  if (Number(adminCount) === 0) {
    for (const email of bootstrapAdminEmails) {
      await pool.execute('INSERT IGNORE INTO admins (email, created_by) VALUES (?, ?)', [email, 'environment bootstrap']);
    }
  }
  const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM sources');
  if (Number(count) === 0) {
    for (const item of initialSources) {
      await pool.execute('INSERT INTO sources (school, name, site_url, rule_json) VALUES (?, ?, ?, ?)',
        [item.school, item.name, item.siteUrl, JSON.stringify(item.rule)]);
    }
  }
}
