require('dotenv').config();
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionsBitField
} = require('discord.js');

const BOT_TOKEN = process.env.BOT_TOKEN;
const MOD_COMMANDS_CHANNEL_ID = process.env.MOD_COMMANDS_CHANNEL_ID || '1574914496567185509';
const SUGGESTIONS_CHANNEL_ID = process.env.SUGGESTIONS_CHANNEL_ID || '1394168134822268948';
const STAFF_ROLE_ID = process.env.STAFF_ROLE_ID || '1356920995658862594';
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || '';
const WELCOME_CHANNEL_ID = process.env.WELCOME_CHANNEL_ID || '';
const PREFIX = process.env.BOT_PREFIX || '?';
const DATA_FILE = path.join(__dirname, 'economy_data.json');
const SUGGESTIONS_FILE = path.join(__dirname, 'suggestions_data.json');

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

// ==================== إدارة بيانات النقاط ====================
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

// ==================== إدارة بيانات الاقتراحات ====================
function loadSuggestionsData() {
  try {
    if (fs.existsSync(SUGGESTIONS_FILE)) {
      return JSON.parse(fs.readFileSync(SUGGESTIONS_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Error loading suggestions_data.json:', err);
  }
  return {};
}

function saveSuggestionsData(data) {
  try {
    fs.writeFileSync(SUGGESTIONS_FILE, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Error saving suggestions_data.json:', err);
  }
}

let suggestionsData = loadSuggestionsData();

function buildSuggestionEmbed(sug) {
  const agreeCount = sug.agree.length;
  const disagreeCount = sug.disagree.length;

  let color = 0x6366f1;
  let statusText = '⏳ قيد التصويت';

  if (sug.status === 'implemented') {
    color = 0x22c55e;
    statusText = `✅ تم تنفيذ الاقتراح${sug.handledBy ? ` بواسطة <@${sug.handledBy}>` : ''}`;
  } else if (sug.status === 'punished') {
    color = 0xef4444;
    statusText = `🔇 تمت معاقبة صاحب الاقتراح (${sug.punishmentNote || 'ميوت'})`;
  }

  return new EmbedBuilder()
    .setAuthor({
      name: sug.authorTag || 'عضو',
      iconURL: sug.authorAvatar || undefined
    })
    .setTitle('💡 اقتراح جديد — نُخبة')
    .setDescription(sug.text)
    .setColor(color)
    .addFields(
      { name: '👍 مع', value: `**${agreeCount}** مصوّت`, inline: true },
      { name: '👎 ضد', value: `**${disagreeCount}** مصوّت`, inline: true },
      { name: '📌 الحالة', value: statusText, inline: false }
    )
    .setFooter({ text: `آيدي صاحب الاقتراح: ${sug.authorId}` })
    .setTimestamp(new Date(sug.createdAt || Date.now()));
}

function buildSuggestionButtons(msgId, disabledAll = false) {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sug_agree_${msgId}`)
      .setLabel('مع')
      .setEmoji('👍')
      .setStyle(ButtonStyle.Success)
      .setDisabled(disabledAll),
    new ButtonBuilder()
      .setCustomId(`sug_disagree_${msgId}`)
      .setLabel('ضد')
      .setEmoji('👎')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(disabledAll)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`sug_punish_${msgId}`)
      .setLabel('معاقبة')
      .setEmoji('🔇')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(disabledAll),
    new ButtonBuilder()
      .setCustomId(`sug_done_${msgId}`)
      .setLabel('تم تنفيذ الاقتراح')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(disabledAll)
  );

  return [row1, row2];
}

function hasStaffPermission(member) {
  if (!member) return false;
  return (
    member.roles.cache.has(STAFF_ROLE_ID) ||
    member.permissions.has(PermissionsBitField.Flags.Administrator)
  );
}

// ==================== أدوات مساعدة ====================
function parseDurationToMs(str) {
  if (!str) return null;
  const match = str.trim().match(/^(\d+)(s|m|h|d)$/i);
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
  console.log(`✅ بوت نُخبة جاهز وأونلاين باسم: ${client.user.tag}`);
  console.log(`⚡ البادئة النشطة: ${PREFIX}`);
  console.log(`📌 روم استقبال الأوامر: ${MOD_COMMANDS_CHANNEL_ID}`);
  console.log(`💡 روم الاقتراحات: ${SUGGESTIONS_CHANNEL_ID}`);
});

// ==================== معالجة الأزرار والنوافذ في الاقتراحات ====================
client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isButton()) {
      const id = interaction.customId;
      if (!id.startsWith('sug_')) return;

      const parts = id.split('_'); // sug | action | msgId
      const action = parts[1];
      const msgId = parts.slice(2).join('_');
      const sug = suggestionsData[msgId];

      if (!sug) {
        return interaction.reply({ content: '❌ بيانات هذا الاقتراح غير موجودة.', ephemeral: true });
      }

      if (action === 'agree' || action === 'disagree') {
        if (sug.status !== 'open') {
          return interaction.reply({ content: '⚠️ تم إغلاق التصويت على هذا الاقتراح.', ephemeral: true });
        }

        const voterId = interaction.user.id;
        sug.agree = sug.agree.filter((x) => x !== voterId);
        sug.disagree = sug.disagree.filter((x) => x !== voterId);

        if (action === 'agree') {
          sug.agree.push(voterId);
        } else {
          sug.disagree.push(voterId);
        }

        saveSuggestionsData(suggestionsData);
        await interaction.message.edit({
          embeds: [buildSuggestionEmbed(sug)],
          components: buildSuggestionButtons(msgId, false)
        });

        return interaction.reply({
          content: action === 'agree' ? '👍 تم تسجيل صوتك (مع).' : '👎 تم تسجيل صوتك (ضد).',
          ephemeral: true
        });
      }

      if (action === 'punish') {
        if (!hasStaffPermission(interaction.member)) {
          return interaction.reply({
            content: '❌ هذا الزر مخصص للرتبة المحددة فقط.',
            ephemeral: true
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`sug_modal_punish_${msgId}`)
          .setTitle('معاقبة صاحب الاقتراح (ميوت)');

        const durationInput = new TextInputBuilder()
          .setCustomId('punish_duration')
          .setLabel('مدة الميوت (مثال: 10m أو 1h أو 1d)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('1h')
          .setRequired(true);

        const reasonInput = new TextInputBuilder()
          .setCustomId('punish_reason')
          .setLabel('سبب المعاقبة')
          .setStyle(TextInputStyle.Paragraph)
          .setPlaceholder('اكتب سبب الميوت هنا...')
          .setRequired(true);

        modal.addComponents(
          new ActionRowBuilder().addComponents(durationInput),
          new ActionRowBuilder().addComponents(reasonInput)
        );

        return interaction.showModal(modal);
      }

      if (action === 'done') {
        if (!hasStaffPermission(interaction.member)) {
          return interaction.reply({
            content: '❌ هذا الزر مخصص للرتبة المحددة فقط.',
            ephemeral: true
          });
        }

        sug.status = 'implemented';
        sug.handledBy = interaction.user.id;
        saveSuggestionsData(suggestionsData);

        await interaction.message.edit({
          embeds: [buildSuggestionEmbed(sug)],
          components: buildSuggestionButtons(msgId, true)
        });

        await sendModLog(
          interaction.guild,
          '✅ تم تنفيذ اقتراح',
          [
            { name: 'صاحب الاقتراح', value: `<@${sug.authorId}> (${sug.authorId})`, inline: true },
            { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true },
            { name: 'نص الاقتراح', value: sug.text.slice(0, 1000), inline: false }
          ],
          0x22c55e
        );

        return interaction.reply({
          content: '✅ تم تحديث حالة الاقتراح إلى (تم تنفيذ الاقتراح).',
          ephemeral: true
        });
      }
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('sug_modal_punish_')) {
      const msgId = interaction.customId.replace('sug_modal_punish_', '');
      const sug = suggestionsData[msgId];
      if (!sug) {
        return interaction.reply({ content: '❌ بيانات الاقتراح غير موجودة.', ephemeral: true });
      }

      if (!hasStaffPermission(interaction.member)) {
        return interaction.reply({ content: '❌ لا تملك صلاحية المعاقبة.', ephemeral: true });
      }

      const durationStr = interaction.fields.getTextInputValue('punish_duration').trim();
      const reasonStr = interaction.fields.getTextInputValue('punish_reason').trim();
      const durationMs = parseDurationToMs(durationStr);

      if (!durationMs) {
        return interaction.reply({
          content: '❌ صيغة المدة غير صحيحة. استخدم مثل: `10m` أو `1h` أو `1d` (بحد أقصى `28d`).',
          ephemeral: true
        });
      }

      const targetMember = await interaction.guild.members.fetch(sug.authorId).catch(() => null);
      if (!targetMember) {
        return interaction.reply({
          content: '❌ لم يتم العثور على صاحب الاقتراح داخل السيرفر.',
          ephemeral: true
        });
      }

      await targetMember.timeout(durationMs, `معاقبة من اقتراح: ${reasonStr}`);

      sug.status = 'punished';
      sug.handledBy = interaction.user.id;
      sug.punishmentNote = `${durationStr} — ${reasonStr}`;
      saveSuggestionsData(suggestionsData);

      const channel = await interaction.guild.channels.fetch(SUGGESTIONS_CHANNEL_ID).catch(() => null);
      const targetMsg = channel ? await channel.messages.fetch(msgId).catch(() => null) : null;
      if (targetMsg) {
        await targetMsg.edit({
          embeds: [buildSuggestionEmbed(sug)],
          components: buildSuggestionButtons(msgId, true)
        });
      }

      await sendModLog(
        interaction.guild,
        '🔇 معاقبة صاحب اقتراح (ميوت)',
        [
          { name: 'المعاقَب', value: `<@${sug.authorId}> (${sug.authorId})`, inline: true },
          { name: 'المدة', value: durationStr, inline: true },
          { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'السبب', value: reasonStr, inline: false }
        ],
        0xef4444
      );

      return interaction.reply({
        content: `✅ تم إعطاء ميوت للعضو <@${sug.authorId}> لمدة **${durationStr}** | السبب: ${reasonStr}`,
        ephemeral: true
      });
    }
  } catch (err) {
    console.error('Suggestion interaction error:', err);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: '❌ حدث خطأ أثناء تنفيذ الإجراء (تأكد من صلاحيات البوت وترتيب رتبته).',
        ephemeral: true
      }).catch(() => {});
    }
  }
});

// ==================== معالجة الرسائل (الاقتراحات + الأوامر) ====================
client.on('messageCreate', async (message) => {
  if (!message.guild) return;
  if (message.author.id === client.user.id) return;

  // 1. تحويل أي رسالة في روم الاقتراحات إلى إيمبد بأزرار التصويت والمعاقبة والتنفيذ
  if (message.channel.id === SUGGESTIONS_CHANNEL_ID) {
    if (message.webhookId) return;
    const suggestionText = message.content.trim();
    if (!suggestionText) return;

    const authorId = message.author.id;
    const authorTag = message.author.tag || message.author.username;
    const authorAvatar = message.author.displayAvatarURL({ extension: 'png', size: 128 });

    await message.delete().catch(() => {});

    const tempId = `temp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const sugRecord = {
      messageId: '',
      authorId,
      authorTag,
      authorAvatar,
      text: suggestionText,
      agree: [],
      disagree: [],
      status: 'open',
      createdAt: Date.now()
    };

    const sentMsg = await message.channel.send({
      embeds: [buildSuggestionEmbed(sugRecord)],
      components: buildSuggestionButtons(tempId, false)
    });

    sugRecord.messageId = sentMsg.id;
    suggestionsData[sentMsg.id] = sugRecord;
    saveSuggestionsData(suggestionsData);

    await sentMsg.edit({
      embeds: [buildSuggestionEmbed(sugRecord)],
      components: buildSuggestionButtons(sentMsg.id, false)
    });
    return;
  }

  // 2. استقبال أوامر الإدارة والنقاط بالبادئة ? في الروم المحدد
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
        const earned = Math.floor(Math.random() * 81) + 40;
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
        const sender = ensureUser(actorI
