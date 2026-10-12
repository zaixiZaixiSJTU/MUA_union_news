import 'dotenv/config';
import { makePool } from '../src/db.js';
import { initialSources } from '../src/seed.js';

const pool = makePool(process.env.DATABASE_URL);
try {
  for (const source of initialSources.filter(item => item.rule.type !== 'auto')) {
    const [[existing]] = await pool.execute('SELECT id, rule_json FROM sources WHERE school=?', [source.school]);
    if (!existing) continue;
    const rule = typeof existing.rule_json === 'string' ? JSON.parse(existing.rule_json) : existing.rule_json;
    const oldSitmcFeed = source.school === '上海应用技术大学' &&
      rule.type === 'rss' && rule.url === 'https://www.sitmc.club/feed';
    if (rule.type !== 'auto' && !oldSitmcFeed) continue;
    await pool.execute('UPDATE sources SET site_url=?, rule_json=? WHERE id=?',
      [source.siteUrl, JSON.stringify(source.rule), existing.id]);
    console.log(`已更新 ${source.school} 的采集规则`);
  }
} finally { await pool.end(); }
