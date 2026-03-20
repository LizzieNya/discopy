# 📸 Discopy — Discord Channel Image Downloader

A Discord bot that downloads **all photos** from any channel in your server.

## Features

- 🖼️ Downloads all image attachments (PNG, JPG, GIF, WebP, etc.)
- 🔗 Captures images from embeds too (thumbnails, image embeds)
- 📁 Organized by server name and channel name
- ⏭️ Skips already-downloaded files (safe to re-run)
- 📊 Live progress updates in Discord
- 🛑 Cancel downloads mid-way with `/cancel`
- 📈 View active downloads with `/stats`

## Setup

### 1. Create a Discord Bot

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** → give it a name → **Create**
3. Go to the **"Bot"** tab → click **"Reset Token"** → copy the token
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **Message Content Intent**
5. Go to the **"OAuth2"** tab → **"URL Generator"**:
   - Scopes: `bot`, `applications.commands`
   - Bot Permissions: `Read Messages/View Channels`, `Read Message History`, `Send Messages`
6. Copy the generated URL and open it in your browser to invite the bot to your server

### 2. Install & Configure

```bash
cd discopy
npm install
```

Copy the example env file and add your token:

```bash
copy .env.example .env
```

Edit `.env` and paste your bot token:

```
DISCORD_TOKEN=your_actual_token_here
```

### 3. Run

```bash
npm start
```

## Usage

| Command | Description |
|---------|-------------|
| `/download` | Download all images from the current channel |
| `/download channel:#general` | Download all images from a specific channel |
| `/cancel` | Cancel the active download in this channel |
| `/stats` | Show all active downloads |

## Where are images saved?

Images are saved to:

```
discopy/
  downloads/
    Server Name/
      channel-name/
        image1.png
        image2.jpg
        ...
```

## Notes

- The bot needs **Read Message History** permission in the target channel
- Large channels (100k+ messages) may take a while — progress is shown live
- Already-downloaded files are skipped, so it's safe to run multiple times
- Rate limiting is handled automatically
