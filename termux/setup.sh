#!/data/data/com.termux/files/usr/bin/bash
# ClawCC Termux Setup Script
# Installs and configures ClawCC node-agent or CLI client on Android via Termux

set -e

echo "========================================="
echo "  ClawCC Termux Setup"
echo "========================================="
echo ""

# Check we're running in Termux
if [ ! -d "/data/data/com.termux" ]; then
  echo "ERROR: This script must be run inside Termux on Android."
  exit 1
fi

# Install Node.js if not present
if ! command -v node &> /dev/null; then
  echo "[1/4] Installing Node.js..."
  pkg install -y nodejs
else
  echo "[1/4] Node.js already installed: $(node --version)"
fi

# Install git if not present
if ! command -v git &> /dev/null; then
  echo "[2/4] Installing git..."
  pkg install -y git
else
  echo "[2/4] Git already installed"
fi

# Clone or update ClawCC
CLAWCC_DIR="$HOME/clawcc"
if [ -d "$CLAWCC_DIR" ]; then
  echo "[3/4] Updating ClawCC..."
  cd "$CLAWCC_DIR" && git pull
else
  echo "[3/4] Please clone ClawCC to $CLAWCC_DIR manually"
  echo "       git clone <your-repo-url> $CLAWCC_DIR"
fi

# Create config
echo "[4/4] Setting up configuration..."
CONFIG_DIR="$HOME/.config/clawcc"
mkdir -p "$CONFIG_DIR"

if [ ! -f "$CONFIG_DIR/node-agent.config.json" ]; then
  cat > "$CONFIG_DIR/node-agent.config.json" << 'CONF'
{
  "nodeId": "",
  "controlPlaneUrl": "http://YOUR_CONTROL_PLANE:3400",
  "nodeSecret": "CHANGE_ME",
  "tags": ["termux", "mobile"],
  "discoveryPaths": [],
  "telemetryIntervalMs": 15000,
  "heartbeatIntervalMs": 30000,
  "dataDir": "~/clawcc/node-data",
  "allowlistsDir": "~/clawcc/allowlists",
  "spoolDir": "~/clawcc/node-data/spool",
  "logLevel": "info"
}
CONF
  echo ""
  echo "Configuration created at: $CONFIG_DIR/node-agent.config.json"
  echo "Please edit it with your control plane URL and node secret."
else
  echo "Configuration already exists at: $CONFIG_DIR/node-agent.config.json"
fi

echo ""
echo "========================================="
echo "  Setup Complete"
echo "========================================="
echo ""
echo "To run as node agent:"
echo "  cd $CLAWCC_DIR && node node-agent/agent.js"
echo ""
echo "To use CLI:"
echo "  cd $CLAWCC_DIR && node cli/clawcc.js status --host http://YOUR_HOST:3400"
echo ""
echo "Security notes for Termux:"
echo "  - Node agent runs with restricted sandbox defaults"
echo "  - No filesystem discovery paths configured by default"
echo "  - Recommend using Tailscale for secure connectivity"
echo "    pkg install tailscale"
echo ""
