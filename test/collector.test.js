import test from 'node:test';
import assert from 'node:assert/strict';
import { collect, plain, safeHttpUrl, validateRule } from '../src/collector.js';

async function withResponse(body, contentType, run) {
  const original = globalThis.fetch;
  globalThis.fetch = async url => ({ ok: true, status: 200, url, headers: new Headers({ 'content-type': contentType }), text: async () => body });
  try { return await run(); } finally { globalThis.fetch = original; }
}

test('SJMCL 数据清理为规范文章', async () => {
  const data = { posts: [{ id: 42, title: '校园 <b>活动</b>', abstract: '<p>一起建造</p>', link: 'https://mc.example.edu/post/42', imageSrc: ['https://mc.example.edu/a.jpg', 800, 400], keywords: '活动', createAt: '2026-10-01T12:00:00', updateAt: '2026-10-02T12:00:00' }] };
  const result = await withResponse(JSON.stringify(data), 'application/json', () => collect({ rule_json: { type: 'sjmcl', url: 'https://mc.example.edu/api-sjmcl/article' } }));
  assert.equal(result.articles.length, 1);
  assert.equal(result.articles[0].title, '校园 活动');
  assert.equal(result.articles[0].abstract, '一起建造');
  assert.equal(result.articles[0].imageUrl, 'https://mc.example.edu/a.jpg');
});

test('HTML 规则读取整张链接卡片及中文日期', async () => {
  const html = '<a class="card" href="/news/one"><h2>社团新消息</h2><time>2026 年 10 月 11 日</time><p>摘要</p></a>';
  const rule = { type: 'html', url: 'https://club.example.edu/news', itemSelector: '.card', linkSelector: ':self', titleSelector: 'h2', dateSelector: 'time', abstractSelector: 'p' };
  const result = await withResponse(html, 'text/html', () => collect({ rule_json: rule }));
  assert.equal(result.articles[0].link, 'https://club.example.edu/news/one');
  assert.equal(result.articles[0].publishedAt.slice(0, 10), '2026-10-11');
});

test('JSON 规则映射列表与链接模板', async () => {
  const data = { data: [{ id: 1, slug: 'hello', title: '标题', excerpt: '简介', date: '2026-10-11' }] };
  const rule = { type: 'json', url: 'https://club.example.edu/api/news', itemsPath: 'data', linkTemplate: 'https://club.example.edu/news/{slug}', fields: { id: 'id', title: 'title', abstract: 'excerpt', date: 'date' } };
  const result = await withResponse(JSON.stringify(data), 'application/json', () => collect({ rule_json: rule }));
  assert.equal(result.articles[0].link, 'https://club.example.edu/news/hello');
  assert.equal(result.articles[0].abstract, '简介');
});

test('JS 数据公告保留可直达的哈希链接', async () => {
  const body = 'window.CLUB_DATA = {"news":[{"id":"10","title":"社团公告","date":"2026-09-15","content":"新服开放"}]};';
  const rule = { type: 'json', url: 'https://club.example.edu/data.js', jsonPrefix: 'window.CLUB_DATA =',
    itemsPath: 'news', linkTemplate: 'https://club.example.edu/#newsdetails?id={id}',
    fields: { id: 'id', title: 'title', abstract: 'content', date: 'date' } };
  const result = await withResponse(body, 'text/javascript', () => collect({ rule_json: rule }));
  assert.equal(result.articles[0].link, 'https://club.example.edu/#newsdetails?id=10');
  assert.equal(result.articles[0].abstract, '新服开放');
});

test('活动日期范围取开始日期', async () => {
  const data = { data: { blocks: { 'activity-square': { activities: [
    { id: 'a', title: '百团纳新', url: '/activities/a', meta: '2026-10-11 00:00 至 2026-10-11 23:59' }
  ] } } } };
  const rule = { type: 'json', url: 'https://club.example.edu/api/context',
    itemsPath: 'data.blocks.activity-square.activities',
    fields: { id: 'id', title: 'title', link: 'url', date: 'meta' } };
  const result = await withResponse(JSON.stringify(data), 'application/json', () => collect({ rule_json: rule }));
  assert.equal(result.articles[0].publishedAt.slice(0, 10), '2026-10-11');
});

test('拒绝本地地址和无效规则', () => {
  assert.equal(safeHttpUrl('http://127.0.0.1/'), null);
  assert.equal(safeHttpUrl('http://localhost/'), null);
  assert.equal(plain('<p>甲&nbsp;乙</p>'), '甲 乙');
  assert.throws(() => validateRule({ type: 'html' }));
});
