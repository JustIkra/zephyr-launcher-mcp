import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureFetch, remoteUrl, credentials } from './fixtures/launcher.mjs';

const api = await import('../src/launcher.mjs').catch(() => ({}));

test('listing authenticates, selects STAGE and returns compact code/name entries', async () => {
  assert.equal(typeof api.listGames, 'function');
  const fixture = fixtureFetch();
  assert.deepEqual(await api.listGames({}, fixture), [{ code: 'testgame', name: 'Test Game' }]);
  assert.deepEqual(fixture.calls.map(c => c.path), [
    '/api/auth/login', '/api/stand', '/api/stand/STAGE/games?username=fixture-login',
  ]);
  assert.deepEqual(fixture.calls[0].body, { username: 'fixture-login', password: 'fixture-password' });
  assert.equal(fixture.calls[1].headers.Cookie, 'session=fixture-cookie');
  assert.ok(fixture.calls.every(c => c.redirect === 'error' && c.signal instanceof AbortSignal));
});

test('remote launch creates a zero-balance user, updates balance, then returns the unchanged URL', async () => {
  assert.equal(typeof api.getWrapperLink, 'function');
  const fixture = fixtureFetch();
  assert.equal(await api.getWrapperLink({ game_code: 'testgame' }, fixture), remoteUrl);
  assert.deepEqual(fixture.calls.map(c => [c.method, c.path]), [
    ['POST', '/api/auth/login'], ['GET', '/api/stand'], ['GET', '/api/stand/STAGE/games?username=fixture-login'],
    ['GET', '/api/currency'], ['POST', '/api/user'], ['POST', '/api/user'], ['POST', '/api/stand/STAGE/launch/testgame'],
  ]);
  assert.deepEqual(fixture.calls[4].body, { balance: 0, stand: 'STAGE', currency: 'USD' });
  assert.deepEqual(fixture.calls[5].body, { id: 'fixture-user', balance: 100000, stand: 'STAGE', currency: 'USD' });
  assert.deepEqual(fixture.calls[6].body, { id: 'fixture-user', demo: false });
});

test('custom stand, balance and currency reach the launcher', async () => {
  const fixture = fixtureFetch();
  await api.getWrapperLink({ game_code: 'testgame', stand: 'OTHER', balance: 0, currency: 'EUR' }, fixture);
  assert.deepEqual(fixture.calls[5].body, { id: 'fixture-user', balance: 0, stand: 'OTHER', currency: 'EUR' });
  assert.equal(fixture.calls[6].path, '/api/stand/OTHER/launch/testgame');
});

for (const [label, input, expected] of [
  ['new parameters before fragment', remoteUrl, 'https://cdn.example.test/wrapper/index.html?authToken=a%2Fb+c%3D&userId=123&wrapperUrl=https%3A%2F%2Fwrapper.example.test%2F%3Fa%3D1%26b%3D2&gameLoadPath=http://localhost:4445&cheats=true#play'],
  ['replacement without touching encoding', 'https://cdn.example.test/?gameLoadPath=http://old&authToken=a+b%2F&cheats=false#hash', 'https://cdn.example.test/?gameLoadPath=http://localhost:4445&authToken=a+b%2F&cheats=true#hash'],
  ['empty query', 'https://cdn.example.test/?#hash', 'https://cdn.example.test/?gameLoadPath=http://localhost:4445&cheats=true#hash'],
  ['no query', 'https://cdn.example.test/index.html', 'https://cdn.example.test/index.html?gameLoadPath=http://localhost:4445&cheats=true'],
]) test(`local override: ${label}`, async () => {
  const fixture = fixtureFetch({ wrapperUrl: input });
  assert.equal(await api.getWrapperLink({ game_code: 'testgame', game_load_path: 'http://localhost:4445' }, fixture), expected);
});

for (const args of [
  {}, { game_code: '' }, { game_code: 'testgame', balance: -1 }, { game_code: 'testgame', balance: Infinity },
  { game_code: 'testgame', balance: '100' }, { game_code: 'testgame', stand: '' },
  { game_code: 'testgame', currency: null }, { game_code: 'testgame', extra: true },
  ...['javascript:alert(1)', 'file:///tmp/game', 'http://user:pass@localhost:4445', 'http://localhost:4445/?x=1&cheats=false', 'http://localhost:4445/#hash', ''].map(game_load_path => ({ game_code: 'testgame', game_load_path })),
]) test(`invalid launch args rejected before network: ${JSON.stringify(args)}`, async () => {
  const fixture = fixtureFetch();
  await assert.rejects(() => api.getWrapperLink(args, fixture));
  assert.equal(fixture.calls.length, 0);
});

test('missing credentials fail before network without exposing values', async () => {
  const fixture = fixtureFetch();
  await assert.rejects(() => api.listGames({}, { ...fixture, credentials: {} }), /ZEPHYR_LAUNCHER_LOGIN.*ZEPHYR_LAUNCHER_PASSWORD/);
  assert.equal(fixture.calls.length, 0);
});

for (const [path, status] of [
  ['/api/auth/login', 401], ['/api/stand', 302],
  ['/api/stand/STAGE/games?username=fixture-login', 403],
  ['/api/currency', 500], ['/api/user', 500], ['/api/stand/STAGE/launch/testgame', 500],
]) test(`HTTP ${status} at ${path} stops without retry or leaking response`, async () => {
  const fixture = fixtureFetch({ failAt: path, status });
  await assert.rejects(() => api.getWrapperLink({ game_code: 'testgame' }, fixture), error =>
    error.message.includes(String(status)) && !/fixture-password|private-session|fixture-login/.test(error.message));
  assert.equal(fixture.calls.at(-1).path, path);
  assert.equal(fixture.calls.filter(c => c.path === path).length, 1);
});

test('malformed JSON is a safe operation error', async () => {
  const fixture = fixtureFetch({ invalidAt: '/api/auth/login' });
  await assert.rejects(() => api.listGames({}, fixture), /login.*invalid response/i);
  assert.equal(fixture.calls.length, 1);
});

test('network exception details and rejected login bodies are not echoed', async () => {
  await assert.rejects(() => api.listGames({}, {
    credentials, fetchImpl: async () => { throw new Error('fixture-password authToken=private-session'); },
  }), error => /login/i.test(error.message) && !/fixture-password|private-session/.test(error.message));
  await assert.rejects(() => api.listGames({}, {
    credentials, fetchImpl: async () => Response.json({ success: false, error: 'fixture-password' }),
  }), error => /rejected/i.test(error.message) && !error.message.includes('fixture-password'));
});

for (const args of [
  { game_code: 'unknown' }, { game_code: 'testgame', currency: 'BAD' }, { game_code: 'testgame', stand: 'MISSING' },
]) test('unavailable game/currency/stand fails before creating a user: ' + JSON.stringify(args), async () => {
  const fixture = fixtureFetch();
  await assert.rejects(() => api.getWrapperLink(args, fixture), /unavailable/i);
  assert.ok(fixture.calls.every(c => c.path !== '/api/user' && !c.path.includes('/launch/')));
});

test('invalid response shapes and wrapper URL schemes are rejected', async () => {
  for (const value of [null, {}, 'javascript:alert(1)', 'https://user:password@cdn.example.test/']) {
    const fixture = fixtureFetch({ wrapperUrl: value });
    await assert.rejects(() => api.getWrapperLink({ game_code: 'testgame' }, fixture), /invalid.*URL/i);
  }
  await assert.rejects(() => api.listGames({}, {
    credentials, fetchImpl: async url => Response.json(url.endsWith('/login') ? { success: true } : {}),
  }), /invalid response/i);
});

test('caller cancellation is honored before network', async () => {
  const fixture = fixtureFetch();
  await assert.rejects(() => api.listGames({}, { ...fixture, signal: AbortSignal.abort() }), /cancel/i);
  assert.equal(fixture.calls.length, 0);
});

test('request deadline terminates an unresponsive dependency with a safe timeout', async () => {
  await assert.rejects(() => api.listGames({}, {
    credentials,
    requestTimeoutMs: 10,
    fetchImpl: (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
  }), /timed out/i);
});
