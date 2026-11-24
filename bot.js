require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  SlashCommandBuilder,
  REST,
  Routes,
  PermissionFlagsBits
} = require('discord.js');

const {
  BOT_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  LOGS_CHANNEL_ID,
  REQUESTS_CHANNEL_ID,
  API_SECRET = 'change-this-secret-key',
  PORT = process.env.PORT || 3000
} = process.env;

// ==========================================
// 1. نظام تخزين البيانات (الطلبات + اللوقات)
// ==========================================
const DATA_FILE = path.join(__dirname, 'system-data.json');

function loadData() {
  if (!fs.existsSync(DATA_FILE)) {
    const initial = { requests: [], logs: [] };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2));
    return initial;
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { requests: [], logs: [] };
  }
}

function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

let db = loadData();

async function addLog({ action, actor = 'النظام', target = '-', details = '', source = 'System' }) {
  const entry = {
    id: `LOG-${Date.now()}`,
    action,
    actor,
    target,
    details,
    source,
    createdAt: new Date().toISOString()
  };

  db.logs.unshift(entry);
  if (db.logs.length > 300) db.logs = db.logs.slice(0, 300);
  saveData(db);

  // إرسال اللوق إلى قناة اللوقات في الديسكورد إن وجدت
  if (LOGS_CHANNEL_ID && client.isReady()) {
    try {
      const ch = await client.channels.fetch(LOGS_CHANNEL_ID);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(`📋 لوق جديد | ${action}`)
          .setColor(0x3b82f6)
          .addFields(
            { name: 'المنفّذ', value: actor, inline: true },
            { name: 'المستهدف', value: target || '-', inline: true },
            { name: 'المصدر', value: source, inline: true },
            { name: 'التفاصيل', value: details || 'لا توجد تفاصيل إضافية' }
          )
          .setTimestamp();
        await ch.send({ embeds: [embed] });
      }
    } catch (e) {
      console.error('خطأ أثناء إرسال اللوق إلى الديسكورد:', e.message);
    }
  }
  return entry;
}

// ==========================================
// 2. إعداد بوت الديسكورد وأوامر السلاش
// ==========================================
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration
  ]
});

const commands = [
  new SlashCommandBuilder()
    .setName('ban')
    .setDescription('حظر عضو من السيرفر')
    .addUserOption(opt => opt.setName('user').setDescription('العضو المراد حظره').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('سبب الحظر').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers),

  new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('إعطاء ميوت مؤقت (Timeout) لعضو')
    .addUserOption(opt => opt.setName('user').setDescription('العضو').setRequired(true))
    .addIntegerOption(opt => opt.setName('minutes').setDescription('المدة بالدقائق (1 إلى 40320)').setRequired(true))
    .addStringOption(opt => opt.setName('reason').setDescription('السبب').setRequired(false))
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers),

  new SlashCommandBuilder()
    .setName('request')
    .setDescription('إرسال طلب جديد إلى نظام السيرفر والموقع')
    .addStringOption(opt => opt.setName('type').setDescription('نوع الطلب (تصميم، مونتاج، انضمام، تعاون)').setRequired(true))
    .addStringOption(opt => opt.setName('details').setDescription('تفاصيل الطلب').setRequired(true))
];

async function registerSlashCommands() {
  if (!BOT_TOKEN || !CLIENT_ID || !GUILD_ID) return;
  const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
  try {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
      body: commands.map(c => c.toJSON())
    });
    console.log('✅ تم تسجيل أوامر السلاش بنجاح');
  } catch (err) {
    console.error('❌ فشل تسجيل أوامر السلاش:', err);
  }
}

client.on('interactionCreate', async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'ban') {
    const targetUser = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || 'لم يتم تحديد سبب';

    try {
      await interaction.guild.members.ban(targetUser.id, { reason });
      await addLog({
        action: 'حظر عضو (Ban)',
        actor: interaction.user.tag,
        target: `${targetUser.tag} (${targetUser.id})`,
        details: `السبب: ${reason}`,
        source: 'Discord Slash Command'
      });
      await interaction.reply({ content: `✅ تم حظر **${targetUser.tag}** بنجاح.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ تعذر حظر العضو: ${err.message}`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'timeout') {
    const targetUser = interaction.options.getUser('user', true);
    const minutes = interaction.options.getInteger('minutes', true);
    const reason = interaction.options.getString('reason') || 'مخالفة قوانين السيرفر';

    if (minutes < 1 || minutes > 40320) {
      return interaction.reply({ content: '⚠️ المدة يجب أن تكون بين دقيقة واحدة و28 يوماً (40320 دقيقة).', ephemeral: true });
    }

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      await member.timeout(minutes * 60 * 1000, reason);
      await addLog({
        action: 'ميوت مؤقت (Timeout)',
        actor: interaction.user.tag,
        target: `${targetUser.tag} (${targetUser.id})`,
        details: `المدة: ${minutes} دقيقة | السبب: ${reason}`,
        source: 'Discord Slash Command'
      });
      await interaction.reply({ content: `🔇 تم إعطاء **${targetUser.tag}** ميوت لمدة **${minutes}** دقيقة.`, ephemeral: true });
    } catch (err) {
      await interaction.reply({ content: `❌ تعذر تطبيق الميوت: ${err.message}`, ephemeral: true });
    }
  }

  if (interaction.commandName === 'request') {
    const type = interaction.options.getString('type', true);
    const details = interaction.options.getString('details', true);

    const reqItem = {
      id: `REQ-${Date.now()}`,
      type,
      requester: interaction.user.tag,
      requesterId: interaction.user.id,
      details,
      status: 'pending',
      createdAt: new Date().toISOString()
    };

    db.requests.unshift(reqItem);
    saveData(db);

    await addLog({
      action: 'طلب جديد عبر البوت',
      actor: interaction.user.tag,
      target: reqItem.id,
      details: `النوع: ${type} - ${details}`,
      source: 'Discord'
    });

    await interaction.reply({ content: `📩 تم تسجيل طلبك برقم **${reqItem.id}** وسيظهر في الموقع والإدارة.`, ephemeral: true });
  }
});

client.once('ready', async () => {
  console.log(`🤖 البوت (نظام خادمك) متصل باسم: ${client.user.tag}`);
  await registerSlashCommands();
  await addLog({
    action: 'تشغيل البوت',
    actor: client.user.tag,
    target: GUILD_ID || 'السيرفر',
    details: 'البوت جاهز لاستقبال أوامر الموقع وإدارة السيرفر',
    source: 'Bot Startup'
  });
});

// ==========================================
// 3. خادم API لربط البوت مع الموقع الإلكتروني
// ==========================================
const app = express();
app.use(express.json());

// إعداد CORS للسماح للموقع بالاتصال بالبوت
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// التحقق من المفتاح السري للموقع
function verifyApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key || key !== API_SECRET) {
    return res.status(401).json({ ok: false, error: 'مفتاح الربط غير صحيح أو مفقود' });
  }
  next();
}

// فحص حالة البوت
app.get('/api/status', verifyApiKey, async (req, res) => {
  try {
    const guild = GUILD_ID ? await client.guilds.fetch(GUILD_ID) : null;
    res.json({
      ok: true,
      botOnline: client.isReady(),
      botTag: client.user ? client.user.tag : null,
      guildName: guild ? guild.name : null,
      memberCount: guild ? guild.memberCount : null
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// جلب جميع الطلبات وعرضها في الموقع
app.get('/api/requests', verifyApiKey, (req, res) => {
  res.json({ ok: true, requests: db.requests });
});

// إضافة طلب جديد من الموقع وإرساله لقناة الطلبات في الديسكورد
app.post('/api/requests', verifyApiKey, async (req, res) => {
  const { type = 'طلب عام', requester = 'زائر الموقع', contact = '-', details = '' } = req.body;
  if (!details.trim()) {
    return res.status(400).json({ ok: false, error: 'تفاصيل الطلب مطلوبة' });
  }

  const newReq = {
    id: `REQ-${Date.now()}`,
    type,
    requester,
    contact,
    details: details.trim(),
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  db.requests.unshift(newReq);
  saveData(db);

  if (REQUESTS_CHANNEL_ID && client.isReady()) {
    try {
      const ch = await client.channels.fetch(REQUESTS_CHANNEL_ID);
      if (ch && ch.isTextBased()) {
        const embed = new EmbedBuilder()
          .setTitle(`🆕 طلب جديد من الموقع (${newReq.id})`)
          .setColor(0x10b981)
          .addFields(
            { name: 'النوع', value: type, inline: true },
            { name: 'مقدم الطلب', value: requester, inline: true },
            { name: 'التواصل', value: contact || '-', inline: true },
            { name: 'التفاصيل', value: details.trim() }
          )
          .setTimestamp();
        await ch.send({ embeds: [embed] });
      }
    } catch (err) {
      console.error('خطأ في إرسال الطلب لقناة الديسكورد:', err.message);
    }
  }

  await addLog({
    action: 'استقبال طلب من الموقع',
    actor: requester,
    target: newReq.id,
    details: `النوع: ${type} | ${details.trim()}`,
    source: 'Website'
  });

  res.status(201).json({ ok: true, request: newReq });
});

// تحديث حالة الطلب (مقبول / مرفوض / مكتمل) من لوحة إدارة الموقع
app.patch('/api/requests/:id', verifyApiKey, async (req, res) => {
  const { status, adminName = 'إدارة الموقع' } = req.body;
  const item = db.requests.find(r => r.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: 'الطلب غير موجود' });

  item.status = status || item.status;
  saveData(db);

  await addLog({
    action: 'تحديث حالة طلب',
    actor: adminName,
    target: item.id,
    details: `الحالة الجديدة: ${item.status}`,
    source: 'Website Admin'
  });

  res.json({ ok: true, request: item });
});

// جلب لوقات الموقع والنظام
app.get('/api/logs', verifyApiKey, (req, res) => {
  res.json({ ok: true, logs: db.logs });
});

// تسجيل لوق جديد قادم من الموقع (دخول، إجراءات، أخطاء، إلخ)
app.post('/api/logs', verifyApiKey, async (req, res) => {
  const { action, actor = 'الموقع', target = '-', details = '' } = req.body;
  if (!action) return res.status(400).json({ ok: false, error: 'اسم الإجراء (action) مطلوب' });

  const entry = await addLog({
    action,
    actor,
    target,
    details,
    source: 'Website'
  });
  res.status(201).json({ ok: true, log: entry });
});

// ==========================================
// 4. تنفيذ أوامر الإدارة من الموقع عبر البوت
// ==========================================
// حظر عضو (Ban) من الموقع: يرسل { userId, reason, adminName }
app.post('/api/mod/ban', verifyApiKey, async (req, res) => {
  const { userId, reason = 'تم الحظر من لوحة إدارة الموقع', adminName = 'إدارة الموقع' } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'معرف العضو (userId) مطلوب' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.ban(userId, { reason });

    await addLog({
      action: 'حظر عضو من الموقع (Ban)',
      actor: adminName,
      target: userId,
      details: `السبب: ${reason}`,
      source: 'Website Dashboard'
    });

    res.json({ ok: true, message: `تم حظر العضو (${userId}) بنجاح` });
  } catch (err) {
    res.status(500).json({ ok: false, error: `فشل الحظر: ${err.message}` });
  }
});

// فك الحظر (Unban) من الموقع: يرسل { userId, reason, adminName }
app.post('/api/mod/unban', verifyApiKey, async (req, res) => {
  const { userId, reason = 'فك الحظر من لوحة الموقع', adminName = 'إدارة الموقع' } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'معرف العضو (userId) مطلوب' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    await guild.members.unban(userId, reason);

    await addLog({
      action: 'فك حظر عضو (Unban)',
      actor: adminName,
      target: userId,
      details: `السبب: ${reason}`,
      source: 'Website Dashboard'
    });

    res.json({ ok: true, message: `تم فك الحظر عن (${userId}) بنجاح` });
  } catch (err) {
    res.status(500).json({ ok: false, error: `فشل فك الحظر: ${err.message}` });
  }
});

// إعطاء ميوت مؤقت (Timeout) أو إزالته من الموقع: يرسل { userId, minutes, reason, adminName } (minutes = 0 لإزالة الميوت)
app.post('/api/mod/timeout', verifyApiKey, async (req, res) => {
  const { userId, minutes = 10, reason = 'ميوت من لوحة إدارة الموقع', adminName = 'إدارة الموقع' } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'معرف العضو (userId) مطلوب' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId);
    const durationMs = Number(minutes) > 0 ? Number(minutes) * 60 * 1000 : null;

    await member.timeout(durationMs, reason);

    await addLog({
      action: durationMs ? 'إعطاء ميوت (Timeout)' : 'إزالة الميوت',
      actor: adminName,
      target: `${member.user.tag} (${userId})`,
      details: durationMs ? `المدة: ${minutes} دقيقة | السبب: ${reason}` : `تم فك الميوت | السبب: ${reason}`,
      source: 'Website Dashboard'
    });

    res.json({
      ok: true,
      message: durationMs
        ? `تم تطبيق ميوت لمدة ${minutes} دقيقة على ${member.user.tag}`
        : `تم إزالة الميوت عن ${member.user.tag}`
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: `فشل تطبيق الميوت: ${err.message}` });
  }
});

// طرد عضو (Kick) من الموقع: يرسل { userId, reason, adminName }
app.post('/api/mod/kick', verifyApiKey, async (req, res) => {
  const { userId, reason = 'تم الطرد من لوحة إدارة الموقع', adminName = 'إدارة الموقع' } = req.body;
  if (!userId) return res.status(400).json({ ok: false, error: 'معرف العضو (userId) مطلوب' });

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    const member = await guild.members.fetch(userId);
    await member.kick(reason);

    await addLog({
      action: 'طرد عضو (Kick)',
      actor: adminName,
      target: `${member.user.tag} (${userId})`,
      details: `السبب: ${reason}`,
      source: 'Website Dashboard'
    });

    res.json({ ok: true, message: `تم طرد ${member.user.tag} بنجاح` });
  } catch (err) {
    res.status(500).json({ ok: false, error: `فشل الطرد: ${err.message}` });
  }
});

// إرسال رسالة أو إعلان إلى قناة محددة في الديسكورد من الموقع
app.post('/api/announce', verifyApiKey, async (req, res) => {
  const { channelId, title = 'إعلان من الموقع', message, adminName = 'إدارة الموقع' } = req.body;
  if (!channelId || !message) {
    return res.status(400).json({ ok: false, error: 'رقم القناة (channelId) ونص الرسالة (message) مطلوبان' });
  }

  try {
    const ch = await client.channels.fetch(channelId);
    if (!ch || !ch.isTextBased()) {
      return res.status(404).json({ ok: false, error: 'القناة غير موجودة أو غير نصية' });
    }

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message)
      .setColor(0x8b5cf6)
      .setFooter({ text: `بواسطة ${adminName}` })
      .setTimestamp();

    await ch.send({ embeds: [embed] });

    await addLog({
      action: 'نشر إعلان في الديسكورد',
      actor: adminName,
      target: `#${ch.name || channelId}`,
      details: `${title}: ${message}`,
      source: 'Website Dashboard'
    });

    res.json({ ok: true, message: 'تم إرسال الرسالة إلى الديسكورد بنجاح' });
  } catch (err) {
    res.status(500).json({ ok: false, error: `فشل الإرسال: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`🌐 خادم API للبوت يعمل على المنفذ ${PORT}`);
});

client.login(BOT_TOKEN);
