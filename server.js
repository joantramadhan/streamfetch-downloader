const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Gunakan folder di dalam disk aplikasi (bukan /tmp yang memakan RAM 512MB Render)
const DOWNLOAD_DIR = path.join(__dirname, 'temp_downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

function getCookieStatus() {
  const candidates = [
    '/etc/secrets/cookies.txt',
    path.join(__dirname, 'cookies.txt')
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        const stat = fs.statSync(p);
        const content = fs.readFileSync(p, 'utf8');
        const isValidFormat = content.includes('youtube.com') && content.length > 100;
        return { found: true, path: p, size: stat.size, valid: isValidFormat };
      } catch (err) {
        return { found: false, error: err.message };
      }
    }
  }
  return { found: false, path: null, size: 0, valid: false };
}

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Sayangku Gihan',
    cookies: getCookieStatus()
  });
});

app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL tidak boleh kosong' });

  const isYouTube = /(youtube\.com|youtu\.be)/i.test(url);
  const isTikTok = /tiktok\.com/i.test(url);
  const isInstagram = /instagram\.com/i.test(url);

  try {
    if (isYouTube) {
      const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
      const response = await fetch(oembedUrl);
      if (response.ok) {
        const data = await response.json();
        return res.json({
          title: data.title || 'Video YouTube',
          uploader: data.author_name || 'YouTube Channel',
          thumbnail: data.thumbnail_url || '',
          duration: 'Siap Unduh',
          platform: 'YouTube'
        });
      }
    }

    if (isTikTok) {
      const oembedUrl = `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`;
      const response = await fetch(oembedUrl);
      if (response.ok) {
        const data = await response.json();
        return res.json({
          title: data.title || 'Video TikTok',
          uploader: data.author_name || 'Kreator TikTok',
          thumbnail: data.thumbnail_url || '',
          duration: 'Tanpa Watermark',
          platform: 'TikTok'
        });
      }
    }

    return res.json({
      title: isInstagram ? 'Instagram Reels / Video' : 'Video Media Siap Diunduh',
      uploader: isInstagram ? 'Instagram' : 'Media',
      thumbnail: '',
      duration: 'Siap Unduh',
      platform: isInstagram ? 'Instagram' : 'Media'
    });
  } catch (err) {
    return res.json({
      title: 'Video Siap Diproses',
      uploader: 'Media',
      thumbnail: '',
      duration: 'Siap Unduh',
      platform: isYouTube ? 'YouTube' : 'Media'
    });
  }
});

app.get('/api/download', (req, res) => {
  const { url, quality = '720p', startTime = '', endTime = '' } = req.query;

  const validPattern = /^https?:\/\/(www\.|vm\.|vt\.|m\.|music\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)\//i;
  if (!url || !validPattern.test(url)) {
    return res.status(400).send('URL tidak didukung. Gunakan tautan YouTube, TikTok, atau Instagram.');
  }

  // Perpanjang batas waktu koneksi HTTP agar tidak diputus di tengah proses
  req.setTimeout(300000);
  res.setTimeout(300000);

  const isAudio = quality === 'mp3';
  const isYouTube = /(youtube\.com|youtu\.be)/i.test(url);
  const height = quality.replace('p', '');
  const ext = isAudio ? 'mp3' : 'mp4';
  const tempId = `gihan_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const tempFile = path.join(DOWNLOAD_DIR, `${tempId}.${ext}`);
  const tempCookies = path.join(DOWNLOAD_DIR, `cookies_${tempId}.txt`);
  const downloadName = isAudio ? `SayangkuGihan_Audio.mp3` : `SayangkuGihan_${quality}.mp4`;

  const cookieStatus = getCookieStatus();
  let useCookies = false;

  if (cookieStatus.found && isYouTube) {
    try {
      fs.copyFileSync(cookieStatus.path, tempCookies);
      useCookies = true;
    } catch (e) {
      console.error('Gagal menyalin cookies:', e.message);
    }
  }

  const baseArgs = [
    '--no-playlist',
    '--no-part',
    '--force-ipv4',
    '--geo-bypass',
    '--concurrent-fragments', '1', // Hemat RAM Render 512MB
    '--postprocessor-args', 'ffmpeg:-threads 1', // Cegah FFmpeg menghabiskan RAM
    ...(isYouTube ? ['--extractor-args', 'youtube:player_client=web_creator,tv,default'] : []),
    ...(useCookies ? ['--cookies', tempCookies] : [])
  ];

  // Potong klip secara stream-copy (tanpa --force-keyframes-at-cuts yang membuat CPU/RAM Render 502)
  const timeRegex = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
  if (startTime || endTime) {
    const start = timeRegex.test(startTime.trim()) ? startTime.trim() : '00:00';
    const end = timeRegex.test(endTime.trim()) ? endTime.trim() : 'inf';
    baseArgs.push('--download-sections', `*${start}-${end}`);
  }

  const formatSelector = isYouTube
    ? `bestvideo[height<=${height}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${height}][ext=mp4]/best[height<=${height}]/best`
    : `best[height<=${height}]/best`;

  const args = isAudio
    ? [...baseArgs, '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', tempFile, url]
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
    try {
      const files = fs.readdirSync(DOWNLOAD_DIR);
      for (const f of files) {
        if (f.includes(tempId)) {
          fs.unlinkSync(path.join(DOWNLOAD_DIR, f));
        }
      }
    } catch (_) {}
  };

  ytdlp.on('close', (code) => {
    if (code !== 0 || !fs.existsSync(tempFile)) {
      cleanup();
      return res.status(500).send(`Gagal memproses media:\n${errorLog.slice(-600)}`);
    }

    res.download(tempFile, downloadName, (err) => {
      cleanup();
      if (err) console.error('Error saat mengirim file:', err);
    });
  });

  req.on('close', () => {
    if (!ytdlp.killed) ytdlp.kill('SIGKILL');
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sayangku Gihan berjalan di port ${PORT}`));
