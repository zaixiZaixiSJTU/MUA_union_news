export function normalizeBaseUrl(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  url.pathname = url.pathname.replace(/\/+$/, '') || '/';
  return url;
}

export function basePathOf(baseUrl) {
  return baseUrl.pathname === '/' ? '' : baseUrl.pathname;
}

export function appPath(baseUrl, path = '') {
  const suffix = String(path).replace(/^\/+/, '');
  return `${basePathOf(baseUrl)}/${suffix}`;
}

export function publicUrl(baseUrl, path = '') {
  return new URL(appPath(baseUrl, path), baseUrl.origin);
}
