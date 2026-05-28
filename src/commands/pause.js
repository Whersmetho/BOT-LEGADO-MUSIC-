const { EmbedBuilder } = require('discord.js');
const { canControl } = require('../permissions');

module.exports = {
  name: 'pause',
  description: 'Pausa la reproducción',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    if (!player?.playing)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No hay música reproduciéndose.')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannelId) return;

    const fakeQueue = { getNowPlaying: () => ({ requestedBy: { id: player.requester } }), voiceChannel: vc };
    const { allowed, reason } = canControl(message.member, fakeQueue, 'l!pause');
    if (!allowed) return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription(reason)] });

    player.pause();
    message.reply({ embeds: [
      new EmbedBuilder()
        .setColor('#F39C12')
        .setDescription('⏸️ **Música pausada.**')
        .setFooter({ text: 'LEGADO MUSIC' })
    ]});
  },
};
