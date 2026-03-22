# 📸 Discopy — Discord Channel Media Downloader

A Discord bot + CLI tool that downloads **all photos and videos** from any channel. Users install it to their **account** and use it anywhere — if the bot isn't in a server, the local CLI grabs the media instead.

## Features

- 🖼️ Downloads all image and video attachments (PNG, JPG, MP4, WebM, etc.)
- 🔗 Captures media from embeds too (thumbnails, image/video embeds)
- 👤 **User-installable** — add to your account, use `/download` anywhere
- 🖥️ **Local CLI fallback** — download from any channel you can access, no bot invite needed
- 📁 Organized by server name and channel name
- ⏭️ Skips already-downloaded files (safe to re-run)
- 📊 Live progress updates
- 🛑 Cancel downloads mid-way with `/cancel`

## Setup

### 1. Create a Discord App

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Click **"New Application"** → give it a name → **Create**
3. Go to the **"Bot"** tab → click **"Reset Token"** → copy the token
4. Under **Privileged Gateway Intents**, enable:
   - ✅ **Message Content Intent**

### 2. Enable User Install

1. Go to the **"Installation"** tab in the Developer Portal
2. Under **Installation Contexts**, check both:
   - ✅ **Guild Install**
   - ✅ **User Install**
3. Under **Default Install Settings**:
   - **User Install**: add `applications.commands` scope
   - **Guild Install**: add `bot` + `applications.commands` scopes, with permissions: `Read Messages/View Channels`, `Read Message History`, `Send Messages`
4. Set install link to **Discord Provided Link**

### 3. Install & Configure

```bash
cd discopy
npm install
```

Copy the example env file:

```bash
copy .env.example .env
```

Edit `.env` and add your tokens:

```env
# Bot token (for the Discord bot)
DISCORD_TOKEN=your_bot_token_here

# Your personal Discord token (for the CLI tool)
DISCORD_USER_TOKEN=your_user_token_here
```

#### How to get your Discord user token

1. Open Discord in your **browser** (discord.com/app)
2. Press **F12** to open DevTools
3. Go to the **Console** tab
4. Paste and run:
   ```js
   (webpackChunkdiscord_app.push([[''],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]),m).find(m=>m?.exports?.default?.getToken!==void 0).exports.default.getToken()
   ```
5. Copy the token (without quotes) into your `.env`

### 4. Run

```bash
# Start the bot
npm start

# Or use the CLI directly
npm run download -- https://discord.com/channels/SERVER_ID/CHANNEL_ID
```

## How It Works

### In servers where the bot IS a member
Use `/download` → bot reads messages and downloads media directly using its own token.

### In servers where the bot is NOT a member (Auto-Fallback)
Use `/download` → If `DISCORD_USER_TOKEN` is configured, the bot will **automatically fall back to using the host's user token**. It will scan the channel, download the media, and then provide a direct ZIP download link (thanks to the built-in express server!).

If there is NO fallback token configured, it will give you a CLI command to run locally on your own machine.

### Zipped Downloads
When doing `/download` using the bot, it will return a direct download link to a ZIP archive containing all the channel's scraped media:
`http://<your-ip>:3000/download/ServerName/ChannelName`

## Commands

| Command | Description |
|---------|-------------|
| `/download` | Download all media from the current channel |
| `/download channel:#general` | Download all media from a specific channel |
| `/cancel` | Cancel the active download in this channel |
| `/stats` | Show all active downloads |

## CLI Usage

```bash
# By channel URL (easiest — just copy from Discord)
node cli.js https://discord.com/channels/123456/789012

# By channel ID
node cli.js 789012
```

## Where is media saved?

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

- **Bot mode**: Needs Read Message History permission in the target channel
- **CLI mode**: Works in any channel your account can access
- Large channels may take a while — progress is shown live
- Already-downloaded files are skipped (safe to re-run)
- Rate limiting is handled automatically
- ⚠️ Using user tokens for automation is technically against Discord TOS — use at your own discretion
