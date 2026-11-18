const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.static(path.join(__dirname, 'public')));

// Gunakan folder disk aplikasi (bukan /tmp yang memakan kuota RAM 512MB Render)
const DOWNLOAD_DIR = path.join(__dirname, 'temp_downloads');
if (!fs.existsSync(DOWNLOAD_DIR)) {
  fs.mkdirSync(DOWNLOAD_DIR, { recursive: true });
}

// Bersihkan file sisa yang lebih tua dari 15 menit secara berkala agar disk tidak penuh
setInterval(() => {
  try {
    const now = Date.now();
    for (const file of fs.readdirSync(DOWNLOAD_DIR)) {
      const fullPath = path.join(DOWNLOAD_DIR, file);
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > 15 * 60 * 1000) {
        fs.unlinkSync(fullPath);
      }
    }
  } catch (_) {}
}, 5 * 60 * 1000);

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

// Endpoint super cepat (< 1 detik) untuk pratinjau judul & thumbnail
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

// Fungsi pembantu untuk menjalankan yt-dlp sebagai Promise agar bisa Auto-Retry
function runYtDlp(args) {
  return new Promise((resolve) => {
    const proc = spawn('yt-dlp', args);
    let stderrLog = '';

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderrLog += text;
      console.error(text);
    });

    proc.on('close', (code) => {
      resolve({ code, stderrLog });
    });

    proc.on('error', (err) => {
      resolve({ code: -1, stderrLog: err.message });
    });
  });
}

// Endpoint utama untuk mengunduh & memotong klip dengan Auto-Fallback 3 Lapis
app.get('/api/download', async (req, res) => {
  const { url, quality = '720p', startTime = '', endTime = '' } = req.query;

  const validPattern = /^https?:\/\/(www\.|vm\.|vt\.|m\.|music\.)?(youtube\.com|youtu\.be|tiktok\.com|instagram\.com)\//i;
  if (!url || !validPattern.test(url)) {
    return res.status(400).send('URL tidak didukung. Gunakan tautan YouTube, TikTok, atau Instagram.');
  }

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

  const cleanup = () => {
    try {
      for (const f of fs.readdirSync(DOWNLOAD_DIR)) {
        if (f.includes(tempId)) {
          fs.unlinkSync(path.join(DOWNLOAD_DIR, f));
        }
      }
    } catch (_) {}
  };

  const cookieStatus = getCookieStatus();
  let hasCookies = false;
  if (cookieStatus.found && isYouTube) {
    try {
      fs.copyFileSync(cookieStatus.path, tempCookies);
      hasCookies = true;
    } catch (_) {}
  }

  // Argumen pemotongan durasi (Clip / Trim)
  const trimArgs = [];
  const timeRegex = /^(\d{1,2}:)?\d{1,2}:\d{2}$/;
  if (startTime || endTime) {
    const start = timeRegex.test(startTime.trim()) ? startTime.trim() : '00:00';
    const end = timeRegex.test(endTime.trim()) ? endTime.trim() : 'inf';
    trimArgs.push('--download-sections', `*${start}-${end}`);
  }

  // Fungsi pembuat daftar argumen berdasarkan strategi percobaan
  const buildArgs = (strategyArgs, flexibleFormat = false) => {
    const common = [
      '--no-playlist',
      '--no-part',
      '--force-ipv4',
      '--geo-bypass',
      '--concurrent-fragments', '1',
      '--postprocessor-args', 'ffmpeg:-threads 1',
      ...trimArgs,
      ...strategyArgs
    ];

    if (isAudio) {
      return [...common, '-x', '--audio-format', 'mp3', '--audio-quality', '5', '-o', tempFile, url];
    }

    const formatSelector = flexibleFormat || !isYouTube
      ? `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`
      : `bestvideo[height<=${height}][vcodec^=avc]+bestaudio[acodec^=mp4a]/bestvideo[height<=${height}]+bestaudio/best[height<=${height}]/best`;

    return [
      ...common,
      '-f', formatSelector,
      ...(isYouTube && !flexibleFormat ? ['-S', `res:${height},fps,vcodec:h264,acodec:m4a`] : []),
      '--merge-output-format', 'mp4',
      '-o', tempFile,
      url
    ];
  };

  // Susun strategi Auto-Fallback khusus YouTube agar tidak mudah gagal karena 403 / Cookies Rotated
  const strategies = [];
  if (isYouTube) {
    if (hasCookies) {
      // Lapis 1: Default bawaan yt-dlp terbaru + Cookies
      strategies.push({ name: 'Lapis 1 (Default + Cookies)', args: ['--cookies', tempCookies], flex: false });
      // Lapis 2: Client Web/Mweb + Cookies + Format Fleksibel
      strategies.push({ name: 'Lapis 2 (Mweb + Cookies)', args: ['--cookies', tempCookies, '--extractor-args', 'youtube:player_client=mweb,web'], flex: true });
    }
    // Lapis 3: Tanpa Cookies (berguna jika cookies.txt di Render sudah kedaluwarsa/terotasi)
    strategies.push({ name: 'Lapis 3 (Tanpa Cookies / Fallback)', args: ['--extractor-args', 'youtube:player_client=ios,mweb,android_vr'], flex: true });
  } else {
    // Untuk TikTok & Instagram
    strategies.push({ name: 'Multi-Platform Default', args: [], flex: true });
  }

  let lastError = '';
  let success = false;

  for (const strat of strategies) {
    console.log(`[Sayangku Gihan] Mencoba unduh dengan ${strat.name}...`);
    // Hapus file gagal dari percobaan sebelumnya jika ada
    if (fs.existsSync(tempFile)) {
      try { fs.unlinkSync(tempFile); } catch (_) {}
    }

    const result = await runYtDlp(buildArgs(strat.args, strat.flex));
    if (result.code === 0 && fs.existsSync(tempFile) && fs.statSync(tempFile).size > 0) {
      success = true;
      break;
    }
    lastError = result.stderrLog;
  }

  if (!success || !fs.existsSync(tempFile)) {
    cleanup();
    return res.status(500).send(
      `Maaf, video belum berhasil diunduh setelah mencoba semua jalur cadangan.\n\nDetail Teknis:\n${lastError.slice(-500)}`
    );
  }

  res.download(tempFile, downloadName, (err) => {
    cleanup();
    if (err) console.error('Error saat mengirim file:', err);
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Sayangku Gihan siap di port ${PORT}`));
