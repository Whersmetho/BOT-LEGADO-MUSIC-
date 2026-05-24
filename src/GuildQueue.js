const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  StreamType,
} = require('@discordjs/voice');
const { spawn } = require('child_process');
const { EmbedBuilder } = require('discord.js');
const { getRelatedVideos } = require('./autoplay');

function nowPlayingEmbed(song, autoplay = false) {
  return new EmbedBuilder()
    .setColor('#9B59B6')
    .setAuthor({ name: '▶️ Reproduciendo ahora' })
    .setTitle(song.title)
    .setURL(song.url)
    .setThumbnail(`https://img.youtube.com/vi/${extractID(song.url)}/hqdefault.jpg`)
    .addFields(
      { name: '⏱️ Duración', value: song.duration || '??:??', inline: true },
      { name: '🎧 Pedido por', value: song.requestedBy || 'Autoplay', inline: true },
      { name: '🔀 Autoplay', value: autoplay ? 'Activado' : 'Desactivado', inline: true }
    )
    .setFooter({ text: 'LEGADO MUSIC' })
    .setTimestamp();
}

function queueEmbed(song, position) {
  return new EmbedBuilder()
    .setColor('#3498DB')
    .setAuthor({ name: `➕ Añadido a la cola — Posición #${position}` })
    .setTitle(song.title)
    .setURL(song.url)
    .setThumbnail(`https://img.youtube.com/vi/${extractID(song.url)}/hqdefault.jpg`)
    .addFields(
      { name: '⏱️ Duración', value: song.duration || '??:??', inline: true },
      { name: '🎧 Pedido por', value: song.requestedBy || 'Desconocido', inline: true }
    )
    .setFooter({ text: 'LEGADO MUSIC' });
}

function extractID(url) {
  const match = url?.match(/(?:v=|youtu\.be\/|shorts\/)([A-Za-z0-9_-]{11})/);
  return match ? match[1] : '';
}

// Pre-obtiene la URL de audio real de un video sin descargarlo
function prefetchAudioStream(url) {
  return new Promise((resolve) => {
    const ytdlp = spawn('yt-dlp', [
      '--js-runtimes', 'node',
      '-f', 'bestaudio/best',
      '-o', '-',
      '--no-playlist',
      '--quiet',
      '--no-warnings',
      url,
    ], { stdio: ['ignore', 'pipe', 'ignore'] });

    resolve(ytdlp); // devolver el proceso listo para usar
  });
}

const MAX_HISTORY = 50;

class GuildQueue {
  constructor(voiceChannel, textChannel, connection) {
    this.voiceChannel = voiceChannel;
    this.textChannel = textChannel;
    this.connection = connection;
    this.songs = [];
    this.playing = false;
    this.loop = false;
    this.autoplay = false;
    this.lastSong = null;
    this.history = [];
    this.relatedPool = [];
    this.player = createAudioPlayer();
    this.ytdlpProc = null;
    this.ffmpegProc = null;

    // Pre-carga de la siguiente canción
    this.nextYtdlp = null;
    this.nextFfmpeg = null;
    this.prefetchTimeout = null;

    connection.subscribe(this.player);

    this.player.on(AudioPlayerStatus.Idle, async () => {
      if (this.loop && this.songs.length > 0) {
        this._play(this.songs[0]);
      } else {
        const finished = this.songs.shift();
        if (finished) {
          this.lastSong = finished;
          this.history.push(finished.url);
          if (this.history.length > MAX_HISTORY) this.history.shift();
        }

        if (this.songs.length > 0) {
          await this._playWithPrefetch();
        } else if (this.autoplay && this.lastSong) {
          await this._playRelated();
        } else {
          this.playing = false;
          this._cancelPrefetch();
          this.textChannel.send({
            embeds: [new EmbedBuilder().setColor('#2ECC71').setDescription('✅ **Cola vacía. ¡Hasta la próxima!**').setFooter({ text: 'LEGADO MUSIC' })]
          });
          setTimeout(() => { if (!this.playing) this.connection.destroy(); }, 30000);
        }
      }
    });

    this.player.on('error', (err) => {
      console.error('Player error:', err.message);
      this._killProcesses();
      this._cancelPrefetch();
      this.songs.shift();
      if (this.songs.length > 0) this._playWithPrefetch();
    });
  }

  // Inicia el proceso de yt-dlp+ffmpeg para la siguiente canción en segundo plano
  _prefetchNext() {
    if (this.songs.length < 2) return;
    const nextSong = this.songs[1];
    if (!nextSong) return;

    // Cancelar prefetch anterior si existe
    this._cancelPrefetch();

    // Esperar 3 segundos para no saturar al inicio
    this.prefetchTimeout = setTimeout(() => {
      try {
        const ffmpeg = spawn('ffmpeg', [
          '-i', 'pipe:0',
          '-analyzeduration', '0',
          '-loglevel', 'error',
          '-f', 's16le',
          '-ar', '48000',
          '-ac', '2',
          'pipe:1',
        ], { stdio: ['pipe', 'pipe', 'ignore'] });

        const ytdlp = spawn('yt-dlp', [
          '--js-runtimes', 'node',
          '-f', 'bestaudio/best',
          '-o', '-',
          '--no-playlist',
          '--quiet',
          '--no-warnings',
          nextSong.url,
        ], { stdio: ['ignore', 'pipe', 'ignore'] });

        ytdlp.stdout.pipe(ffmpeg.stdin, { end: true });
        ytdlp.stdout.on('error', () => {});
        ffmpeg.stdin.on('error', () => {});
        ffmpeg.stdout.on('error', () => {});

        this.nextYtdlp = ytdlp;
        this.nextFfmpeg = ffmpeg;
        this.prefetchSong = nextSong;

        console.log(`🔄 Pre-cargando: ${nextSong.title}`);
      } catch (e) {
        console.error('Error en prefetch:', e.message);
      }
    }, 3000);
  }

  _cancelPrefetch() {
    if (this.prefetchTimeout) { clearTimeout(this.prefetchTimeout); this.prefetchTimeout = null; }
    try { if (this.nextFfmpeg) { this.nextFfmpeg.kill('SIGKILL'); this.nextFfmpeg = null; } } catch {}
    try { if (this.nextYtdlp) { this.nextYtdlp.kill('SIGKILL'); this.nextYtdlp = null; } } catch {}
    this.prefetchSong = null;
  }

  // Reproducir usando el prefetch si está disponible
  async _playWithPrefetch() {
    const song = this.songs[0];

    // Si el prefetch ya tiene lista esta canción, usarlo directamente
    if (this.nextFfmpeg && this.nextYtdlp && this.prefetchSong?.url === song.url) {
      this._killProcesses();

      const ffmpeg = this.nextFfmpeg;
      const ytdlp = this.nextYtdlp;
      this.nextFfmpeg = null;
      this.nextYtdlp = null;
      this.prefetchSong = null;

      this.ytdlpProc = ytdlp;
      this.ffmpegProc = ffmpeg;

      const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
      this.player.play(resource);
      this.textChannel.send({ embeds: [nowPlayingEmbed(song, this.autoplay)] });

      // Pre-cargar la siguiente
      this._prefetchNext();
    } else {
      // No hay prefetch disponible, reproducir normal
      await this._play(song);
    }
  }

  async _playRelated() {
    try {
      this.textChannel.send({
        embeds: [new EmbedBuilder().setColor('#9B59B6').setDescription('🔀 **Buscando canción relacionada...**')]
      });

      if (this.relatedPool.length < 2) {
        const related = await getRelatedVideos(this.lastSong.url, this.lastSong.title, this.history);
        if (related.length > 0) {
          this.relatedPool = related.sort(() => Math.random() - 0.5);
        }
      }

      let song = null;
      while (this.relatedPool.length > 0) {
        const candidate = this.relatedPool.shift();
        if (!this.history.includes(candidate.url)) {
          song = candidate;
          break;
        }
      }

      if (!song) {
        this.playing = false;
        this.textChannel.send({
          embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No encontré canciones relacionadas nuevas.')]
        });
        setTimeout(() => { if (!this.playing) this.connection.destroy(); }, 30000);
        return;
      }

      this.songs.push(song);
      await this._play(song);

      // Pre-cargar más en segundo plano
      if (this.relatedPool.length < 3) {
        getRelatedVideos(song.url, song.title, this.history).then(more => {
          const nuevas = more.filter(v => !this.history.includes(v.url));
          this.relatedPool.push(...nuevas.sort(() => Math.random() - 0.5));
        }).catch(() => {});
      }

    } catch (err) {
      console.error('Error en autoplay:', err.message);
      this.playing = false;
      setTimeout(() => { if (!this.playing) this.connection.destroy(); }, 30000);
    }
  }

  _killProcesses() {
    try { if (this.ffmpegProc) { this.ffmpegProc.kill('SIGKILL'); this.ffmpegProc = null; } } catch {}
    try { if (this.ytdlpProc) { this.ytdlpProc.kill('SIGKILL'); this.ytdlpProc = null; } } catch {}
  }

  async addSong(song, silent = false) {
    const position = this.songs.length;
    this.songs.push(song);

    if (!this.playing) {
      this.playing = true;
      await this._play(this.songs[0]);
      // Iniciar prefetch de la segunda canción
      this._prefetchNext();
    } else if (!silent && position > 0) {
      this.textChannel.send({ embeds: [queueEmbed(song, position)] });
      // Si es la segunda canción, iniciar prefetch
      if (position === 1) this._prefetchNext();
    }
  }

  async _play(song) {
    this._killProcesses();

    try {
      const ffmpeg = spawn('ffmpeg', [
        '-i', 'pipe:0',
        '-analyzeduration', '0',
        '-loglevel', 'error',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'ignore'] });

      const ytdlp = spawn('yt-dlp', [
        '--js-runtimes', 'node',
        '-f', 'bestaudio/best',
        '-o', '-',
        '--no-playlist',
        '--quiet',
        '--no-warnings',
        song.url,
      ], { stdio: ['ignore', 'pipe', 'ignore'] });

      this.ytdlpProc = ytdlp;
      this.ffmpegProc = ffmpeg;

      ytdlp.stdout.pipe(ffmpeg.stdin, { end: true });
      ytdlp.stdout.on('error', () => {});
      ffmpeg.stdin.on('error', () => {});
      ffmpeg.stdout.on('error', () => {});

      const resource = createAudioResource(ffmpeg.stdout, { inputType: StreamType.Raw });
      this.player.play(resource);
      this.textChannel.send({ embeds: [nowPlayingEmbed(song, this.autoplay)] });

      // Iniciar prefetch de la siguiente canción
      this._prefetchNext();

    } catch (err) {
      console.error('Error al reproducir:', err.message);
      this.textChannel.send({
        embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ **No se pudo reproducir esta canción. Saltando...**')]
      });
      this._killProcesses();
      this.songs.shift();
      if (this.songs.length > 0) this._playWithPrefetch();
    }
  }

  skip() { this._cancelPrefetch(); this._killProcesses(); this.player.stop(); }
  pause() { return this.player.pause(); }
  resume() { return this.player.unpause(); }

  stop() {
    this._cancelPrefetch();
    this._killProcesses();
    this.songs = [];
    this.loop = false;
    this.autoplay = false;
    this.history = [];
    this.relatedPool = [];
    this.player.stop();
    this.playing = false;
  }

  destroy() { this.stop(); try { this.connection.destroy(); } catch {} }
  toggleLoop() { this.loop = !this.loop; return this.loop; }
  toggleAutoplay() { this.autoplay = !this.autoplay; return this.autoplay; }
  getNowPlaying() { return this.songs[0] || null; }
  getQueue() { return this.songs.slice(1); }
}

module.exports = GuildQueue;
