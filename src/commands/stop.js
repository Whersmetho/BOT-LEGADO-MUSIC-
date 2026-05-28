const { EmbedBuilder } = require('discord.js');
const { canStop } = require('../permissions');

module.exports = {
  name: 'stop',
  description: 'Detiene la música y limpia la cola',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    if (!player)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No hay música en cola.')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannel) return;

    const fakeQueue = { voiceChannel: vc };
    const { allowed, reason } = canStop(message.member, fakeQueue);
    if (!allowed) return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription(reason)] });

    player.destroy();
    message.reply({ embeds: [
      new EmbedBuilder()
        .setColor('#E74C3C')
        .setDescription('⏹️ **Música detenida y cola limpiada.**')
        .setFooter({ text: `Detenido por ${message.author.username} • LEGADO MUSIC` })
    ]});
  },
};
