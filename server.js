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

  // Salin cookies dari Render Secret Files ke /tmp agar yt-dlp bisa membacanya/menulisnya
  const secretCookies = '/etc/secrets/cookies.txt';
  const localCookies = path.join(__dirname, 'cookies.txt');
  const tempCookies = path.join(os.tmpdir(), `cookies_${tempId}.txt`);
  let hasCookies = false;

  if (fs.existsSync(secretCookies)) {
    fs.copyFileSync(secretCookies, tempCookies);
    hasCookies = true;
  } else if (fs.existsSync(localCookies)) {
    fs.copyFileSync(localCookies, tempCookies);
    hasCookies = true;
  }

  const baseArgs = [
    '--no-playlist',
    '--js-runtimes', 'node',
    '--force-ipv4',
    ...(hasCookies
      ? ['--cookies', tempCookies]
      : ['--extractor-args', 'youtube:player_client=tv_embedded,mweb']),
  ];

  const args = isAudio
    ? [...baseArgs, '-x', '--audio-format', 'mp3', '-o', tempFile, url]
    : [
        ...baseArgs,
        '-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best`,
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
      return res.status(500).send(
        'Gagal memproses video. Tambahkan Secret File cookies.txt di Render untuk melewati batas HTTP 429 YouTube.'
      );
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
