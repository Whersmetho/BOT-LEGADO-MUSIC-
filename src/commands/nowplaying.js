const { EmbedBuilder } = require('discord.js');

function formatMs(ms) {
  if (!ms) return '??:??';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
}

module.exports = {
  name: 'nowplaying',
  aliases: ['np'],
  description: 'Muestra la canción actual',
  async execute(message, args, client) {
    const player = client.moon.players.get(message.guild.id);
    const track  = player?.current;

    if (!track)
      return message.reply({ embeds: [new EmbedBuilder().setColor('#E74C3C').setDescription('❌ No hay nada reproduciéndose.')] });

    const vc = message.member.voice.channel;
    if (!vc || vc.id !== player.voiceChannelId) return;

    const info = track.info;
    message.reply({ embeds: [
      new EmbedBuilder()
        .setColor('#9B59B6')
        .setAuthor({ name: '🎵 Sonando ahora' })
        .setTitle(info.title)
        .setURL(info.uri)
        .setThumbnail(info.artworkUrl || `https://img.youtube.com/vi/${info.identifier}/hqdefault.jpg`)
        .addFields(
          { name: '⏱️ Duración',  value: formatMs(info.length), inline: true },
          { name: '🎧 Pedido por', value: player.requester ? `<@${player.requester}>` : 'Desconocido', inline: true },
          { name: '🔁 Bucle',     value: player.loop === 'track' ? 'Activado' : 'Desactivado', inline: true },
          { name: '🔀 Autoplay',  value: player.autoplay ? 'Activado' : 'Desactivado', inline: true },
          { name: '📋 En cola',   value: `${player.queue.size} canciones`, inline: true },
        )
        .setFooter({ text: 'LEGADO MUSIC' })
        .setTimestamp()
    ]});
  },
};
