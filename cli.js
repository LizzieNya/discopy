#!/usr/bin/env node

/**
 * Discopy CLI — Local companion tool
 */

require("dotenv").config();
const path = require("path");
const { downloadFromChannel } = require("./downloader");

const DOWNLOAD_DIR = path.join(__dirname, "downloads");

function parseChannelInput(input) {
  const urlMatch = input.match(/discord\.com\/channels\/(\d+)\/(\d+)/);
  if (urlMatch) return { guildId: urlMatch[1], channelId: urlMatch[2] };
  if (/^\d+$/.test(input)) return { guildId: null, channelId: input };
  return null;
}

async function main() {
  const input = process.argv[2];

  if (!input || input === "--help" || input === "-h") {
    console.log(`
📸  Discopy CLI — Download media from any Discord channel

Usage:
  node cli.js <channel-url-or-id>
`);
    process.exit(0);
  }

  const parsed = parseChannelInput(input);
  if (!parsed) {
    console.error("❌  Invalid input. Pass a channel URL or channel ID.");
    process.exit(1);
  }

  const userToken = process.env.DISCORD_USER_TOKEN;
  if (!userToken) {
    console.error("❌  No user token found! Add DISCORD_USER_TOKEN to your .env");
    process.exit(1);
  }

  console.log(`\n📸  Discopy CLI`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  try {
    const result = await downloadFromChannel({
      channelId: parsed.channelId,
      userToken,
      downloadDir: DOWNLOAD_DIR,
      onProgress: (status) => {
        if (status.phase === "info" || status.phase === "scanning") {
          process.stdout.write(`\r    ${status.message || (status.totalMessages + " messages scanned...")}   `);
        } else if (status.phase === "downloading") {
          process.stdout.write(`\r    ${status.downloaded}/${status.totalMedia} downloaded (${status.pct}%)${status.failed > 0 ? ` [${status.failed} failed]` : ""}${status.skipped > 0 ? ` [${status.skipped} skipped]` : ""}   `);
        }
      }
    });

    console.log(`\n\n✅  Done!`);
    console.log(`    📨 Messages: ${result.totalMessages.toLocaleString()}`);
    console.log(`    💽  Media:    ${result.totalMedia.toLocaleString()}`);
    console.log(`    ✅ Downloaded: ${result.downloaded.toLocaleString()}`);
    if (result.failed > 0) console.log(`    ❌ Failed:    ${result.failed}`);
    if (result.skipped > 0) console.log(`    ⏭️  Skipped:   ${result.skipped}`);
    console.log(`    📁 Saved to:  ${result.savePath}\n`);
  } catch (err) {
    console.error(`\n❌  Fatal error: ${err.message}`);
    process.exit(1);
  }
}

main();
