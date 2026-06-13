const { EmbedBuilder } = require('discord.js');
const spotify = require('../spotify');
const lavalinkState = require('../lavalinkState');

function isSpotifyURL(str) { return str.includes('open.spotify.com'); }
function isDeezerURL(str) { return str.includes('deezer.com'); }

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
      uri: t.url ?? t.uri ?? '', artworkUrl: t.artworkUrl ?? t.thumbnail ?? '',
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

module.exports = {
  name: 'play',
  aliases: ['p'],
  description: 'Reproduce música de Spotify o Deezer',
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
          guildId: message.guild.id,
          voiceChannel: voiceChannel.id,
          textChannel: message.channel.id,
          autoPlay: false,
        });
        player.autoplay = false;
        player.loop = false;
        player.nowPlayingMsgId = null;
      }
      if (!player.connected) await player.connect();
      player.textChannel = message.channel.id;

      // ── Spotify URL ───────────────────────────────────────────────────────
      if (isSpotifyURL(query)) {
        const type = spotify.getSpotifyType(query);
        if (!type) return loadingMsg.edit('❌ URL de Spotify no válida.');

        if (type === 'track') {
          await loadingMsg.edit('🟢 Cargando canción de Spotify...');
          let { tracks } = await search(client.moon, query, 'spsearch');
          if (!tracks.length) return loadingMsg.edit('❌ No encontré esa canción en Spotify/Deezer.');
          const track = tracks[0];
          player.requester = message.author.id;
          player.queue.add(track);
          if (!player.playing) await player.play();
          await loadingMsg.edit(`▶️ **${track.info.title}** — reproduciendo.`);

        } else if (type === 'playlist') {
          await loadingMsg.edit('🟢 Cargando playlist de Spotify...');
          const { tracks, res } = await search(client.moon, query, 'spsearch');
          if (!tracks.length) return loadingMsg.edit('❌ No pude cargar esta playlist.');
          const wasPlaying = player.playing;
          player.requester = message.author.id;
          for (const t of tracks) player.queue.add(t);
          if (!wasPlaying) await player.play();
          const name = res?.playlistInfo?.name || 'Playlist';
          await loadingMsg.edit(`✅ **${name}** — ${tracks.length} canciones añadidas.`);

        } else if (type === 'album') {
          await loadingMsg.edit('🟢 Cargando álbum de Spotify...');
          const { tracks, res } = await search(client.moon, query, 'spsearch');
          if (!tracks.length) return loadingMsg.edit('❌ No pude cargar este álbum.');
          const wasPlaying = player.playing;
          player.requester = message.author.id;
          for (const t of tracks) player.queue.add(t);
          if (!wasPlaying) await player.play();
          const name = res?.playlistInfo?.name || 'Álbum';
          await loadingMsg.edit(`✅ **${name}** — ${tracks.length} canciones añadidas.`);
        }

      // ── Deezer URL ────────────────────────────────────────────────────────
      } else if (isDeezerURL(query)) {
        await loadingMsg.edit('🟠 Cargando desde Deezer...');
        const { tracks, res } = await search(client.moon, query, 'dzsearch');
        if (!tracks.length) return loadingMsg.edit('❌ No pude cargar desde Deezer.');
        const wasPlaying = player.playing;
        player.requester = message.author.id;
        for (const t of tracks) player.queue.add(t);
        if (!wasPlaying) await player.play();
        if (tracks.length === 1) {
          await loadingMsg.edit(`▶️ **${tracks[0].info.title}** — reproduciendo.`);
        } else {
          await loadingMsg.edit(`✅ **${res?.playlistInfo?.name || 'Playlist'}** — ${tracks.length} canciones añadidas.`);
        }

      // ── Texto libre ───────────────────────────────────────────────────────
      } else {
        // Buscar primero en Spotify, luego Deezer como fallback
        let { tracks, res } = await search(client.moon, query, 'spsearch');

        if (!tracks.length) {
          const dz = await search(client.moon, query, 'dzsearch');
          tracks = dz.tracks;
          res    = dz.res;
        }

        if (!tracks.length) return loadingMsg.edit('❌ No se encontraron resultados en Spotify ni Deezer.');

        player.requester = message.author.id;
        const track = tracks[0];
        player.queue.add(track);

        if (!player.playing) {
          await player.play();
          await loadingMsg.delete().catch(() => {});
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
