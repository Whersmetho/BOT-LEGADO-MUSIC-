require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Collection,
} = require('discord.js');

const fs = require('fs');
const path = require('path');

const { spotifyClientId, spotifyClientSecret } = require('../config.json');
const { initSpotify } = require('./spotify');

// ===============================
// TOKEN DESDE RAILWAY / GITHUB
// ===============================
const token = process.env.TOKEN?.trim();

if (!token) {
  console.error('❌ No se encontró la variable TOKEN');
  process.exit(1);
}

// ===============================
// CLIENTE DISCORD
// ===============================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.MessageContent,
  ],
});

// ===============================
// COLECCIONES
// ===============================
client.commands = new Collection();
client.aliases = new Collection();
client.queues = new Map();

// ===============================
// CARGAR COMANDOS
// ===============================
const commandsPath = path.join(__dirname, 'commands');

const commandFiles = fs
  .readdirSync(commandsPath)
  .filter(file => file.endsWith('.js'));

for (const file of commandFiles) {
  const command = require(path.join(commandsPath, file));

  client.commands.set(command.name, command);

  if (command.aliases) {
    for (const alias of command.aliases) {
      client.aliases.set(alias, command.name);
    }
  }
}

// ===============================
// READY
// ===============================
client.once('ready', () => {
  console.log(`✅ Bot listo: ${client.user.tag}`);

  client.user.setActivity('🎵 l!help para comandos');

  // Spotify
  if (spotifyClientId && spotifyClientSecret) {
    initSpotify(spotifyClientId, spotifyClientSecret);
    console.log('🟢 Spotify conectado');
  } else {
    console.warn(
      '⚠️ Spotify no configurado. Solo YouTube disponible.'
    );
  }
});

// ===============================
// MENSAJES
// ===============================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const prefix = 'l!';

  if (!message.content.toLowerCase().startsWith(prefix)) return;

  const args = message.content
    .slice(prefix.length)
    .trim()
    .split(/ +/);

  const commandName = args.shift().toLowerCase();

  // Alias
  const resolvedName =
    client.aliases.get(commandName) || commandName;

  const command = client.commands.get(resolvedName);

  if (!command) return;

  try {
    await command.execute(message, args, client);
  } catch (error) {
    console.error(`❌ Error en comando ${commandName}:`, error);

    message.reply(
      '❌ Ocurrió un error ejecutando ese comando.'
    );
  }
});

// ===============================
// LOGIN
// ===============================
client
  .login(token)
  .then(() => {
    console.log('🟢 Login exitoso');
  })
  .catch((err) => {
    console.error('❌ Error al iniciar sesión:', err);
  });