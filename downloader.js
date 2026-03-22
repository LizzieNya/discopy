/**
 * Discopy Downloader — Shared download logic
 * Used by both the bot (index.js) and CLI (cli.js)
 * Downloads images from any channel using a Discord user token via REST API.
 */

const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

const API_BASE = "https://discord.com/api/v10";

const MEDIA_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".ico",
  ".mp4", ".mkv", ".webm", ".avi", ".mov",
]);

// ─── Helpers ─────────────────────────────────────────────────────

function isMediaUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();
    return MEDIA_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").substring(0, 100);
}

/**
 * Make an authenticated request to the Discord REST API.
 */
function discordFetch(endpoint, token) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${API_BASE}${endpoint}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: "GET",
      headers: {
        Authorization: token,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    };

    https.get(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        if (res.statusCode === 429) {
          const body = JSON.parse(data);
          const retryAfter = (body.retry_after || 1) * 1000;
          setTimeout(() => {
            discordFetch(endpoint, token).then(resolve).catch(reject);
          }, retryAfter);
          return;
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Discord API ${res.statusCode}: ${data}`));
        }
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    }).on("error", reject);
  });
}

/**
 * Download a file from a URL to a local path.
 */
function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const dir = path.dirname(destPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const file = fs.createWriteStream(destPath);
    const client = url.startsWith("https") ? https : http;

    client
      .get(url, (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        }
        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`HTTP ${response.statusCode}`));
        }
        response.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
  });
}

/**
 * Extract media URLs from a raw Discord API message object.
 */
function extractMediaUrlsFromRaw(message) {
  const urls = [];

  if (message.attachments) {
    for (const att of message.attachments) {
      if (att.content_type?.startsWith("image/") || att.content_type?.startsWith("video/") || isMediaUrl(att.url)) {
        urls.push({
          url: att.url,
          filename: att.filename || `attachment_${att.id}`,
        });
      }
    }
  }

  if (message.embeds) {
    for (const embed of message.embeds) {
      if (embed.image?.url && isMediaUrl(embed.image.url)) {
        const parsed = new URL(embed.image.url);
        urls.push({
          url: embed.image.url,
          filename: path.basename(parsed.pathname) || `embed_image_${Date.now()}`,
        });
      }
      if (embed.thumbnail?.url && isMediaUrl(embed.thumbnail.url)) {
        const parsed = new URL(embed.thumbnail.url);
        urls.push({
          url: embed.thumbnail.url,
          filename: path.basename(parsed.pathname) || `embed_thumb_${Date.now()}`,
        });
      }
    }
  }

  return urls;
}

/**
 * Download all images from a channel using a user token.
 *
 * @param {Object} options
 * @param {string} options.channelId - The channel ID to download from
 * @param {string} options.userToken - Discord user token
 * @param {string} options.downloadDir - Base download directory
 * @param {function} [options.onProgress] - Progress callback: ({ phase, totalMessages, totalMedia, downloaded, failed, skipped, pct })
 * @returns {Promise<{ totalMessages, totalMedia, downloaded, failed, skipped, serverName, channelName, cancelled }>}
 */
async function downloadFromChannel({ channelId, userToken, downloadDir, onProgress, shouldCancel }) {
  const result = {
    totalMessages: 0,
    totalMedia: 0,
    downloaded: 0,
    failed: 0,
    skipped: 0,
    serverName: "Unknown",
    channelName: "unknown",
    cancelled: false,
  };

  // ── Get channel info ──
  if (onProgress) onProgress({ phase: "info", message: "Fetching channel info..." });

  let channelInfo;
  try {
    channelInfo = await discordFetch(`/channels/${channelId}`, userToken);
  } catch (err) {
    throw new Error(`Can't access channel: ${err.message}`);
  }

  // Get guild info
  if (channelInfo.guild_id) {
    try {
      const guildInfo = await discordFetch(`/guilds/${channelInfo.guild_id}`, userToken);
      result.serverName = guildInfo.name;
    } catch {
      result.serverName = channelInfo.guild_id;
    }
  }
  result.channelName = channelInfo.name || channelId;

  // ── Fetch all messages ──
  if (onProgress) onProgress({ phase: "scanning", message: `Scanning #${result.channelName}...` });

  const allMessages = [];
  let lastId = null;

  while (true) {
    if (shouldCancel && shouldCancel()) {
      result.cancelled = true;
      return result;
    }

    let endpoint = `/channels/${channelId}/messages?limit=100`;
    if (lastId) endpoint += `&before=${lastId}`;

    const messages = await discordFetch(endpoint, userToken);
    if (!messages.length) break;

    allMessages.push(...messages);
    lastId = messages[messages.length - 1].id;

    result.totalMessages = allMessages.length;
    if (onProgress) onProgress({ phase: "scanning", totalMessages: allMessages.length });

    await new Promise((r) => setTimeout(r, 500));
  }

  result.totalMessages = allMessages.length;

  // ── Collect media ──
  const mediaQueue = [];
  for (const msg of allMessages) {
    mediaQueue.push(...extractMediaUrlsFromRaw(msg));
  }
  result.totalMedia = mediaQueue.length;

  if (mediaQueue.length === 0) {
    return result;
  }

  // ── Download images ──
  const serverDir = sanitize(result.serverName);
  const channelDir = sanitize(result.channelName);
  const destDir = path.join(downloadDir, serverDir, channelDir);

  if (onProgress) {
    onProgress({
      phase: "downloading",
      totalMessages: result.totalMessages,
      totalMedia: result.totalMedia,
      downloaded: 0,
      pct: 0,
    });
  }

  const usedNames = new Set();

  for (let i = 0; i < mediaQueue.length; i++) {
    if (shouldCancel && shouldCancel()) {
      result.cancelled = true;
      return result;
    }

    const { url, filename } = mediaQueue[i];

    let safeName = sanitize(filename);
    if (usedNames.has(safeName.toLowerCase())) {
      const ext = path.extname(safeName);
      const base = path.basename(safeName, ext);
      safeName = `${base}_${i}${ext}`;
    }
    usedNames.add(safeName.toLowerCase());

    const destPath = path.join(destDir, safeName);

    if (fs.existsSync(destPath)) {
      result.skipped++;
      result.downloaded++;
    } else {
      try {
        await downloadFile(url, destPath);
        result.downloaded++;
      } catch {
        result.failed++;
      }
    }

    if (onProgress && (i % 10 === 0 || i === mediaQueue.length - 1)) {
      onProgress({
        phase: "downloading",
        totalMessages: result.totalMessages,
        totalMedia: result.totalMedia,
        downloaded: result.downloaded,
        failed: result.failed,
        skipped: result.skipped,
        pct: Math.round(((i + 1) / mediaQueue.length) * 100),
      });
    }

    await new Promise((r) => setTimeout(r, 50));
  }

  result.savePath = `downloads/${serverDir}/${channelDir}/`;
  return result;
}

module.exports = {
  downloadFromChannel,
  downloadFile,
  discordFetch,
  extractMediaUrlsFromRaw,
  isMediaUrl,
  sanitize,
  MEDIA_EXTENSIONS,
};
