const { EmbedBuilder } = require('discord.js');
const spotify = require('../spotify');

function isSpotifyURL(str) { return str.includes('open.spotify.com'); }

// Helper: obtiene los nodos de forma compatible con Map y objeto plano
function getNodes(moon) {
  if (!moon?.nodes) return [];
  try {
    if (typeof moon.nodes.values === 'function') return [...moon.nodes.values()];
    return Object.values(moon.nodes);
  } catch {
    return [];
  }
}

// Espera hasta que Lavalink esté conectado (máx 15s)
function waitForLavalink(client, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const start = Date.now();

    const check = () => {
      try {
        const nodes = getNodes(client.moon);

        if (nodes.length > 0) {
          const node = nodes[0];

          if (
            node.connected === true ||
            node.ws?.readyState === 1
          ) {
            return resolve();
          }
        }

        if (Date.now() - start >= timeout) {
          return reject(new Error('Lavalink no conectó a tiempo'));
        }

        setTimeout(check, 1000);
      } catch (err) {
        reject(err);
      }
    };

    check();
  });
}

module.exports = {
  name: 'play',
  aliases: ['p'],
  description: 'Reproduce música de YouTube o Spotify',
  async execute(message, args, client) {
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
      // Esperar a que Lavalink esté conectado antes de crear el player
      const nodes = getNodes(client.moon);
      if (!nodes.some(n => n.connected)) {
        await loadingMsg.edit('⏳ Conectando al servidor de música, espera un momento...');
        await waitForLavalink(client, 15000);
      }
      
      const nodes = getNodes(client.moon);

console.log(
  'Lavalink Debug:',
  nodes.map(n => ({
    connected: n.connected,
    state: n.ws?.readyState,
    host: n.host
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
          const res = await client.moon.search({ query: trackInfo.searchQuery, source: 'youtube' });
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

          let added = 0;
          for (const t of tracks) {
            const res = await client.moon.search({ query: t.searchQuery, source: 'youtube' });
            if (res.tracks?.length) {
              const track = res.tracks[0];
              track.info.title = t.title;
              player.requester = message.author.id;
              player.queue.add(track);
              if (!player.playing) player.play();
              added++;
            }
          }
          await loadingMsg.edit(`✅ Playlist **${playlistName}** — ${added}/${total} canciones añadidas.`);

        } else if (type === 'album') {
          await loadingMsg.edit('🟢 Cargando álbum de Spotify...');
          const { tracks, albumName, total } = await spotify.getAlbum(query);
          await loadingMsg.edit(`💿 Cargando **${albumName}** — ${total} canciones...`);

          let added = 0;
          for (const t of tracks) {
            const res = await client.moon.search({ query: t.searchQuery, source: 'youtube' });
            if (res.tracks?.length) {
              const track = res.tracks[0];
              track.info.title = t.title;
              player.requester = message.author.id;
              player.queue.add(track);
              if (!player.playing) player.play();
              added++;
            }
          }
          await loadingMsg.edit(`✅ Álbum **${albumName}** — ${added}/${total} canciones añadidas.`);
        }

      // ── YouTube / búsqueda ───────────────────────────────────────────────
      } else {
        const source = query.startsWith('http') ? undefined : 'youtube';
        const res    = await client.moon.search({ query, source });

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
