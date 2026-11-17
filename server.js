const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Fungsi pembantu untuk mencari dan memvalidasi Secret File cookies.txt
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
        return {
          found: true,
          path: p,
          size: stat.size,
          valid: isValidFormat
        };
      } catch (err) {
        return { found: false, error: err.message };
      }
    }
  }
  return { found: false, path: null, size: 0, valid: false };
}

// Endpoint cek kesehatan server & status Secret File cookies.txt
app.get('/api/health', (req, res) => {
  const cookieInfo = getCookieStatus();
  res.json({
    status: 'ok',
    app: 'Sayangku Gihan',
    cookies: cookieInfo
  });
});

// Endpoint super cepat (< 1 detik) untuk mengambil judul & thumbnail
app.get('/api/info', async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'URL tidak boleh kosong' });

  const isYouTube = /(youtube\.com|youtu\.be)/i.test(url);
  const isTikTok = /tiktok\.com/i.test(url);
  const isInstagram = /instagram\.com/i.test(url);

  try {
    // 1. Jalur Kilat YouTube (oEmbed resmi, tidak kena blokir bot & instan)
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

    // 2. Jalur Kilat TikTok (oEmbed resmi)
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

    // 3. Fallback langsung untuk Instagram / video lainnya agar UI tidak macet menunggu yt-dlp
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

// Endpoint utama untuk mengunduh & memotong klip dengan yt-dlp + cookies.txt
app.get('/api/download', (req, res) => {
  const { url, quality = '720p', startTime = '', endTime = '' } = req.query;

  const validPattern = /^https?:\/\/(www\.|vm\.|vt\.|m\.|music\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)\//i;
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

  // Salin cookies.txt dari Render Secret Files ke /tmp agar yt-dlp memiliki izin baca/tulis penuh
  const cookieStatus = getCookieStatus();
  const tempCookies = path.join(os.tmpdir(), `cookies_${tempId}.txt`);
  let useCookies = false;

  if (cookieStatus.found && isYouTube) {
    try {
      fs.copyFileSync(cookieStatus.path, tempCookies);
      useCookies = true;
      console.log(`[Sayangku Gihan] Memakai cookies aktif dari: ${cookieStatus.path} (${cookieStatus.size} bytes)`);
    } catch (e) {
      console.error('[Sayangku Gihan] Gagal menyalin cookies:', e.message);
    }
  }

  const baseArgs = [
    '--no-playlist',
    '--force-ipv4',
    '--geo-bypass',
    ...(isYouTube ? ['--extractor-args', 'youtube:player_client=web_creator,tv,default'] : []),
    ...(useCookies ? ['--cookies', tempCookies] : [])
  ];

  // Tambahkan pemotongan durasi jika waktu mulai/selesai diisi
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
