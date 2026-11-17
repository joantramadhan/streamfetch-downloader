const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.get('/api/download', (req, res) => {
  const { url, quality = '720p' } = req.query;
  if (!url || !/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//.test(url)) {
    return res.status(400).send('URL YouTube tidak valid');
  }

  const isAudio = quality === 'mp3';
  const height = quality.replace('p', '');
  const ext = isAudio ? 'mp3' : 'mp4';
  const tempId = `streamfetch_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tempFile = path.join(os.tmpdir(), `${tempId}.${ext}`);
  const downloadName = isAudio ? 'audio.mp3' : `video_${quality}.mp4`;

  // Render menyimpan Secret Files di /etc/secrets/<nama_file> atau di root /app/<nama_file>
  const possibleCookiePaths = [
    '/etc/secrets/cookies.txt',
    path.join(__dirname, 'cookies.txt')
  ];
  const foundCookiePath = possibleCookiePaths.find((p) => fs.existsSync(p));
  const tempCookies = path.join(os.tmpdir(), `cookies_${tempId}.txt`);
  let hasCookies = false;

  if (foundCookiePath) {
    fs.copyFileSync(foundCookiePath, tempCookies);
    hasCookies = true;
    console.log(`Menggunakan cookies dari: ${foundCookiePath}`);
  } else {
    console.warn('PERINGATAN: File cookies.txt tidak ditemukan di /etc/secrets maupun folder root!');
  }

const baseArgs = [
    '--no-playlist',
    '--js-runtimes', 'node',
    '--remote-components', 'ejs:github',
    '--force-ipv4',
    '--geo-bypass',
    ...(hasCookies ? ['--cookies', tempCookies] : [])
  ];
  // Gunakan selector fleksibel agar jika stream mp4 dibatasi, yt-dlp mengambil webm lalu digabung ke mp4 oleh ffmpeg
  const formatSelector = `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;

  const args = isAudio
    ? [...baseArgs, '-x', '--audio-format', 'mp3', '-o', tempFile, url]
    : [
        ...baseArgs,
        '-f', formatSelector,
        '--merge-output-format', 'mp4',
        '-o', tempFile,
        url
      ];

  const ytdlp = spawn('yt-dlp', args);
  let errorLog = '';

  ytdlp.stderr.on('data', (data) => {
    errorLog += data.toString();
    console.error(data.toString());
  });

  const cleanup = () => {
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
    }
    if (fs.existsSync(tempCookies)) {
      try { fs.unlinkSync(tempCookies); } catch (_) {}
    }
  };

  ytdlp.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(tempFile)) {
      console.error('Gagal mengunduh:', errorLog);
      cleanup();
      return res.status(500).send(`Gagal memproses video:\n${errorLog}`);
    }

    res.download(tempFile, downloadName, (err) => {
      cleanup();
      if (err) console.error('Error saat mengirim file:', err);
    });
  });

  req.on('close', () => {
    if (!ytdlp.killed) ytdlp.kill();
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StreamFetch siap di port ${PORT}`));
