const { EmbedBuilder } = require('discord.js');
const spotify = require('../spotify');
const lavalinkState = require('../lavalinkState');

function isSpotifyURL(str) { return str.includes('open.spotify.com'); }
function isDeezerURL(str)  { return str.includes('deezer.com'); }

function normalizeTracks(res) {
  if (Array.isArray(res?.tracks) && res.tracks.length > 0 && res.tracks[0]?.info?.title) {
    return res.tracks;
  }
  const source = Array.isArray(res?.tracks) && res.tracks.length > 0
    ? res.tracks : (Array.isArray(res?.data) ? res.data : []);
  return source.filter(t => t?.encoded).map(t => {
    const info = t.info ?? {
      title: t.title ?? 'Desconocido', author: t.author ?? 'Desconocido',
      length: t.duration ?? t.length ?? 0, identifier: t.identifier ?? '',
      uri: t.url ?? t.uri ?? '', artworkUrl: t.artworkUrl ?? '',
      isStream: false, isSeekable: true, sourceName: t.sourceName ?? 'unknown',
      position: 0, isrc: t.isrc ?? null,
    };
    return { encoded: t.encoded, track: t.encoded, info, pluginInfo: t.pluginInfo ?? {}, userData: t.userData ?? {} };
  });
}

function waitForLavalink(timeout = 45000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (lavalinkState.isReady()) return resolve();
      if (Date.now() - start >= timeout) return reject(new Error('Lavalink no conectó a tiempo'));
      setTimeout(check, 1000);
    };
    check();
  });
}

async function search(moon, query, source) {
  try {
    const res = await moon.search({ query, source });
    const tracks = normalizeTracks(res);
    console.log(`🔍 ${source}:"${query}" → ${tracks.length} tracks`);
    return { tracks, res };
  } catch (e) {
    console.log(`⚠️ ${source} falló: ${e.message}`);
    return { tracks: [], res: null };
  }
}

// Inicia reproducción pasando el track explícitamente a moonlink
async function startPlay(player, track) {
  console.log('▶️ startPlay called, track:', track?.info?.title, 'encoded:', track?.encoded?.substring(0, 20));
  try {
    // moonlink v3: play(track) o play() con queue
    if (typeof player.play === 'function') {
      // Intentar pasar el track directo primero
      const result = await player.play(track);
      console.log('▶️ play() result:', result);
    }
  } catch (e) {
    console.error('▶️ play() error:', e.message);
  }
}

module.exports = {
  name: 'play',
  aliases: ['p'],
  description: 'Reproduce música de Deezer',
  async execute(message, args, client) {
    console.log('▶️ PLAY CMD recibido, args:', args);
    if (!args.length)
      return message.reply('❌ Escribe el nombre o URL de una canción. Ej: `l!play amorfoda`');

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('🎤 Debes estar en un canal de voz primero.');

    const perms = voiceChannel.permissionsFor(message.client.user);
    if (!perms.has('Connect') || !perms.has('Speak'))
      return message.reply('❌ No tengo permisos para unirme o hablar en ese canal.');

    const query      = args.join(' ');
    const loadingMsg = await message.reply('🔍 Buscando...');

    try {
      if (!lavalinkState.isReady()) {
        await loadingMsg.edit('⏳ Conectando al servidor de música, espera...');
        await waitForLavalink(45000);
      }

      let player = client.moon.players.get(message.guild.id);
      if (!player) {
        player = client.moon.players.create({
          guildId:      message.guild.id,
          voiceChannel: voiceChannel.id,
          textChannel:  message.channel.id,
          autoPlay:     false,
        });
        player.autoplay        = false;
        player.loop            = false;
        player.nowPlayingMsgId = null;
      }

      if (!player.connected) {
        console.log('🔌 Conectando al canal de voz...');
        await player.connect();
        // Esperar un momento para que el voice state se establezca
        await new Promise(r => setTimeout(r, 1000));
      }
      player.textChannel = message.channel.id;
      player.requester   = message.author.id;

      console.log('🔌 Player state:', {
        connected: player.connected,
        playing: player.playing,
        voiceChannel: player.voiceChannel,
        guildId: player.guildId,
      });

      // ── URL de Spotify ──────────────────────────────────────────────────
      if (isSpotifyURL(query)) {
        const type = spotify.getSpotifyType(query);
        if (!type) return loadingMsg.edit('❌ URL de Spotify no válida.');

        await loadingMsg.edit('🟢 Cargando desde Spotify...');
        const { tracks, res } = await search(client.moon, query, 'spsearch');
        if (!tracks.length) return loadingMsg.edit('❌ No encontré esa canción.');

        if (type === 'track') {
          player.queue.add(tracks[0]);
          if (!player.playing) await startPlay(player, tracks[0]);
          await loadingMsg.edit(`▶️ **${tracks[0].info.title}** — reproduciendo.`);
        } else {
          const wasPlaying = player.playing;
          for (const t of tracks) player.queue.add(t);
          if (!wasPlaying) await startPlay(player, tracks[0]);
          const name = res?.playlistInfo?.name || 'Playlist';
          await loadingMsg.edit(`✅ **${name}** — ${tracks.length} canciones añadidas.`);
        }

      // ── URL de Deezer ───────────────────────────────────────────────────
      } else if (isDeezerURL(query)) {
        await loadingMsg.edit('🟠 Cargando desde Deezer...');
        const { tracks, res } = await search(client.moon, query, 'dzsearch');
        if (!tracks.length) return loadingMsg.edit('❌ No pude cargar desde Deezer.');
        const wasPlaying = player.playing;
        for (const t of tracks) player.queue.add(t);
        if (!wasPlaying) await startPlay(player, tracks[0]);
        await loadingMsg.edit(tracks.length === 1
          ? `▶️ **${tracks[0].info.title}** — reproduciendo.`
          : `✅ **${res?.playlistInfo?.name || 'Playlist'}** — ${tracks.length} canciones.`);

      // ── Texto libre ─────────────────────────────────────────────────────
      } else {
        // Buscar en Deezer primero, luego Spotify como fallback
        let { tracks, res } = await search(client.moon, query, 'dzsearch');

        if (!tracks.length) {
          const sp = await search(client.moon, query, 'spsearch');
          tracks = sp.tracks;
          res    = sp.res;
        }

        if (!tracks.length) return loadingMsg.edit('❌ No se encontraron resultados.');

        const track      = tracks[0];
        const wasPlaying = player.playing;
        player.queue.add(track);

        console.log('🎵 Track añadido:', track.info.title, '| wasPlaying:', wasPlaying, '| queue size:', player.queue.size);

        if (!wasPlaying) {
          await startPlay(player, track);
          await loadingMsg.edit(`▶️ **${track.info.title}** (${formatMs(track.info.length)}) — reproduciendo.`);
        } else {
          await loadingMsg.edit(`➕ **${track.info.title}** (${formatMs(track.info.length)}) añadido a la cola.`);
        }
      }

    } catch (err) {
      console.error('Error en play:', err);
      loadingMsg.edit(`❌ Error: ${err.message}`).catch(() => {});
    }
  },
};

function formatMs(ms) {
  if (!ms) return '??:??';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
