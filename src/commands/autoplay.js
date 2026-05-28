const { EmbedBuilder } = require('discord.js');
const { canControl } = require('../permissions');

module.exports = {
  name: 'autoplay',
  aliases: ['ap'],
  description: 'Activa/desactiva el autoplay',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    if (!player?.current)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No hay música en la cola.')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannelId) return;

    const fakeQueue = { getNowPlaying: () => ({ requestedBy: { id: player.requester } }), voiceChannel: vc };
    const { allowed, reason } = canControl(message.member, fakeQueue, 'l!autoplay');
    if (!allowed) return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription(reason)] });

    player.autoplay = !player.autoplay;
    message.reply({ embeds: [
      new EmbedBuilder()
        .setColor(player.autoplay ? '#9B59B6' : '#95A5A6')
        .setDescription(player.autoplay
          ? '🔀 **Autoplay activado.** Reproduciré canciones relacionadas automáticamente.'
          : '⏹️ **Autoplay desactivado.**')
        .setFooter({ text: 'LEGADO MUSIC' })
    ]});
  },
};
