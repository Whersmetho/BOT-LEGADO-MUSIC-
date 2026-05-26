const { EmbedBuilder } = require('discord.js');

// ─────────────────────────────────────────────
// CONFIGURACIÓN POR DEFECTO (por servidor)
// ─────────────────────────────────────────────
const defaultConfig = () => ({
  enabled: true,

  modules: {
    links:        true,
    adultLinks:   true,
    invites:      true,
    spam:         true,
    massMention:  true,
    caps:         true,
    words:        false,
    zalgo:        true,
    spoofLinks:   true,
  },

  spam: {
    messages: 5,
    seconds:  5,
    action:   'mute',
  },
  massMention: {
    threshold: 5,
    action: 'delete',
  },
  caps: {
    percent: 70,
    minLength: 10,
  },

  actions: {
    links:       'delete',
    adultLinks:  'delete',
    invites:     'delete',
    caps:        'delete',
    words:       'delete',
    zalgo:       'delete',
    spoofLinks:  'delete',
  },

  muteDuration: 5 * 60 * 1000,
  logChannel: null,
  blockedWords: [],
  excludedChannels: [],
  excludedRoles: [],
  warnThreshold: 3,
});

// ─────────────────────────────────────────────
// ESTADO EN MEMORIA
// ─────────────────────────────────────────────
const configs     = new Map();
const warns       = new Map();
const spamTracker = new Map();

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function getConfig(guildId) {
  if (!configs.has(guildId)) configs.set(guildId, defaultConfig());
  return configs.get(guildId);
}

function isExempt(member, config) {
  if (!member) return false;
  if (member.permissions.has('ManageMessages')) return true;
  if (member.permissions.has('Administrator')) return true;
  if (config.excludedRoles.some(r => member.roles.cache.has(r))) return true;
  return false;
}

function warnKey(guildId, userId) { return `${guildId}-${userId}`; }
function addWarn(guildId, userId) {
  const key = warnKey(guildId, userId);
  const current = warns.get(key) || 0;
  warns.set(key, current + 1);
  return current + 1;
}
function getWarns(guildId, userId)  { return warns.get(warnKey(guildId, userId)) || 0; }
function clearWarns(guildId, userId){ warns.delete(warnKey(guildId, userId)); }

async function sendLog(guild, config, embed) {
  if (!config.logChannel) return;
  try {
    const ch = await guild.channels.fetch(config.logChannel).catch(() => null);
    if (ch) ch.send({ embeds: [embed] });
  } catch {}
}

async function applyMute(member, duration) {
  try { await member.timeout(duration, 'AutoMod: mute automático'); } catch {}
}

// ─────────────────────────────────────────────
// DETECCIONES
// ─────────────────────────────────────────────
const ADULT_DOMAINS = [
  'pornhub.com','xvideos.com','xnxx.com','xhamster.com',
  'redtube.com','youporn.com','tube8.com','onlyfans.com',
  'fansly.com','brazzers.com','bangbros.com','chaturbate.com',
  'livejasmin.com','stripchat.com','cam4.com','bongacams.com',
];

const URL_REGEX      = /https?:\/\/[^\s]+/gi;
const INVITE_REGEX   = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/i;
const ZALGO_REGEX    = /[\u0300-\u036f\u0489\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]{3,}/;
const SPOOFLINK_REGEX= /\[.*?\]\(https?:\/\/[^\s)]+\)/i;

function detectAdultLink(content)              { return ADULT_DOMAINS.some(d => content.toLowerCase().includes(d)); }
function detectInvite(content)                 { return INVITE_REGEX.test(content); }
function detectLink(content)                   { return URL_REGEX.test(content); }
function detectZalgo(content)                  { return ZALGO_REGEX.test(content); }
function detectSpoofLink(content)              { return SPOOFLINK_REGEX.test(content); }
function detectBlockedWord(content, words)     { const l = content.toLowerCase(); return words.some(w => l.includes(w.toLowerCase())); }
function detectMassMention(content, threshold) {
  const mentions = (content.match(/<@[!&]?\d+>/g) || []).length;
  const everyoneHere = (content.match(/@(everyone|here)/g) || []).length;
  return (mentions + everyoneHere) >= threshold;
}
function detectCaps(content, percent, minLength) {
  const letters = content.replace(/[^a-zA-Z]/g, '');
  if (letters.length < minLength) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return (upper / letters.length) * 100 >= percent;
}

// ─────────────────────────────────────────────
// SPAM TRACKER
// ─────────────────────────────────────────────
function trackSpam(guildId, userId, config) {
  const key = warnKey(guildId, userId);
  let tracker = spamTracker.get(key);
  if (!tracker) {
    tracker = { count: 1 };
    spamTracker.set(key, tracker);
    setTimeout(() => spamTracker.delete(key), config.spam.seconds * 1000);
    return false;
  }
  tracker.count++;
  if (tracker.count >= config.spam.messages) {
    spamTracker.delete(key);
    return true;
  }
  return false;
}

// ─────────────────────────────────────────────
// ACCIÓN
// ─────────────────────────────────────────────
async function takeAction(message, action, reason, config) {
  const { guild, author, channel, member } = message;
  const warnCount = addWarn(guild.id, author.id);

  try { await message.delete(); } catch {}

  const warningEmbed = new EmbedBuilder()
    .setColor('#E74C3C')
    .setAuthor({ name: '🛡️ AutoMod — LEGADO MUSIC' })
    .setDescription(`${author}, tu mensaje fue eliminado.`)
    .addFields({ name: '📌 Razón', value: reason, inline: true })
    .setFooter({ text: `Advertencia ${warnCount}/${config.warnThreshold}` })
    .setTimestamp();

  const warning = await channel.send({ embeds: [warningEmbed] }).catch(() => null);
  if (warning) setTimeout(() => warning.delete().catch(() => {}), 6000);

  const logEmbed = new EmbedBuilder()
    .setColor('#E67E22')
    .setAuthor({ name: '🛡️ AutoMod Log' })
    .setThumbnail(author.displayAvatarURL())
    .addFields(
      { name: '👤 Usuario',      value: `${author.tag} (${author.id})`, inline: true },
      { name: '📌 Razón',        value: reason,                          inline: true },
      { name: '📢 Canal',        value: `<#${channel.id}>`,              inline: true },
      { name: '⚠️ Advertencias', value: `${warnCount}/${config.warnThreshold}`, inline: true },
      { name: '🔨 Acción',       value: action,                          inline: true },
    )
    .setTimestamp();

  await sendLog(guild, config, logEmbed);

  if (action === 'mute' || warnCount >= config.warnThreshold) {
    await applyMute(member, config.muteDuration);
    if (warnCount >= config.warnThreshold) clearWarns(guild.id, author.id);
  } else if (action === 'kick') {
    try { await member.kick(`AutoMod: ${reason}`); } catch {}
  }
}

// ─────────────────────────────────────────────
// HANDLER DE MENSAJES (llamado desde index.js)
// ─────────────────────────────────────────────
async function handleMessage(message, client) {
  if (message.author.bot) return;
  if (!message.guild) return;

  const config = getConfig(message.guild.id);
  if (!config.enabled) return;

  const { member, channel, content } = message;
  if (config.excludedChannels.includes(channel.id)) return;
  if (isExempt(member, config)) return;

  if (config.modules.spam && trackSpam(message.guild.id, message.author.id, config))
    return takeAction(message, config.spam.action, '🚫 Spam detectado', config);

  if (config.modules.adultLinks && detectAdultLink(content))
    return takeAction(message, config.actions.adultLinks, '🔞 Link de contenido adulto', config);

  if (config.modules.invites && detectInvite(content))
    return takeAction(message, config.actions.invites, '📨 Invitación de Discord no permitida', config);

  if (config.modules.links && detectLink(content))
    return takeAction(message, config.actions.links, '🔗 Link no permitido', config);

  if (config.modules.massMention && detectMassMention(content, config.massMention.threshold))
    return takeAction(message, config.massMention.action, `📣 Menciones masivas (${config.massMention.threshold}+)`, config);

  if (config.modules.caps && detectCaps(content, config.caps.percent, config.caps.minLength))
    return takeAction(message, config.actions.caps, '🔠 Mensaje en mayúsculas excesivas', config);

  if (config.modules.zalgo && detectZalgo(content))
    return takeAction(message, config.actions.zalgo, '👾 Texto zalgo/corrupto', config);

  if (config.modules.spoofLinks && detectSpoofLink(content))
    return takeAction(message, config.actions.spoofLinks, '🎭 Link disfrazado con markdown', config);

  if (config.modules.words && config.blockedWords.length > 0 && detectBlockedWord(content, config.blockedWords))
    return takeAction(message, config.actions.words, '🤬 Palabra no permitida', config);
}

// ─────────────────────────────────────────────
// COMANDO l!automod
// ─────────────────────────────────────────────
const name    = 'automod';
const aliases = ['am'];
const description = 'Configura el sistema de AutoMod del servidor.';

async function execute(message, args, client) {
  // Solo administradores
  if (!message.member.permissions.has('Administrator')) {
    return message.reply('❌ Solo los administradores pueden usar este comando.');
  }

  const config = getConfig(message.guild.id);
  const sub    = args[0]?.toLowerCase();

  // ── l!automod (sin args) → mostrar estado ───────────────────────────────
  if (!sub || sub === 'status') {
    const modulesStatus = Object.entries(config.modules)
      .map(([k, v]) => `${v ? '🟢' : '🔴'} \`${k}\``)
      .join('\n');

    const embed = new EmbedBuilder()
      .setColor('#3498DB')
      .setAuthor({ name: '🛡️ AutoMod — Estado actual' })
      .addFields(
        { name: '⚙️ Sistema',   value: config.enabled ? '🟢 Activo' : '🔴 Inactivo', inline: true },
        { name: '📋 Módulos',   value: modulesStatus },
        { name: '📢 Log canal', value: config.logChannel ? `<#${config.logChannel}>` : 'No configurado', inline: true },
        { name: '⚠️ Umbral warns', value: `${config.warnThreshold}`, inline: true },
        { name: '🔇 Duración mute', value: `${config.muteDuration / 60000} min`, inline: true },
      )
      .setFooter({ text: 'Usa l!automod help para ver todos los subcomandos' })
      .setTimestamp();

    return message.channel.send({ embeds: [embed] });
  }

  // ── l!automod help ───────────────────────────────────────────────────────
  if (sub === 'help') {
    const embed = new EmbedBuilder()
      .setColor('#9B59B6')
      .setAuthor({ name: '🛡️ AutoMod — Ayuda' })
      .setDescription('Lista de subcomandos disponibles:')
      .addFields(
        { name: '`l!automod`',                        value: 'Ver estado actual' },
        { name: '`l!automod enable/disable`',         value: 'Activar/desactivar todo el sistema' },
        { name: '`l!automod module <nombre> on/off`', value: 'Activar/desactivar un módulo (links, spam, caps, invites, adultLinks, massMention, zalgo, spoofLinks, words)' },
        { name: '`l!automod setlog <#canal>`',        value: 'Configurar canal de logs' },
        { name: '`l!automod setmute <minutos>`',      value: 'Duración del mute automático' },
        { name: '`l!automod setwarn <número>`',       value: 'Advertencias antes de acción mayor' },
        { name: '`l!automod addword <palabra>`',      value: 'Agregar palabra bloqueada' },
        { name: '`l!automod removeword <palabra>`',   value: 'Quitar palabra bloqueada' },
        { name: '`l!automod words`',                  value: 'Ver palabras bloqueadas' },
        { name: '`l!automod exclude <#canal>`',       value: 'Excluir un canal del automod' },
        { name: '`l!automod unexclude <#canal>`',     value: 'Quitar exclusión de un canal' },
        { name: '`l!automod warns [@usuario]`',       value: 'Ver advertencias de un usuario' },
        { name: '`l!automod clearwarns [@usuario]`',  value: 'Limpiar advertencias de un usuario' },
        { name: '`l!automod reset`',                  value: 'Resetear config a valores por defecto' },
      )
      .setTimestamp();

    return message.channel.send({ embeds: [embed] });
  }

  // ── l!automod enable / disable ───────────────────────────────────────────
  if (sub === 'enable' || sub === 'disable') {
    config.enabled = sub === 'enable';
    return message.reply(`✅ AutoMod **${config.enabled ? 'activado' : 'desactivado'}**.`);
  }

  // ── l!automod module <nombre> on/off ────────────────────────────────────
  if (sub === 'module') {
    const modName = args[1]?.toLowerCase();
    const state   = args[2]?.toLowerCase();
    if (!modName || !state || !['on','off'].includes(state) || !(modName in config.modules)) {
      return message.reply('❌ Uso: `l!automod module <nombre> on/off`\nMódulos: `links`, `adultLinks`, `invites`, `spam`, `massMention`, `caps`, `words`, `zalgo`, `spoofLinks`');
    }
    config.modules[modName] = state === 'on';
    return message.reply(`✅ Módulo \`${modName}\` **${state === 'on' ? 'activado' : 'desactivado'}**.`);
  }

  // ── l!automod setlog <#canal> ────────────────────────────────────────────
  if (sub === 'setlog') {
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply('❌ Menciona un canal. Ej: `l!automod setlog #logs`');
    config.logChannel = ch.id;
    return message.reply(`✅ Canal de logs configurado: ${ch}`);
  }

  // ── l!automod setmute <minutos> ──────────────────────────────────────────
  if (sub === 'setmute') {
    const mins = parseInt(args[1]);
    if (isNaN(mins) || mins < 1) return message.reply('❌ Uso: `l!automod setmute <minutos>` (mínimo 1)');
    config.muteDuration = mins * 60 * 1000;
    return message.reply(`✅ Duración del mute: **${mins} minuto(s)**.`);
  }

  // ── l!automod setwarn <número> ───────────────────────────────────────────
  if (sub === 'setwarn') {
    const n = parseInt(args[1]);
    if (isNaN(n) || n < 1) return message.reply('❌ Uso: `l!automod setwarn <número>` (mínimo 1)');
    config.warnThreshold = n;
    return message.reply(`✅ Umbral de advertencias: **${n}**.`);
  }

  // ── l!automod addword <palabra> ──────────────────────────────────────────
  if (sub === 'addword') {
    const word = args[1]?.toLowerCase();
    if (!word) return message.reply('❌ Uso: `l!automod addword <palabra>`');
    if (config.blockedWords.includes(word)) return message.reply('⚠️ Esa palabra ya está bloqueada.');
    config.blockedWords.push(word);
    config.modules.words = true; // activar módulo automáticamente
    return message.reply(`✅ Palabra \`${word}\` agregada. Módulo \`words\` activado.`);
  }

  // ── l!automod removeword <palabra> ──────────────────────────────────────
  if (sub === 'removeword') {
    const word = args[1]?.toLowerCase();
    if (!word) return message.reply('❌ Uso: `l!automod removeword <palabra>`');
    const idx = config.blockedWords.indexOf(word);
    if (idx === -1) return message.reply('⚠️ Esa palabra no está en la lista.');
    config.blockedWords.splice(idx, 1);
    return message.reply(`✅ Palabra \`${word}\` eliminada.`);
  }

  // ── l!automod words ──────────────────────────────────────────────────────
  if (sub === 'words') {
    if (config.blockedWords.length === 0) return message.reply('📋 No hay palabras bloqueadas.');
    return message.reply(`📋 **Palabras bloqueadas:**\n${config.blockedWords.map(w => `\`${w}\``).join(', ')}`);
  }

  // ── l!automod exclude <#canal> ───────────────────────────────────────────
  if (sub === 'exclude') {
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply('❌ Uso: `l!automod exclude #canal`');
    if (config.excludedChannels.includes(ch.id)) return message.reply('⚠️ Ese canal ya está excluido.');
    config.excludedChannels.push(ch.id);
    return message.reply(`✅ Canal ${ch} excluido del AutoMod.`);
  }

  // ── l!automod unexclude <#canal> ─────────────────────────────────────────
  if (sub === 'unexclude') {
    const ch = message.mentions.channels.first();
    if (!ch) return message.reply('❌ Uso: `l!automod unexclude #canal`');
    const idx = config.excludedChannels.indexOf(ch.id);
    if (idx === -1) return message.reply('⚠️ Ese canal no está excluido.');
    config.excludedChannels.splice(idx, 1);
    return message.reply(`✅ Canal ${ch} ya no está excluido.`);
  }

  // ── l!automod warns [@usuario] ───────────────────────────────────────────
  if (sub === 'warns') {
    const target = message.mentions.users.first() || message.author;
    const count  = getWarns(message.guild.id, target.id);
    return message.reply(`⚠️ **${target.tag}** tiene **${count}** advertencia(s).`);
  }

  // ── l!automod clearwarns [@usuario] ──────────────────────────────────────
  if (sub === 'clearwarns') {
    const target = message.mentions.users.first();
    if (!target) return message.reply('❌ Menciona a un usuario. Ej: `l!automod clearwarns @usuario`');
    clearWarns(message.guild.id, target.id);
    return message.reply(`✅ Advertencias de **${target.tag}** limpiadas.`);
  }

  // ── l!automod reset ──────────────────────────────────────────────────────
  if (sub === 'reset') {
    configs.set(message.guild.id, defaultConfig());
    return message.reply('✅ Configuración de AutoMod reseteada a valores por defecto.');
  }

  return message.reply('❌ Subcomando desconocido. Usa `l!automod help` para ver las opciones.');
}

// ─────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────
module.exports = {
  name,
  aliases,
  description,
  execute,
  // Para uso interno (src/automod.js re-exporta esto)
  handleMessage,
  getConfig,
  configs,
  warns,
  getWarns,
  clearWarns,
  defaultConfig,
};
