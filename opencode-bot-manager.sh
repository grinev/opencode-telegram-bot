#!/bin/bash
# opencode-bot-manager.sh - Helper script for managing the bot

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR"
COMPOSE_FILE="$PROJECT_DIR/docker-compose.yml"
SERVICE_NAME="opencode-telegram-bot"

cd "$PROJECT_DIR"

case "${1:-help}" in
    start)
        echo "Starting OpenCode Telegram Bot..."
        docker compose up -d
        ;;
    stop)
        echo "Stopping OpenCode Telegram Bot..."
        docker compose down
        ;;
    restart)
        echo "Restarting OpenCode Telegram Bot..."
        docker compose down
        docker compose up -d
        ;;
    logs)
        docker compose logs -f --tail=100 opencode-bot
        ;;
    status)
        docker compose ps
        echo ""
        echo "=== OpenCode health ==="
        docker compose exec -T opencode-bot wget -q --spider http://localhost:4096/api/health && echo "OK" || echo "FAIL"
        ;;
    update)
        echo "Updating OpenCode Telegram Bot..."
        # Check for local changes before git pull
        if ! git diff --quiet || ! git diff --cached --quiet; then
            echo "ERROR: Working tree has uncommitted changes. Aborting update."
            echo "Commit or stash your changes first."
            exit 1
        fi
        git pull --ff-only
        npm ci
        npm run build
        docker compose up -d --build
        echo "Update complete."
        ;;
    rebuild)
        echo "Full rebuild..."
        docker compose down
        docker compose build --no-cache
        docker compose up -d
        ;;
    shell)
        docker compose exec opencode-bot sh
        ;;
    health)
        echo "OpenCode health:"
        docker compose exec -T opencode-bot wget -qO- http://localhost:4096/api/health
        echo ""
        ;;
    *)
        cat <<EOF
OpenCode Telegram Bot Manager

Usage: \$0 <command>

Commands:
  start           Start the bot (docker compose up)
  stop            Stop the bot (docker compose down)
  restart         Restart the bot
  logs            Follow logs (Ctrl+C to exit)
  status          Show container status and OpenCode health
  update          Pull latest code + rebuild, restart (aborts if local changes)
  rebuild         Full rebuild from scratch (no cache)
  shell           Open shell in running container
  health          Check OpenCode health

Examples:
  \$0 start
  \$0 logs
  \$0 update
EOF
        exit 1
        ;;
esac