'use strict';

(() => {
  const config = window.NOVEL_SITE_CONFIG ?? {};
  const apiKey = String(config.supabasePublishableKey ?? '').trim();

  function isPublicKey(value) {
    if (value.startsWith('sb_publishable_')) return true;
    try {
      const segment = value.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(atob(segment)).role === 'anon';
    } catch {
      return false;
    }
  }

  function projectOrigin(value) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:' && !url.username && !url.password &&
          url.pathname === '/' && !url.search && !url.hash) return url.origin;
    } catch {
      return null;
    }
    return null;
  }

  const origin = projectOrigin(config.supabaseUrl);
  const configured = Boolean(origin && isPublicKey(apiKey));

  async function request(path, { body, token, timeout = 15000 } = {}) {
    if (!configured) throw new Error('Backend is not configured.');

    const headers = { apikey: apiKey };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (body !== undefined) headers['Content-Type'] = 'application/json';

    const response = await fetch(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(timeout),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new Error('Backend request failed.');
      error.status = response.status;
      error.code = data?.code;
      throw error;
    }
    return data;
  }

  const publicPath = '/functions/v1/novel-public';
  const operatorPath = '/functions/v1/novel-operator';
  window.NovelBackend = Object.freeze({
    configured,
    challengeUrl: configured ? origin + publicPath + '?challenge=1' : '',
    loadCatalog: () => request(publicPath, { timeout: 6000 }),
    submit: (body) => request(publicPath, { body }),
    requestMagicLink: (email, redirectUrl) => request('/auth/v1/otp?redirect_to=' + encodeURIComponent(redirectUrl), {
      body: { email, create_user: false },
    }),
    signOut: (token) => request('/auth/v1/logout?scope=local', { body: {}, token, timeout: 4000 }),
    listSuggestions: (token, status) => request(operatorPath + '?status=' + encodeURIComponent(status), { token }),
    decide: (token, body) => request(operatorPath, { token, body }),
  });
})();
