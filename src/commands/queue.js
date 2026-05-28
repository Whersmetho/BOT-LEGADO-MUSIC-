const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

function formatMs(ms) {
  if (!ms) return '??:??';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

function buildQueueEmbed(player, page) {
  const now      = player.current;
  const upcoming = player.queue.tracks || [];
  const perPage  = 10;
  const total    = Math.max(1, Math.ceil(upcoming.length / perPage));
  const safePage = Math.min(Math.max(0, page), total - 1);
  const slice    = upcoming.slice(safePage * perPage, safePage * perPage + perPage);

  const embed = new EmbedBuilder()
    .setColor('#9B59B6')
    .setAuthor({ name: '📋 Cola de reproducción' })
    .setThumbnail(now?.info?.artworkUrl || `https://img.youtube.com/vi/${now?.info?.identifier}/hqdefault.jpg`)
    .setFooter({ text: `LEGADO MUSIC • Página ${safePage + 1}/${total} • ${upcoming.length + 1} canción(es)` })
    .setTimestamp();

  embed.addFields({
    name: '▶️ Reproduciendo ahora',
    value: `[${now?.info?.title || '?'}](${now?.info?.uri || '#'}) • \`${formatMs(now?.info?.length)}\` • ${player.requester ? `<@${player.requester}>` : 'Desconocido'}`,
  });

  if (slice.length > 0) {
    embed.addFields({
      name: '⏭️ A continuación',
      value: slice.map((t, i) =>
        `\`${safePage * perPage + i + 1}.\` [${t.info.title}](${t.info.uri}) • \`${formatMs(t.info.length)}\``
      ).join('\n'),
    });
  } else {
    embed.addFields({ name: '⏭️ A continuación', value: '_No hay más canciones en cola._' });
  }

  if (player.loop === 'track') embed.addFields({ name: '🔁 Bucle', value: 'Activado', inline: true });
  if (player.autoplay)         embed.addFields({ name: '🔀 Autoplay', value: 'Activado', inline: true });

  return { embed, totalPages: total, safePage };
}

module.exports = {
  name: 'queue',
  aliases: ['q'],
  description: 'Muestra la cola de canciones',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    if (!player?.current)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('📭 **La cola está vacía.**')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannel) return;

    let page = 0;
    const { embed, totalPages, safePage } = buildQueueEmbed(player, page);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('queue_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(true),
      new ButtonBuilder().setCustomId('queue_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(totalPages <= 1),
    );

    const reply = await message.reply({ embeds: [embed], components: totalPages > 1 ? [row] : [] });
    if (totalPages <= 1) return;

    const collector = reply.createMessageComponentCollector({ time: 60000 });
    collector.on('collect', async (i) => {
      if (i.user.id !== message.author.id)
        return i.reply({ content: '❌ Solo quien ejecutó el comando puede cambiar la página.', ephemeral: true });

      if (i.customId === 'queue_prev') page = Math.max(0, page - 1);
      if (i.customId === 'queue_next') page = Math.min(totalPages - 1, page + 1);

      const { embed: e, totalPages: tp, safePage: sp } = buildQueueEmbed(player, page);
      const newRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('queue_prev').setEmoji('◀️').setStyle(ButtonStyle.Secondary).setDisabled(sp === 0),
        new ButtonBuilder().setCustomId('queue_next').setEmoji('▶️').setStyle(ButtonStyle.Secondary).setDisabled(sp >= tp - 1),
      );
      await i.update({ embeds: [e], components: [newRow] });
    });
    collector.on('end', () => reply.edit({ components: [] }).catch(() => {}));
  },
};
