import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeCursor, encodeCursor, parsePageSize } from '../src/sjmcl-pagination.js';

test('pageSize=0 用于仅查询来源信息', () => {
  assert.equal(parsePageSize('0'), 0);
  assert.equal(parsePageSize(undefined), 12);
  assert.throws(() => parsePageSize('-1'));
  assert.throws(() => parsePageSize('51'));
});

test('游标使用 SJMCL 要求的数字偏移量', () => {
  const next = encodeCursor(12);
  assert.equal(next, 12);
  assert.equal(decodeCursor(String(next)), 12);
  assert.throws(() => decodeCursor('garbage'));
  assert.throws(() => decodeCursor('-1'));
});
