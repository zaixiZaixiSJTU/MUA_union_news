let csrfToken = '';

export function setCsrfToken(value) {
  csrfToken = value || '';
}

export async function request(url, options = {}) {
  const headers = new Headers(options.headers || {});
  headers.set('accept', 'application/json');
  if (options.body != null) headers.set('content-type', 'application/json');
  if (csrfToken) headers.set('x-csrf-token', csrfToken);

  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（${response.status}）`);
  return data;
}
