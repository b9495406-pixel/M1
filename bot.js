require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MOD_COMMANDS_CHANNEL_ID = process.env.MOD_COMMANDS_CHANNEL_ID || '1574914496567185509';
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '';
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '';

if (!BOT_TOKEN) {
  console.error('❌ BOT_TOKEN غير موجود في متغيرات البيئة.');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

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
  const maxMs = 28 * 24 * 60 * 60 * 1000;
  return ms > 0 && ms <= maxMs ? ms : null;
}

function extractId(text) {
  if (!text) return null;
  const match = text.match(/\d{17,20}/);
  return match ? match[0] : null;
}

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

// تنبيه دخول عضو جديد
client.on('guildMemberAdd', async (member) => {
  if (!WELCOME_CHANNEL_ID) return;
  const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  await channel.send(
    `📥 انضم عضو جديد: <@${member.id}> (${member.user.tag}) — ID: \`${member.id}\``
  ).catch(() => {});
});

// تنبيه خروج عضو
client.on('guildMemberRemove', async (member) => {
  if (!WELCOME_CHANNEL_ID) return;
  const channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  await channel.send(
    `📤 غادر السيرفر: **${member.user?.tag || member.id}** — ID: \`${member.id}\``
  ).catch(() => {});
});

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

  const allowedCmds = ['mute', 'unmute', 'ban', 'unban', 'kick', 'addrole', 'removerole', 'clear', 'warn'];
  if (!allowedCmds.includes(cmd)) return;

  try {
    // أمر حذف رسائل: !clear <عدد> [channelId]
    if (cmd === 'clear') {
      const count = parseInt(args[0], 10);
      if (!count || count < 1 || count > 100) {
        return message.reply('❌ حدد عدداً صحيحاً للرسائل من `1` إلى `100` (مثال: `!clear 20`).').catch(() => {});
      }
      const targetChannelId = extractId(args[1]) || message.channel.id;
      const targetChannel = await message.guild.channels.fetch(targetChannelId).catch(() => null);
      if (!targetChannel || !targetChannel.isTextBased() || typeof targetChannel.bulkDelete !== 'function') {
        return message.reply('❌ تعذر حذف الرسائل في الروم المحدد.').catch(() => {});
      }

      const deleted = await targetChannel.bulkDelete(count, true);
      await message.reply(`🧹 تم حذف **${deleted.size}** رسالة من <#${targetChannel.id}>.`).catch(() => {});
      await sendModLog(
        message.guild,
        '🧹 تنظيف رسائل (Clear)',
        [
          { name: 'الروم', value: `<#${targetChannel.id}>`, inline: true },
          { name: 'العدد المحذوف', value: `${deleted.size}`, inline: true }
        ],
        0x64748b
      );
      return;
    }

    const targetId = extractId(args[0]);
    if (!targetId) {
      return message.reply('❌ لم يتم العثور على آيدي صحيح للعضو في الأمر.').catch(() => {});
    }

    const member = await message.guild.members.fetch(targetId).catch(() => null);

    // أمر تحذير/تنبيه: !warn <@ID> [dm|chat|channelId] <السبب>
    if (cmd === 'warn') {
      const targetUser = member?.user || await client.users.fetch(targetId).catch(() => null);
      if (!targetUser) {
        return message.reply('❌ لم يتم العثور على هذا العضو.').catch(() => {});
      }

      const modeArg = (args[1] || '').toLowerCase();
      const channelIdArg = extractId(args[1]);
      let deliveryMode = 'chat';
      let targetChannel = message.channel;
      let reasonStartIndex = 1;

      if (modeArg === 'dm') {
        deliveryMode = 'dm';
        reasonStartIndex = 2;
      } else if (modeArg === 'chat') {
        deliveryMode = 'chat';
        targetChannel = message.channel;
        reasonStartIndex = 2;
      } else if (channelIdArg) {
        const fetchedChannel = await message.guild.channels.fetch(channelIdArg).catch(() => null);
        if (!fetchedChannel || !fetchedChannel.isTextBased()) {
          return message.reply('❌ آيدي الروم المحدد غير صالح أو لا يقبل رسائل نصية.').catch(() => {});
        }
        deliveryMode = 'channel';
        targetChannel = fetchedChannel;
        reasonStartIndex = 2;
      }

      const reason = args.slice(reasonStartIndex).join(' ').trim() || 'تنبيه إداري من الإدارة';

      const warnEmbed = new EmbedBuilder()
        .setTitle('⚠️ تحذير / تنبيه إداري')
        .setColor(0xfbbf24)
        .addFields(
          { name: 'العضو', value: `<@${targetId}>`, inline: true },
          { name: 'السيرفر', value: message.guild.name, inline: true },
          { name: 'نص التحذير / السبب', value: reason, inline: false }
        )
        .setTimestamp();

      if (deliveryMode === 'dm') {
        try {
          await targetUser.send({ embeds: [warnEmbed] });
          await message.reply(`✅ تم إرسال رسالة التحذير إلى خاص <@${targetId}> | السبب: ${reason}`).catch(() => {});
        } catch {
          return message.reply(`❌ تعذر إرسال الرسالة إلى خاص <@${targetId}> (قد يكون مغلقاً أو لا يشاركنا السيرفر).`).catch(() => {});
        }
      } else {
        await targetChannel.send({
          content: `<@${targetId}>`,
          embeds: [warnEmbed]
        });
        await message.reply(`✅ تم إرسال رسالة التحذير إلى <#${targetChannel.id}> للعضو <@${targetId}> | السبب: ${reason}`).catch(() => {});
      }

      await sendModLog(
        message.guild,
        '⚠️ إصدار تحذير (Warn)',
        [
          { name: 'العضو', value: `<@${targetId}> (${targetId})`, inline: true },
          { name: 'مكان الإرسال', value: deliveryMode === 'dm' ? 'الخاص (DM)' : `<#${targetChannel.id}>`, inline: true },
          { name: 'السبب / النص', value: reason, inline: false }
        ],
        0xfbbf24
      );
      return;
    }

    const reason = args.slice(cmd === 'mute' ? 2 : 1).join(' ').trim() || 'بدون سبب محدد';

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

    else if (cmd === 'unmute') {
      if (!member) {
        return message.reply('❌ العضو غير موجود في السيرفر.').catch(() => {});
      }
      await member.timeout(null, reason);
      await message.reply(`🔊 تم فك الميوت عن العضو <@${targetId}> | السبب: ${reason}`).catch(() => {});
      await sendModLog(
        message.guild,
        '🔊 فك ميوت (Unmute)',
        [
          { name: 'العضو', value: `<@${targetId}> (${targetId})`, inline: true },
          { name: 'السبب', value: reason, inline: false }
        ],
        0x22c55e
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

    else if (cmd === 'unban') {
      await message.guild.members.unban(targetId, reason);
      await message.reply(`🔓 تم فك الحظر عن العضو <@${targetId}> | السبب: ${reason}`).catch(() => {});
      await sendModLog(
        message.guild,
        '🔓 فك حظر (Unban)',
        [
          { name: 'العضو', value: `<@${targetId}> (${targetId})`, inline: true },
          { name: 'السبب', value: reason, inline: false }
        ],
        0x10b981
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
