FROM node:20-slim

RUN apt-get update && apt-get install -y python3 python3-pip ffmpeg curl ca-certificates \
    && pip3 install --no-cache-dir --break-system-packages -U "yt-dlp[default]" yt-dlp-ejs \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
