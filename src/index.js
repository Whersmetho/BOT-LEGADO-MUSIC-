require('dotenv').config();

const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MoonlinkManager } = require('moonlink.js');
const fs   = require('fs');
const path = require('path');
const { initSpotify } = require('./spotify');
const { handleMessage: automodHandle } = require('./commands/automod');
const lavalinkState = require('./lavalinkState');

process.on('unhandledRejection', (err) => {
  console.error('❌ Unhandled Rejection:', err?.message || err);
});
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err?.message || err);
});

const token               = process.env.TOKEN?.trim();
const spotifyClientId     = process.env.SPOTIFY_CLIENT_ID;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

if (!token) { console.error('❌ TOKEN no encontrado'); process.exit(1); }

const lavalinkSecure = process.env.LAVALINK_SECURE === 'true';
const LAVALINK_NODES = [
  {
    host:     process.env.LAVALINK_HOST     || 'lavalink.jirayu.net',
    port:     parseInt(process.env.LAVALINK_PORT) || (lavalinkSecure ? 443 : 80),
    password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure:   lavalinkSecure,
  },
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

client.commands = new Collection();
client.aliases  = new Collection();

const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsPath, file));
  if (!cmd.name) continue;
  client.commands.set(cmd.name, cmd);
  if (cmd.aliases) cmd.aliases.forEach(a => client.aliases.set(a, cmd.name));
}

client.moon = new MoonlinkManager(
  LAVALINK_NODES,
  { clientName: 'LEGADO MUSIC' },
  (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(JSON.parse(payload));
  }
);

client.moon.on('nodeCreate', node => {
  console.log(`🔄 Nodo Lavalink creado: ${node.host}:${node.port}`);
});
client.moon.on('nodeReady', node => {
  lavalinkState.setReady(true);
  console.log(`🟢 Nodo Lavalink listo: ${node.host}:${node.port}`);
});
client.moon.on('nodeError', (node, err) =>
  console.error(`❌ Error en nodo ${node.host}:`, err?.message || err)
);
client.moon.on('playerError', (player, error) => {
  console.error('PLAYER ERROR:', error);
});
client.moon.on('nodeDestroy', node => {
  lavalinkState.setReady(false);
  console.warn(`🔴 Nodo destruido: ${node.host} — reconectando en 10s...`);
  setTimeout(() => {
    try { client.moon.init(client.user.id); } catch {}
  }, 10000);
});

setInterval(() => {
  try {
    if (lavalinkState.isReady()) return;
    const nodes = [...(client.moon.nodes?.map?.values() ?? [])];
    const node  = nodes[0];
    if (node && node.state !== 'CONNECTED' && node.state !== 'READY') {
      console.log('🔄 Reintentando conexión a Lavalink...');
      client.moon.init(client.user.id);
    }
  } catch {}
}, 60_000);

client.moon.on('trackEnd', async (player, track) => {
  const textChannel = client.channels.cache.get(player.textChannel);
  if (!textChannel) return;

  if (player.nowPlayingMsgId) {
    try {
      const msg = await textChannel.messages.fetch(player.nowPlayingMsgId);
      await msg.edit({ components: [disabledButtons(player)] });
    } catch {}
    player.nowPlayingMsgId = null;
  }

  if (player.loop) { player.play(); return; }
  if (player.queue.size > 0) { player.play(); return; }

  if (player.autoplay) {
    await playRelated(player, track, textChannel);
    return;
  }

  player.playing = false;
  try {
    textChannel.send({ embeds: [
      new EmbedBuilder()
        .setColor('#2ECC71')
        .setDescription('✅ **Cola vacía. ¡Hasta la próxima!**')
        .setFooter({ text: 'LEGADO MUSIC' })
    ]});
  } catch {}
  setTimeout(() => { try { player.destroy(); } catch {} }, 30000);
});

client.moon.on('trackStart', async (player, track) => {
  const textChannel = client.channels.cache.get(player.textChannel);
  if (!textChannel) return;

  const embed = nowPlayingEmbed(track, player);
  const row   = enabledButtons(player);

  try {
    const msg = await textChannel.send({ embeds: [embed], components: [row] });
    player.nowPlayingMsgId = msg.id;
  } catch {}
});

client.moon.on('trackError', async (player, track, err) => {
  console.error('TRACK ERROR:', err);
  const textChannel = client.channels.cache.get(player.textChannel);
  if (textChannel) {
    try {
      textChannel.send({ embeds: [
        new EmbedBuilder().setColor('#E74C3C').setDescription('❌ **Error al reproducir esta canción. Saltando...**')
      ]});
    } catch {}
  }
  // Intentar siguiente canción
  if (player.queue.size > 0) {
    setTimeout(() => { try { player.play(); } catch {} }, 1000);
  }
});

client.once('clientReady', () => {
  console.log(`✅ Bot listo como ${client.user.tag}`);
  client.user.setActivity('🎵 l!help para comandos');
  client.moon.init(client.user.id);
  console.log('🔄 Conectando a Lavalink...');

  if (spotifyClientId && spotifyClientSecret) {
    initSpotify(spotifyClientId, spotifyClientSecret);
    console.log('🟢 Spotify API inicializado');
  } else {
    console.warn('⚠️ SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET no definidos');
  }
});

client.on('raw', data => {
  if (data.t === 'VOICE_SERVER_UPDATE' || data.t === 'VOICE_STATE_UPDATE') {
    console.log(`🎙️ Voice packet: ${data.t}`, JSON.stringify(data.d).substring(0, 150));
    client.moon.packetUpdate(data);
  }
});

client.on('voiceStateUpdate', (oldState, newState) => {
  if (newState.member?.user?.id === client.user?.id) {
    console.log('🎙️ Bot voiceStateUpdate — channelId:', newState.channelId, 'sessionId:', newState.sessionId);
    client.moon.packetUpdate({
      t: 'VOICE_STATE_UPDATE',
      d: {
        guild_id:   newState.guild.id,
        user_id:    newState.member.user.id,
        channel_id: newState.channelId,
        session_id: newState.sessionId,
      }
    });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const musicButtons = ['btn_pause', 'btn_skip', 'btn_stop', 'btn_loop', 'btn_autoplay'];
  if (!musicButtons.includes(interaction.customId)) return;

  const player = client.moon.players.get(interaction.guild.id);
  if (!player) return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel || voiceChannel.id !== player.voiceChannel)
    return interaction.reply({ content: '🎤 Debes estar en el canal de voz.', ephemeral: true });

  await interaction.deferUpdate();

  switch (interaction.customId) {
    case 'btn_pause':
      if (player.paused) { player.resume(); interaction.followUp({ content: '▶️ Reanudado.', ephemeral: true }); }
      else               { player.pause();  interaction.followUp({ content: '⏸️ Pausado.',   ephemeral: true }); }
      break;
    case 'btn_skip':
      player.stop();
      interaction.followUp({ content: '⏭️ Saltado.', ephemeral: true });
      break;
    case 'btn_stop':
      player.destroy();
      interaction.followUp({ content: '⏹️ Música detenida.', ephemeral: true });
      break;
    case 'btn_loop':
      player.loop = !player.loop;
      interaction.followUp({ content: player.loop ? '🔁 Bucle activado.' : '➡️ Bucle desactivado.', ephemeral: true });
      break;
    case 'btn_autoplay':
      player.autoplay = !player.autoplay;
      interaction.followUp({ content: player.autoplay ? '🔀 Autoplay activado.' : '⏹️ Autoplay desactivado.', ephemeral: true });
      break;
  }
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  await automodHandle(message, client);
  if (!message.guild) return;

  const prefix = 'l!';
  if (!message.content.toLowerCase().startsWith(prefix)) return;

  const args        = message.content.slice(prefix.length).trim().split(/ +/);
  const commandName = args.shift().toLowerCase();
  const resolved    = client.aliases.get(commandName) || commandName;
  const command     = client.commands.get(resolved);
  if (!command) return;

  try {
    await command.execute(message, args, client);
  } catch (err) {
    console.error(`❌ Error en ${commandName}:`, err);
    message.reply('❌ Ocurrió un error ejecutando ese comando.').catch(() => {});
  }
});

client.login(token).catch(err => console.error('❌ Error al iniciar sesión:', err));

// ── Helpers ───────────────────────────────────────────────────────────────────
function nowPlayingEmbed(track, player) {
  const info = track.info || track;
  const thumbnail = info.artworkUrl
    || (info.identifier ? `https://img.youtube.com/vi/${info.identifier}/hqdefault.jpg` : null);

  return new EmbedBuilder()
    .setColor('#1DB954')  // verde de Spotify
    .setAuthor({ name: '▶️ Reproduciendo ahora' })
    .setTitle(info.title)
    .setURL(info.uri)
    .setThumbnail(thumbnail)
    .addFields(
      { name: '⏱️ Duración',   value: formatMs(info.length), inline: true },
      { name: '🎧 Pedido por', value: player.requester ? `<@${player.requester}>` : 'Desconocido', inline: true },
      { name: '🔀 Autoplay',   value: player.autoplay ? 'Activado' : 'Desactivado', inline: true },
    )
    .setFooter({ text: `LEGADO MUSIC • ${player.queue.size} en cola` })
    .setTimestamp();
}

function enabledButtons(player) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('btn_loop').setEmoji('🔁').setStyle(player.loop ? ButtonStyle.Primary : ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('btn_autoplay').setEmoji('🔀').setStyle(player.autoplay ? ButtonStyle.Primary : ButtonStyle.Secondary),
  );
}

function disabledButtons(player) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('btn_pause').setEmoji('⏸️').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('btn_skip').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('btn_stop').setEmoji('⏹️').setStyle(ButtonStyle.Danger).setDisabled(true),
    new ButtonBuilder().setCustomId('btn_loop').setEmoji('🔁').setStyle(ButtonStyle.Secondary).setDisabled(true),
    new ButtonBuilder().setCustomId('btn_autoplay').setEmoji('🔀').setStyle(ButtonStyle.Secondary).setDisabled(true),
  );
}

function formatMs(ms) {
  if (!ms) return '??:??';
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, '0')}`;
}

function normalizeTracks(res) {
  if (Array.isArray(res?.tracks) && res.tracks.length > 0 && res.tracks[0]?.info?.title) return res.tracks;
  const source = (Array.isArray(res?.tracks) && res.tracks.length > 0) ? res.tracks : (Array.isArray(res?.data) ? res.data : []);
  return source.filter(t => t?.encoded).map(t => {
    const info = t.info ?? { title: t.title ?? 'Desconocido', author: t.author ?? 'Desconocido', length: t.duration ?? t.length ?? 0, identifier: t.identifier ?? '', uri: t.url ?? t.uri ?? '', artworkUrl: t.artworkUrl ?? '', isStream: t.isStream ?? false, isSeekable: t.isSeekable ?? true, sourceName: t.sourceName ?? 'spotify', position: 0, isrc: null };
    return { encoded: t.encoded, track: t.encoded, info, pluginInfo: t.pluginInfo ?? {}, userData: t.userData ?? {} };
  });
}

async function playRelated(player, track, textChannel) {
  try {
    const info = track.info || track;
    // Buscar relacionadas en Spotify primero, luego YouTube
    const query = `${info.title} ${info.author || ''}`.trim();
    let res = await client.moon.search({ query, source: 'spsearch' });
    let allTracks = normalizeTracks(res);
    if (!allTracks.length) {
      res = await client.moon.search({ query, source: 'ytsearch' });
      allTracks = normalizeTracks(res);
    }
    if (!allTracks.length) throw new Error('Sin resultados');
    const related = allTracks.find(t => t.info?.uri !== info.uri) || allTracks[0];
    player.queue.add(related);
    player.play();
  } catch {
    try {
      textChannel.send({ embeds: [
        new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No encontré canciones relacionadas.')
      ]});
    } catch {}
    setTimeout(() => { try { player.destroy(); } catch {} }, 30000);
  }
}

client.moon.on('nodeDisconnect', (node, reason) => {
  console.log('🔴 NODE DISCONNECT', { host: node.host, reason });
});

// Debug: log moonlink events safely (avoiding circular refs)
const moonEvents = ["trackStart","trackEnd","trackError","trackStuck","playerCreate","playerDestroy","playerUpdate","queueEnd","socketClosed","start","end","error","stuck"];
moonEvents.forEach(evt => {
  client.moon.on(evt, (...args) => {
    try {
      const safe = args.map(a => (!a || typeof a !== "object") ? a : { title: a?.info?.title || a?.track?.info?.title || "?", type: a?.constructor?.name });
      console.log("🌙 moonlink event: " + evt, JSON.stringify(safe));
    } catch { console.log("🌙 moonlink event: " + evt + " [circular]"); }
  });
});
