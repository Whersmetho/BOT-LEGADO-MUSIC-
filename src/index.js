require('dotenv').config();

const { Client, GatewayIntentBits, Collection, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { MoonlinkManager } = require('moonlink.js');
const fs   = require('fs');
const path = require('path');
const { initSpotify } = require('./spotify');
const { handleMessage: automodHandle } = require('./commands/automod');

const token               = process.env.TOKEN?.trim();
const spotifyClientId     = process.env.SPOTIFY_CLIENT_ID;
const spotifyClientSecret = process.env.SPOTIFY_CLIENT_SECRET;

if (!token) { console.error('❌ TOKEN no encontrado'); process.exit(1); }

// ── Nodos de Lavalink (públicos y gratuitos) ─────────────────────────────────
// Puedes agregar más nodos de https://lavalink-list.autm.dev
const LAVALINK_NODES = [
  {
    host:     process.env.LAVALINK_HOST     || 'lavalink.jirayu.net',
    port:     parseInt(process.env.LAVALINK_PORT)     || 13592,
    password: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure:   false,
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

// ── Cargar comandos ──────────────────────────────────────────────────────────
const commandsPath = path.join(__dirname, 'commands');
for (const file of fs.readdirSync(commandsPath).filter(f => f.endsWith('.js'))) {
  const cmd = require(path.join(commandsPath, file));
  if (!cmd.name) continue;
  client.commands.set(cmd.name, cmd);
  if (cmd.aliases) cmd.aliases.forEach(a => client.aliases.set(a, cmd.name));
}

// ── Moonlink (Lavalink) ──────────────────────────────────────────────────────
client.moon = new MoonlinkManager(
  LAVALINK_NODES,
  { clientName: 'LEGADO MUSIC' },
  (guildId, payload) => {
    const guild = client.guilds.cache.get(guildId);
    if (guild) guild.shard.send(JSON.parse(payload));
  }
);

// Eventos del manager
client.moon.on('nodeCreate', node =>
  console.log(`🟢 Nodo Lavalink conectado: ${node.host}:${node.port}`)
);
client.moon.on('nodeError', (node, err) =>
  console.error(`❌ Error en nodo ${node.host}:`, err.message)
);
client.moon.on('nodeDestroy', node =>
  console.warn(`🔴 Nodo destruido: ${node.host}`)
);

// Cuando termina una canción → reproducir la siguiente
client.moon.on('trackEnd', async (player, track) => {
  const textChannel = client.channels.cache.get(player.textChannelId);
  if (!textChannel) return;

  // Deshabilitar botones del mensaje anterior
  if (player.nowPlayingMsgId) {
    try {
      const msg = await textChannel.messages.fetch(player.nowPlayingMsgId);
      await msg.edit({ components: [disabledButtons(player)] });
    } catch {}
    player.nowPlayingMsgId = null;
  }

  if (player.loop === 'track') {
    player.play();
    return;
  }

  if (player.queue.size > 0) {
    player.play();
    return;
  }

  if (player.autoplay) {
    await playRelated(player, track, textChannel);
    return;
  }

  // Cola vacía
  player.playing = false;
  textChannel.send({ embeds: [
    new EmbedBuilder()
      .setColor('#2ECC71')
      .setDescription('✅ **Cola vacía. ¡Hasta la próxima!**')
      .setFooter({ text: 'LEGADO MUSIC' })
  ]});
  setTimeout(() => { try { player.destroy(); } catch {} }, 30000);
});

// Cuando empieza una canción → mostrar embed
client.moon.on('trackStart', async (player, track) => {
  const textChannel = client.channels.cache.get(player.textChannelId);
  if (!textChannel) return;

  const embed = nowPlayingEmbed(track, player);
  const row   = enabledButtons(player);

  try {
    const msg = await textChannel.send({ embeds: [embed], components: [row] });
    player.nowPlayingMsgId = msg.id;
  } catch {}
});

client.moon.on('trackError', async (player, track, err) => {
  console.error('Track error:', err);
  const textChannel = client.channels.cache.get(player.textChannelId);
  if (textChannel) {
    textChannel.send({ embeds: [
      new EmbedBuilder().setColor('#E74C3C').setDescription('❌ **Error al reproducir esta canción. Saltando...**')
    ]});
  }
});

// ── Ready ────────────────────────────────────────────────────────────────────
client.once('ready', () => {
  console.log(`✅ Bot listo como ${client.user.tag}`);
  client.user.setActivity('🎵 l!help para comandos');
  client.moon.init(client.user.id);

  if (spotifyClientId && spotifyClientSecret) {
    initSpotify(spotifyClientId, spotifyClientSecret);
    console.log('🟢 Spotify conectado');
  }
});

// ── Necesario para que Lavalink reciba eventos de voz ────────────────────────
client.on('raw', data => client.moon.packetUpdate(data));

// ── Botones interactivos ─────────────────────────────────────────────────────
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isButton()) return;

  const player = client.moon.players.get(interaction.guild.id);
  if (!player) return interaction.reply({ content: '❌ No hay música reproduciéndose.', ephemeral: true });

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel || voiceChannel.id !== player.voiceChannelId)
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
      player.loop = player.loop === 'track' ? 'off' : 'track';
      interaction.followUp({ content: player.loop === 'track' ? '🔁 Bucle activado.' : '➡️ Bucle desactivado.', ephemeral: true });
      break;
    case 'btn_autoplay':
      player.autoplay = !player.autoplay;
      interaction.followUp({ content: player.autoplay ? '🔀 Autoplay activado.' : '⏹️ Autoplay desactivado.', ephemeral: true });
      break;
  }
});

// ── Mensajes ─────────────────────────────────────────────────────────────────
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
    message.reply('❌ Ocurrió un error ejecutando ese comando.');
  }
});

client.login(token).catch(err => console.error('❌ Error al iniciar sesión:', err));

// ── Helpers ──────────────────────────────────────────────────────────────────
function nowPlayingEmbed(track, player) {
  const info = track.info || track;
  return new EmbedBuilder()
    .setColor('#9B59B6')
    .setAuthor({ name: '▶️ Reproduciendo ahora' })
    .setTitle(info.title)
    .setURL(info.uri)
    .setThumbnail(info.artworkUrl || `https://img.youtube.com/vi/${info.identifier}/hqdefault.jpg`)
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
    new ButtonBuilder().setCustomId('btn_loop').setEmoji('🔁').setStyle(player.loop === 'track' ? ButtonStyle.Primary : ButtonStyle.Secondary),
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

async function playRelated(player, track, textChannel) {
  try {
    const info = track.info || track;
    const res  = await client.moon.search({
      query: `${info.title} related`,
      source: 'youtube',
    });
    if (!res.tracks?.length) throw new Error('Sin resultados');
    const related = res.tracks.find(t => t.info?.uri !== info.uri) || res.tracks[0];
    player.queue.add(related);
    player.play();
  } catch {
    textChannel.send({ embeds: [
      new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No encontré canciones relacionadas.')
    ]});
    setTimeout(() => { try { player.destroy(); } catch {} }, 30000);
  }
}
