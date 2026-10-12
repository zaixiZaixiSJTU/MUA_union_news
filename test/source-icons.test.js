import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseIconCandidate } from '../src/source-icons.js';

test('选择高分辨率触屏社徽并解析相对 URL', () => {
  const icon = chooseIconCandidate([
    { rel: 'icon', href: '/favicon-32.png', sizes: '32x32' },
    { rel: 'apple-touch-icon', href: '/club-mark.png', sizes: '180x180' }
  ], 'https://club.example/news/');
  assert.equal(icon, 'https://club.example/club-mark.png');
});

test('支持绝对图标地址及 SVG favicon', () => {
  assert.equal(chooseIconCandidate([
    { rel: 'shortcut icon', href: 'https://cdn.example/mark.svg', sizes: 'any' }
  ], 'https://club.example/'), 'https://cdn.example/mark.svg');
});

test('忽略无效图标地址', () => {
  assert.equal(chooseIconCandidate([
    { rel: 'icon', href: 'javascript:alert(1)' }
  ], 'https://club.example/'), null);
});
