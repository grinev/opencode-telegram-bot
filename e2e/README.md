# Browser-driven e2e checks

Drives the real bot through Telegram Web with Playwright MCP — no MTProto, no API
credentials. A persistent browser profile keeps the web session logged in.

Running the checks is the job of the `manual-tester` subagent
(`.claude/agents/manual-tester.md`). This file covers the one-time setup
a human does first.

## Files

| Path | What it is |
| --- | --- |
| `.env` | Test config you edit. Copied into the test home on every launch |
| `.env.example` | Template |
| `run-test-bot.ps1` / `.sh` | Starts the bot against an isolated home |
| `stop-test-bot.ps1` / `.sh` | Stops the test bot, its OpenCode server and the fault or forward proxy |
| `fault-proxy.mjs` | Fault-injection proxy in front of the Telegram Bot API |
| `fault-proxy.md` | How to launch and drive the fault proxy |
| `forward-proxy.mjs` | Local SOCKS / HTTP(S) forward proxy for `TELEGRAM_PROXY_URL` checks |
| `forward-proxy-test-only.crt` / `.key` | Public test certificate of the `https` forward proxy |
| `probes.js` | DOM probes and confirmed Telegram Web selectors |
| `scenarios/` | Regression scenarios the subagent runs before any feature check |
| `.tmp/e2e/home/` | Runtime state: `settings.json`, `logs/` |
| `.tmp/e2e/opencode-state/` | The stand's OpenCode V2 state: its background server registration |
| `.tmp/e2e/fault-proxy/` | Fault proxy call logs and pid file |
| `.tmp/e2e/forward-proxy/` | Forward proxy connection logs and pid file |
| `.tmp/e2e/browser-profile/` | Persistent Telegram Web login |
| `e2e/output/` | Screenshots and console logs the subagent produces |

## One-time setup

1. **Test bot.** Create a separate bot with @BotFather. Do not use your
   production token — these runs create sessions and switch projects.

2. **Config.** Run `.\e2e\run-test-bot.ps1` once; it creates `e2e/.env` from the
   template and exits. Fill in `TELEGRAM_BOT_TOKEN` and
   `TELEGRAM_ALLOWED_USER_ID`, then run it again.

   Keep `BOT_LOCALE=en` — the probes match bot strings literally.

3. **Browser session.** The Playwright MCP server is declared inside the
   subagent, so the browser only exists while the subagent runs. Ask it to open
   `https://web.telegram.org/k/`, then scan the QR code from your phone once.
   Keep the Telegram Web interface in English. The session survives restarts;
   re-login is needed only every few months.

   Only one process at a time may use the browser profile. If a browser is
   already open on it, the subagent will fail with a profile-lock error.

4. **Update the peer id.** The subagent opens the chat by
   `data-peer-id`. If you use a different test bot, update that id in
   `.claude/agents/manual-tester.md`.

## Running

```powershell
.\e2e\run-test-bot.ps1                # Windows
```

```bash
./e2e/run-test-bot.sh                 # macOS / Linux
```

It builds first and refuses to start on a compile error. Add `-SkipBuild` /
`--skip-build` only when you know `dist/` is already current — the subagent never
does, since it is called right after the code changed.

Everything stays inside `.tmp/e2e/home`, so your real `.env`, `settings.json`
and `logs/` are untouched. Logs land in `.tmp/e2e/home/logs/`, one file per
launch.

OpenCode runs on the port from `OPENCODE_API_URL` in `e2e/.env` (4097 by
default) so test runs never collide with your own OpenCode (V1 on 4096, the V2
background server on 49374).

### OpenCode V1 and V2

The stand runs OpenCode V2 by default (`OPENCODE_SERVER_VERSION=v2` in
`e2e/.env`). One launch runs V1 instead with:

```powershell
.\e2e\run-test-bot.ps1 -OpencodeVersion v1       # Windows
```

```bash
./e2e/run-test-bot.sh --opencode-version v1      # macOS / Linux
```

Both versions use the same test port and are started from the chat with
`/opencode_start`. For the bot process only, the launcher:

- puts the chosen version's global npm `bin` first on PATH (`@opencode/cli` for
  V2, `opencode-ai` for V1), since both install an `opencode` command and the bot
  starts whichever comes first. Without that install it warns and leaves PATH as is;
- on V2, sets `XDG_STATE_HOME=.tmp/e2e/opencode-state`. V2 keeps one registered
  background server per user, recorded there; a registration of the stand's own
  keeps `/opencode_start` on 4097 from replacing your server on 49374. The
  sessions database stays the shared one in `~/.local/share/opencode`, as on V1;
- on V2, gives the bot `OPENCODE_SERVER_PASSWORD` from
  `~/.config/opencode/service.json`, the file the V2 background server takes its
  password from, and clears `OPENCODE_CONFIG_DIR`, which V2 reads instead of
  `~/.config/opencode` rather than on top of it. The launch is refused when that
  file has no password: set one with `opencode service set password <value>`.

`/status` names the running version. Sessions are not shared between the
versions, so after a switch the bot may drop its saved session.

When done:

```powershell
.\e2e\stop-test-bot.ps1               # Windows
```

```bash
./e2e/stop-test-bot.sh                # macOS / Linux
```

The subagent runs this itself at the end of every session. It only stops what
the test setup started: the OpenCode server on the configured test port, bot
processes whose pid appears in a `.tmp/e2e/home/logs` file name, and the fault
or forward proxy named in `.tmp/e2e/fault-proxy/proxy.pid` or
`.tmp/e2e/forward-proxy/proxy.pid`.

The `.sh` scripts need the executable bit once they are committed:
`git update-index --chmod=+x e2e/run-test-bot.sh e2e/stop-test-bot.sh`

## Fault-injection proxy

[`fault-proxy.mjs`](./fault-proxy.mjs) is a local proxy in front of the Telegram Bot
API. It breaks the channel between the bot and Telegram on purpose. Start the stand
with `-FaultProxy` / `--fault-proxy` and switch faults on and off at runtime:

- dropped connections, hangs, Bot API errors (429, 400, 403, 5xx, …), latency;
- "Telegram received it, the bot never learned";
- the named scenarios `drop-send`, `blackout` and `no-duplicate`.

A fault can target specific methods, call numbers or payloads. Every call is logged,
with per-method counters. Without the flag nothing changes.

Launch, control API, rule shape and log format:
[`fault-proxy.md`](./fault-proxy.md).

## Forward proxy

[`forward-proxy.mjs`](./forward-proxy.mjs) is a local forward proxy for checking how
the bot reaches Telegram through `TELEGRAM_PROXY_URL`. It needs no external proxy
server and no dependency. Start the stand with one scheme:

```powershell
.\e2e\run-test-bot.ps1 -ForwardProxy socks5h     # Windows
```

```bash
./e2e/run-test-bot.sh --forward-proxy socks5h    # macOS / Linux
```

The launcher starts the proxy on `127.0.0.1:8766` and gives the bot process, and
only it, `TELEGRAM_PROXY_URL=<scheme>://127.0.0.1:8766`. Both addresses are printed
at startup. The proxy stops together with the bot, including when the bot fails
to start; `stop-test-bot` stops it as well. The mode is refused before anything
starts when combined with `-FaultProxy`, or when `TELEGRAM_PROXY_URL` or
`TELEGRAM_API_ROOT` is set in `e2e/.env` or the environment. An unknown scheme is
refused with the supported list. Schemes are lowercase only.

| Scheme | Protocol the proxy speaks | Destination names resolved by | Destinations accepted |
| --- | --- | --- | --- |
| `socks` | SOCKS5, no auth | the proxy | name, IPv4, IPv6 |
| `socks4` | SOCKS4 | the bot | IPv4 only |
| `socks4a` | SOCKS4a | the proxy | name, IPv4 |
| `socks5` | SOCKS5, no auth | the bot | IPv4, IPv6 |
| `socks5h` | SOCKS5, no auth | the proxy | name, IPv4, IPv6 |
| `http` | HTTP `CONNECT` | the proxy | name, IPv4, IPv6 |
| `https` | HTTP `CONNECT` over TLS | the proxy | name, IPv4, IPv6 |

Only `CONNECT` is implemented: no SOCKS BIND or UDP, no proxy authentication, and no
plain (non-`CONNECT`) HTTP forwarding. A `socks4` bot that resolves the Telegram host
to IPv6 fails before it reaches the proxy, because SOCKS4 carries IPv4 only.

**Diagnostics.** Each launch writes `.tmp/e2e/forward-proxy/connections-<time>.jsonl`,
one record per event:

- `tunnel-opened`: the protocol the client used and the destination it asked for;
- `tunnel-closed`: bytes each way and the duration;
- `rejected`: the reason. `protocol-mismatch` names the `expected` protocol and the
  one `detected` from the client's first byte. A name sent to `socks4`/`socks5`,
  whose clients must resolve names themselves, is a mismatch as well. Other reasons:
  `tls-handshake-failed`, `upstream-error`, `unsupported-method`,
  `unsupported-command`, `unsupported-auth`, `bad-request`.

The log never holds payloads, request paths or the bot token. Bot API traffic stays
TLS end to end between the bot and Telegram inside the tunnel. The proxy's stdout
goes to `proxy-output.log` in the same folder on macOS / Linux.

**Test certificate.** The `https` scheme presents
`forward-proxy-test-only.crt`, a self-signed leaf for `127.0.0.1` only. It is not a
CA, so its committed private key cannot sign anything else. The launcher trusts it
through `NODE_EXTRA_CA_CERTS` for the test-bot process only; a value you had there
is replaced for that launch and restored afterwards. The OpenCode server the test
bot starts inherits the variable, as it inherits `TELEGRAM_PROXY_URL`. The pair was
generated once, valid until 2126, with:

```bash
cat > cert.cnf <<'EOF'
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = opencode-telegram-bot e2e forward proxy (TEST ONLY)
[ext]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature
extendedKeyUsage = serverAuth
subjectAltName = IP:127.0.0.1
EOF
openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 36500 \
  -config cert.cnf -keyout forward-proxy-test-only.key -out forward-proxy-test-only.crt
```

A config file rather than `-addext`: the latter keeps the default `CA:TRUE` next to
it. Both files then get a plain-text header marking them as a test credential.

**File downloads.** Every supported scheme carries text, voice, photos, documents,
and media groups. A `protocol-mismatch` in the connection log means the bot used the
wrong proxy client for that scheme.

**Automated tests.** `tests/e2e/forward-proxy.test.ts` runs every scheme through
the bot's own proxy agents against a local upstream. `tests/e2e/run-test-bot.test.ts`
covers the launcher's up-front refusals. Launcher behaviour is tested by spawning the
real launcher from a temporary copy of `e2e/` with a fake `.env`, the PowerShell
launcher on Windows and the shell launcher elsewhere. Its checks stay written inline
in each launcher, and every test asserts its specific message.

## Maintenance

Telegram Web changes class names between releases. When probes stop matching,
run the `discoverSelectors` probe from `probes.js` against a live chat and fix
the constants there. The selectors were last calibrated on 2026-07-27.

`@playwright/mcp` is pinned in the subagent's `mcpServers` frontmatter because a
newer release may require a newer Chromium revision than the one installed
locally. Screenshots go to `e2e/output/` (gitignored). Claude sets `--output-dir`
on the tester's `mcpServers`; OpenCode uses `.opencode/opencode.json`; OMP
picks Codex `.codex/config.toml` over OpenCode for the same server name.

## What to test

`scenarios/` holds the regression scenarios. The subagent runs them before any
feature check, so a change that breaks the basic loop is caught before anything
else is judged. Today there is one, [`smoke.md`](./scenarios/smoke.md) — longer
scenarios get added as separate files next to it.

The feature scenario itself is passed to the subagent per task, as behaviour
only: it gets no diff and no implementation detail, and writes its own cases.
Commands, features, and interaction routing rules are documented in
[`PRODUCT.md`](../PRODUCT.md).
