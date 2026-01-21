import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

function isPrivateIpV4(hostname: string) {
  const m = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const parts = m.slice(1).map((v) => Number(v));
  if (parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return false;
}

function isPrivateHostname(hostname: string) {
  const h = String(hostname || '').toLowerCase();
  if (!h) return true;
  if (h === 'localhost') return true;
  if (h.endsWith('.local')) return true;
  if (h === '::1') return true;
  if (h.startsWith('127.')) return true;
  if (isPrivateIpV4(h)) return true;
  // Rough IPv6 private checks
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // fc00::/7
  if (h.startsWith('fe80:')) return true; // link-local
  return false;
}

function extractTitle(html: string) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!m) return '';
  return String(m[1] || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractIconHref(html: string) {
  const patterns = [
    /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i,
    /<link[^>]*rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i,
    /<link[^>]*href=["']([^"']+)["'][^>]*rel=["'][^"']*apple-touch-icon[^"']*["'][^>]*>/i,
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return String(m[1]).trim();
  }
  return '';
}

async function fetchWithRedirectLimit(startUrl: string, maxRedirects: number) {
  const visited = new Set<string>();
  let current = startUrl;
  for (let i = 0; i <= maxRedirects; i++) {
    if (visited.has(current)) throw new Error('Too many redirects');
    visited.add(current);

    const res = await fetch(current, {
      redirect: 'manual',
      headers: {
        'user-agent': 'nippo-app/1.0 (+metadata-fetch)',
        accept: 'text/html,application/xhtml+xml',
      },
    });

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location') || '';
      if (!loc) throw new Error('Redirect with no location');
      const next = new URL(loc, current);
      if (isPrivateHostname(next.hostname)) throw new Error('blocked hostname');
      current = next.toString();
      continue;
    }

    return { res, finalUrl: current };
  }
  throw new Error('Too many redirects');
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const rawUrl = String(searchParams.get('url') || '').trim();
  if (!rawUrl) {
    return NextResponse.json({ success: false, error: 'url is required' }, { status: 400 });
  }

  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return NextResponse.json({ success: false, error: 'invalid url' }, { status: 400 });
  }

  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return NextResponse.json({ success: false, error: 'only http/https are allowed' }, { status: 400 });
  }

  if (isPrivateHostname(target.hostname)) {
    return NextResponse.json({ success: false, error: 'blocked hostname' }, { status: 400 });
  }

  const fallback = {
    title: target.hostname,
    iconUrl: `${target.protocol}//${target.host}/favicon.ico`,
    finalUrl: target.toString(),
  };

  try {
    const { res, finalUrl } = await fetchWithRedirectLimit(target.toString(), 6);
    if (!res.ok) {
      return NextResponse.json({ success: true, ...fallback, finalUrl, fetched: false });
    }

    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('text/html') && !ct.includes('application/xhtml+xml')) {
      return NextResponse.json({ success: true, ...fallback, finalUrl, fetched: false });
    }

    const MAX_BYTES = 200 * 1024;
    const buf = await res.arrayBuffer();
    const slice = buf.byteLength > MAX_BYTES ? buf.slice(0, MAX_BYTES) : buf;
    const html = new TextDecoder('utf-8').decode(slice);

    const title = extractTitle(html) || new URL(finalUrl).hostname;

    let iconUrl = '';
    const iconHref = extractIconHref(html);
    if (iconHref) {
      try {
        iconUrl = new URL(iconHref, finalUrl).toString();
      } catch {
        iconUrl = '';
      }
    }
    if (!iconUrl) {
      try {
        iconUrl = new URL('/favicon.ico', finalUrl).toString();
      } catch {
        iconUrl = fallback.iconUrl;
      }
    }

    return NextResponse.json({ success: true, title, iconUrl, finalUrl, fetched: true });
  } catch {
    return NextResponse.json({ success: true, ...fallback, fetched: false });
  }
}
