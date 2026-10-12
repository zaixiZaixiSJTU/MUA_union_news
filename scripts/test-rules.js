import { initialSources } from '../src/seed.js';
import { collect } from '../src/collector.js';
for (const source of initialSources.filter(source => source.rule.type !== 'auto')) {
  try {
    const result = await collect({ site_url: source.siteUrl, rule_json: source.rule });
    console.log(`${source.school}: ${result.articles.length} 篇 · ${result.articles[0]?.title || '无文章'}`);
  } catch (e) { console.log(`${source.school}: 失败 · ${e.message}`); }
}
