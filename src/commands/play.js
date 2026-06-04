const { EmbedBuilder } = require('discord.js');
const spotify = require('../spotify');
const lavalinkState = require('../lavalinkState');

function isSpotifyURL(str) { return str.includes('open.spotify.com'); }

// Helper: obtiene los nodos desde NodeManager de moonlink.js v3
function getNodes(moon) {
  try {
    return [...moon.nodes.map.values()];
  } catch {
    return [];
  }
}

// Espera hasta que Lavalink esté conectado (máx 45s — margen para cold start en Render)
function waitForLavalink(timeout = 45000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (lavalinkState.isReady()) return resolve();
      if (Date.now() - start >= timeout)
        return reject(new Error('Lavalink no conectó a tiempo'));
      setTimeout(check, 1000);
    };
    check();
  });
}

module.exports = {
  name: 'play',
  aliases: ['p'],
  description: 'Reproduce música de YouTube o Spotify',
  async execute(message, args, client) {
    console.log('▶️ PLAY CMD recibido, args:', args);
    if (!args.length)
      return message.reply('❌ Escribe el nombre o URL de una canción. Ej: `l!play despacito`');

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) return message.reply('🎤 Debes estar en un canal de voz primero.');

    const perms = voiceChannel.permissionsFor(message.client.user);
    if (!perms.has('Connect') || !perms.has('Speak'))
      return message.reply('❌ No tengo permisos para unirme o hablar en ese canal.');

    const query      = args.join(' ');
    const loadingMsg = await message.reply('🔍 Buscando...');

    try {
      // Esperar a que Lavalink esté listo antes de crear el player
if (!lavalinkState.isReady()) {
  await loadingMsg.edit('⏳ Conectando al servidor de música, espera un momento...');
  await waitForLavalink(45000);
}

console.log(
  'Lavalink Debug:',
  getNodes(client.moon).map(n => ({
    state: n.state,
    host: n.host,
    socket: n.socket?.constructor?.name ?? 'null'
  }))
);

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

      if (!player.connected) await player.connect();
      player.textChannel = message.channel.id;

      // ── Spotify ──────────────────────────────────────────────────────────
      if (isSpotifyURL(query)) {
        const type = spotify.getSpotifyType(query);
        if (!type) return loadingMsg.edit('❌ URL de Spotify no válida.');

        if (type === 'track') {
          await loadingMsg.edit('🟢 Obteniendo canción de Spotify...');
          const [trackInfo] = await spotify.getTrack(query);
          const res = await client.moon.search({ query: trackInfo.searchQuery, source: 'ytsearch' });
          if (!res.tracks?.length) return loadingMsg.edit(`❌ No encontré "${trackInfo.title}" en YouTube.`);

          const track = res.tracks[0];
          track.info.title = trackInfo.title;
          player.requester = message.author.id;
          player.queue.add(track);
          if (!player.playing) player.play();

          if (player.queue.size > 0 || player.playing)
            await loadingMsg.edit(`➕ **${trackInfo.title}** añadido a la cola.`);
          else
            await loadingMsg.delete().catch(() => {});

        } else if (type === 'playlist') {
          await loadingMsg.edit('🟢 Cargando playlist de Spotify...');
          const { tracks, playlistName, total } = await spotify.getPlaylist(query);
          await loadingMsg.edit(`📋 Cargando **${playlistName}** — ${total} canciones...`);

          const wasPlaying = player.playing;
          let added = 0;
          for (const t of tracks) {
            const res = await client.moon.search({ query: t.searchQuery, source: 'ytsearch' });
            if (res.tracks?.length) {
              const track = res.tracks[0];
              track.info.title = t.title;
              player.requester = message.author.id;
              player.queue.add(track);
              added++;
            }
          }
          if (!wasPlaying && added > 0) player.play();
          await loadingMsg.edit(`✅ Playlist **${playlistName}** — ${added}/${total} canciones añadidas.`);

        } else if (type === 'album') {
          await loadingMsg.edit('🟢 Cargando álbum de Spotify...');
          const { tracks, albumName, total } = await spotify.getAlbum(query);
          await loadingMsg.edit(`💿 Cargando **${albumName}** — ${total} canciones...`);

          const wasPlaying = player.playing;
          let added = 0;
          for (const t of tracks) {
            const res = await client.moon.search({ query: t.searchQuery, source: 'ytsearch' });
            if (res.tracks?.length) {
              const track = res.tracks[0];
              track.info.title = t.title;
              player.requester = message.author.id;
              player.queue.add(track);
              added++;
            }
          }
          if (!wasPlaying && added > 0) player.play();
          await loadingMsg.edit(`✅ Álbum **${albumName}** — ${added}/${total} canciones añadidas.`);
        }

      // ── YouTube / búsqueda ───────────────────────────────────────────────
      } else {
        const source = query.startsWith('http') ? undefined : 'ytsearch';
        const res    = await client.moon.search({ query, source });

        console.log('🔍 SEARCH DEBUG:', JSON.stringify({
          query,
          source,
          loadType:   res?.loadType,
          trackCount: res?.tracks?.length ?? 0,
          firstTrack: res?.tracks?.[0]?.info?.title ?? null,
          rawKeys:    Object.keys(res ?? {}),
        }, null, 2));

        if (!res.tracks?.length) return loadingMsg.edit('❌ No se encontraron resultados.');

        player.requester = message.author.id;

        if (res.loadType === 'playlist') {
          for (const track of res.tracks) player.queue.add(track);
          if (!player.playing) player.play();
          await loadingMsg.edit(`✅ Playlist **${res.playlistInfo?.name || 'Sin nombre'}** — ${res.tracks.length} canciones añadidas.`);
        } else {
          const track = res.tracks[0];
          player.queue.add(track);
          if (!player.playing) player.play();

          if (player.playing && player.queue.size > 0) {
            await loadingMsg.edit(`➕ **${track.info.title}** (${formatMs(track.info.length)}) añadido a la cola.`);
          } else {
            await loadingMsg.delete().catch(() => {});
          }
        }
      }

    } catch (err) {
      console.error('Error en play:', err);
      if (err.message?.includes('tiempo') || err.message?.includes('Lavalink')) {
        loadingMsg.edit('❌ El servidor de música tardó demasiado en conectar. Inténtalo de nuevo en unos segundos.').catch(() => {});
      } else {
        loadingMsg.edit('❌ Ocurrió un error. Revisa la consola para más detalles.').catch(() => {});
      }
    }
  },
};

function formatMs(ms) {
  if (!ms) return '??:??';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}
