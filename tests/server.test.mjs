import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { remoteUrl } from './fixtures/launcher.mjs';

async function connect(t, { fixture = false, credentials = false } = {}) {
  const args = [];
  if (fixture) args.push('--import', fileURLToPath(new URL('./fixtures/preload.mjs', import.meta.url)));
  args.push(fileURLToPath(new URL('../src/server.mjs', import.meta.url)));
  const transport = new StdioClientTransport({
    command: process.execPath, args, stderr: 'pipe',
    env: { ZEPHYR_LAUNCHER_LOGIN: credentials ? 'fixture-login' : '', ZEPHYR_LAUNCHER_PASSWORD: credentials ? 'fixture-password' : '' },
  });
  const client = new Client({ name: 'launcher-test', version: '1.0.0' });
  t.after(() => client.close());
  await client.connect(transport);
  return client;
}

test('stdio discovery exposes exactly two tools without requiring credentials', async t => {
  const client = await connect(t);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name), ['get_games_list', 'get_wrapper_link']);
  assert.equal(tools[0].annotations.readOnlyHint, true);
  assert.equal(tools[1].annotations.readOnlyHint, false);
  assert.equal(tools[1].annotations.idempotentHint, false);
  assert.deepEqual(tools[1].inputSchema.required, ['game_code']);
  assert.equal(tools[1].inputSchema.additionalProperties, false);
  assert.match(tools[1].description, /gameLoadPath/);
  assert.match(tools[1].description, /cheats/);
});

test('stdio tools return compact structured games and a ready URL from fixture API', async t => {
  const client = await connect(t, { fixture: true, credentials: true });
  const games = await client.callTool({ name: 'get_games_list', arguments: {} });
  assert.deepEqual(games.structuredContent, { games: [{ code: 'testgame', name: 'Test Game' }] });
  const remote = await client.callTool({ name: 'get_wrapper_link', arguments: { game_code: 'testgame' } });
  assert.deepEqual(remote.structuredContent, { url: remoteUrl });
  const local = await client.callTool({ name: 'get_wrapper_link', arguments: { game_code: 'testgame', game_load_path: 'http://localhost:4445' } });
  assert.equal(local.structuredContent.url, 'https://cdn.example.test/wrapper/index.html?authToken=a%2Fb+c%3D&userId=123&wrapperUrl=https%3A%2F%2Fwrapper.example.test%2F%3Fa%3D1%26b%3D2&gameLoadPath=http://localhost:4445&cheats=true#play');
});

test('unknown tools, missing game codes and invalid inputs produce safe tool errors', async t => {
  const client = await connect(t, { fixture: true, credentials: true });
  for (const params of [
    { name: 'unknown', arguments: {} },
    { name: 'get_wrapper_link', arguments: {} },
    { name: 'get_wrapper_link', arguments: { game_code: 'testgame', balance: '100' } },
    { name: 'get_games_list', arguments: { username: 'fixture-password' } },
  ]) {
    const result = await client.callTool(params);
    assert.equal(result.isError, true);
    assert.ok(!JSON.stringify(result).includes('fixture-password'));
  }
});

test('missing credentials are actionable call errors, not server startup failures', async t => {
  const client = await connect(t);
  const result = await client.callTool({ name: 'get_games_list', arguments: {} });
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /ZEPHYR_LAUNCHER_LOGIN.*ZEPHYR_LAUNCHER_PASSWORD/);
  assert.equal((await client.listTools()).tools.length, 2);
});
