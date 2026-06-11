const { EmbedBuilder } = require('discord.js');
const spotify = require('../spotify');
const lavalinkState = require('../lavalinkState');

function isSpotifyURL(str) { return str.includes('open.spotify.com'); }

// Normaliza tracks de Lavalink v4 a estructura con .info
function normalizeTracks(res) {
  if (Array.isArray(res?.tracks) && res.tracks.length > 0 && res.tracks[0]?.info?.title) {
    return res.tracks;
  }
  const source = Array.isArray(res?.tracks) && res.tracks.length > 0
    ? res.tracks
    : (Array.isArray(res?.data) ? res.data : []);

  return source
    .filter(t => t?.encoded)
    .map(t => {
      const info = t.info ?? {
        title:      t.title      ?? 'Desconocido',
        author:     t.author     ?? 'Desconocido',
        length:     t.duration   ?? t.length ?? 0,
        identifier: t.identifier ?? '',
        uri:        t.url        ?? t.uri    ?? '',
        artworkUrl: t.artworkUrl ?? t.thumbnail ?? '',
        isStream:   t.isStream   ?? false,
        isSeekable: t.isSeekable ?? true,
        sourceName: t.sourceName ?? 'spotify',
        position:   t.position   ?? 0,
        isrc:       t.isrc       ?? null,
      };
      return {
        encoded:    t.encoded,
        track:      t.encoded,
        info,
        pluginInfo: t.pluginInfo ?? {},
        userData:   t.userData   ?? {},
      };
    });
}

function getNodes(moon) {
  try { return [...moon.nodes.map.values()]; }
  catch { return []; }
}

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
  description: 'Reproduce música de Spotify o por búsqueda',
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
      if (!lavalinkState.isReady()) {
        await loadingMsg.edit('⏳ Conectando al servidor de música, espera un momento...');
        await waitForLavalink(45000);
      }

      console.log('Lavalink Debug:', getNodes(client.moon).map(n => ({
        state: n.state, host: n.host, socket: n.socket?.constructor?.name ?? 'null'
      })));

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

      // ── Spotify URL directa ───────────────────────────────────────────────
      if (isSpotifyURL(query)) {
        const type = spotify.getSpotifyType(query);
        if (!type) return loadingMsg.edit('❌ URL de Spotify no válida.');

        if (type === 'track') {
          await loadingMsg.edit('🟢 Cargando canción de Spotify...');
          // Buscar directo en Spotify via LavaSrc
          const res = await client.moon.search({ query, source: 'spsearch' });
          const tracks = normalizeTracks(res);

          // Fallback: si LavaSrc no está disponible, buscar por metadatos
          let finalTracks = tracks;
          if (!finalTracks.length) {
            const [meta] = await spotify.getTrack(query);
            const ytRes = await client.moon.search({ query: meta.searchQuery, source: 'ytsearch' });
            finalTracks = normalizeTracks(ytRes);
            if (finalTracks.length) finalTracks[0].info.title = meta.title;
          }

          if (!finalTracks.length) return loadingMsg.edit('❌ No encontré esa canción.');
          const track = finalTracks[0];
          player.requester = message.author.id;
          player.queue.add(track);
          if (!player.playing) await player.play();
          await loadingMsg.edit(`➕ **${track.info.title}** añadido a la cola.`);

        } else if (type === 'playlist') {
          await loadingMsg.edit('🟢 Cargando playlist de Spotify...');
          // LavaSrc carga playlists de Spotify directamente
          const res = await client.moon.search({ query, source: 'spsearch' });
          let tracks = normalizeTracks(res);

          if (tracks.length > 0) {
            // LavaSrc cargó la playlist directo
            const wasPlaying = player.playing;
            player.requester = message.author.id;
            for (const t of tracks) player.queue.add(t);
            if (!wasPlaying) await player.play();
            const name = res.playlistInfo?.name || 'Playlist de Spotify';
            await loadingMsg.edit(`✅ Playlist **${name}** — ${tracks.length} canciones añadidas.`);
          } else {
            // Fallback: obtener metadatos y buscar en YouTube
            const { tracks: spTracks, playlistName, total } = await spotify.getPlaylist(query);
            await loadingMsg.edit(`📋 Cargando **${playlistName}** — ${total} canciones...`);
            const wasPlaying = player.playing;
            let added = 0;
            for (const t of spTracks) {
              const r = await client.moon.search({ query: t.searchQuery, source: 'ytsearch' });
              const found = normalizeTracks(r);
              if (found.length) {
                found[0].info.title = t.title;
                player.requester = message.author.id;
                player.queue.add(found[0]);
                added++;
              }
            }
            if (!wasPlaying && added > 0) await player.play();
            await loadingMsg.edit(`✅ Playlist **${playlistName}** — ${added}/${total} canciones añadidas.`);
          }

        } else if (type === 'album') {
          await loadingMsg.edit('🟢 Cargando álbum de Spotify...');
          const res = await client.moon.search({ query, source: 'spsearch' });
          let tracks = normalizeTracks(res);

          if (tracks.length > 0) {
            const wasPlaying = player.playing;
            player.requester = message.author.id;
            for (const t of tracks) player.queue.add(t);
            if (!wasPlaying) await player.play();
            const name = res.playlistInfo?.name || 'Álbum de Spotify';
            await loadingMsg.edit(`✅ Álbum **${name}** — ${tracks.length} canciones añadidas.`);
          } else {
            // Fallback
            const { tracks: spTracks, albumName, total } = await spotify.getAlbum(query);
            await loadingMsg.edit(`💿 Cargando **${albumName}** — ${total} canciones...`);
            const wasPlaying = player.playing;
            let added = 0;
            for (const t of spTracks) {
              const r = await client.moon.search({ query: t.searchQuery, source: 'ytsearch' });
              const found = normalizeTracks(r);
              if (found.length) {
                found[0].info.title = t.title;
                player.requester = message.author.id;
                player.queue.add(found[0]);
                added++;
              }
            }
            if (!wasPlaying && added > 0) await player.play();
            await loadingMsg.edit(`✅ Álbum **${albumName}** — ${added}/${total} canciones añadidas.`);
          }
        }

      // ── Texto libre: buscar primero en Spotify, luego YouTube ─────────────
      } else {
        let tracks = [];
        let usedSource = 'spsearch';

        if (!query.startsWith('http')) {
          // Intentar Spotify primero
          const spRes = await client.moon.search({ query, source: 'spsearch' });
          tracks = normalizeTracks(spRes);
          console.log('🟢 Spotify search:', tracks.length, 'tracks');
        }

        if (!tracks.length) {
          // Fallback a YouTube
          usedSource = 'ytsearch';
          const source = query.startsWith('http') ? undefined : 'ytsearch';
          const ytRes  = await client.moon.search({ query, source });
          tracks = normalizeTracks(ytRes);
          console.log('🔴 YouTube fallback:', tracks.length, 'tracks');
        }

        console.log('🔍 SEARCH DEBUG:', JSON.stringify({
          query, usedSource,
          trackCount: tracks.length,
          firstTrack: tracks[0]?.info?.title ?? null,
        }, null, 2));

        if (!tracks.length) return loadingMsg.edit('❌ No se encontraron resultados.');

        player.requester = message.author.id;
        const track = tracks[0];
        player.queue.add(track);
        if (!player.playing) await player.play();

        if (player.playing && player.queue.size > 0) {
          await loadingMsg.edit(`➕ **${track.info.title}** (${formatMs(track.info.length)}) añadido a la cola.`);
        } else {
          await loadingMsg.delete().catch(() => {});
        }
      }

    } catch (err) {
      console.error('Error en play:', err);
      if (err.message?.includes('tiempo') || err.message?.includes('Lavalink')) {
        loadingMsg.edit('❌ El servidor de música tardó demasiado. Inténtalo de nuevo.').catch(() => {});
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
