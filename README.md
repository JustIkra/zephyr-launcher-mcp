# Zephyr Launcher MCP

Two MCP tools for the [Zephyr Game Launcher](https://game-launcher.zephyrslots.com): **list games** and **get a ready-to-open wrapper link**. Authentication and session setup happen inside the server, not in the agent's context.

| Tool | What it does |
| --- | --- |
| `get_games_list` | Returns available game codes and names for a stand. |
| `get_wrapper_link` | Creates a user, sets a balance and returns a wrapper URL for a game. |

No skill, browser automation or screenshot workflow is required to get a link. This is a small, unofficial integration, not a way to obtain launcher access.

## Install

Requires **Node.js 22 or newer**, npm, Git and an existing Zephyr Launcher account.

```sh
git clone https://github.com/JustIkra/zephyr-launcher-mcp.git
cd zephyr-launcher-mcp
npm ci
```

## Set up credentials

Ask your launcher administrator for a login and password. This server cannot issue credentials.

Keep them in a private file **outside the repository**. On macOS or Linux:

```sh
mkdir -p "$HOME/.config/zephyr-launcher-mcp"
chmod 700 "$HOME/.config/zephyr-launcher-mcp"
cp .env.example "$HOME/.config/zephyr-launcher-mcp/.env"
chmod 600 "$HOME/.config/zephyr-launcher-mcp/.env"
```

Open that file in your editor and replace the placeholders:

```dotenv
ZEPHYR_LAUNCHER_LOGIN="your-launcher-login"
ZEPHYR_LAUNCHER_PASSWORD="your-launcher-password"
```

Use Node-compatible dotenv quoting, especially if a value contains spaces or `#`. On Windows, create the same two-variable file in a private directory and restrict its file permissions to your account.

The server reads these two environment variables. Node's `--env-file` option loads the file; you can instead supply them through your MCP client's private environment configuration. **Do not put real credentials in chat, command arguments, Git or a shared MCP configuration.** Existing environment variables take precedence over `--env-file`; remove stale exported values if authentication unexpectedly fails.

## Connect an MCP client

Add a stdio server to your client's MCP configuration. Replace both paths below with **absolute paths**. Do not use `~` or `$HOME` in JSON: clients do not necessarily expand them.

```json
{
  "mcpServers": {
    "zephyr-launcher": {
      "command": "node",
      "args": [
        "--env-file=/absolute/path/to/private/.env",
        "/absolute/path/to/zephyr-launcher-mcp/src/server.mjs"
      ]
    }
  }
}
```

This format works with clients that use `mcpServers`; other clients need the same command and arguments in their native format. If your desktop client cannot find Node, use the absolute path to the Node executable.

Restart the client, then look for `get_games_list` and `get_wrapper_link`. Tool discovery works without credentials; actual calls require them.

To start the transport manually:

```sh
node --env-file="$HOME/.config/zephyr-launcher-mcp/.env" src/server.mjs
```

It waits for MCP messages on stdin. It is not an interactive shell command and does not print a banner or a link by itself.

## Use the tools

### List games

```json
{}
```

Call `get_games_list` with no arguments to use `STAGE`, or pass `{"stand":"STAGE"}`. The result is:

```json
{
  "games": [
    { "code": "examplegame", "name": "Example Game" }
  ]
}
```

Use a returned `code` in the next call. The example above is illustrative, not a bundled game catalog.

### Get a wrapper link

Call `get_wrapper_link`:

```json
{
  "game_code": "examplegame",
  "game_load_path": "http://localhost:4445"
}
```

| Argument | Default | Meaning |
| --- | --- | --- |
| `game_code` | Required | A code from `get_games_list`. |
| `stand` | `STAGE` | Launcher stand. |
| `balance` | `100000` | Initial balance; must be a finite, nonnegative number. |
| `currency` | `USD` | A currency supported by the launcher. |
| `game_load_path` | Omitted | Optional local game URL. Omit it to use the remote game. |

The result is `{"url":"<ready wrapper URL>"}`. Each successful call creates a new launcher user and session. Calls are not automatically retried. A failure after user creation can leave that user behind; calling again creates another user.

The local server must already be running. This MCP only returns a link: HTTPS-wrapper access to local assets, CORS, local-network permissions and browser testing remain your browser or project's responsibility.

### Wrapper query parameters

- **`gameLoadPath`** tells the wrapper where to load game assets. The tool adds it only when you supply `game_load_path`, an HTTP(S) URL without credentials, query or fragment.
- **`cheats=true`** is also added with a local override, enabling cheats where supported.
- **`authToken`, `userId`, `wsHost`, `clientCode`, `currency`, `wrapperUrl`, `gameCode`, `cdnGameVersion`** and other parameters belong to the launcher. Preserve them.

**Open the returned URL unchanged.** Do not parse and reserialize it through `URLSearchParams`, re-encode it or paste in another session's parameters. The server adds local parameters as raw strings so existing encoded values remain intact. Treat returned URLs as private session credentials; do not publish or commit them.

## Troubleshooting

- **Missing credentials:** check the private file path and both variable names, then restart the MCP client.
- **Login rejected / HTTP 401 or 403:** verify your account with the launcher administrator.
- **Stand, game or currency unavailable:** check the stand, refresh the game list and use values supported by your account.
- **Timeout / request failed:** check connectivity to the launcher. Requests have a 15-second deadline; redirects are rejected. No browser-login fallback is attempted.

## Development and help

```sh
npm test
npm run check
```

Tests use fixture credentials and API responses, including a real stdio client/server exchange. They do not contact the launcher. Dependencies are pinned in `package-lock.json`; no npm package publication is required.

Maintained by [JustIkra](https://github.com/JustIkra). Report problems or propose changes through [issues](https://github.com/JustIkra/zephyr-launcher-mcp/issues) and pull requests. Never attach real credentials or session URLs.
