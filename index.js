require("dotenv").config();
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { Client, GatewayIntentBits, Partials } = require("discord.js");
const {
  joinVoiceChannel,
  getVoiceConnection,
  entersState,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
} = require("@discordjs/voice");

const PREFIX = "!";
const MUSIC_DIR = process.env.MUSIC_DIR;
const TOKEN = process.env.DISCORD_TOKEN;

if (!TOKEN) {
  console.error("Missing DISCORD_TOKEN in .env");
  process.exit(1);
}
if (!MUSIC_DIR) {
  console.error("Missing MUSIC_DIR in .env");
  process.exit(1);
}
if (!fs.existsSync(MUSIC_DIR) || !fs.statSync(MUSIC_DIR).isDirectory()) {
  console.error(`MUSIC_DIR is not a directory or doesn't exist: ${MUSIC_DIR}`);
  process.exit(1);
}

const SUPPORTED = new Set([
  ".mp3",
  ".flac",
  ".wav",
  ".ogg",
  ".m4a",
  ".aac",
  ".opus",
  ".webm",
]);

// ---- Client ----
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
  partials: [Partials.Channel],
});

// ---- Per-guild state ----
/**
 * guildId -> {
 *   player,
 *   connection,
 *   queue: string[],
 *   playing: boolean,
 *   nowPlaying: string | null
 * }
 */
const guildState = new Map();

function getOrCreateState(guildId) {
  let state = guildState.get(guildId);
  if (state) return state;

  const player = createAudioPlayer({
    // For debugging and sanity: don't pause just because nobody is subscribed for a moment.
    behaviors: { noSubscriber: NoSubscriberBehavior.Play },
  });

  state = {
    player,
    connection: null,
    queue: [],
    playing: false,
    nowPlaying: null,
  };
  guildState.set(guildId, state);

  // Debug player
  player.on("stateChange", (oldS, newS) => {
    console.log(`[Player ${guildId}] ${oldS.status} -> ${newS.status}`);
  });
  player.on("error", (err) => {
    console.error(`[Player ${guildId}] error:`, err);
    state.playing = false;
    state.nowPlaying = null;
  });

  // When idle, advance queue
  player.on(AudioPlayerStatus.Idle, () => {
    state.playing = false;
    state.nowPlaying = null;
    // Try to play next if there is anything queued
    void playNext(guildId, null);
  });

  return state;
}

function userVoiceChannel(message) {
  return message.member?.voice?.channel ?? null;
}

function listMusicFiles() {
  const entries = fs.readdirSync(MUSIC_DIR, { withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .filter((name) => SUPPORTED.has(path.extname(name).toLowerCase()))
    .sort((a, b) => a.localeCompare(b));
}

// Prevent traversal: only allow files that exist in the directory listing.
function resolveByIndex(index) {
  const files = listMusicFiles();
  if (files.length === 0) throw new Error("No audio files found in MUSIC_DIR.");

  if (!Number.isInteger(index) || index < 1 || index > files.length) {
    throw new Error(`Index out of range. Use 1..${files.length}`);
  }
  return path.join(MUSIC_DIR, files[index - 1]);
}

function resolveByName(name) {
  const files = listMusicFiles();
  const lower = name.toLowerCase();
  const match = files.find((f) => f.toLowerCase() === lower);
  if (!match) throw new Error("File not found in MUSIC_DIR (exact name match).");
  return path.join(MUSIC_DIR, match);
}

async function ensureVoice(message) {
  const channel = userVoiceChannel(message);
  if (!channel) throw new Error("You must be in a voice channel.");

  const guildId = channel.guild.id;
  const state = getOrCreateState(guildId);

  // If we already have a live connection in this guild, reuse it
  const existing = getVoiceConnection(guildId);
  if (existing) {
    state.connection = existing;
    // Re-subscribe just in case
    existing.subscribe(state.player);
    return existing;
  }

  const connection = joinVoiceChannel({
    channelId: channel.id,
    guildId: channel.guild.id,
    adapterCreator: channel.guild.voiceAdapterCreator,
    selfDeaf: false, // debug-friendly; you can set true later
    selfMute: false,
  });

  // Debug connection transitions
  connection.on("stateChange", (oldS, newS) => {
    console.log(`[VC ${guildId}] ${oldS.status} -> ${newS.status}`);
  });

  // Wait until READY (very important)
  await entersState(connection, VoiceConnectionStatus.Ready, 20_000);

  connection.subscribe(state.player);

  state.connection = connection;
  return connection;
}

function createResourceFromFile(filePath) {
  // Decode to raw PCM 48kHz stereo; @discordjs/voice will handle Opus encoding
  const ffmpeg = spawn("ffmpeg", [
    "-hide_banner",
    "-loglevel",
    "warning",
    "-i",
    filePath,
    "-vn",
    "-f",
    "s16le",
    "-ar",
    "48000",
    "-ac",
    "2",
    "pipe:1",
  ]);

  ffmpeg.on("error", (e) => {
    console.error("FFmpeg spawn error:", e);
  });

  // Helpful logs when there's "no sound"
  ffmpeg.stderr.on("data", (d) => console.log("[ffmpeg]", d.toString()));

  ffmpeg.on("close", (code, signal) => {
    console.log(`ffmpeg exited code=${code} signal=${signal}`);
  });

  return createAudioResource(ffmpeg.stdout, {
    inputType: StreamType.Raw,
    metadata: { filePath },
  });
}

async function playNext(guildId, textChannel) {
  const state = getOrCreateState(guildId);
  if (state.playing) return;

  const next = state.queue.shift();
  if (!next) return;

  state.playing = true;
  state.nowPlaying = next;

  try {
    const resource = createResourceFromFile(next);
    state.player.play(resource);

    if (textChannel) {
      await textChannel.send(`▶️ Playing: \`${path.basename(next)}\``);
    }
  } catch (err) {
    console.error("Failed to play:", err);
    state.playing = false;
    state.nowPlaying = null;
    if (textChannel) await textChannel.send(`❌ Failed: \`${path.basename(next)}\``);
    // try next item
    await playNext(guildId, textChannel);
  }
}

// ---- Commands ----
client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`MUSIC_DIR = ${MUSIC_DIR}`);
});

client.on("messageCreate", async (message) => {
  if (!message.guild) return;
  if (message.author.bot) return;
  if (!message.content.startsWith(PREFIX)) return;

  const guildId = message.guild.id;
  const state = getOrCreateState(guildId);

  const args = message.content.slice(PREFIX.length).trim().split(/\s+/);
  const cmd = (args.shift() || "").toLowerCase();

  try {
    if (cmd === "join") {
      await ensureVoice(message);
      return void message.reply("✅ Joined your voice channel.");
    }

    if (cmd === "leave") {
      const conn = getVoiceConnection(guildId);
      if (conn) conn.destroy();
      state.connection = null;
      state.queue.length = 0;
      state.player.stop(true);
      state.playing = false;
      state.nowPlaying = null;
      return void message.reply("👋 Left the voice channel.");
    }

    if (cmd === "list") {
      const files = listMusicFiles();
      if (files.length === 0) return void message.reply("No audio files found in MUSIC_DIR.");

      const first = files.slice(0, 30).map((f, i) => `${i + 1}. ${f}`).join("\n");
      const more = files.length > 30 ? `\n… and ${files.length - 30} more` : "";
      return void message.reply(`🎵 Files:\n\`\`\`\n${first}${more}\n\`\`\``);
    }

    if (cmd === "play") {
      if (args.length === 0) {
        return void message.reply('Usage: `!play <index>` OR `!play "Exact Name.mp3"`');
      }

      await ensureVoice(message);

      const raw = args.join(" ").trim().replace(/^"|"$/g, "");
      let filePath;

      if (/^\d+$/.test(raw)) filePath = resolveByIndex(parseInt(raw, 10));
      else filePath = resolveByName(raw);

      state.queue.push(filePath);
      await message.reply(`➕ Queued: \`${path.basename(filePath)}\``);

      await playNext(guildId, message.channel);
      return;
    }

    if (cmd === "random") {
      await ensureVoice(message);

      const files = listMusicFiles();
      if (files.length === 0) return void message.reply("No audio files found in MUSIC_DIR.");

      const pick = files[Math.floor(Math.random() * files.length)];
      const filePath = path.join(MUSIC_DIR, pick);

      state.queue.push(filePath);
      await message.reply(`🎲 Queued random: \`${pick}\``);

      await playNext(guildId, message.channel);
      return;
    }

    if (cmd === "skip") {
      state.player.stop(true); // triggers Idle -> playNext
      return void message.reply("⏭️ Skipped.");
    }

    if (cmd === "stop") {
      state.queue.length = 0;
      state.player.stop(true);
      state.playing = false;
      state.nowPlaying = null;
      return void message.reply("⏹️ Stopped and cleared queue.");
    }

    if (cmd === "queue") {
      if (state.queue.length === 0) return void message.reply("Queue is empty.");
      const q = state.queue.slice(0, 20).map((p, i) => `${i + 1}. ${path.basename(p)}`).join("\n");
      return void message.reply(`🧾 Queue:\n\`\`\`\n${q}\n\`\`\``);
    }

    if (cmd === "now") {
      if (!state.nowPlaying) return void message.reply("Nothing is playing.");
      return void message.reply(`🎧 Now playing: \`${path.basename(state.nowPlaying)}\``);
    }

    if (cmd === "help") {
      const embed = {
        color: 0x2b2d31,
        title: "🎵 Music Bot Commands",
        description: "Prefix: `!`",
        fields: [
          {
            name: "🎧 Voice",
            value:
              "`!join` – Join your voice channel\n" +
              "`!leave` – Leave the voice channel",
          },
          {
            name: "▶️ Playback",
            value:
              "`!play <index>` – Play by number from `!list`\n" +
              "`!play \"Exact Name.mp3\"` – Play by exact filename\n" +
              "`!random` – Play random song\n" +
              "`!skip` – Skip current song\n" +
              "`!stop` – Stop and clear queue",
          },
          {
            name: "📜 Library",
            value:
              "`!list` – Show available songs\n" +
              "`!queue` – Show queue\n" +
              "`!now` – Show current song",
          },
          {
            name: "ℹ️ Info",
            value:
              "`!help` – Show this menu",
          },
        ],
        footer: {
          text: "Local Music Bot • FFmpeg Required",
        },
      };

      return message.reply({ embeds: [embed] });
    }

    if (cmd === "download") {
      if (!args[0]) {
        return message.reply("Usage: `!download <youtube link>`");
      }

      const url = args[0];

      // basic validation
      if (!url.includes("youtube.com") && !url.includes("youtu.be")) {
        return message.reply("❌ Only YouTube links are supported.");
      }

      await message.reply("⬇️ Downloading audio... please wait.");

      try {
        const outputTemplate = path.join(MUSIC_DIR, "%(title)s.%(ext)s");

        const yt = spawn("yt-dlp", [
          "-f",
          "bestaudio",
          "--extract-audio",
          "--audio-format",
          "mp3",
          "--audio-quality",
          "0",
          "-o",
          outputTemplate,
          url,
        ]);

        yt.stderr.on("data", (d) =>
          console.log("[yt-dlp]", d.toString())
        );

        yt.on("close", async (code) => {
          if (code !== 0) {
            return message.reply("❌ Download failed.");
          }

          message.reply("✅ Download complete! Use `!list` to see it.");
        });
      } catch (err) {
        console.error(err);
        message.reply("❌ Error while downloading.");
      }

      return;
    }

    // Unknown command
    return void message.reply("Unknown command.");
  } catch (err) {
    const msg = err?.message ? String(err.message) : "Unknown error";
    return void message.reply(`❌ ${msg}`);
  }
});

// ---- Start ----
client.login(TOKEN);
