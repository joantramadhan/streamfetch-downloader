FROM node:20-slim

# Instal Python3, FFmpeg, Deno (wajib untuk YouTube EJS challenge), dan yt-dlp versi nightly terbaru
RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl unzip ca-certificates \
    && curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && pip3 install --no-cache-dir --break-system-packages -U --pre "yt-dlp[default]" \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

EXPOSE 3000
CMD ["npm", "start"]
