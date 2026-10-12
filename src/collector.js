import * as cheerio from 'cheerio';
import Parser from 'rss-parser';
import { isIP } from 'node:net';

const parser = new Parser({ customFields: { item: ['media:content', 'media:thumbnail'] } });
const timeout = 12000;

export function safeHttpUrl(value, base, preserveHash = false) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, base);
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') ||
      isIP(host) || !host.includes('.')) return null;
    if (!preserveHash) url.hash = '';
    return url.href;
  } catch { return null; }
}

async function request(url, accept = '*/*', options = {}) {
  let target = safeHttpUrl(url);
  if (!target) throw new Error('只允许公网 HTTP/HTTPS 地址');
  for (let hop = 0; hop < 5; hop++) {
    const response = await fetch(target, {
      method: options.method || 'GET',
      body: options.body,
      headers: { 'User-Agent': 'MUA-Union-News/1.0 (+news aggregator)', Accept: accept,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}) },
      redirect: 'manual', signal: AbortSignal.timeout(timeout)
    });
    if (response.status >= 300 && response.status < 400) {
      target = safeHttpUrl(response.headers.get('location'), target);
      if (!target) throw new Error('重定向到无效地址');
      continue;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (Number(response.headers.get('content-length') || 0) > 5_000_000) throw new Error('响应过大');
    const body = await response.text();
    if (body.length > 5_000_000) throw new Error('响应过大');
    return { body, url: response.url || target, contentType: response.headers.get('content-type') || '' };
  }
  throw new Error('重定向次数过多');
}

export function plain(value) {
  return cheerio.load(`<div>${String(value || '')}</div>`)('div').first().text().replace(/\s+/g, ' ').trim();
}

function absolute(value, base, preserveHash = false) { return safeHttpUrl(value, base, preserveHash); }
function isoDate(value) {
  const input = String(value || '').trim();
  const chinese = input.match(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  const rangeStart = input.match(/^(20\d{2}-\d{1,2}-\d{1,2})\s+\d{1,2}:\d{2}\s*至/);
  const date = input ? new Date(chinese ? `${chinese[1]}-${chinese[2].padStart(2, '0')}-${chinese[3].padStart(2, '0')}` : rangeStart ? rangeStart[1] : input) : new Date();
  return Number.isNaN(date.valueOf()) ? new Date().toISOString() : date.toISOString();
}
function dateFromLink(link) {
  const path = String(link || '');
  const dashed = path.match(/(20\d{2})[-/](\d{2})[-/](\d{2})/);
  if (dashed) return `${dashed[1]}-${dashed[2]}-${dashed[3]}`;
  const compact = path.match(/(20\d{2})(\d{2})(\d{2})/);
  return compact ? `${compact[1]}-${compact[2]}-${compact[3]}` : '';
}
function normalize(entry, base) {
  const link = absolute(entry.link, base, true);
  const title = plain(entry.title).slice(0, 500);
  if (!link || !title) return null;
  return {
    originalId: entry.originalId == null ? null : String(entry.originalId).slice(0, 255),
    title,
    abstract: plain(entry.abstract).slice(0, 2000),
    link,
    imageUrl: absolute(entry.imageUrl, base),
    keywords: String(entry.keywords || '').slice(0, 800),
    publishedAt: isoDate(entry.publishedAt),
    updatedAt: isoDate(entry.updatedAt || entry.publishedAt)
  };
}

async function parseRss(url) {
  const response = await request(url, 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*');
  const feed = await parser.parseString(response.body);
  return (feed.items || []).slice(0, 50).map(item => normalize({
    originalId: item.guid || item.id,
    title: item.title,
    abstract: item.contentSnippet || item.summary || item.content,
    link: item.link,
    imageUrl: item.enclosure?.url || item['media:thumbnail']?.$?.url || item['media:content']?.$?.url,
    keywords: (item.categories || []).join(','),
    publishedAt: item.isoDate || item.pubDate,
    updatedAt: item.updated || item.isoDate || item.pubDate
  }, response.url)).filter(Boolean);
}

async function parseWordpress(url) {
  const response = await request(url, 'application/json');
  const rows = JSON.parse(response.body);
  if (!Array.isArray(rows)) throw new Error('WordPress API 格式无效');
  return rows.map(item => {
    const media = item._embedded?.['wp:featuredmedia']?.[0];
    return normalize({
      originalId: item.id,
      title: item.title?.rendered,
      abstract: item.excerpt?.rendered,
      link: item.link,
      imageUrl: media?.media_details?.sizes?.medium_large?.source_url ||
        media?.media_details?.sizes?.large?.source_url || media?.source_url,
      publishedAt: item.date,
      updatedAt: item.modified || item.date
    }, response.url);
  }).filter(Boolean);
}

async function parseSjmcl(url) {
  const response = await request(url, 'application/json');
  const data = JSON.parse(response.body);
  if (!Array.isArray(data.posts)) throw new Error('SJMCL API 格式无效');
  return data.posts.map(item => normalize({
    originalId: item.id,
    title: item.title,
    abstract: item.abstract,
    link: item.link,
    imageUrl: Array.isArray(item.imageSrc) ? item.imageSrc[0] : item.imageSrc,
    keywords: item.keywords,
    publishedAt: item.createAt,
    updatedAt: item.updateAt
  }, response.url)).filter(Boolean);
}

function elementValue($, root, selector, attr) {
  if (!selector) return '';
  const element = selector === ':self' ? root : root.find(selector).first();
  return attr ? (element.attr(attr) || element.text()) : element.text();
}

function parseHtmlDocument(response, rule) {
  let $ = cheerio.load(response.body);
  if (rule.unwrapSelector) {
    const raw = $(rule.unwrapSelector).first().html() || $(rule.unwrapSelector).first().text();
    $ = cheerio.load(raw || '');
  }
  const list = $(rule.itemSelector || 'article, .post, .news-item, .article-item').slice(0, 50);
  const articles = [];
  list.each((_, node) => {
    const root = $(node);
    const linkNode = rule.linkSelector === ':self' ? root : root.find(rule.linkSelector || 'h1 a, h2 a, h3 a, a').first();
    const link = rule.linkAttribute ? linkNode.attr(rule.linkAttribute) : linkNode.attr('href');
    const title = rule.titleSelector ? elementValue($, root, rule.titleSelector, rule.titleAttribute) : linkNode.text();
    const imageNode = root.find(rule.imageSelector || 'img').first();
    const image = imageNode.attr(rule.imageAttribute || 'src') || imageNode.attr('data-src');
    const date = elementValue($, root, rule.dateSelector || 'time', rule.dateAttribute || 'datetime');
    const abstract = elementValue($, root, rule.abstractSelector || 'p, .excerpt, .summary');
    const publishedAt = date || dateFromLink(link);
    if (rule.requireFullDate === 'true' && !/(20\d{2})\s*(?:年|[-/])\s*\d{1,2}\s*(?:月|[-/])\s*\d{1,2}/.test(publishedAt)) return;
    const item = normalize({ title, link, imageUrl: image, publishedAt, abstract }, response.url);
    if (item) articles.push(item);
  });
  return [...new Map(articles.map(article => [article.link, article])).values()];
}
async function parseHtml(url, rule) { return parseHtmlDocument(await request(url, 'text/html'), rule); }

function pathValue(object, path) {
  return String(path || '').split('.').reduce((value, key) => value?.[key], object);
}
async function parseJson(rule) {
  const response = await request(rule.url, 'application/json');
  let body = response.body.trim();
  if (rule.jsonPrefix) {
    if (!body.startsWith(rule.jsonPrefix)) throw new Error('JSON 前缀不匹配');
    body = body.slice(rule.jsonPrefix.length).trim().replace(/;\s*$/, '');
  }
  const data = JSON.parse(body);
  const rows = rule.itemsPath ? pathValue(data, rule.itemsPath) : data;
  if (!Array.isArray(rows)) throw new Error('JSON 规则 itemsPath 没有指向数组');
  const field = (item, name) => pathValue(item, rule.fields?.[name]);
  return rows.slice(0, 100).map(item => {
    const link = rule.linkTemplate
      ? rule.linkTemplate.replace(/\{([a-zA-Z][\w]*)\}/g, (_, key) => encodeURIComponent(String(pathValue(item, key) || '')))
      : field(item, 'link');
    return normalize({
      originalId: field(item, 'id'), title: field(item, 'title'), abstract: field(item, 'abstract'),
      link, imageUrl: field(item, 'image'), keywords: field(item, 'keywords'),
      publishedAt: field(item, 'date'), updatedAt: field(item, 'updated')
    }, response.url);
  }).filter(Boolean);
}

async function parseNmo(rule) {
  const categories = ['information', 'magazine', 'notice', 'activity'];
  const origin = new URL(rule.url).origin;
  const groups = await Promise.all(categories.map(async category => {
    const articles = [];
    for (let page = 1; page <= 5; page++) {
      const response = await request(rule.url, 'application/json', {
        method: 'POST', body: JSON.stringify({ target: category, page, page_size: 100, pin: false })
      });
      const rows = JSON.parse(response.body).list;
      if (!Array.isArray(rows)) throw new Error('NMO 新闻接口格式无效');
      articles.push(...rows.map(item => normalize({
        originalId: item.id, title: item.title, abstract: item.brief,
        link: `${origin}/news/detail/${encodeURIComponent(item.id)}`,
        imageUrl: item.image, keywords: category,
        publishedAt: item.date, updatedAt: item.date
      }, response.url)).filter(Boolean));
      if (rows.length < 100) break;
    }
    return articles;
  }));
  return groups.flat();
}

export function validateRule(rule) {
  if (!rule || !['auto', 'rss', 'wordpress', 'sjmcl', 'html', 'json', 'nmo'].includes(rule.type)) throw new Error('规则类型无效');
  if (rule.url && !safeHttpUrl(rule.url)) throw new Error('规则 URL 无效');
  if (rule.type !== 'auto' && !rule.url) throw new Error('规则需要 url');
  for (const [key, value] of Object.entries(rule)) {
    if (key === 'fields' && rule.type === 'json' && value && typeof value === 'object' && !Array.isArray(value) &&
      Object.values(value).every(field => typeof field === 'string' && field.length < 100)) continue;
    if (typeof value !== 'string' || value.length > 1000) throw new Error(`规则字段 ${key} 无效`);
  }
  if (rule.type === 'json' && (!rule.fields?.title || !rule.fields?.date || (!rule.fields?.link && !rule.linkTemplate))) throw new Error('JSON 规则缺少标题、日期或链接字段');
  if (rule.linkTemplate && !safeHttpUrl(rule.linkTemplate.replace(/\{[^}]+\}/g, 'value'))) throw new Error('链接模板无效');
  return rule;
}

export async function collect(source) {
  const rule = validateRule(typeof source.rule_json === 'string' ? JSON.parse(source.rule_json) : source.rule_json);
  if (rule.type === 'rss') return { articles: await parseRss(rule.url), rule };
  if (rule.type === 'wordpress') return { articles: await parseWordpress(rule.url), rule };
  if (rule.type === 'sjmcl') return { articles: await parseSjmcl(rule.url), rule };
  if (rule.type === 'html') return { articles: await parseHtml(rule.url, rule), rule };
  if (rule.type === 'json') return { articles: await parseJson(rule), rule };
  if (rule.type === 'nmo') return { articles: await parseNmo(rule), rule };

  const home = await request(source.site_url, 'text/html, */*');
  const $ = cheerio.load(home.body);
  const feeds = $('link[rel="alternate"]').toArray()
    .filter(el => /rss|atom|xml/i.test($(el).attr('type') || ''))
    .map(el => absolute($(el).attr('href'), home.url)).filter(Boolean);
  const origin = new URL(home.url).origin;
  const candidates = [
    ...feeds.map(url => ({ type: 'rss', url })),
    { type: 'sjmcl', url: `${origin}/api-sjmcl/article?pageSize=30` },
    { type: 'wordpress', url: `${origin}/wp-json/wp/v2/posts?per_page=30&_embed=1` },
    ...['/feed/', '/feed.xml', '/rss.xml', '/atom.xml', '/index.xml'].map(path => ({ type: 'rss', url: `${origin}${path}` }))
  ];
  const seen = new Set();
  const attempts = await Promise.allSettled(candidates.filter(candidate => {
    if (seen.has(candidate.url)) return false;
    seen.add(candidate.url); return true;
  }).map(candidate => collect({ ...source, rule_json: candidate })));
  for (const attempt of attempts) if (attempt.status === 'fulfilled' && attempt.value.articles.length) return attempt.value;
  throw new Error('未发现 RSS/WordPress/SJMCL 资讯接口；请在后台填写该站点的 HTML 选择器规则');
}

export function mysqlDate(iso) { return new Date(iso).toISOString().slice(0, 19).replace('T', ' '); }
