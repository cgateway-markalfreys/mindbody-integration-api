const axios = require('axios');

const MB_BASE = process.env.MINDBODY_BASE_URL || 'https://api.mindbodyonline.com/public/v6';
const MB_SITE = process.env.MINDBODY_SITE_ID || '-99';

function authHeaders() {
  return {
    'Api-Key': process.env.MINDBODY_API_KEY,
    'SiteId': MB_SITE,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

// Reject non-absolute paths to prevent 'site/site' bugs
function assertAbsolutePath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) {
    const e = new Error(`Mindbody path must be absolute and start with '/': got "${path}"`);
    e.code = 'RELATIVE_PATH';
    throw e;
  }
  return path;
}

// Minimal XML parser for visibility if we ever hit legacy SOAP
function parseXmlErrorSnippet(xml) {
  if (typeof xml !== 'string') return {};
  const grab = (tag) => {
    const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return m ? m[1].trim() : undefined;
  };
  return {
    status: grab('Status'),
    code: grab('ErrorCode') || grab('Code'),
    message: grab('Message') || grab('DeveloperMessage') || grab('Description'),
    snippet: xml.slice(0, 300),
  };
}

const api = axios.create({
  baseURL: MB_BASE,
  headers: authHeaders(),
  timeout: 15000,
  maxRedirects: 0,
});

// Enforce absolute paths on request
api.interceptors.request.use((cfg) => {
  if (cfg.url) cfg.url = assertAbsolutePath(cfg.url);
  // Ensure SiteId header present
  cfg.headers = { ...(cfg.headers || {}), SiteId: MB_SITE };
  return cfg;
});

// Enforce JSON-only responses
api.interceptors.response.use(
  (resp) => {
    const ct = String(resp.headers['content-type'] || '');
    if (ct.includes('application/json')) return resp;

    if (ct.includes('xml')) {
      const info = parseXmlErrorSnippet(resp.data);
      const err = new Error(`Mindbody XML response (legacy). code=${info.code || 'unknown'} msg=${info.message || 'n/a'}`);
      err.status = resp.status;
      err.data = info;
      throw err;
    }

    const err = new Error(`Mindbody API returned non-JSON response (status ${resp.status}, content-type ${ct})`);
    err.status = resp.status;
    err.data = typeof resp.data === 'string' ? resp.data.slice(0, 300) : resp.data;
    throw err;
  },
  (err) => {
    if (err.response) {
      err.status = err.response.status;
      const ct = String(err.response.headers?.['content-type'] || '');
      if (ct.includes('xml')) {
        const info = parseXmlErrorSnippet(err.response.data);
        err.message = `Mindbody XML error: code=${info.code || 'unknown'} msg=${info.message || 'n/a'}`;
        err.data = info;
      } else if (typeof err.response.data === 'string') {
        err.data = err.response.data.slice(0, 300);
      }
    }
    return Promise.reject(err);
  }
);

module.exports = { api, MB_BASE, MB_SITE, authHeaders, assertAbsolutePath };
