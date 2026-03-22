require("dotenv").config();
const {
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  ApplicationIntegrationType,
  InteractionContextType,
} = require("discord.js");
const fs = require("fs");
const path = require("path");
const express = require("express");
const archiver = require("archiver");
const { downloadFromChannel } = require("./downloader");

// ─── Configuration ───────────────────────────────────────────────
const TOKEN = process.env.DISCORD_TOKEN;
const USER_TOKEN = process.env.DISCORD_USER_TOKEN;
const DOWNLOAD_DIR = path.join(__dirname, "downloads");
const PORT = process.env.PORT || 3000;
const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${PORT}`;

// ─── Web Server for Zips ─────────────────────────────────────────
const app = express();

app.get("/download/:server/:channel", (req, res) => {
  const server = req.params.server;
  const channel = req.params.channel;
  const folderPath = path.join(DOWNLOAD_DIR, server, channel);

  if (!fs.existsSync(folderPath)) {
    return res.status(404).send("Folder not found. Maybe it hasn't been downloaded yet or the name is incorrect.");
  }

  res.attachment(`${server}_${channel}.zip`);
  const archive = archiver("zip", { zlib: { level: 9 } });

  archive.on("error", (err) => res.status(500).send({ error: err.message }));

  archive.pipe(res);
  archive.directory(folderPath, false);
  archive.finalize();
});

app.listen(PORT, () => {
  console.log(`🌍  Web server running on port ${PORT}`);
  console.log(`🔗  Zipped files accessible via: ${PUBLIC_URL}/download/...`);
});

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
    .setDescription("Download all images and videos from a channel")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    )
    .setContexts(InteractionContextType.Guild)
    .addChannelOption((opt) =>
      opt
        .setName("channel")
        .setDescription("The channel to download media from (defaults to current channel)")
        .setRequired(false)
    )
    .toJSON(),
  new SlashCommandBuilder()
    .setName("cancel")
    .setDescription("Cancel an active download in this channel")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    )
    .setContexts(InteractionContextType.Guild)
    .toJSON(),
  new SlashCommandBuilder()
    .setName("stats")
    .setDescription("Show download statistics for active downloads")
    .setIntegrationTypes(
      ApplicationIntegrationType.GuildInstall,
      ApplicationIntegrationType.UserInstall
    )
    .setContexts(InteractionContextType.Guild)
    .toJSON(),
];

client.once("ready", async () => {
  console.log(`\n✅  Logged in as ${client.user.tag}`);
  console.log(`📡  Serving ${client.guilds.cache.size} server(s)`);
  console.log(`\n💡  Use /download in any channel to start downloading media.\n`);

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

    // Check if the bot is actually in this server (needed for reading message history)
    const botMember = interaction.guild?.members.cache.get(client.user.id)
      || await interaction.guild?.members.fetch(client.user.id).catch(() => null);

    let useToken = `Bot ${TOKEN}`;
    let usingFallback = false;

    if (!botMember) {
      if (!USER_TOKEN) {
        const inviteUrl = `https://discord.com/oauth2/authorize?client_id=${client.user.id}&permissions=66560&integration_type=0&scope=bot+applications.commands`;
        const channelUrl = `https://discord.com/channels/${interaction.guildId}/${targetChannel.id}`;
        return interaction.reply({
          embeds: [
            new EmbedBuilder()
              .setTitle("📸  Can't Access This Server Directly")
              .setDescription(
                `I'm not a member of this server, so I can't read messages here.\n\n` +
                `The owner has not configured a fallback user token.\n\n` +
                `**Option 1 — Use the local CLI**:\n` +
                `\`\`\`\nnode cli.js ${channelUrl}\n\`\`\`\n` +
                `**Option 2 — Add me to this server:**\n` +
                `Ask a server admin to [**invite me**](${inviteUrl}), then use \`/download\` again.`
              )
              .setColor(0x5865f2),
          ],
          ephemeral: true,
        });
      }

      // Fallback to user token since bot isn't in server
      useToken = USER_TOKEN;
      usingFallback = true;
    } else {
      // Bot is in the server, check perms using typical discord.js methods
      if (targetChannel.isTextBased) {
        const perms = targetChannel.permissionsFor(botMember);
        if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.ReadMessageHistory)) {
          return interaction.reply({
            content: "❌ I don't have permission to read that channel. I need **View Channel** and **Read Message History**.",
            ephemeral: true,
          });
        }
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

    const ongoingDownload = { cancelled: false };
    activeDownloads.set(targetChannel.id, ongoingDownload);

    try {
      await interaction.editReply({
        embeds: [
          new EmbedBuilder()
            .setTitle(usingFallback ? "📥  Auto-Fallback: Scanning Channel" : "📥  Scanning Channel")
            .setDescription(`Fetching messages from <#${targetChannel.id}>...${usingFallback ? '\n*(Using host account fallback token to access messages)*' : ''}`)
            .setColor(0x5865f2),
        ],
      });

      const result = await downloadFromChannel({
        channelId: targetChannel.id,
        userToken: useToken,
        downloadDir: DOWNLOAD_DIR,
        shouldCancel: () => ongoingDownload.cancelled,
        onProgress: async (status) => {
          // Update discord every once in a while
          if (status.phase === "downloading" && (status.downloaded % 10 === 0 || status.downloaded === status.totalMedia)) {
            try {
              await interaction.editReply({
                embeds: [
                  new EmbedBuilder()
                    .setTitle("⬇️  Downloading Media")
                    .setDescription(
                      `**${status.downloaded}** / **${status.totalMedia}** downloaded${status.failed > 0 ? ` (${status.failed} failed)` : ""}${status.skipped > 0 ? ` (${status.skipped} skipped)` : ""}`
                    )
                    .setColor(0x57f287)
                    .setFooter({ text: `${status.pct}% complete` }),
                ]
              });
            } catch { /* ignore update errors */ }
          }
        }
      });

      activeDownloads.delete(targetChannel.id);

      const embed = new EmbedBuilder()
        .setTitle(result.cancelled ? "🚫  Download Cancelled" : "✅  Download Complete")
        .setColor(result.cancelled ? 0xed4245 : 0x57f287)
        .addFields(
          { name: "📨 Messages Scanned", value: result.totalMessages.toLocaleString(), inline: true },
          { name: "💽 Media Found", value: result.totalMedia.toLocaleString(), inline: true },
          { name: "✅ Downloaded", value: result.downloaded.toLocaleString(), inline: true },
        );

      if (result.failed > 0) {
        embed.addFields({ name: "❌ Failed", value: result.failed.toLocaleString(), inline: true });
      }
      if (result.skipped > 0) {
        embed.addFields({ name: "⏭️ Skipped (exists)", value: result.skipped.toLocaleString(), inline: true });
      }

      const zipUrl = `${PUBLIC_URL}/download/${encodeURIComponent(result.serverName)}/${encodeURIComponent(result.channelName)}`;

      embed.addFields({
        name: "📁 Saved To",
        value: `\`${result.savePath}\``,
        inline: false,
      });

      if (!result.cancelled && result.totalMedia > 0) {
        embed.addFields({
          name: "📦 Download ZIP",
          value: `[**Click here to download all media**](${zipUrl})`,
          inline: false
        });
      }

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
        value: `Downloading...`, 
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
