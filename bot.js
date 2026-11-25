require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MOD_COMMANDS_CHANNEL_ID = process.env.MOD_COMMANDS_CHANNEL_ID || '1574914496567185509';
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '';
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '';
const PREFIX = process.env.BOT_PREFIX || '?';
const DATA_FILE = path.join(__dirname, 'economy_data.json');

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

// تحميل أو إنشاء قاعدة بيانات النقاط والعمليات
function loadEconomyData() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
      return {
        users: raw.users || {},
        transactions: raw.transactions || []
      };
    }
  } catch (err) {
    console.error('Error loading economy_data.json:', err);
  }
  return { users: {}, transactions: [] };
}

function saveEconomyData(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving economy_data.json:', err);
  }
}

let economyData = loadEconomyData();

function ensureUser(userId, username = 'مستخدم') {
  if (!economyData.users[userId]) {
    economyData.users[userId] = {
      id: userId,
      username,
      balance: 0,
      lastDaily: 0,
      lastWork: 0
    };
  } else if (username && username !== 'مستخدم') {
    economyData.users[userId].username = username;
  }
  return economyData.users[userId];
}

function recordTransaction(type, userId, username, amount, note) {
  const entry = {
    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    type,
    userId,
    username,
    amount,
    note,
    timestamp: new Date().toISOString()
  };
  economyData.transactions.unshift(entry);
  economyData.transactions = economyData.transactions.slice(0, 100);
  saveEconomyData(economyData);
}

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
  console.log(`⚡ البادئة النشطة: ${PREFIX}`);
  console.log(`📌 روم استقبال الأوامر: ${MOD_COMMANDS_CHANNEL_ID}`);
});

client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  if (message.author.id === client.user.id) return;
  if (message.channel.id !== MOD_COMMANDS_CHANNEL_ID) return;

  const content = message.content.trim();
  if (!content.startsWith(PREFIX)) return;

  const args = content.slice(PREFIX.length).trim().split(/\s+/);
  const rawCmd = (args.shift() || '').toLowerCase();
  const cmd = rawCmd === 'muet' ? 'mute' : rawCmd;

  const economyCmds = ['balance', 'bal', 'points', 'daily', 'work', 'addpoints', 'removepoints', 'transfer', 'top'];
  const modCmds = ['mute', 'unmute', 'ban', 'unban', 'kick', 'addrole', 'removerole', 'clear', 'warn'];

  if (!economyCmds.includes(cmd) && !modCmds.includes(cmd)) return;

  try {
    // ==================== أوامر العملة والنقاط ====================
    if (economyCmds.includes(cmd)) {
      const actorId = message.author.webhookId ? (extractId(args[0]) || message.author.id) : message.author.id;
      const actorMember = await message.guild.members.fetch(actorId).catch(() => null);
      const actorName = actorMember?.user?.username || message.author.username || 'مستخدم';

      if (cmd === 'balance' || cmd === 'bal' || cmd === 'points') {
        const targetId = extractId(args[0]) || actorId;
        const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
        const u = ensureUser(targetId, targetMember?.user?.username);
        saveEconomyData(economyData);
        return message.reply(`💰 رصيد <@${targetId}>: **${u.balance}** نقطة`).catch(() => {});
      }

      if (cmd === 'daily') {
        const u = ensureUser(actorId, actorName);
        const now = Date.now();
        const cooldown = 24 * 60 * 60 * 1000;
        if (now - u.lastDaily < cooldown) {
          const remainingHours = Math.ceil((cooldown - (now - u.lastDaily)) / (60 * 60 * 1000));
          return message.reply(`⏳ لقد استلمت مكافأتك اليومية بالفعل. عد بعد **${remainingHours}** ساعة.`).catch(() => {});
        }
        const reward = 150;
        u.balance += reward;
        u.lastDaily = now;
        recordTransaction('مكافأة يومية', actorId, u.username, reward, 'استلام مكافأة ?daily');
        return message.reply(`🎁 حصل <@${actorId}> على **+${reward}** نقطة! الرصيد الحالي: **${u.balance}**`).catch(() => {});
      }

      if (cmd === 'work') {
        const u = ensureUser(actorId, actorName);
        const now = Date.now();
        const cooldown = 30 * 60 * 1000;
        if (now - u.lastWork < cooldown) {
          const remainingMins = Math.ceil((cooldown - (now - u.lastWork)) / (60 * 1000));
          return message.reply(`⏳ يمكنك العمل مرة أخرى بعد **${remainingMins}** دقيقة.`).catch(() => {});
        }
        const earned = Math.floor(Math.random() * 81) + 40; // من 40 إلى 120 نقطة
        u.balance += earned;
        u.lastWork = now;
        recordTransaction('جمع نقاط (عمل)', actorId, u.username, earned, 'إتمام مهمة ?work');
        return message.reply(`💼 جمع <@${actorId}> **+${earned}** نقطة من العمل! الرصيد الحالي: **${u.balance}**`).catch(() => {});
      }

      if (cmd === 'addpoints' || cmd === 'removepoints') {
        const targetId = extractId(args[0]);
        const amount = parseInt(args[1], 10);
        if (!targetId || !amount || amount <= 0) {
          return message.reply(`❌ الصيغة: \`${PREFIX}${cmd} <@ID> <العدد> [السبب]\``).catch(() => {});
        }
        const note = args.slice(2).join(' ').trim() || (cmd === 'addpoints' ? 'إضافة نقاط إدارية' : 'خصم نقاط إداري');
        const targetMember = await message.guild.members.fetch(targetId).catch(() => null);
        const u = ensureUser(targetId, targetMember?.user?.username);

        if (cmd === 'addpoints') {
          u.balance += amount;
          recordTransaction('إضافة نقاط', targetId, u.username, amount, note);
          return message.reply(`✅ تمت إضافة **+${amount}** نقطة إلى <@${targetId}> | الرصيد: **${u.balance}**`).catch(() => {});
        } else {
          const actualDeduct = Math.min(u.balance, amount);
          u.balance -= actualDeduct;
          recordTransaction('خصم نقاط', targetId, u.username, -actualDeduct, note);
          return message.reply(`➖ تم خصم **${actualDeduct}** نقطة من <@${targetId}> | الرصيد: **${u.balance}**`).catch(() => {});
        }
      }

      if (cmd === 'transfer') {
        const toId = extractId(args[0]);
        const amount = parseInt(args[1], 10);
        if (!toId || !amount || amount <= 0 || toId === actorId) {
          return message.reply(`❌ الصيغة: \`${PREFIX}transfer <@ID> <العدد>\``).catch(() => {});
        }
        const sender = ensureUser(actorId, actorName);
        if (sender.balance < amount) {
          return message.reply(`❌ رصيدك غير كافٍ. رصيدك الحالي: **${sender.balance}** نقطة.`).catch(() => {});
        }
        const receiverMember = await message.guild.members.fetch(toId).catch(() => null);
        const receiver = ensureUser(toId, receiverMember?.user?.username);

        sender.balance -= amount;
        receiver.balance += amount;
        recordTransaction('تحويل نقاط', actorId, sender.username, -amount, `تحويل إلى ${receiver.username}`);
        recordTransaction('استلام تحويل', toId, receiver.username, amount, `تحويل من ${sender.username}`);
        return message.reply(`💸 تم تحويل **${amount}** نقطة من <@${actorId}> إلى <@${toId}> بنجاح.`).catch(() => {});
      }

      if (cmd === 'top') {
        const sorted = Object.values(economyData.users)
          .sort((a, b) => b.balance - a.balance)
          .slice(0, 5);
        if (!sorted.length) {
          return message.reply('📊 لا توجد بيانات نقاط مسجلة بعد.').catch(() => {});
        }
        const lines = sorted.map((u, i) => `**${i + 1}.** ${u.username} (\`${u.id}\`) — **${u.balance}** نقطة`);
        return message.reply(`🏆 **أعلى الأعضاء نقاطاً:**\n${lines.join('\n')}`).catch(() => {});
      }
      return;
    }

    // ==================== أوامر الإدارة ====================
    if (cmd === 'clear') {
      const count = parseInt(args[0], 10);
      if (!count || count < 1 || count > 100) {
        return message.reply(`❌ حدد عدداً صحيحاً للرسائل من \`1\` إلى \`100\` (مثال: \`${PREFIX}clear 20\`).`).catch(() => {});
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
    console.error('Moderation/Economy execution error:', err);
    await message.reply('❌ تعذر تنفيذ الأمر: تأكد من صلاحيات البوت وترتيب رتبته وصحة البيانات.').catch(() => {});
  }
});

client.login(BOT_TOKEN);
