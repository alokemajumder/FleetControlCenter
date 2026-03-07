# ClawCC Termux Module

Run ClawCC node-agent or CLI on Android via Termux.

## Prerequisites

- [Termux](https://f-droid.org/packages/com.termux/) installed from F-Droid
- Node.js 18+ (installed via `pkg install nodejs`)

## Quick Setup

```bash
# In Termux:
bash setup.sh
```

## Running as Node Agent

Registers your Android device as a fleet node:

```bash
cd ~/clawcc
node node-agent/agent.js
```

The default Termux config has:
- No filesystem discovery (safe by default)
- Extended heartbeat intervals (battery-friendly)
- `termux` and `mobile` tags for policy targeting

## Running as CLI Client

```bash
cd ~/clawcc
node cli/clawcc.js status --host http://your-control-plane:3400
node cli/clawcc.js feed --host http://your-control-plane:3400
```

## Tailscale on Termux

For secure connectivity without exposing ports:

```bash
pkg install tailscale
tailscaled &
tailscale up
```

Then use your Tailscale IP as the control plane URL.

## Security Notes

- The Termux node agent runs with the most restrictive sandbox defaults
- No shell commands are enabled by default in the Termux allowlist
- Filesystem access is disabled by default
- All communication should go over Tailscale or HTTPS
