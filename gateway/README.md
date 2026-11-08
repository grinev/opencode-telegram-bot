# OpenCode LAN Gateway

The gateway is a small authenticated HTTP service that runs on the LAN-capable
Swarm node. It exposes the OpenCode V1 API through the private overlay network,
wakes a configured computer when necessary, and waits for OpenCode to become
ready before forwarding requests.

## Endpoints

- `GET /health/live` is unauthenticated and never contacts the target.
- `GET /status` requires `X-Gateway-Secret` and performs a read-only readiness check.
- `POST /wake` requires `X-Gateway-Secret`, sends Wake-on-LAN when needed, and waits for readiness.
- Every other path requires `X-Gateway-Secret` and is proxied to the fixed target OpenCode server.

The proxy preserves HTTP responses and SSE streams. It removes the gateway
secret before forwarding the request and never accepts a destination address
from the client.

## Configuration

Copy `.env.example` and set the target IP, MAC address, broadcast address, and
shared secret. In production, provide the shared secret as the Docker secret
`/run/secrets/gateway_shared_secret`, or set `GATEWAY_SHARED_SECRET_FILE` to a
different secret-file path. The environment variable is intended for local
development only.

Run locally with:

```bash
npm ci
npm run build
node dist/index.js
```

The target must expose the OpenCode V1 health route at
`http://TARGET_IP_ADDRESS:TARGET_OPENCODE_PORT/global/health`.
