const productionUrl = 'https://uehfvpnnoitgybsmdgef.supabase.co';

export function resolveBrowserConfig(env) {
  const url = String(env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
  const key = String(env.VITE_SUPABASE_PUBLISHABLE_KEY || '');
  const preview = env.VERCEL_ENV === 'preview';
  if (!url && !key && !preview) return null;
  if (!url || !key) throw new Error('Set both browser Supabase configuration variables.');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error('Supabase URL must be an HTTPS project origin.');
  }
  if (preview && parsed.origin === productionUrl) throw new Error('Preview must use an isolated Supabase project.');
  let publicKey = key.startsWith('sb_publishable_');
  if (!publicKey) {
    try { publicKey = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role === 'anon'; } catch {}
  }
  if (!publicKey) throw new Error('Browser configuration requires a publishable or anonymous key.');
  return { url: parsed.origin, key };
}

export function injectBrowserConfig(html, config) {
  if (!config) return html;
  const serialize = (value) => JSON.stringify(value).replace(/</g, '\\u003c');
  const marker = /<script>window\.__LOOSE_ENDS_SUPABASE_URL__[\s\S]*?<\/script>/;
  if (!marker.test(html)) throw new Error('Browser configuration insertion point missing.');
  return html.replace(marker,
    () => `<script>window.__LOOSE_ENDS_SUPABASE_URL__=${serialize(config.url)};window.__LOOSE_ENDS_SUPABASE_PUBLISHABLE_KEY__=${serialize(config.key)};</script>`);
}
