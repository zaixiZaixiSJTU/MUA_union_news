import 'dotenv/config';
import express from 'express';
import session from 'express-session';
import helmet from 'helmet';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { collect, mysqlDate, safeHttpUrl, validateRule } from './collector.js';
import { initializeDatabase, makePool } from './db.js';
import { MySqlSessionStore } from './session-store.js';
import { decodeCursor, encodeCursor, parsePageSize } from './sjmcl-pagination.js';
import { discoverIconUrl } from './source-icons.js';
import { appPath, normalizeBaseUrl, publicUrl } from './public-url.js';

const required = ['DATABASE_URL', 'SESSION_SECRET', 'BASE_URL', 'OAUTH_CLIENT_ID', 'OAUTH_CLIENT_SECRET', 'ADMIN_EMAILS'];
for (const key of required) if (!process.env[key]) throw new Error(`缺少配置：${key}`);
const baseUrl = normalizeBaseUrl(process.env.BASE_URL);
const bootstrapAdmins = [...new Set(process.env.ADMIN_EMAILS.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
const pool = makePool(process.env.DATABASE_URL);
await initializeDatabase(pool, bootstrapAdmins);
const app = express();
if (baseUrl.protocol === 'https:') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '80kb' }));
const store = new MySqlSessionStore(pool);
app.use(session({
  name: 'mua_news_session', store, secret: process.env.SESSION_SECRET,
  resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: baseUrl.protocol === 'https:', path: appPath(baseUrl), maxAge: 7 * 86400_000 }
}));

const callbackUrl = publicUrl(baseUrl, 'auth/callback').href;
const authorizeUrl = process.env.OAUTH_AUTHORIZE_URL || 'https://skin.mualliance.ltd/oauth/authorize';
const tokenUrl = process.env.OAUTH_TOKEN_URL || 'https://skin.mualliance.ltd/oauth/token';
const userInfoUrl = process.env.OAUTH_USERINFO_URL || 'https://skin.mualliance.ltd/api/user';
const sourceShortNames = {
  'mc.sjtu.cn': 'SJMC', 'sitmc.club': 'SITMC', 'mine.blanoir.com': 'Blanoir', 'hall.mc.taru.xj.cn': 'TARU',
  'seubcl.cn': 'SEUBCL', 'mcug.cn': 'MCUG', 'docs.imucraft.cn': 'IMUCraft',
  'mc.ecustvr.top': 'ECUSTVR', 'nuistcraft.com': 'NUISTCraft', 'nmo.net.cn': 'NMO',
  'njitmc.club': 'NJITMC', 'mc.taru.xj.cn': 'TARU', 'fdcraft.github.io': 'FDCraft',
  'mc.bobby.com.cn': 'BobbyCraft', 'gdufscraft.top': 'GDUFSCraft', 'uemcraft.cn': 'UEMCraft',
  'asyncraft.club': 'Asyncraft', 'minejufe.cn': 'MineJUFE', 'yitmc.cn': 'YITMC',
  'ysumc.net': 'YSUMC', 'mc.cduestc.fun': 'CUESTC', 'cop.cooo.site': 'COOO',
  'cqumc.cn': 'CQUMC', 'ccutmc.bickey.net': 'CCUTMC', 'blog.qutcraft.cn': 'QUTCraft',
  'wlyw.qlu.edu.cn': 'WLYW'
};
const activeCrawls = new Set();
let allRunning = false;
let lastCrawlAt = null;
let crawlProgress = { total: 0, completed: 0, succeeded: 0, failed: 0, startedAt: null, finishedAt: null };

function error(res, status, message) { return res.status(status).json({ error: message }); }
function sourceAuthor({ school, name, siteUrl, iconUrl }) {
  const site = new URL(siteUrl);
  const host = site.hostname.replace(/^www\./, '');
  const shortName = sourceShortNames[host] || host.split('.')[0].toUpperCase();
  return {
    endpointUrl: publicUrl(baseUrl, 'api-sjmcl/article').href,
    name: shortName,
    fullName: name || `${school} Minecraft 社团`,
    iconSrc: iconUrl || publicUrl(baseUrl, 'icon.svg').href
  };
}
async function refreshSourceIcon(sourceId) {
  const [[source]] = await pool.execute('SELECT site_url, icon_url FROM sources WHERE id=?', [sourceId]);
  if (!source || source.icon_url) return source?.icon_url || null;
  const iconUrl = await discoverIconUrl(source.site_url);
  if (iconUrl) await pool.execute('UPDATE sources SET icon_url=? WHERE id=? AND icon_url IS NULL', [iconUrl, sourceId]);
  return iconUrl;
}
async function refreshMissingSourceIcons() {
  const [sources] = await pool.query('SELECT id FROM sources WHERE icon_url IS NULL');
  const results = await Promise.allSettled(sources.map(source => refreshSourceIcon(source.id)));
  const found = results.filter(result => result.status === 'fulfilled' && result.value).length;
  console.log(`Discovered ${found}/${sources.length} source icons`);
}
async function isAdminEmail(email) {
  if (!email) return false;
  const [[row]] = await pool.execute('SELECT 1 AS allowed FROM admins WHERE email=? LIMIT 1', [String(email).toLowerCase()]);
  return !!row;
}
async function adminOnly(req, res, next) {
  try {
    if (!req.session.user?.verified || !(await isAdminEmail(req.session.user.email))) {
      if (req.session.user) req.session.user.admin = false;
      return error(res, 403, '需要管理员登录');
    }
    req.session.user.admin = true;
    next();
  } catch (e) { next(e); }
}
function csrf(req, res, next) {
  const expected = Buffer.from(req.session.csrf || '');
  const given = Buffer.from(String(req.get('x-csrf-token') || ''));
  if (!expected.length || expected.length !== given.length || !timingSafeEqual(expected, given)) return error(res, 403, '无效的请求令牌');
  next();
}
function parseId(value) {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
function parseRule(value) {
  const rule = typeof value === 'string' ? JSON.parse(value) : value;
  return validateRule(rule);
}
function articleKeywords(school, raw) {
  return [...new Set([school, ...String(raw || '').split(/[,，]/).map(s => s.trim()).filter(Boolean)])].join(',').slice(0, 1000);
}

async function crawlSource(id) {
  if (activeCrawls.has(id)) return { skipped: true };
  activeCrawls.add(id);
  try {
    const [[source]] = await pool.execute('SELECT * FROM sources WHERE id = ?', [id]);
    if (!source) throw new Error('资讯源不存在');
    const result = await collect(source);
    let saved = 0;
    for (const article of result.articles) {
      await pool.execute(`INSERT INTO articles
        (source_id, original_id, title, abstract, link, image_url, keywords, published_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE title=VALUES(title), abstract=VALUES(abstract), image_url=VALUES(image_url),
        keywords=VALUES(keywords), updated_at=VALUES(updated_at)`, [
        id, article.originalId, article.title, article.abstract, article.link,
        article.imageUrl, articleKeywords(source.school, article.keywords),
        mysqlDate(article.publishedAt), mysqlDate(article.updatedAt)
      ]);
      saved++;
    }
    await pool.execute(`UPDATE sources SET rule_json=?, last_checked_at=UTC_TIMESTAMP(),
      last_success_at=UTC_TIMESTAMP(), last_error=NULL WHERE id=?`, [JSON.stringify(result.rule), id]);
    return { saved, rule: result.rule };
  } catch (e) {
    await pool.execute('UPDATE sources SET last_checked_at=UTC_TIMESTAMP(), last_error=? WHERE id=?', [String(e.message).slice(0, 2000), id]);
    throw e;
  } finally { activeCrawls.delete(id); }
}

async function crawlAll() {
  if (allRunning) return crawlProgress;
  allRunning = true;
  const startedAt = new Date().toISOString();
  crawlProgress = { total: 0, completed: 0, succeeded: 0, failed: 0, startedAt, finishedAt: null };
  try {
    const [rows] = await pool.query('SELECT id FROM sources WHERE enabled=1 ORDER BY id');
    crawlProgress.total = rows.length;
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(3, rows.length) }, async () => {
      while (cursor < rows.length) {
        const id = Number(rows[cursor++].id);
        try {
          await crawlSource(id);
          crawlProgress.succeeded++;
        } catch (e) {
          crawlProgress.failed++;
          console.error(`采集源 ${id} 失败: ${e.message}`);
        } finally { crawlProgress.completed++; }
      }
    }));
    lastCrawlAt = new Date().toISOString();
    return crawlProgress;
  } finally {
    crawlProgress.finishedAt = new Date().toISOString();
    allRunning = false;
  }
}

async function schedule() {
  try {
    const [[setting]] = await pool.query("SELECT value FROM settings WHERE name='crawl_interval_minutes'");
    const interval = Math.max(15, Math.min(1440, Number(setting.value) || 60)) * 60_000;
    const [[row]] = await pool.query('SELECT MAX(last_checked_at) AS last_checked FROM sources WHERE enabled=1');
    const last = row.last_checked ? Date.parse(`${row.last_checked.replace(' ', 'T')}Z`) : 0;
    if (Date.now() - last >= interval) await crawlAll();
  } catch (e) { console.error(`定时采集失败: ${e.message}`); }
}
setInterval(schedule, 60_000).unref();
setTimeout(schedule, 2000).unref();
setInterval(() => pool.query('DELETE FROM web_sessions WHERE expires_at<=UTC_TIMESTAMP()').catch(e => console.error(e)), 3600_000).unref();

app.get('/auth/login', (req, res) => {
  const state = randomBytes(24).toString('hex');
  req.session.oauthState = state;
  const url = new URL(authorizeUrl);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', process.env.OAUTH_CLIENT_ID);
  url.searchParams.set('redirect_uri', callbackUrl);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', '');
  req.session.save(() => res.redirect(url.href));
});
app.get('/auth/callback', async (req, res) => {
  const state = String(req.query.state || '');
  if (!state || state !== req.session.oauthState || !req.query.code) return res.redirect(`${appPath(baseUrl)}?auth=failed`);
  delete req.session.oauthState;
  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code: String(req.query.code),
        redirect_uri: callbackUrl, client_id: process.env.OAUTH_CLIENT_ID,
        client_secret: process.env.OAUTH_CLIENT_SECRET
      })
    });
    if (!tokenResponse.ok) throw new Error(`换取令牌失败 ${tokenResponse.status}`);
    const token = await tokenResponse.json();
    if (!token.access_token) throw new Error('OAuth 未返回 access_token');
    const userResponse = await fetch(userInfoUrl, {
      headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10000)
    });
    if (!userResponse.ok) throw new Error(`获取用户资料失败 ${userResponse.status}`);
    const body = await userResponse.json();
    const user = body.data || body.user || body;
    const email = String(user.email || '').trim().toLowerCase();
    if (!email) throw new Error('用户资料未提供邮箱');
    const verified = user.verified === true || user.verified === 1 || user.verified === '1';
    const admin = verified && await isAdminEmail(email);
    req.session.regenerate(err => {
      if (err) return res.redirect(`${appPath(baseUrl)}?auth=failed`);
      req.session.user = { email, name: user.nickname || user.name || email, verified, admin };
      req.session.csrf = randomBytes(24).toString('hex');
      req.session.save(() => res.redirect(req.session.user.admin ? appPath(baseUrl, 'admin') : `${appPath(baseUrl)}?auth=not-admin`));
    });
  } catch (e) {
    console.error(`OAuth 登录失败: ${e.message}`);
    res.redirect(`${appPath(baseUrl)}?auth=failed`);
  }
});
app.post('/auth/logout', csrf, (req, res) => req.session.destroy(() => res.json({ ok: true })));

app.get('/api/session', async (req, res, next) => {
  try {
    const admin = !!req.session.user?.verified && await isAdminEmail(req.session.user.email);
    if (req.session.user) req.session.user.admin = admin;
    res.json({ user: req.session.user ? { ...req.session.user, admin } : null, csrf: admin ? req.session.csrf : null });
  } catch (e) { next(e); }
});
app.get('/api/stats', async (_req, res, next) => {
  try {
    const [[a]] = await pool.query('SELECT COUNT(*) AS count FROM articles');
    const [[s]] = await pool.query('SELECT COUNT(*) AS count, SUM(enabled=1) AS enabled FROM sources');
    const [[t]] = await pool.query('SELECT MAX(last_success_at) AS last_success FROM sources');
    res.json({ articles: Number(a.count), sources: Number(s.count), enabled: Number(s.enabled || 0), lastSuccess: t.last_success, crawling: allRunning });
  } catch (e) { next(e); }
});
app.get('/api/schools', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT s.school, COUNT(a.id) AS count,
      MAX(s.last_error IS NOT NULL AND s.last_error NOT LIKE '未发现 RSS/%') AS access_errors,
      MAX(s.last_error LIKE '未发现 RSS/%') AS missing_feed FROM sources s
      LEFT JOIN articles a ON a.source_id=s.id WHERE s.enabled=1 GROUP BY s.school ORDER BY s.school`);
    res.json(rows.map(row => ({
      school: row.school, count: Number(row.count),
      status: Number(row.access_errors) ? 'unavailable' : Number(row.missing_feed) ? 'feed_unconfirmed' : 'ok'
    })));
  } catch (e) { next(e); }
});
app.get('/api/articles', async (req, res, next) => {
  try {
    const page = Math.max(1, Math.min(10000, Number(req.query.page) || 1));
    const size = Math.max(1, Math.min(48, Number(req.query.pageSize) || 12));
    const school = String(req.query.school || '').slice(0, 120);
    const q = String(req.query.q || '').slice(0, 100);
    const where = ['s.enabled=1']; const args = [];
    if (school) { where.push('s.school=?'); args.push(school); }
    if (q) { where.push('(a.title LIKE ? OR a.abstract LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
    const condition = where.join(' AND ');
    const [[{ count }]] = await pool.execute(`SELECT COUNT(*) AS count FROM articles a JOIN sources s ON s.id=a.source_id WHERE ${condition}`, args);
    const [rows] = await pool.execute(`SELECT a.id, a.title, a.abstract, a.link, a.image_url AS imageUrl,
      a.keywords, a.published_at AS publishedAt, s.school, s.name AS sourceName,
      s.site_url AS siteUrl, s.icon_url AS iconUrl FROM articles a
      JOIN sources s ON s.id=a.source_id WHERE ${condition} ORDER BY a.published_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...args, size, (page - 1) * size]);
    res.json({ items: rows.map(row => ({ ...row, author: sourceAuthor(row) })), total: Number(count), page, pageSize: size });
  } catch (e) { next(e); }
});

function sjmclSource() {
  return {
    endpointUrl: publicUrl(baseUrl, 'api-sjmcl/article').href,
    fullName: process.env.SOURCE_FULL_NAME || '高校 Minecraft 社团资讯联合源',
    iconSrc: process.env.SOURCE_ICON_URL || publicUrl(baseUrl, 'icon.svg').href,
    name: process.env.SOURCE_NAME || 'MUA 高校社团资讯'
  };
}
app.get('/api-sjmcl/article', async (req, res, next) => {
  try {
    let size;
    try {
      size = parsePageSize(req.query.pageSize);
    } catch (e) { return error(res, 400, e.message); }
    const source = sjmclSource();
    if (size === 0) return res.json({ sourceInfo: source });
    let cursor;
    try { cursor = !req.query.cursor ? null : decodeCursor(req.query.cursor); }
    catch (e) { return error(res, 400, e.message); }
    const [rows] = await pool.execute(`SELECT a.id, a.title, a.abstract, a.link, a.image_url,
      a.keywords, a.published_at, a.updated_at, s.school, s.name, s.site_url, s.icon_url FROM articles a JOIN sources s ON s.id=a.source_id
        WHERE s.enabled=1 ORDER BY a.published_at DESC, a.id DESC LIMIT ? OFFSET ?`, [size + 1, cursor || 0]);
    const hasMore = rows.length > size;
    const posts = rows.slice(0, size).map(row => ({
      id: Number(row.id), title: row.title, abstract: `<p>${escapeHtml(row.abstract || '')}</p>`,
        link: row.link, imageSrc: [row.image_url || '', 0, 0],
      keywords: row.keywords, createAt: row.published_at?.replace(' ', 'T'),
      updateAt: row.updated_at?.replace(' ', 'T'), source: sourceAuthor({ school: row.school, name: row.name, siteUrl: row.site_url, iconUrl: row.icon_url })
    }));
      res.json({ next: hasMore ? encodeCursor((cursor || 0) + size) : null, posts, sourceInfo: source });
  } catch (e) { next(e); }
});
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

function normalizeAdminEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

app.get('/api/admin/admins', adminOnly, async (_req, res, next) => {
  try {
    const [rows] = await pool.query('SELECT email, created_by, created_at FROM admins ORDER BY created_at, email');
    res.json(rows);
  } catch (e) { next(e); }
});
app.post('/api/admin/admins', adminOnly, csrf, async (req, res, next) => {
  try {
    const email = normalizeAdminEmail(req.body.email);
    if (!email) return error(res, 400, '管理员邮箱格式无效');
    const [result] = await pool.execute('INSERT IGNORE INTO admins (email, created_by) VALUES (?, ?)', [email, req.session.user.email]);
    if (!result.affectedRows) return error(res, 409, '该管理员已存在');
    res.status(201).json({ email });
  } catch (e) { next(e); }
});
app.delete('/api/admin/admins/:email', adminOnly, csrf, async (req, res, next) => {
  const email = normalizeAdminEmail(req.params.email);
  if (!email) return error(res, 400, '管理员邮箱格式无效');
  if (email === req.session.user.email) return error(res, 400, '不能删除当前登录的管理员');
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[{ count }]] = await connection.query('SELECT COUNT(*) AS count FROM admins FOR UPDATE');
    if (Number(count) <= 1) {
      await connection.rollback();
      return error(res, 400, '必须至少保留一名管理员');
    }
    const [result] = await connection.execute('DELETE FROM admins WHERE email=?', [email]);
    if (!result.affectedRows) {
      await connection.rollback();
      return error(res, 404, '管理员不存在');
    }
    await connection.commit();
    res.json({ ok: true });
  } catch (e) {
    await connection.rollback();
    next(e);
  } finally { connection.release(); }
});

app.get('/api/admin/sources', adminOnly, async (_req, res, next) => {
  try { const [rows] = await pool.query('SELECT * FROM sources ORDER BY id'); res.json(rows.map(r => ({ ...r, id: Number(r.id) }))); }
  catch (e) { next(e); }
});
app.get('/api/admin/settings', adminOnly, async (_req, res, next) => {
  try {
    const [[row]] = await pool.query("SELECT value FROM settings WHERE name='crawl_interval_minutes'");
    res.json({ crawlIntervalMinutes: Number(row.value), crawling: allRunning, lastCrawlAt, crawlProgress });
  } catch (e) { next(e); }
});
app.put('/api/admin/settings', adminOnly, csrf, async (req, res, next) => {
  try {
    const value = Number(req.body.crawlIntervalMinutes);
    if (!Number.isInteger(value) || value < 15 || value > 1440) return error(res, 400, '间隔需为 15–1440 分钟');
    await pool.execute("UPDATE settings SET value=? WHERE name='crawl_interval_minutes'", [String(value)]);
    res.json({ crawlIntervalMinutes: value });
  } catch (e) { next(e); }
});
function sourceInput(body) {
  const school = String(body.school || '').trim().slice(0, 120);
  const name = String(body.name || '').trim().slice(0, 160);
  const siteUrl = safeHttpUrl(body.siteUrl);
  const iconUrl = body.iconUrl ? safeHttpUrl(body.iconUrl) : null;
  const rule = parseRule(body.rule);
  if (!school || !name || !siteUrl || (body.iconUrl && !iconUrl)) throw new Error('学校、名称或网站地址无效');
  return { school, name, siteUrl, iconUrl, rule, enabled: body.enabled === false ? 0 : 1 };
}
app.post('/api/admin/sources', adminOnly, csrf, async (req, res, next) => {
  try {
    const s = sourceInput(req.body);
    const [result] = await pool.execute(`INSERT INTO sources
      (school, name, site_url, icon_url, rule_json, enabled) VALUES (?, ?, ?, ?, ?, ?)`,
      [s.school, s.name, s.siteUrl, s.iconUrl, JSON.stringify(s.rule), s.enabled]);
    res.status(201).json({ id: Number(result.insertId) });
  } catch (e) { if (e instanceof SyntaxError || /无效|需要/.test(e.message)) return error(res, 400, e.message); next(e); }
});
app.put('/api/admin/sources/:id', adminOnly, csrf, async (req, res, next) => {
  try {
    const id = parseId(req.params.id); if (!id) return error(res, 400, 'ID 无效');
    const s = sourceInput(req.body);
    const [result] = await pool.execute(`UPDATE sources SET school=?, name=?, site_url=?, icon_url=?, rule_json=?,
      enabled=? WHERE id=?`, [s.school, s.name, s.siteUrl, s.iconUrl, JSON.stringify(s.rule), s.enabled, id]);
    if (!result.affectedRows) return error(res, 404, '资讯源不存在');
    res.json({ ok: true });
  } catch (e) { if (e instanceof SyntaxError || /无效|需要/.test(e.message)) return error(res, 400, e.message); next(e); }
});
app.delete('/api/admin/sources/:id', adminOnly, csrf, async (req, res, next) => {
  try {
    const id = parseId(req.params.id); if (!id) return error(res, 400, 'ID 无效');
    const [result] = await pool.execute('DELETE FROM sources WHERE id=?', [id]);
    if (!result.affectedRows) return error(res, 404, '资讯源不存在');
    res.json({ ok: true });
  } catch (e) { next(e); }
});
app.post('/api/admin/sources/:id/crawl', adminOnly, csrf, async (req, res, next) => {
  try { const id = parseId(req.params.id); if (!id) return error(res, 400, 'ID 无效'); res.json(await crawlSource(id)); }
  catch (e) { return error(res, 422, e.message); }
});
app.post('/api/admin/crawl', adminOnly, csrf, (_req, res) => {
  if (allRunning) return res.json({ running: true, started: false, crawlProgress });
  void crawlAll().catch(e => console.error(e));
  res.status(202).json({ running: true, started: true, crawlProgress });
});

const publicDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
app.use(express.static(publicDir, { extensions: ['html'] }));
app.get('/admin', (_req, res) => res.sendFile(join(publicDir, 'admin.html')));
app.use((err, _req, res, _next) => {
  console.error(err);
  error(res, 500, '服务器内部错误');
});
app.listen(Number(process.env.PORT || 3000), () => {
  console.log(`MUA Union News: ${baseUrl.href}`);
  void refreshMissingSourceIcons().catch(error => console.error('Source icon discovery failed:', error));
});
