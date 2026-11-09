import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { LauncherError, listGames, getWrapperLink } from './launcher.mjs';

const stand = { type: 'string', minLength: 1, maxLength: 100, default: 'STAGE' };
const tools = [
  {
    name: 'get_games_list',
    description: 'List available Zephyr games as code/name pairs for a stand. Credentials come from the server environment.',
    inputSchema: { type: 'object', properties: { stand }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  },
  {
    name: 'get_wrapper_link',
    description: 'Create a user, set balance and return a ready Zephyr wrapper URL. Optional game_load_path loads local HTTP(S) game assets via gameLoadPath and adds cheats=true. Omit it for the remote game. Preserve launcher-owned authToken, userId, wsHost, wrapperUrl, gameCode, cdnGameVersion and other query values: never rebuild/encode the returned URL. Session links grant access; do not publish them. No browser setup required to obtain a link.',
    inputSchema: {
      type: 'object',
      properties: {
        game_code: { type: 'string', minLength: 1, maxLength: 200 },
        stand,
        balance: { type: 'number', minimum: 0, default: 100000 },
        currency: { type: 'string', minLength: 1, maxLength: 20, default: 'USD' },
        game_load_path: { type: 'string', minLength: 1, maxLength: 2048, description: 'HTTP(S) game URL without credentials, query or fragment, e.g. http://localhost:4445.' },
      },
      required: ['game_code'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  },
];

const server = new Server({ name: 'zephyr-launcher-mcp', version: '0.1.0' }, { capabilities: { tools: {} } });
const shutdown = new AbortController();
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }, extra) => {
  try {
    const dependencies = { signal: AbortSignal.any([shutdown.signal, extra.signal]) };
    let result;
    if (params.name === 'get_games_list') result = { games: await listGames(params.arguments ?? {}, dependencies) };
    else if (params.name === 'get_wrapper_link') result = { url: await getWrapperLink(params.arguments ?? {}, dependencies) };
    else throw new LauncherError('Unknown tool.');
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  } catch (error) {
    return { isError: true, content: [{ type: 'text', text: error instanceof LauncherError ? error.message : 'Launcher operation failed.' }] };
  }
});

let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  shutdown.abort();
  await server.close();
}
process.stdin.once('end', () => { void close(); });
process.stdin.once('close', () => { void close(); });
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => { void close(); });
await server.connect(new StdioServerTransport());
