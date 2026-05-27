// Comando temporal de diagnóstico — borrar después de usarlo
const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

module.exports = {
  name: 'debug',
  async execute(message, args, client) {
    if (!message.member.permissions.has('Administrator')) return;

    const cookiesPath = path.join(process.cwd(), 'cookies.txt');
    const url = args[0] || 'https://youtube.com/watch?v=oujzyZfQF94';
    const cookiesArgs = fs.existsSync(cookiesPath) ? `--cookies ${cookiesPath}` : '';

    await message.reply(`🔍 Probando: ${url}\n🍪 cookies.txt: ${fs.existsSync(cookiesPath) ? '✅ existe' : '❌ no existe'}`);

    try {
      const out = execSync(
        `yt-dlp ${cookiesArgs} --list-formats --no-warnings "${url}" 2>&1`,
        { timeout: 30000 }
      ).toString();

      // Dividir en chunks de 1900 chars para no superar el límite de Discord
      const chunks = out.match(/.{1,1900}/gs) || ['(sin output)'];
      for (const chunk of chunks.slice(0, 3)) {
        await message.channel.send('```\n' + chunk + '\n```');
      }
    } catch (e) {
      const err = e.stdout?.toString() || e.message;
      await message.channel.send('```\n' + err.slice(0, 1900) + '\n```');
    }
  },
};
