const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => res.json({ status: 'ok', app: 'Sayangku Gihan' }));

// Endpoint untuk mengambil metadata video (YouTube, TikTok, Instagram)
app.get('/api/info', (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL tidak boleh kosong' });

  const possibleCookiePaths = ['/etc/secrets/cookies.txt', path.join(__dirname, 'cookies.txt')];
  const foundCookiePath = possibleCookiePaths.find((p) => fs.existsSync(p));
  const tempCookies = path.join(os.tmpdir(), `info_cookies_${Date.now()}.txt`);
  let hasCookies = false;

  if (foundCookiePath) {
    fs.copyFileSync(foundCookiePath, tempCookies);
    hasCookies = true;
  }

  const isYouTube = /(youtube\.com|youtu\.be)/i.test(url);
  const args = [
    '--dump-single-json',
    '--no-playlist',
    '--no-warnings',
    ...(isYouTube ? ['--extractor-args', 'youtube:player_client=web_creator,tv,default'] : []),
    ...(hasCookies && isYouTube ? ['--cookies', tempCookies] : []),
    url
  ];

  const ytdlp = spawn('yt-dlp', args);
  let stdoutData = '';
  let stderrData = '';

  ytdlp.stdout.on('data', (d) => (stdoutData += d.toString()));
  ytdlp.stderr.on('data', (d) => (stderrData += d.toString()));

  ytdlp.on('close', (code) => {
    if (fs.existsSync(tempCookies)) {
      try { fs.unlinkSync(tempCookies); } catch (_) {}
    }

    if (code !== 0 || !stdoutData) {
      return res.status(500).json({ error: 'Gagal mengambil info video', detail: stderrData });
    }

    try {
      const info = JSON.parse(stdoutData);
      res.json({
        title: info.title || 'Video Media',
        uploader: info.uploader || info.channel || info.extractor_key || 'Kreator',
        thumbnail: info.thumbnail || '',
        duration: info.duration_string || '',
        platform: info.extractor_key || 'Media'
      });
    } catch (e) {
      res.status(500).json({ error: 'Format metadata tidak terbaca' });
    }
  });
});

// Endpoint utama untuk mengunduh & memotong klip
app.get('/api/download', (req, res) => {
  const { url, quality = '720p', startTime = '', endTime = '' } = req.query;

  const validPattern = /^https?:\/\/(www\.|vm\.|vt\.|m\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)\//i;
  if (!url || !validPattern.test(url)) {
    return res.status(400).send('URL tidak didukung. Gunakan tautan YouTube, TikTok, atau Instagram.');
  }

  const isAudio = quality === 'mp3';
  const isYouTube = /(youtube\.com|youtu\.be)/i.test(url);
  const height = quality.replace('p', '');
  const ext = isAudio ? 'mp3' : 'mp4';
  const tempId = `gihan_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const tempFile = path.join(os.tmpdir(), `${tempId}.${ext}`);
  const downloadName = isAudio ? `SayangkuGihan_Audio.mp3` : `SayangkuGihan_${quality}.mp4`;

  const possibleCookiePaths = ['/etc/secrets/cookies.txt', path.join(__dirname, 'cookies.txt')];
  const foundCookiePath = possibleCookiePaths.find((p) => fs.existsSync(p));
  const tempCookies = path.join(os.tmpdir(), `cookies_${tempId}.txt`);
  let hasCookies = false;

  if (foundCookiePath && isYouTube) {
    fs.copyFileSync(foundCookiePath, tempCookies);
    hasCookies = true;
  }

  const baseArgs = [
    '--no-playlist',
    '--force-ipv4',
    '--geo-bypass',
    ...(isYouTube ? ['--extractor-args', 'youtube:player_client=web_creator,tv,default'] : []),
    ...(hasCookies ? ['--cookies', tempCookies] : [])
  ];

  // Tambahkan pemotongan durasi jika startTime atau endTime diisi
  const timeRegex = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
  if (startTime || endTime) {
    const start = timeRegex.test(startTime.trim()) ? startTime.trim() : '00:00';
    const end = timeRegex.test(endTime.trim()) ? endTime.trim() : 'inf';
    baseArgs.push('--download-sections', `*${start}-${end}`, '--force-keyframes-at-cuts');
  }

  const formatSelector = isYouTube
    ? `bestvideo[height<=${height}][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`
    : `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;

  const args = isAudio
    ? [...baseArgs, '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', tempFile, url]
    : [
        ...baseArgs,
        '-f', formatSelector,
        ...(isYouTube ? ['-S', `res:${height},fps,vcodec:h264,acodec:m4a`] : []),
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
      return res.status(500).send(`Gagal memproses media:\n${errorLog}`);
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
app.listen(PORT, () => console.log(`Sayangku Gihan berjalan di port ${PORT}`));
