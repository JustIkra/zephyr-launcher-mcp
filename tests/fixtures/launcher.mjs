export const credentials = { username: 'fixture-login', password: 'fixture-password' };
export const remoteUrl = 'https://cdn.example.test/wrapper/index.html?authToken=a%2Fb+c%3D&userId=123&wrapperUrl=https%3A%2F%2Fwrapper.example.test%2F%3Fa%3D1%26b%3D2#play';

export function fixtureFetch({ failAt, status = 500, invalidAt, wrapperUrl = remoteUrl, onRequest } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const path = url.replace('https://game-launcher.zephyrslots.com', '');
    const body = options.body ? JSON.parse(options.body) : undefined;
    const call = { path, method: options.method, body, headers: options.headers, redirect: options.redirect, signal: options.signal };
    calls.push(call);
    onRequest?.(call);
    if (failAt === path) return new Response('fixture-password authToken=private-session', { status });
    if (invalidAt === path) return new Response('{broken', { headers: { 'content-type': 'application/json' } });
    const replies = {
      '/api/auth/login': { success: true },
      '/api/stand': [{ name: 'STAGE' }, { name: 'OTHER' }],
      '/api/stand/STAGE/games?username=fixture-login': [{ code: 'testgame', name: 'Test Game', extra: 'omit' }],
      '/api/stand/OTHER/games?username=fixture-login': [{ code: 'testgame', name: 'Test Game' }],
      '/api/currency': [{ code: 'USD' }, 'EUR'],
      '/api/user': { id: 'fixture-user' },
      '/api/stand/STAGE/launch/testgame': wrapperUrl,
      '/api/stand/OTHER/launch/testgame': wrapperUrl,
    };
    if (!(path in replies)) throw new Error('Unexpected fixture request');
    return Response.json(replies[path], {
      headers: path === '/api/auth/login' ? { 'set-cookie': 'session=fixture-cookie; Path=/; HttpOnly' } : {},
    });
  };
  return { fetchImpl, calls, credentials };
}
