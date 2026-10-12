import 'dotenv/config';
import { makePool } from '../src/db.js';
import { collect, mysqlDate } from '../src/collector.js';

const pool = makePool(process.env.DATABASE_URL);
const ids = process.argv.slice(2).map(Number);
if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error('资讯源 ID 无效');

try {
  const [sources] = ids.length
    ? await pool.query(`SELECT * FROM sources WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
    : await pool.query('SELECT * FROM sources WHERE enabled=1 ORDER BY id');
  for (const source of sources) {
    try {
      const result = await collect(source);
      for (const article of result.articles) {
        const keywords = [...new Set([source.school, ...String(article.keywords || '').split(/[,，]/).map(s => s.trim()).filter(Boolean)])].join(',').slice(0, 1000);
        await pool.execute(`INSERT INTO articles
          (source_id, original_id, title, abstract, link, image_url, keywords, published_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE title=VALUES(title), abstract=VALUES(abstract), image_url=VALUES(image_url),
          keywords=VALUES(keywords), updated_at=VALUES(updated_at)`, [
          source.id, article.originalId, article.title, article.abstract, article.link,
          article.imageUrl, keywords, mysqlDate(article.publishedAt), mysqlDate(article.updatedAt)
        ]);
      }
      await pool.execute('UPDATE sources SET rule_json=?, last_checked_at=UTC_TIMESTAMP(), last_success_at=UTC_TIMESTAMP(), last_error=NULL WHERE id=?',
        [JSON.stringify(result.rule), source.id]);
      console.log(`${source.school}: ${result.articles.length} 篇`);
    } catch (error) {
      await pool.execute('UPDATE sources SET last_checked_at=UTC_TIMESTAMP(), last_error=? WHERE id=?',
        [String(error.message).slice(0, 2000), source.id]);
      console.error(`${source.school}: ${error.message}`);
    }
  }
} finally { await pool.end(); }
