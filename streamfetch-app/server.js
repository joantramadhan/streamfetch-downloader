// Simpan sebagai server.js (letakkan index.html di folder /public)
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');

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
  const filename = isAudio ? 'audio.mp3' : `video_${quality}.mp4`;

  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', isAudio ? 'audio/mpeg' : 'video/mp4');

  const args = isAudio
    ? ['-x', '--audio-format', 'mp3', '-o', '-', url]
    : ['-f', `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best`, '--merge-output-format', 'mp4', '-o', '-', url];

  const ytdlp = spawn('yt-dlp', args);
  ytdlp.stdout.pipe(res);
  ytdlp.stderr.on('data', (d) => console.error(d.toString()));
  req.on('close', () => ytdlp.kill());
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`StreamFetch siap di port ${PORT}`));