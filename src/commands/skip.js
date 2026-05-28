// ── skip.js ──────────────────────────────────────────────────────────────────
const { EmbedBuilder } = require('discord.js');
const { canControl, canStop } = require('../permissions');

module.exports = {
  name: 'skip',
  aliases: ['s'],
  description: 'Salta la canción actual',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    if (!player?.playing)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No hay música reproduciéndose.')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannel) return;

    const nowPlaying = player.current;
    const fakeQueue  = { getNowPlaying: () => ({ requestedBy: { id: player.requester } }), voiceChannel: vc };
    const { allowed, reason } = canControl(message.member, fakeQueue, 'l!skip');
    if (!allowed) return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription(reason)] });

    player.stop();
    message.reply({ embeds: [
      new EmbedBuilder()
        .setColor('#F39C12')
        .setAuthor({ name: '⏭️ Canción saltada' })
        .setDescription(`**${nowPlaying?.info?.title || 'Canción actual'}**`)
        .setFooter({ text: `Saltada por ${message.author.username} • LEGADO MUSIC` })
    ]});
  },
};
