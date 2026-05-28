const { EmbedBuilder } = require('discord.js');
const { canControl } = require('../permissions');

module.exports = {
  name: 'leave',
  aliases: ['dc', 'disconnect'],
  description: 'Desconecta el bot del canal de voz',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    if (!player)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No hay cola activa.')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannel) return;

    const fakeQueue = { getNowPlaying: () => ({ requestedBy: { id: player.requester } }), voiceChannel: vc };
    const { allowed, reason } = canControl(message.member, fakeQueue, 'l!dc');
    if (!allowed) return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription(reason)] });

    player.destroy();
    message.reply({ embeds: [
      new EmbedBuilder().setColor('#95A5A6').setDescription('👋 **Desconectado y cola limpiada.**')
    ]});
  },
};
