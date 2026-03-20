#!/bin/bash
# ──────────────────────────────────────────────────
# Oracle Cloud VM Setup Script for Discopy
# Run this ONCE after SSH-ing into your free VM
# ──────────────────────────────────────────────────

echo "📦 Updating system..."
sudo apt update && sudo apt upgrade -y

echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

echo "📦 Installing Git..."
sudo apt install -y git

echo "📂 Cloning your bot..."
# Replace with YOUR GitHub repo URL
git clone https://github.com/YOUR_USERNAME/discopy.git
cd discopy

echo "📦 Installing dependencies..."
npm install

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit your .env file:  nano .env"
echo "     Add your bot token:   DISCORD_TOKEN=your_token_here"
echo "  2. Start the bot:        sudo npm install -g pm2 && pm2 start index.js --name discopy"
echo "  3. Auto-start on reboot: pm2 save && pm2 startup"
echo ""
