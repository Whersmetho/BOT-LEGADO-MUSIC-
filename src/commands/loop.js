const { EmbedBuilder } = require('discord.js');
const { canControl } = require('../permissions');

module.exports = {
  name: 'loop',
  description: 'Activa/desactiva el bucle',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    if (!player?.playing)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No hay música en la cola.')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannel) return;

    const fakeQueue = { getNowPlaying: () => ({ requestedBy: { id: player.requester } }), voiceChannel: vc };
    const { allowed, reason } = canControl(message.member, fakeQueue, 'l!loop');
    if (!allowed) return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription(reason)] });

    player.loop = player.loop === 'track' ? 'off' : 'track';
    const looping = player.loop === 'track';

    message.reply({ embeds: [
      new EmbedBuilder()
        .setColor(looping ? '#9B59B6' : '#95A5A6')
        .setDescription(looping ? '🔁 **Bucle activado.**' : '➡️ **Bucle desactivado.**')
        .setFooter({ text: 'LEGADO MUSIC' })
    ]});
  },
};
