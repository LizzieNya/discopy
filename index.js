require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  SlashCommandBuilder,
  REST,
  Routes,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const https = require("https");
const http = require("http");

// ─── Configuration ───────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const DOWNLOAD_DIR = path.join(__dirname, "downloads");

// Image file extensions we look for
const IMAGE_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".tiff", ".ico",
]);

// ─── Helpers ─────────────────────────────────────────────────────

/**
 * Check if a URL points to an image based on its extension.
 */
function isImageUrl(url) {
  try {
    const parsed = new URL(url);
    const ext = path.extname(parsed.pathname).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext);
  } catch {
    return false;
  }
}

/**
 * Download a file from a URL and save it locally.
 * Returns a promise that resolves when the download is complete.
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
        // Handle redirects
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          file.close();
          fs.unlinkSync(destPath);
          return downloadFile(response.headers.location, destPath).then(resolve).catch(reject);
        }

        if (response.statusCode !== 200) {
          file.close();
          fs.unlinkSync(destPath);
          return reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        }

        response.pipe(file);
        file.on("finish", () => {
          file.close(resolve);
        });
      })
      .on("error", (err) => {
        file.close();
        if (fs.existsSync(destPath)) fs.unlinkSync(destPath);
        reject(err);
      });
  });
}

/**
 * Fetch ALL messages from a channel using pagination.
 */
async function fetchAllMessages(channel, statusCallback) {
  const allMessages = [];
  let lastId = null;
  let fetched;

  do {
    const options = { limit: 100 };
    if (lastId) options.before = lastId;

    fetched = await channel.messages.fetch(options);
    if (fetched.size === 0) break;

    allMessages.push(...fetched.values());
    lastId = fetched.last().id;

    if (statusCallback) {
      statusCallback(allMessages.length);
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  } while (fetched.size === 100);

  return allMessages;
}

/**
 * Extract all image URLs from a message (attachments + embeds).
 */
function extractImageUrls(message) {
  const urls = [];

  // 1. Direct attachments
  for (const attachment of message.attachments.values()) {
    if (attachment.contentType?.startsWith("image/") || isImageUrl(attachment.url)) {
      urls.push({
        url: attachment.url,
        filename: attachment.name || `attachment_${attachment.id}`,
      });
    }
  }

  // 2. Embeds (thumbnail, image)
  for (const embed of message.embeds) {
    if (embed.image?.url && isImageUrl(embed.image.url)) {
      const parsed = new URL(embed.image.url);
      urls.push({
        url: embed.image.url,
        filename: path.basename(parsed.pathname) || `embed_image_${Date.now()}`,
      });
    }
    if (embed.thumbnail?.url && isImageUrl(embed.thumbnail.url)) {
      const parsed = new URL(embed.thumbnail.url);
      urls.push({
        url: embed.thumbnail.url,
        filename: path.basename(parsed.pathname) || `embed_thumb_${Date.now()}`,
      });
    }
  }

  return urls;
}

/**
 * Sanitize a string for use as a folder/file name.
 */
function sanitize(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").substring(0, 100);
}

// ─── Discord Client ──────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// Track active download tasks so we can cancel them
const activeDownloads = new Map();

// ─── Slash Command Registration ──────────────────────────────────
const commands = [
  new SlashCommandBuilder()
    .setName("download")
    .setDescription("Download all images from a channel")
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("The channel to download images from (defaults to current channel)")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("cancel")
    .setDescription("Cancel an active download in this channel")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show download statistics for active downloads")
    .toJSON(),
];

client.once("ready", async () => {
  console.log(`\n✅  Logged in as ${client.user.tag}`);
  console.log(`📡  Serving ${client.guilds.cache.size} server(s)`);
  console.log(`\n💡  Use /download in any channel to start downloading images.\n`);

  // Register slash commands globally
  const rest = new REST({ version: "10" }).setToken(TOKEN);
  try {
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log("✅  Slash commands registered globally.");
  } catch (err) {
    console.error("❌  Failed to register slash commands:", err);
  }
});

// ─── Slash Command Handler ───────────────────────────────────────
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  // ── /download ──
  if (interaction.commandName === "download") {
    const targetChannel = interaction.options.getChannel("channel") || interaction.channel;

    // Permission check
    const botMember = interaction.guild?.members.cache.get(client.user.id);
    if (targetChannel.isTextBased && botMember) {
      const perms = targetChannel.permissionsFor(botMember);
      if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
        return interaction.reply({
          content: "❌ I don't have permission to read that channel. I need **View Channel** and **Read Message History**.",
          ephemeral: true,
        });
      }
    }

    // Check if already downloading in this channel
    if (activeDownloads.has(targetChannel.id)) {
      return interaction.reply({
        content: "⚠️ A download is already in progress for this channel. Use `/cancel` to stop it first.",
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    // Create the download task
    const task = {
      cancelled: false,
      totalMessages: 0,
      totalImages: 0,
      downloaded: 0,
      failed: 0,
      skipped: 0,
    };
    activeDownloads.set(targetChannel.id, task);

    try {
      // ── Phase 1: Fetch all messages ──
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("📥  Scanning Channel")
            .setDescription(`Fetching messages from <#${targetChannel.id}>...`)
            .setColor(0x5865f2),
        ],
      });

      const messages = await fetchAllMessages(targetChannel, (count) => {
        task.totalMessages = count;
      });

      if (task.cancelled) {
        activeDownloads.delete(targetChannel.id);
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("🚫  Download Cancelled")
              .setColor(0xed4245),
          ],
        });
      }

      task.totalMessages = messages.length;

      // ── Phase 2: Collect image URLs ──
      const imageQueue = [];
      for (const msg of messages) {
        const images = extractImageUrls(msg);
        imageQueue.push(...images);
      }

      task.totalImages = imageQueue.length;

      if (imageQueue.length === 0) {
        activeDownloads.delete(targetChannel.id);
        return interaction.editReply({
          embeds: [
            new EmbedBuilder()
              .setTitle("📭  No Images Found")
              .setDescription(
                `Scanned **${messages.length.toLocaleString()}** messages in <#${targetChannel.id}> but found no images.`
              )
              .setColor(0xfee75c),
          ],
        });
      }

      // ── Phase 3: Download images ──
      const serverName = sanitize(interaction.guild?.name || "DM");
      const channelName = sanitize(targetChannel.name || targetChannel.id);
      const destDir = path.join(DOWNLOAD_DIR, serverName, channelName);

      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("⬇️  Downloading Images")
            .setDescription(
              `Found **${imageQueue.length.toLocaleString()}** images across **${messages.length.toLocaleString()}** messages.\n\nDownloading to \`downloads/${serverName}/${channelName}/\`...`
            )
            .setColor(0x57f287)
            .setFooter({ text: "0% complete" }),
        ],
      });

      // Track filenames to avoid collisions
      const usedNames = new Set();

      for (let i = 0; i < imageQueue.length; i++) {
        if (task.cancelled) break;

        const { url, filename } = imageQueue[i];

        // Make the filename unique
        let safeName = sanitize(filename);
        if (usedNames.has(safeName.toLowerCase())) {
          const ext = path.extname(safeName);
          const base = path.basename(safeName, ext);
          safeName = `${base}_${i}${ext}`;
        }
        usedNames.add(safeName.toLowerCase());

        const destPath = path.join(destDir, safeName);

        // Skip if file already exists
        if (fs.existsSync(destPath)) {
          task.skipped++;
          task.downloaded++;
          continue;
        }

        try {
          await downloadFile(url, destPath);
          task.downloaded++;
        } catch (err) {
          task.failed++;
          console.error(`  ✗ Failed: ${filename} — ${err.message}`);
        }

        // Update progress every 10 images or on the last one
        if (i % 10 === 0 || i === imageQueue.length - 1) {
          const pct = Math.round(((i + 1) / imageQueue.length) * 100);
          await interaction
            .editReply({
              embeds: [
                new EmbedBuilder()
                  .setTitle("⬇️  Downloading Images")
                  .setDescription(
                    `**${task.downloaded}** / **${imageQueue.length}** downloaded${task.failed > 0 ? ` (${task.failed} failed)` : ""}${task.skipped > 0 ? ` (${task.skipped} skipped)` : ""}`
                  )
                  .setColor(0x57f287)
                  .setFooter({ text: `${pct}% complete` }),
              ],
            })
            .catch(() => {});
        }

        // Small delay to be nice to Discord CDN
        await new Promise((r) => setTimeout(r, 100));
      }

      // ── Done ──
      activeDownloads.delete(targetChannel.id);

      const embed = new EmbedBuilder()
        .setTitle(task.cancelled ? "🚫  Download Cancelled" : "✅  Download Complete")
        .setColor(task.cancelled ? 0xed4245 : 0x57f287)
        .addFields(
          { name: "📨 Messages Scanned", value: task.totalMessages.toLocaleString(), inline: true },
          { name: "🖼️ Images Found", value: task.totalImages.toLocaleString(), inline: true },
          { name: "✅ Downloaded", value: task.downloaded.toLocaleString(), inline: true },
        );

      if (task.failed > 0) {
        embed.addFields({ name: "❌ Failed", value: task.failed.toLocaleString(), inline: true });
      }
      if (task.skipped > 0) {
        embed.addFields({ name: "⏭️ Skipped (exists)", value: task.skipped.toLocaleString(), inline: true });
      }

      embed.addFields({
        name: "📁 Saved To",
        value: `\`downloads/${serverName}/${channelName}/\``,
        inline: false,
      });

      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      activeDownloads.delete(targetChannel.id);
      console.error("Download error:", err);
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle("❌  Error")
            .setDescription(`Something went wrong: ${err.message}`)
            .setColor(0xed4245),
        ],
      });
    }
  }

  // ── /cancel ──
  if (interaction.commandName === "cancel") {
    const task = activeDownloads.get(interaction.channelId);
    if (!task) {
      return interaction.reply({
        content: "ℹ️ No active download in this channel.",
        ephemeral: true,
      });
    }
    task.cancelled = true;
    return interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("🛑  Cancelling Download")
          .setDescription("The current download will stop shortly.")
          .setColor(0xed4245),
      ],
    });
  }

  // ── /stats ──
  if (interaction.commandName === "stats") {
    if (activeDownloads.size === 0) {
      return interaction.reply({
        content: "ℹ️ No active downloads.",
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder()
      .setTitle("📊  Active Downloads")
      .setColor(0x5865f2);

    for (const [channelId, task] of activeDownloads) {
      embed.addFields({
        name: `<#${channelId}>`,
        value: `${task.downloaded}/${task.totalImages} images (${task.failed} failed)`,
        inline: false,
      });
    }

    return interaction.reply({ embeds: [embed], ephemeral: true });
  }
});

// ─── Login ───────────────────────────────────────────────────────
if (!TOKEN || TOKEN === "your_bot_token_here") {
  console.error("\n❌  No bot token found!");
  console.error("   1. Copy .env.example to .env");
  console.error("   2. Paste your bot token from https://discord.com/developers/applications");
  console.error("   3. Run again with: npm start\n");
  process.exit(1);
}

client.login(TOKEN);
