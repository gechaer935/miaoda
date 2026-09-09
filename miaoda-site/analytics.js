(() => {
  const storageKey = 'miaoda_site_visitor_id_v1';
  const cookieName = 'miaoda_site_visitor_id';

  const createVisitorID = () => {
    if (crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
  };

  const validVisitorID = value => /^[A-Za-z0-9_-]{16,128}$/.test(value || '');
  const cookieVisitorID = () => {
    const prefix = `${cookieName}=`;
    const item = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(prefix));
    return item ? decodeURIComponent(item.slice(prefix.length)) : '';
  };

  let visitorId = '';
  try {
    visitorId = localStorage.getItem(storageKey) || '';
  } catch {
    visitorId = '';
  }
  if (!validVisitorID(visitorId)) visitorId = cookieVisitorID();
  if (!validVisitorID(visitorId)) visitorId = createVisitorID();

  try {
    localStorage.setItem(storageKey, visitorId);
  } catch {
    // The first-party cookie keeps visits stable when storage is unavailable.
  }
  const secure = location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = `${cookieName}=${encodeURIComponent(visitorId)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;

  fetch('/analytics/visit', {
    method: 'POST',
    credentials: 'omit',
    cache: 'no-store',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ visitorId })
  }).catch(() => undefined);
})();
