import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { appPath, normalizeBaseUrl, publicUrl } from '../src/public-url.js';

test('公网地址保留 /news 部署前缀', () => {
  const baseUrl = normalizeBaseUrl('https://www.mualliance.cn/news/');
  assert.equal(baseUrl.href, 'https://www.mualliance.cn/news');
  assert.equal(appPath(baseUrl), '/news/');
  assert.equal(appPath(baseUrl, '/admin'), '/news/admin');
  assert.equal(publicUrl(baseUrl, '/api-sjmcl/article').href, 'https://www.mualliance.cn/news/api-sjmcl/article');
  assert.equal(publicUrl(baseUrl, '/auth/callback').href, 'https://www.mualliance.cn/news/auth/callback');
});

test('根路径部署保持原有地址', () => {
  const baseUrl = normalizeBaseUrl('https://news.example.com/');
  assert.equal(appPath(baseUrl), '/');
  assert.equal(appPath(baseUrl, 'admin'), '/admin');
});

test('前台资源和链接在 /news 下保持同一前缀', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const values = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  const internal = values.filter(value => !/^(?:https?:|#)/.test(value));
  for (const value of internal) {
    assert.equal(new URL(value, 'https://www.mualliance.cn/news/').pathname.startsWith('/news/'), true, value);
  }
});

test('后台资源和链接在 /news/admin 下保持同一前缀', async () => {
  const html = await readFile(new URL('../public/admin.html', import.meta.url), 'utf8');
  const values = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map(match => match[1]);
  const internal = values.filter(value => !/^(?:https?:|#)/.test(value));
  for (const value of internal) {
    assert.equal(new URL(value, 'https://www.mualliance.cn/news/admin').pathname.startsWith('/news/'), true, value);
  }
});
