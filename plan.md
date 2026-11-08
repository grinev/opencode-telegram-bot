# Telegram OpenCode Service Plan

## Goal

Deploy two containers in the existing Docker Swarm:

1. A multifunctional Telegram bot on the remote VPS node.
2. A LAN gateway on a node selected by a configurable deployment constraint.

The bot should let one authorized Telegram user operate OpenCode running on a LAN computer. If the computer is powered off, the gateway should wake it, wait for OpenCode to become available, and then proxy the OpenCode connection.

The bot should also provide an extensible command layer and report monitoring failures in the future.

## Existing Environment

- The deployment uses a Docker Swarm stack definition.
- The deployment provides an external overlay network for bot-to-gateway traffic.
- The LAN-capable node is selected by deployment configuration.

- The LAN connection available to the gateway is a configurable external macvlan network.
- The Telegram bot runs on the remote VPS node in the same Swarm.
- No public web service or webhook endpoint is required. Telegram long polling is preferred.
- The target computer runs the configured OpenCode V1 server.

## Architecture

```text
Telegram
   |
   | Telegram long polling
   v
Bot container on VPS
   |
   | authenticated Docker overlay request
   v
LAN gateway on a configured LAN-capable node
   |\\
   | \\ external macvlan LAN connection
   |  \\
   |   Target computer running the configured OpenCode V1 server
   |
   +-- Wake-on-LAN
   +-- readiness checks
   +-- OpenCode HTTP/SSE reverse proxy
```

### Bot container

Use the maintained fork [`ilyapavkin/opencode-telegram-bot`](https://github.com/ilyapavkin/opencode-telegram-bot) as the OpenCode and Telegram foundation. The fork was created from upstream [`grinev/opencode-telegram-bot`](https://github.com/grinev/opencode-telegram-bot), which is MIT-licensed.

The initial baseline is upstream release `v0.27.0` at commit `ec6eb5c3c9fbe9c6e6a1d5ec967b8dda45d70d01`. Keep the upstream repository as a separate Git remote named `upstream`, and merge upstream updates deliberately rather than tracking `main` implicitly.

The bot will:

- Poll Telegram without requiring an inbound public port.
- Accept messages only from the configured Telegram user ID.
- Send OpenCode API requests to the gateway over the Swarm overlay.
- Preserve upstream OpenCode sessions, streaming, attachments, and interaction features.
- Add a local command registry for service-specific commands.
- Run a background monitoring scheduler and send deduplicated alerts.

### LAN gateway container

The gateway will be a small custom service with two network attachments:

- The deployment-provided external overlay network.
- A configurable external macvlan network with LAN reachability.

It will:

- Accept only authenticated requests from the bot.
- Send Wake-on-LAN packets to the configured target MAC address and broadcast address.
- Poll the configured target IP and OpenCode port until ready.
- Proxy OpenCode V1 HTTP and streaming requests to the target.
- Expose a non-waking health endpoint.
- Expose narrow status and wake operations for future bot commands.
- Never publish a host port to the Internet.

## Request Flow

### OpenCode request while the computer is online

1. The user sends a normal message through Telegram.
2. The bot sends the request to the gateway over the overlay network.
3. The gateway verifies the shared secret.
4. The gateway checks or proxies the request to the target OpenCode server.
5. OpenCode responses and streaming events return through the gateway to Telegram.

### OpenCode request while the computer is offline

1. The gateway detects that the target is unavailable.
2. The gateway sends a Wake-on-LAN magic packet.
3. The gateway waits for the configured target IP and port, using bounded retries and a timeout.
4. Once OpenCode is ready, the original request is proxied.
5. The bot reports a clear failure if the timeout expires.

Concurrent wake requests must share one readiness operation so a burst of messages does not generate uncontrolled wake attempts.

## Bot Commands

Initial service commands should include:

- `/help`: list bot and OpenCode commands.
- `/wake`: wake the target and wait for OpenCode readiness.
- `/status`: show bot, gateway, target, and OpenCode state.
- `/monitor`: show configured monitoring checks and current state.
- `/alerts`: show recent unresolved or recently resolved alerts.

Normal text messages continue to be sent to OpenCode.

Future commands must be explicit operations implemented in the command registry. Do not add unrestricted Telegram-to-shell execution.

## Monitoring Design

The bot should periodically query authenticated gateway status endpoints and maintain a small persistent alert state.

Initial checks:

- Gateway reachable.
- Target computer reachable.
- OpenCode API reachable.
- Wake-up duration within the configured timeout.

Alert behavior:

- Send one alert when a check changes from healthy to unhealthy.
- Suppress repeated alerts during the same outage.
- Send a recovery message when the check becomes healthy again.
- Persist enough state to avoid alert storms after a bot restart.
- Use configurable polling intervals and cooldowns.

The monitoring layer should use read-only gateway endpoints and should not require access to the Docker socket.

## Configuration

Values that identify the LAN and target must be configurable:

```text
LAN_MACVLAN_NETWORK
TARGET_MAC_ADDRESS
TARGET_IP_ADDRESS
TARGET_OPENCODE_PORT=4096
WOL_BROADCAST_ADDRESS
WOL_INTERFACE
GATEWAY_SHARED_SECRET
```

Bot configuration should include:

```text
TELEGRAM_BOT_TOKEN
TELEGRAM_ALLOWED_USER_ID
OPENCODE_SERVER_VERSION=v1
OPENCODE_API_URL=http://gateway:4096
```

All tokens, passwords, and shared secrets must be supplied through Docker secrets or runtime secret files. They must not be committed to Git.

The gateway placement constraint is deployment-configurable.

The macvlan network name, target MAC, target IP, broadcast address, and interface remain deployment configuration.

## Security Requirements

- Whitelist exactly one Telegram user ID by default.
- Authenticate every bot-to-gateway request with a Docker secret.
- Keep the gateway on the private overlay and LAN networks only.
- Do not expose the gateway through Traefik or a published host port.
- Allow the gateway to proxy only the configured OpenCode target and port.
- Do not accept arbitrary destination addresses from Telegram commands.
- Do not implement generic shell command execution.
- Bound wake and readiness timeouts.
- Validate all configuration at startup and fail clearly on invalid MAC, IP, port, or network settings.
- Log operational events without logging Telegram tokens, gateway secrets, or OpenCode credentials.

## Repository Changes

Planned files and changes:

- `gateway/`: gateway source, configuration, WOL logic, readiness checks, proxy, and tests.
- `gateway/Dockerfile`: reproducible gateway image.
- Maintained bot fork: `https://github.com/ilyapavkin/opencode-telegram-bot`.
- Bot fork changes: custom commands, gateway authentication, and monitoring.
- Swarm deployment configuration for both services.
- Docker secret declarations and deployment documentation.
- `README.md`: setup, deployment, configuration, troubleshooting, and upgrade notes.
- Tests for protocol authentication, readiness state transitions, WOL behavior, proxying, command authorization, and alert deduplication.

Because Swarm stack deployment does not build images automatically, the bot and gateway images must be built and made available on the target nodes before deployment. Image references should be configurable and pinned in the stack; registry publication can be added later.

## Implementation Phases

1. Confirm the upstream bot release and inspect its extension points.
2. Implement and test the gateway configuration and authentication.
3. Implement Wake-on-LAN and readiness polling with concurrency control.
4. Implement the OpenCode V1 HTTP/SSE proxy.
5. Add the multifunctional bot command layer while preserving upstream OpenCode behavior.
6. Add monitoring checks, persistent alert state, cooldowns, and recovery notifications.
7. Add Swarm placement, overlay, macvlan, secrets, health checks, and pinned images.
8. Document macvlan prerequisites and deployment commands.
9. Run unit tests, container builds, Compose validation, and an end-to-end test against a reachable configured OpenCode V1 server.

## Verification Criteria

- Both services start on their intended Swarm nodes.
- The gateway has overlay and macvlan connectivity.
- The gateway health endpoint does not wake the target.
- `/wake` sends a valid magic packet and reports timeout or readiness correctly.
- An OpenCode request wakes the target when necessary and is eventually proxied.
- OpenCode streaming responses work through the gateway.
- Requests with invalid gateway credentials are rejected.
- Unauthorized Telegram users cannot invoke commands or OpenCode.
- Repeated concurrent requests share one wake/readiness operation.
- Monitoring sends one failure alert and one recovery alert, not repeated messages.
- No service requires a public inbound port.
- Secrets do not appear in Git, image layers, or normal logs.
