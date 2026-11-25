require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MOD_COMMANDS_CHANNEL_ID = process.env.MOD_COMMANDS_CHANNEL_ID || '1574914496567185509';
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود في متغيرات البيئة.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// تحويل المدة النصية مثل 10m أو 1h أو 1d إلى ميلي ثانية
function parseDurationToMs(str) {
  if (!str) return null;
  const match = str.match(/^(\d+)(s|m|h|d)$/i);
  if (!match) return null;

  const value = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000
  };

  const ms = value * multipliers[unit];
  // الحد الأقصى للتايم أوت في ديسكورد هو 28 يوماً
  const maxMs = 28 * 24 * 60 * 60 * 1000;
  return ms > 0 && ms <= maxMs ? ms : null;
}

// استخراج آيدي رقمي (17 إلى 20 رقماً) من منشن أو نص
function extractId(text) {
  if (!text) return null;
  const match = text.match(/\d{17,20}/);
  return match ? match[0] : null;
}

// إرسال سجل تفصيلي إلى روم اللوقات إن كان مضبوطاً
async function sendModLog(guild, title, fields, color = 0x5865f2) {
  if (!LOGS_CHANNEL_ID || !guild) return;
  const logChannel = await guild.channels.fetch(LOGS_CHANNEL_ID).catch(() => null);
  if (!logChannel || !logChannel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .addFields(fields)
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch(() => {});
}

client.once('ready', () => {
  console.log(`✅ البوت جاهز وأونلاين باسم: ${client.user.tag}`);
  console.log(`📌 روم استقبال أوامر الإدارة: ${MOD_COMMANDS_CHANNEL_ID}`);
});

client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  if (message.author.id === client.user.id) return;
  if (message.channel.id !== MOD_COMMANDS_CHANNEL_ID) return;

  const content = message.content.trim();
  if (!content.startsWith('!')) return;

  const args = content.slice(1).trim().split(/\s+/);
  const rawCmd = (args.shift() || '').toLowerCase();
  const cmd = rawCmd === 'muet' ? 'mute' : rawCmd;

  if (!['mute', 'ban', 'kick', 'addrole', 'removerole'].includes(cmd)) return;

  const targetId = extractId(args[0]);
  if (!targetId) {
    return message.reply('❌ لم يتم العثور على آيدي صحيح للعضو في الأمر.').catch(() => {});
  }

  const member = await message.guild.members.fetch(targetId).catch(() => null);
  const reason = args.slice(cmd === 'mute' ? 2 : 1).join(' ').trim() || 'بدون سبب محدد';

  try {
    if (cmd === 'mute') {
      if (!member) {
        return message.reply('❌ العضو غير موجود في السيرفر.').catch(() => {});
      }

      const durationStr = args[1];
      const durationMs = parseDurationToMs(durationStr);
      if (!durationMs) {
        return message.reply('❌ صيغة المدة غير صحيحة (مثال: `10m` أو `1h` أو `1d`، بحد أقصى `28d`).').catch(() => {});
      }

      await member.timeout(durationMs, reason);
      await message.reply(`✅ تم إعطاء ميوت للعضو <@${targetId}> لمدة **${durationStr}** | السبب: ${reason}`).catch(() => {});

      await sendModLog(
        message.guild,
        '🔇 تنفيذ ميوت (Mute)',
        [
          { name: 'العضو', value: `<@${targetId}> (${targetId})`, inline: true },
          { name: 'المدة', value: durationStr, inline: true },
          { name: 'السبب', value: reason, inline: false }
        ],
        0xf59e0b
      );
    }

    else if (cmd === 'kick') {
      if (!member) {
        return message.reply('❌ العضو غير موجود في السيرفر.').catch(() => {});
      }

      await member.kick(reason);
      await message.reply(`✅ تم طرد العضو <@${targetId}> | السبب: ${reason}`).catch(() => {});

      await sendModLog(
        message.guild,
        '👢 تنفيذ طرد (Kick)',
        [
          { name: 'العضو', value: `<@${targetId}> (${targetId})`, inline: true },
          { name: 'السبب', value: reason, inline: false }
        ],
        0xef4444
      );
    }

    else if (cmd === 'ban') {
      await message.guild.members.ban(targetId, { reason });
      await message.reply(`✅ تم حظر العضو <@${targetId}> | السبب: ${reason}`).catch(() => {});

      await sendModLog(
        message.guild,
        '🔨 تنفيذ حظر (Ban)',
        [
          { name: 'العضو', value: `<@${targetId}> (${targetId})`, inline: true },
          { name: 'السبب', value: reason, inline: false }
        ],
        0xdc2626
      );
    }

    else if (cmd === 'addrole' || cmd === 'removerole') {
      if (!member) {
        return message.reply('❌ العضو غير موجود في السيرفر.').catch(() => {});
      }

      const roleQuery = args[1] || '';
      const roleId = extractId(roleQuery);
      const role = roleId
        ? await message.guild.roles.fetch(roleId).catch(() => null)
        : message.guild.roles.cache.find(r => r.name.toLowerCase() === roleQuery.toLowerCase());

      if (!role) {
        return message.reply('❌ لم يتم العثور على الرتبة المطلوبة.').catch(() => {});
      }

      if (cmd === 'addrole') {
        await member.roles.add(role, 'إجراء من لوحة نظام خادمك');
        await message.reply(`✅ تم إعطاء رتبة **${role.name}** للعضو <@${targetId}>.`).catch(() => {});

        await sendModLog(
          message.guild,
          '➕ إعطاء رتبة (Add Role)',
          [
            { name: 'العضو', value: `<@${targetId}> (${targetId})`, inline: true },
            { name: 'الرتبة', value: `${role.name} (${role.id})`, inline: true }
          ],
          0x22c55e
        );
      } else {
        await member.roles.remove(role, 'إجراء من لوحة نظام خادمك');
        await message.reply(`✅ تم سحب رتبة **${role.name}** من العضو <@${targetId}>.`).catch(() => {});

        await sendModLog(
          message.guild,
          '➖ سحب رتبة (Remove Role)',
          [
            { name: 'العضو', value: `<@${targetId}> (${targetId})`, inline: true },
            { name: 'الرتبة', value: `${role.name} (${role.id})`, inline: true }
          ],
          0x3b82f6
        );
      }
    }
  } catch (err) {
    console.error('Moderation execution error:', err);
    await message.reply('❌ تعذر تنفيذ الإجراء: تأكد من صلاحيات البوت وترتيب رتبته فوق العضو أو الرتبة المستهدفة.').catch(() => {});
  }
});

client.login(BOT_TOKEN);
