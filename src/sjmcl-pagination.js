export function parsePageSize(value) {
  if (value === undefined) return 12;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error('pageSize 必须是 0–50 的整数');
  const size = Number(value);
  if (!Number.isSafeInteger(size) || size > 50) throw new Error('pageSize 必须是 0–50 的整数');
  return size;
}

export function encodeCursor(offset) {
  return offset;
}

export function decodeCursor(value) {
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) throw new Error('cursor 无效');
  const offset = Number(value);
  if (!Number.isSafeInteger(offset)) throw new Error('cursor 无效');
  return offset;
}
