const baseUrl = 'https://game-launcher.zephyrslots.com';
const text = value => typeof value === 'string' && value.trim().length > 0;

export class LauncherError extends Error {}

function options(input, launch) {
  const allowed = launch
    ? ['game_code', 'stand', 'balance', 'currency', 'game_load_path']
    : ['stand'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) {
    throw new LauncherError('Invalid tool arguments.');
  }
  const { stand = 'STAGE', balance = 100000, currency = 'USD', game_code, game_load_path } = input;
  if (!text(stand) || stand.length > 100 || (launch && (
    !text(game_code) || game_code.length > 200 || !text(currency) || currency.length > 20 ||
    typeof balance !== 'number' || !Number.isFinite(balance) || balance < 0
  ))) throw new LauncherError('Invalid stand, game_code, balance or currency.');
  if (game_load_path !== undefined) {
    let local;
    try { local = new URL(game_load_path); } catch {}
    if (!text(game_load_path) || game_load_path.length > 2048 || !local || !['http:', 'https:'].includes(local.protocol) ||
      local.username || local.password || /[?&#\s]/.test(game_load_path)) {
      throw new LauncherError('game_load_path must be an HTTP(S) URL without credentials, query or fragment.');
    }
  }
  return { stand, balance, currency, game_code, game_load_path };
}

function client({ credentials = {
  username: process.env.ZEPHYR_LAUNCHER_LOGIN,
  password: process.env.ZEPHYR_LAUNCHER_PASSWORD,
}, fetchImpl = fetch, signal, requestTimeoutMs = 15000 } = {}) {
  if (!text(credentials.username) || !text(credentials.password)) {
    throw new LauncherError('Set ZEPHYR_LAUNCHER_LOGIN and ZEPHYR_LAUNCHER_PASSWORD in the server environment.');
  }
  const cookies = new Map();
  const request = async (path, label, body) => {
    if (signal?.aborted) throw new LauncherError('Launcher operation cancelled.');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    try {
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (cookies.size) headers.Cookie = [...cookies].map(([key, value]) => `${key}=${value}`).join('; ');
      const response = await fetchImpl(`${baseUrl}${path}`, {
        method: body === undefined ? 'GET' : 'POST', headers, redirect: 'error', signal: requestSignal,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (!response.ok) throw new LauncherError(`${label} failed with HTTP ${response.status}.`);
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';', 1)[0];
        const index = pair.indexOf('=');
        if (index > 0) cookies.set(pair.slice(0, index), pair.slice(index + 1));
      }
      try {
        return (response.headers.get('content-type') || '').includes('application/json')
          ? await response.json() : await response.text();
      } catch {
        if (requestSignal.aborted) throw new Error('aborted');
        throw new LauncherError(`${label} returned an invalid response.`);
      }
    } catch (error) {
      if (signal?.aborted) throw new LauncherError('Launcher operation cancelled.');
      if (controller.signal.aborted) throw new LauncherError(`${label} timed out.`);
      if (error instanceof LauncherError) throw error;
      throw new LauncherError(`${label} request failed.`);
    } finally {
      clearTimeout(timer);
    }
  };
  return { request, username: credentials.username, password: credentials.password };
}

async function authenticate(api, stand) {
  const login = await api.request('/api/auth/login', 'Launcher login', { username: api.username, password: api.password });
  if (!login?.success) throw new LauncherError('Launcher login was rejected.');
  const stands = await api.request('/api/stand', 'List stands');
  if (!Array.isArray(stands) || !stands.every(item => text(item?.name))) {
    throw new LauncherError('List stands returned an invalid response.');
  }
  if (!stands.some(item => item.name === stand)) throw new LauncherError('Selected stand is unavailable.');
  const games = await api.request(`/api/stand/${encodeURIComponent(stand)}/games?username=${encodeURIComponent(api.username)}`, 'List games');
  if (!Array.isArray(games) || !games.every(item => text(item?.code))) {
    throw new LauncherError('List games returned an invalid response.');
  }
  return games;
}

export async function listGames(input = {}, dependencies) {
  const { stand } = options(input, false);
  const api = client(dependencies);
  const games = await authenticate(api, stand);
  return games.map(({ code, name }) => ({ code, name: text(name) ? name : code }));
}

function localOverride(url, value) {
  const hashIndex = url.indexOf('#');
  let main = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? '' : url.slice(hashIndex);
  for (const [key, next] of [['gameLoadPath', value], ['cheats', 'true']]) {
    const pattern = new RegExp(`([?&])${key}=[^&]*`, 'g');
    main = pattern.test(main)
      ? main.replace(pattern, (_match, prefix) => `${prefix}${key}=${next}`)
      : `${main}${main.includes('?') ? /[?&]$/.test(main) ? '' : '&' : '?'}${key}=${next}`;
  }
  return main + hash;
}

export async function getWrapperLink(input, dependencies) {
  const { stand, game_code, balance, currency, game_load_path } = options(input, true);
  const api = client(dependencies);
  const games = await authenticate(api, stand);
  if (!games.some(item => item.code === game_code)) throw new LauncherError('Selected game is unavailable on this stand.');
  const currencies = await api.request('/api/currency', 'List currencies');
  if (!Array.isArray(currencies) || !currencies.every(item => text(typeof item === 'string' ? item : item?.code || item?.name))) {
    throw new LauncherError('List currencies returned an invalid response.');
  }
  if (!currencies.some(item => (typeof item === 'string' ? item : item.code || item.name) === currency)) {
    throw new LauncherError('Selected currency is unavailable.');
  }
  const user = await api.request('/api/user', 'Create user', { balance: 0, stand, currency });
  if (!(text(user?.id) || (Number.isSafeInteger(user?.id) && user.id > 0))) {
    throw new LauncherError('Create user returned an invalid response.');
  }
  await api.request('/api/user', 'Update balance', { id: user.id, balance, stand, currency });
  const url = await api.request(`/api/stand/${encodeURIComponent(stand)}/launch/${encodeURIComponent(game_code)}`, 'Launch game', { id: user.id, demo: false });
  let parsed;
  try { parsed = new URL(url); } catch {}
  if (typeof url !== 'string' || !parsed || !['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new LauncherError('Launcher returned an invalid wrapper URL.');
  }
  return game_load_path === undefined ? url : localOverride(url, game_load_path);
}
