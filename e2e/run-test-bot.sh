#!/usr/bin/env bash
# Starts the bot against an isolated home so e2e runs never touch the real
# .env / settings.json / logs of the working copy.
#
# POSIX counterpart of run-test-bot.ps1.
#
# Usage:
#   ./e2e/run-test-bot.sh
#   ./e2e/run-test-bot.sh --skip-build
#   ./e2e/run-test-bot.sh --fault-proxy     # route Bot API calls through e2e/fault-proxy.mjs
#   ./e2e/run-test-bot.sh --forward-proxy socks5h   # reach Telegram through e2e/forward-proxy.mjs
#   ./e2e/run-test-bot.sh --opencode-version v1     # this launch only: OpenCode V1 instead of e2e/.env's version

set -euo pipefail

usage="Usage: $0 [--skip-build] [--fault-proxy] [--forward-proxy <scheme>] [--opencode-version <v1|v2>]"
supported_schemes="socks, socks4, socks4a, socks5, socks5h, http, https"
skip_build=0
fault_proxy=0
use_forward_proxy=0
forward_proxy=""
opencode_version=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --skip-build) skip_build=1 ;;
    --fault-proxy) fault_proxy=1 ;;
    --forward-proxy)
      if [ "$#" -lt 2 ]; then
        echo "--forward-proxy needs a scheme. Supported: $supported_schemes." >&2
        exit 2
      fi
      use_forward_proxy=1
      forward_proxy="$2"
      shift
      ;;
    --opencode-version)
      if [ "$#" -lt 2 ]; then
        echo "--opencode-version needs a version. Supported: v1, v2." >&2
        exit 2
      fi
      opencode_version="$2"
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "$usage" >&2
      exit 2
      ;;
  esac
  shift
done

# Case-sensitive on purpose: the proxy and the bot's agents only know lowercase schemes.
if [ "$use_forward_proxy" -eq 1 ]; then
  case "$forward_proxy" in
    socks | socks4 | socks4a | socks5 | socks5h | http | https) ;;
    *)
      echo "Unknown --forward-proxy scheme '$forward_proxy'. Supported: $supported_schemes." >&2
      exit 2
      ;;
  esac
fi

case "$opencode_version" in
  "" | v1 | v2) ;;
  *)
    echo "Unknown --opencode-version '$opencode_version'. Supported: v1, v2." >&2
    exit 2
    ;;
esac

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(dirname "$script_dir")"
test_home="$project_root/.tmp/e2e/home"
source_env="$script_dir/.env"
runtime_env="$test_home/.env"
proxy_dir="$project_root/.tmp/e2e/fault-proxy"
proxy_pid_file="$proxy_dir/proxy.pid"
proxy_port=8765
proxy_root="http://127.0.0.1:$proxy_port"
forward_dir="$project_root/.tmp/e2e/forward-proxy"
forward_pid_file="$forward_dir/proxy.pid"
forward_port=8766
forward_proxy_url="$forward_proxy://127.0.0.1:$forward_port"
opencode_state_home="$project_root/.tmp/e2e/opencode-state"

test_env_value() {
  grep -E "^[[:space:]]*$1[[:space:]]*=" "$source_env" | tail -n 1 |
    sed -e "s/^[[:space:]]*$1[[:space:]]*=[[:space:]]*//" -e 's/[[:space:]]*$//' \
      -e "s/^[\"']//" -e "s/[\"']\$//" || true
}

# Usage: stop_leftover_proxy <pid file> <script name> <label>
stop_leftover_proxy() {
  [ -f "$1" ] || return 0
  local leftover_pid args
  leftover_pid="$(tr -d '[:space:]' < "$1")"
  if [ -n "$leftover_pid" ] && kill -0 "$leftover_pid" 2>/dev/null; then
    args="$(ps -p "$leftover_pid" -o args= 2>/dev/null || true)"
    case "$args" in
      *"$2"*)
        echo "Stopping $3 left from a previous launch: PID $leftover_pid"
        kill "$leftover_pid" 2>/dev/null || true
        ;;
    esac
  fi
  rm -f "$1"
}

if [ ! -d "$test_home" ]; then
  mkdir -p "$test_home"
  echo "Created test home: $test_home"
fi

if [ ! -f "$source_env" ]; then
  cp "$script_dir/.env.example" "$source_env"
  echo "Created $source_env from e2e/.env.example."
  echo "Fill in TELEGRAM_BOT_TOKEN and TELEGRAM_ALLOWED_USER_ID, then run again."
  exit 1
fi

# e2e/.env is the single source of truth. The test home holds runtime state
# only (settings.json, logs), so the config is re-synced on every launch.
cp "$source_env" "$runtime_env"

# dotenv does not override variables that already exist in the environment, so
# anything inherited from the parent shell would silently win over the test
# config. Clear every key the test .env defines.
while IFS= read -r line; do
  case "$line" in
    [A-Za-z_]*=*) unset "${line%%=*}" 2>/dev/null || true ;;
  esac
done < "$runtime_env"

# The bot rejects TELEGRAM_PROXY_URL together with TELEGRAM_API_ROOT, and the
# fault proxy cannot tunnel through a SOCKS/HTTP proxy itself.
if [ "$fault_proxy" -eq 1 ] && [ -n "$(test_env_value TELEGRAM_PROXY_URL)" ]; then
  echo "--fault-proxy cannot be used while e2e/.env sets TELEGRAM_PROXY_URL." >&2
  exit 1
fi

if [ "$use_forward_proxy" -eq 1 ]; then
  if [ "$fault_proxy" -eq 1 ]; then
    echo "--forward-proxy cannot be combined with --fault-proxy." >&2
    exit 1
  fi
  # The launcher owns TELEGRAM_PROXY_URL in this mode, and the bot rejects it
  # together with TELEGRAM_API_ROOT. Whatever is still in the environment after
  # the clearing above was inherited from the caller.
  for name in TELEGRAM_PROXY_URL TELEGRAM_API_ROOT; do
    if [ -n "$(test_env_value "$name")" ] || [ -n "${!name:-}" ]; then
      echo "--forward-proxy cannot be used while $name is set in e2e/.env or the environment." >&2
      exit 1
    fi
  done
fi

# e2e/.env names the stand's OpenCode version; --opencode-version overrides it for this
# launch. The bot's own default is v1.
effective_opencode_version="$opencode_version"
[ -n "$effective_opencode_version" ] || effective_opencode_version="$(test_env_value OPENCODE_SERVER_VERSION)"
[ -n "$effective_opencode_version" ] || effective_opencode_version="v1"

# The V2 background server takes its password from the user's OpenCode config
# (service.json), and the bot must send the same one.
opencode_password=""
if [ "$effective_opencode_version" = "v2" ]; then
  service_config="${XDG_CONFIG_HOME:-$HOME/.config}/opencode/service.json"
  if [ -f "$service_config" ]; then
    opencode_password="$(node -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).password ?? ""))' "$service_config")"
  fi
  if [ -z "$opencode_password" ]; then
    echo "OpenCode V2 needs a server password, and $service_config has none. Set one with 'opencode service set password <value>'." >&2
    exit 1
  fi
fi

# The bot starts `opencode` from PATH, so the chosen version's bin goes first: both
# versions install an `opencode` command.
if [ "$effective_opencode_version" = "v2" ]; then opencode_package="@opencode/cli"; else opencode_package="opencode-ai"; fi
opencode_bin="$(npm root -g)/$opencode_package/bin"
if [ ! -e "$opencode_bin/opencode" ]; then
  echo "No global npm install of $opencode_package found; the bot starts whichever opencode is on PATH." >&2
  opencode_bin=""
fi

if [ "$skip_build" -eq 0 ]; then
  echo "Building..."
  (cd "$project_root" && npm run build)
fi

export OPENCODE_TELEGRAM_HOME="$test_home"

# exec below replaces this shell, so these reach the bot process only.
[ -z "$opencode_bin" ] || export PATH="$opencode_bin:$PATH"
[ -z "$opencode_version" ] || export OPENCODE_SERVER_VERSION="$opencode_version"
if [ "$effective_opencode_version" = "v2" ]; then
  export OPENCODE_SERVER_PASSWORD="$opencode_password"
  # V2 keeps one registered background server per user, recorded under XDG_STATE_HOME.
  # A state home of the stand's own keeps its server from replacing the user's one.
  export XDG_STATE_HOME="$opencode_state_home"
  # V2 reads OPENCODE_CONFIG_DIR instead of ~/.config/opencode, not on top of it: a
  # directory inherited from the caller would hide the user's config and its password.
  unset OPENCODE_CONFIG_DIR
fi

if [ "$fault_proxy" -eq 1 ]; then
  stop_leftover_proxy "$proxy_pid_file" fault-proxy.mjs "fault proxy"
  mkdir -p "$proxy_dir"

  # A stand that reaches Telegram through its own reverse proxy keeps doing so:
  # that root becomes the fault proxy's upstream.
  upstream="$(test_env_value TELEGRAM_API_ROOT)"
  [ -n "$upstream" ] || upstream="https://api.telegram.org"

  proxy_output="$proxy_dir/proxy-output.log"
  nohup node "$script_dir/fault-proxy.mjs" --port "$proxy_port" --upstream "$upstream" \
    > "$proxy_output" 2>&1 &

  ready=0
  for _ in $(seq 1 20); do
    if node -e "fetch('$proxy_root/__fault/state').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"; then
      ready=1
      break
    fi
    sleep 0.25
  done
  if [ "$ready" -eq 0 ]; then
    echo "Fault proxy did not come up on port $proxy_port. See $proxy_output" >&2
    exit 1
  fi

  # exec below replaces this shell, so the variable reaches the bot process only.
  export TELEGRAM_API_ROOT="$proxy_root"
fi

if [ "$use_forward_proxy" -eq 1 ]; then
  stop_leftover_proxy "$forward_pid_file" forward-proxy.mjs "forward proxy"
  mkdir -p "$forward_dir"

  # Readiness is the pid file the proxy writes once it listens: a probe
  # connection would land in its connection log.
  forward_output="$forward_dir/proxy-output.log"
  nohup node "$script_dir/forward-proxy.mjs" --scheme "$forward_proxy" --port "$forward_port" \
    > "$forward_output" 2>&1 &
  forward_pid=$!

  ready=0
  for _ in $(seq 1 20); do
    kill -0 "$forward_pid" 2>/dev/null || break
    if [ -f "$forward_pid_file" ]; then
      ready=1
      break
    fi
    sleep 0.25
  done
  if [ "$ready" -eq 0 ]; then
    kill "$forward_pid" 2>/dev/null || true
    echo "Forward proxy did not come up on port $forward_port. See $forward_output" >&2
    exit 1
  fi

  # The bot below runs as a child, so these reach the bot process only.
  export TELEGRAM_PROXY_URL="$forward_proxy_url"
  if [ "$forward_proxy" = "https" ]; then
    # The https proxy presents the committed test certificate; only this launch trusts it.
    export NODE_EXTRA_CA_CERTS="$script_dir/forward-proxy-test-only.crt"
  fi
fi

echo
echo "Test home : $test_home"
echo "Logs      : $test_home/logs"
echo "Settings  : $test_home/settings.json"
echo "OpenCode  : $effective_opencode_version (${opencode_bin:-opencode on PATH})"
if [ "$effective_opencode_version" = "v2" ]; then
  echo "OC state  : $opencode_state_home"
fi
if [ "$fault_proxy" -eq 1 ]; then
  echo "Proxy     : $proxy_root -> $upstream (control: $proxy_root/__fault/state)"
  echo "Call log  : $proxy_dir"
fi
if [ "$use_forward_proxy" -eq 1 ]; then
  echo "Proxy     : $forward_proxy forward proxy on 127.0.0.1:$forward_port"
  echo "Bot env   : TELEGRAM_PROXY_URL=$forward_proxy_url"
  echo "Conn log  : $forward_dir"
fi
echo

if [ "$use_forward_proxy" -eq 1 ]; then
  # Not exec: this shell stays to stop the forward proxy when the bot exits for any
  # reason, so a bot that fails to start leaves nothing behind.
  stop_forward_proxy() {
    kill "$forward_pid" 2>/dev/null || true
    rm -f "$forward_pid_file"
  }
  trap stop_forward_proxy EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  node "$project_root/dist/index.js"
  exit 0
fi

exec node "$project_root/dist/index.js"
