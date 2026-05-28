const { EmbedBuilder } = require('discord.js');
const { canControl } = require('../permissions');

module.exports = {
  name: 'resume',
  aliases: ['r'],
  description: 'Reanuda la reproducción',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    if (!player)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No hay música en cola.')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannelId) return;

    const fakeQueue = { getNowPlaying: () => ({ requestedBy: { id: player.requester } }), voiceChannel: vc };
    const { allowed, reason } = canControl(message.member, fakeQueue, 'l!resume');
    if (!allowed) return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription(reason)] });

    player.resume();
    message.reply({ embeds: [
      new EmbedBuilder()
        .setColor('#2ECC71')
        .setDescription('▶️ **Música reanudada.**')
        .setFooter({ text: 'LEGADO MUSIC' })
    ]});
  },
};
