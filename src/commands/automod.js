const { EmbedBuilder, AuditLogEvent } = require('discord.js');

// ─────────────────────────────────────────────
// CONFIGURACIÓN POR DEFECTO (por servidor)
// ─────────────────────────────────────────────
const defaultConfig = () => ({
  enabled: true,

  // Módulos individuales activables
  modules: {
    links:        true,   // bloquear links no permitidos
    adultLinks:   true,   // links adultos
    invites:      true,   // invitaciones de Discord
    spam:         true,   // spam de mensajes repetidos
    massMention:  true,   // menciones masivas
    caps:         true,   // todo en mayúsculas
    words:        false,  // palabras bloqueadas (off por defecto)
    zalgo:        true,   // texto zalgo/corrupto
    spoofLinks:   true,   // links disfrazados con markdown
  },

  // Umbrales
  spam: {
    messages: 5,      // mensajes
    seconds:  5,      // en X segundos
    action:   'mute', // warn | delete | mute | kick
  },
  massMention: {
    threshold: 5,     // menciones en un mensaje
    action: 'delete',
  },
  caps: {
    percent: 70,      // % de mayúsculas para activarse
    minLength: 10,    // mínimo de caracteres para checar
  },

  // Acciones por módulo: 'delete' | 'warn' | 'mute' | 'kick'
  actions: {
    links:       'delete',
    adultLinks:  'delete',
    invites:     'delete',
    caps:        'delete',
    words:       'delete',
    zalgo:       'delete',
    spoofLinks:  'delete',
  },

  // Duración del mute en ms (defecto: 5 minutos)
  muteDuration: 5 * 60 * 1000,

  // Canal de logs (null = desactivado)
  logChannel: null,

  // Palabras bloqueadas personalizadas
  blockedWords: [],

  // Canales excluidos
  excludedChannels: [],

  // Roles excluidos
  excludedRoles: [],

  // Advertencias acumuladas antes de acción mayor
  warnThreshold: 3,
});

// ─────────────────────────────────────────────
// ESTADO EN MEMORIA
// ─────────────────────────────────────────────

// configs: Map<guildId, config>
const configs = new Map();

// warns: Map<guildId-userId, number>
const warns = new Map();

// spamTracker: Map<guildId-userId, { count, timer }>
const spamTracker = new Map();

// mutedUsers: Map<guildId-userId, timeout>
const mutedUsers = new Map();

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

function getWarns(guildId, userId) {
  return warns.get(warnKey(guildId, userId)) || 0;
}

function clearWarns(guildId, userId) {
  warns.delete(warnKey(guildId, userId));
}

async function sendLog(guild, config, embed) {
  if (!config.logChannel) return;
  try {
    const ch = await guild.channels.fetch(config.logChannel).catch(() => null);
    if (ch) ch.send({ embeds: [embed] });
  } catch {}
}

async function applyMute(member, duration) {
  try {
    await member.timeout(duration, 'AutoMod: mute automático');
  } catch {}
}

// ─────────────────────────────────────────────
// DETECCIONES
// ─────────────────────────────────────────────

const ADULT_DOMAINS = [
  'pornhub.com', 'xvideos.com', 'xnxx.com', 'xhamster.com',
  'redtube.com', 'youporn.com', 'tube8.com', 'onlyfans.com',
  'fansly.com', 'brazzers.com', 'bangbros.com', 'chaturbate.com',
  'livejasmin.com', 'stripchat.com', 'cam4.com', 'bongacams.com',
];

const URL_REGEX = /https?:\/\/[^\s]+/gi;
const INVITE_REGEX = /(discord\.(gg|io|me|li)|discordapp\.com\/invite)\/[a-zA-Z0-9]+/i;
const ZALGO_REGEX = /[\u0300-\u036f\u0489\u1DC0-\u1DFF\u20D0-\u20FF\uFE20-\uFE2F]{3,}/;
const SPOOFLINK_REGEX = /\[.*?\]\(https?:\/\/[^\s)]+\)/i;

function detectAdultLink(content) {
  const lower = content.toLowerCase();
  return ADULT_DOMAINS.some(d => lower.includes(d));
}

function detectInvite(content) {
  return INVITE_REGEX.test(content);
}

function detectLink(content) {
  return URL_REGEX.test(content);
}

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

function detectZalgo(content) {
  return ZALGO_REGEX.test(content);
}

function detectSpoofLink(content) {
  return SPOOFLINK_REGEX.test(content);
}

function detectBlockedWord(content, words) {
  const lower = content.toLowerCase();
  return words.some(w => lower.includes(w.toLowerCase()));
}

// ─────────────────────────────────────────────
// SPAM TRACKER
// ─────────────────────────────────────────────

function trackSpam(guildId, userId, config) {
  const key = warnKey(guildId, userId);
  const now = Date.now();
  let tracker = spamTracker.get(key);

  if (!tracker) {
    tracker = { count: 1, first: now };
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

async function takeAction(message, action, reason, config, muteDuration) {
  const { guild, author, channel, member } = message;
  const warnCount = addWarn(guild.id, author.id);

  // Siempre borrar el mensaje
  try { await message.delete(); } catch {}

  // Avisar en canal
  const warningEmbed = new EmbedBuilder()
    .setColor('#E74C3C')
    .setAuthor({ name: '🛡️ AutoMod — LEGADO MUSIC' })
    .setDescription(`${author}, tu mensaje fue eliminado.`)
    .addFields({ name: '📌 Razón', value: reason, inline: true })
    .setFooter({ text: `Advertencia ${warnCount}/${config.warnThreshold}` })
    .setTimestamp();

  const warning = await channel.send({ embeds: [warningEmbed] }).catch(() => null);
  if (warning) setTimeout(() => warning.delete().catch(() => {}), 6000);

  // Log
  const logEmbed = new EmbedBuilder()
    .setColor('#E67E22')
    .setAuthor({ name: '🛡️ AutoMod Log' })
    .setThumbnail(author.displayAvatarURL())
    .addFields(
      { name: '👤 Usuario', value: `${author.tag} (${author.id})`, inline: true },
      { name: '📌 Razón', value: reason, inline: true },
      { name: '📢 Canal', value: `<#${channel.id}>`, inline: true },
      { name: '⚠️ Advertencias', value: `${warnCount}/${config.warnThreshold}`, inline: true },
      { name: '🔨 Acción', value: action, inline: true },
    )
    .setTimestamp();

  await sendLog(guild, config, logEmbed);

  // Acción
  if (action === 'mute' || warnCount >= config.warnThreshold) {
    await applyMute(member, muteDuration || config.muteDuration);
    if (warnCount >= config.warnThreshold) clearWarns(guild.id, author.id);
  } else if (action === 'kick' || warnCount >= config.warnThreshold) {
    try { await member.kick(`AutoMod: ${reason}`); } catch {}
  }
}

// ─────────────────────────────────────────────
// HANDLER PRINCIPAL
// ─────────────────────────────────────────────

async function handleMessage(message, client) {
  if (message.author.bot) return;
  if (!message.guild) return;

  const config = getConfig(message.guild.id);
  if (!config.enabled) return;

  const { member, channel, content } = message;

  if (config.excludedChannels.includes(channel.id)) return;
  if (isExempt(member, config)) return;

  // 1. Spam
  if (config.modules.spam) {
    const isSpam = trackSpam(message.guild.id, message.author.id, config);
    if (isSpam) {
      return takeAction(message, config.spam.action, '🚫 Spam detectado', config);
    }
  }

  // 2. Links adultos
  if (config.modules.adultLinks && detectAdultLink(content)) {
    return takeAction(message, config.actions.adultLinks, '🔞 Link de contenido adulto', config);
  }

  // 3. Invitaciones de Discord
  if (config.modules.invites && detectInvite(content)) {
    return takeAction(message, config.actions.invites, '📨 Invitación de Discord no permitida', config);
  }

  // 4. Links generales
  if (config.modules.links && detectLink(content)) {
    return takeAction(message, config.actions.links, '🔗 Link no permitido', config);
  }

  // 5. Menciones masivas
  if (config.modules.massMention && detectMassMention(content, config.massMention.threshold)) {
    return takeAction(message, config.massMention.action, `📣 Menciones masivas (${config.massMention.threshold}+)`, config);
  }

  // 6. Todo en mayúsculas
  if (config.modules.caps && detectCaps(content, config.caps.percent, config.caps.minLength)) {
    return takeAction(message, config.actions.caps, '🔠 Mensaje en mayúsculas excesivas', config);
  }

  // 7. Zalgo
  if (config.modules.zalgo && detectZalgo(content)) {
    return takeAction(message, config.actions.zalgo, '👾 Texto zalgo/corrupto', config);
  }

  // 8. Spoof links (markdown disfrazado)
  if (config.modules.spoofLinks && detectSpoofLink(content)) {
    return takeAction(message, config.actions.spoofLinks, '🎭 Link disfrazado con markdown', config);
  }

  // 9. Palabras bloqueadas
  if (config.modules.words && config.blockedWords.length > 0 && detectBlockedWord(content, config.blockedWords)) {
    return takeAction(message, config.actions.words, '🤬 Palabra no permitida', config);
  }
}

// ─────────────────────────────────────────────
// EXPORTS (para el comando l!automod)
// ─────────────────────────────────────────────

module.exports = {
  handleMessage,
  getConfig,
  configs,
  warns,
  getWarns,
  clearWarns,
  defaultConfig,
};
