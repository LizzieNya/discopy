#!/bin/bash
echo "🚀 Starting Discopy Setup for Oracle Linux..."

echo "📦 1. Installing Node.js 20 and Unzip..."
curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
sudo dnf install -y nodejs unzip

echo "🛡️ 2. Opening Port 3000 in Linux Firewall (firewalld)..."
sudo firewall-cmd --zone=public --add-port=3000/tcp --permanent
sudo firewall-cmd --reload

echo "⚙️ 3. Installing PM2 (to keep the bot online 24/7)..."
sudo npm install -g pm2
sudo env PATH=$PATH:/usr/bin /usr/lib/node_modules/pm2/bin/pm2 startup systemd -u opc --hp /home/opc

echo "✅ Setup Complete!"
echo "----------------------------------------------------"
echo "NEXT STEPS:"
echo "1. Upload your 'discopy_deploy.zip' file to the server."
echo "2. Unzip it: unzip discopy_deploy.zip"
echo "3. Run: npm install"
echo "4. Copy .env.example to .env and fill in your tokens."
echo "5. Start it: pm2 start index.js --name 'discopy' && pm2 save"
