FROM node:20-slim

# Instalar ffmpeg y yt-dlp
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "src/index.js"]
