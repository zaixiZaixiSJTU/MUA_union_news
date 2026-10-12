import * as cheerio from 'cheerio';
import { safeHttpUrl } from './collector.js';

export function chooseIconCandidate(candidates, baseUrl) {
  return candidates
    .map(candidate => {
      const rel = String(candidate.rel || '').toLowerCase().split(/\s+/);
      const href = safeHttpUrl(candidate.href, baseUrl);
      if (!href) return null;
      const size = String(candidate.sizes || '').match(/(\d+)x\d+/i);
      const pixels = size ? Number(size[1]) : 0;
      const score = (rel.includes('apple-touch-icon') ? 200 : 0) +
        (rel.includes('icon') || rel.includes('shortcut') ? 100 : 0) + Math.min(pixels, 512) / 10;
      return { href, score };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score)[0]?.href || null;
}

export async function discoverIconUrl(siteUrl) {
  let target = safeHttpUrl(siteUrl);
  if (!target) return null;
  try {
    let response;
    for (let hop = 0; hop < 5; hop++) {
      response = await fetch(target, {
        headers: { 'User-Agent': 'MUA-Union-News/1.0 (+icon discovery)', Accept: 'text/html,application/xhtml+xml' },
        redirect: 'manual', signal: AbortSignal.timeout(7000)
      });
      if (response.status >= 300 && response.status < 400) {
        target = safeHttpUrl(response.headers.get('location'), target);
        if (!target) return null;
        continue;
      }
      break;
    }
    if (!response?.ok || !/html|xhtml/i.test(response.headers.get('content-type') || '')) return null;
    if (Number(response.headers.get('content-length') || 0) > 2_000_000) return null;
    const html = await response.text();
    if (html.length > 2_000_000) return null;
    const $ = cheerio.load(html);
    const candidates = $('link[rel][href]').toArray().map(node => ({
      rel: $(node).attr('rel'), href: $(node).attr('href'), sizes: $(node).attr('sizes')
    })).filter(item => /(?:^|\s)(?:icon|apple-touch-icon|mask-icon|shortcut)(?:\s|$)/i.test(item.rel || ''));
    const pageUrl = response.url || target;
    const tileImage = $('meta[name="msapplication-TileImage"]').attr('content');
    if (tileImage) candidates.push({ rel: 'icon', href: tileImage, sizes: '256x256' });
    const discovered = chooseIconCandidate(candidates, pageUrl);
    if (discovered) return discovered;
    const manifestHref = $('link[rel~="manifest"]').attr('href');
    let manifestUrl = safeHttpUrl(manifestHref, pageUrl);
    if (!manifestUrl) return null;
    let manifestResponse;
    for (let hop = 0; hop < 5; hop++) {
      manifestResponse = await fetch(manifestUrl, { redirect: 'manual', signal: AbortSignal.timeout(5000) });
      if (manifestResponse.status >= 300 && manifestResponse.status < 400) {
        manifestUrl = safeHttpUrl(manifestResponse.headers.get('location'), manifestUrl);
        if (!manifestUrl) return null;
        continue;
      }
      break;
    }
    if (!manifestResponse?.ok || Number(manifestResponse.headers.get('content-length') || 0) > 500_000) return null;
    const manifest = await manifestResponse.json();
    const manifestIcons = Array.isArray(manifest.icons) ? manifest.icons.map(icon => ({
      rel: 'icon', href: icon.src, sizes: icon.sizes
    })) : [];
    return chooseIconCandidate(manifestIcons, manifestUrl);
  } catch {
    return null;
  }
}
