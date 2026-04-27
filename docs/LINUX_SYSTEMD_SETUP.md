# Linux systemd setup

## 1. Install and configure the bot

```bash
npm install -g @grinev/opencode-telegram-bot@latest
opencode-telegram config
```

## 2. Get the required paths

```bash
which node
which opencode-telegram
dirname "$(which node)"
```

Use these values in the service file:

- `<USER>`: your Linux user
- `<NODE_PATH>`: output of `which node`
- `<OPENCODE_TELEGRAM_PATH>`: output of `which opencode-telegram`
- `<NODE_BIN_DIR>`: output of `dirname "$(which node)"`

## 3. Create the service file

Create `/etc/systemd/system/opencode-telegram-bot.service`:

```ini
[Unit]
Description=OpenCode Telegram Bot
After=network.target

[Service]
Type=simple
User=<USER>
Environment=PATH=<NODE_BIN_DIR>:/usr/local/bin:/usr/bin:/bin
ExecStart=<NODE_PATH> <OPENCODE_TELEGRAM_PATH> start
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

Run the bot in foreground mode. Do not use `--daemon` under `systemd`.

## 4. Enable and start the service

```bash
sudo systemctl daemon-reload
sudo systemctl enable opencode-telegram-bot
sudo systemctl start opencode-telegram-bot
sudo systemctl status opencode-telegram-bot
```

## 5. Optional: auto-restart local OpenCode server

For VPS setups with scheduled tasks, enable the bot's local OpenCode server monitor in the bot `.env` file:

```env
OPENCODE_AUTO_RESTART_ENABLED=true
OPENCODE_MONITOR_INTERVAL_SEC=300
```

This only works when `OPENCODE_API_URL` points to a local address, for example `http://localhost:4096`. The bot starts `opencode serve` with the configured port and checks the server every 300 seconds by default.

## 6. View logs

```bash
sudo journalctl -u opencode-telegram-bot -f
```

## Example

This is a working example for an `nvm`-based setup:

`ExecStart` does not include `start` here because `start` is the default CLI command.

```ini
[Unit]
Description=OpenCode Telegram Bot
After=network.target

[Service]
Type=simple
User=admin
Environment=PATH=/home/admin/.nvm/versions/node/v20.20.2/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/home/admin/.nvm/versions/node/v20.20.2/bin/node /home/admin/.nvm/versions/node/v20.20.2/bin/opencode-telegram
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
```
