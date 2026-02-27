# 🎵 Discord Local Music Bot

A production-ready Discord music bot built with:

- discord.js v14  
- @discordjs/voice  
- FFmpeg  
- yt-dlp  
- PM2 (for VPS hosting)

This bot plays local audio files, downloads audio from YouTube, and supports channel/playlist bulk downloads.

---

## 🚀 Features

- 🎧 Join / Leave voice channel
- ▶️ Play local audio files
- 🎲 Random song
- 📜 Queue system
- ⏭ Skip / Stop
- 📂 List local music library
- ⬇ Download audio from YouTube
- 🧠 Production-ready logging
- 🖥 VPS deployment ready

---

## 📦 Requirements

- Node.js 18+
- FFmpeg
- yt-dlp
- Linux VPS recommended (Ubuntu 22.04)

---

## ⚙️ Installation

### 1️⃣ Clone Repository

```
git clone https://github.com/Mustafa-Amer-1/discord-local-music-bot.git
cd discord-local-music-bot
```

### 2️⃣ Install Dependencies

```
npm install
npm install @discordjs/opus
```

If opus fails:

```
npm install opusscript
```

---

### 3️⃣ Install System Dependencies (Linux)

```
sudo apt update
sudo apt install -y ffmpeg yt-dlp build-essential python3 make g++
```

---

### 4️⃣ Configure Environment

Create `.env` file:

```
DISCORD_TOKEN=your_bot_token_here
MUSIC_DIR=/path/to/music/folder
```

Create music directory:

```
mkdir -p /path/to/music/folder
chmod -R 755 /path/to/music/folder
```

---

## ▶️ Running the Bot

### Development Mode

```
node index.js
```

---

### Production (Recommended)

Install PM2:

```
npm install -g pm2
```

Start bot:

```
pm2 start index.js --name music-bot
pm2 save
pm2 startup
```

Useful commands:

```
pm2 list
pm2 logs music-bot
pm2 restart music-bot
```

---

## 🎮 Bot Commands

Prefix: `!`

### Voice
```
!join      - Join your voice channel
!leave     - Leave voice channel
```

### Playback
```
!play <index>
!play "Exact Name.mp3"
!random
!skip
!stop
```

### Library
```
!list
!queue
!now
```

### Downloads
```
!download <youtube_url>
```

Examples:

```
!download https://www.youtube.com/watch?v=xxxxx
```

---


## 🧠 Architecture

Audio Flow:

```
YouTube → yt-dlp → FFmpeg → PCM → Opus Encoder → Discord Voice
```

Local Playback:

```
File → FFmpeg → PCM → Opus Encoder → Discord Voice
```

---

## 🛠 Troubleshooting

### No Sound

Install Opus encoder:

```
npm install @discordjs/opus
```

### FFmpeg Not Found

```
sudo apt install ffmpeg
```

### yt-dlp Not Found

```
sudo apt install yt-dlp
```

---

## ⚠ Legal Notice

Downloading YouTube content may violate YouTube Terms of Service.

Only download:
- Your own content
- Creative Commons content
- Content you have permission to download

You are responsible for how this bot is used.

---

## 📄 License

MIT License

