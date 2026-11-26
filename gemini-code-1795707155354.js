const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  UserSelectMenuBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  PermissionsBitField
} = require('discord.js');

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

function buildAdminControlEmbed(guildName = 'السيرفر') {
  return new EmbedBuilder()
    .setTitle('🛡️ لوحة تحكم الإدارة — نُخبة')
    .setDescription(
      `تحكم كامل وسريع في **${guildName}** عبر الأزرار والقوائم المنسدلة.\n` +
      `اختر الإجراء المطلوب بالأسفل، ثم حدد **العضو** أو **الشات** أو **الرتبة** من القائمة التي تظهر لك.`
    )
    .setColor(0x6366f1)
    .addFields(
      {
        name: '⚖️ عقوبات وتنبيهات الأعضاء',
        value: '• **كتم** (تحديد المدة + السبب)\n• **باند** و **طرد** (مع السبب)\n• **تحذير** (إرسال تحذير للعضو)',
        inline: true
      },
      {
        name: '🎖️ إدارة الرتب والشاتات',
        value: '• **إعطاء / سحب رتبة** لعضو\n• **إرسال رسالة** في شات محدد\n• **قفل / فتح** شات و **تنظيف** شات',
        inline: true
      }
    )
    .setFooter({ text: 'نُخبة • لوحة الإدارة التفاعلية' })
    .setTimestamp();
}

function buildAdminControlRows() {
  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('adm_btn_mute').setLabel('كتم').setEmoji('🔇').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('adm_btn_ban').setLabel('باند').setEmoji('🔨').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('adm_btn_kick').setLabel('طرد').setEmoji('👢').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId('adm_btn_warn').setLabel('تحذير').setEmoji('⚠️').setStyle(ButtonStyle.Secondary)
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('adm_btn_addrole').setLabel('إعطاء رتبة').setEmoji('➕').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId('adm_btn_removerole').setLabel('سحب رتبة').setEmoji('➖').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('adm_btn_sendmsg').setLabel('إرسال رسالة').setEmoji('✉️').setStyle(ButtonStyle.Primary)
  );

  const row3 = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('adm_btn_lock').setLabel('قفل شات').setEmoji('🔒').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('adm_btn_clear').setLabel('تنظيف شات').setEmoji('🧹').setStyle(ButtonStyle.Secondary)
  );

  return [row1, row2, row3];
}

function setupAdminPanel(client, options = {}) {
  const panelChannelId = options.panelChannelId || '1575525312014585886';
  const staffRoleId = options.staffRoleId || '1356920995658862594';
  const prefix = options.prefix || '?';
  const sendModLog = typeof options.sendModLog === 'function' ? options.sendModLog : async () => {};

  const pendingSelections = new Map();

  function hasStaffPermission(member) {
    if (!member) return false;
    return (
      member.roles.cache.has(staffRoleId) ||
      member.permissions.has(PermissionsBitField.Flags.Administrator) ||
      member.permissions.has(PermissionsBitField.Flags.ModerateMembers)
    );
  }

  async function postOrRefreshPanel(channel) {
    if (!channel || !channel.isTextBased()) return;
    const recent = await channel.messages.fetch({ limit: 15 }).catch(() => null);
    const existing = recent?.find(
      (m) => m.author.id === client.user.id && m.embeds?.[0]?.title?.includes('لوحة تحكم الإدارة')
    );

    if (existing) {
      await existing.edit({
        embeds: [buildAdminControlEmbed(channel.guild?.name)],
        components: buildAdminControlRows()
      }).catch(() => {});
      return;
    }

    await channel.send({
      embeds: [buildAdminControlEmbed(channel.guild?.name)],
      components: buildAdminControlRows()
    }).catch(() => {});
  }

  async function initPanel() {
    const channel = await client.channels.fetch(panelChannelId).catch((err) => {
      console.error('❌ تعذر جلب روم لوحة الإدارة:', err.message);
      return null;
    });
    if (channel) {
      await postOrRefreshPanel(channel);
      console.log(`✅ تم إرسال/تحديث لوحة الإدارة في الروم: ${panelChannelId}`);
    }
  }

  client.once('clientReady', initPanel);
  if (client.isReady()) {
    initPanel();
  }

  client.on('messageCreate', async (message) => {
    if (!message.guild || message.author.bot) return;
    if (message.channel.id !== panelChannelId) return;
    if (message.content.trim().toLowerCase() !== `${prefix}panel`) return;

    if (!hasStaffPermission(message.member)) {
      return message.reply('❌ هذا الأمر مخصص للإدارة فقط.').catch(() => {});
    }

    await postOrRefreshPanel(message.channel);
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isButton() && interaction.customId.startsWith('adm_btn_')) {
        if (!hasStaffPermission(interaction.member)) {
          return interaction.reply({
            content: '❌ هذا الزر مخصص للرتبة المحددة والإدارة فقط.',
            ephemeral: true
          });
        }

        const action = interaction.customId.replace('adm_btn_', '');
        const stateKey = `${interaction.user.id}_${Date.now()}`;
        pendingSelections.set(stateKey, { action, userId: null, channelId: null, roleId: null });

        if (['mute', 'ban', 'kick', 'warn'].includes(action)) {
          const userMenu = new UserSelectMenuBuilder()
            .setCustomId(`adm_pick_user_${action}_${stateKey}`)
            .setPlaceholder('اختر العضو المستهدف من القائمة...');

          return interaction.reply({
            content: '👤 اختر العضو المطلوب:',
            components: [new ActionRowBuilder().addComponents(userMenu)],
            ephemeral: true
          });
        }

        if (['addrole', 'removerole'].includes(action)) {
          const userMenu = new UserSelectMenuBuilder()
            .setCustomId(`adm_pick_roleuser_${action}_${stateKey}`)
            .setPlaceholder('أولاً: اختر العضو من القائمة...');

          return interaction.reply({
            content: '👤 اختر العضو الذي تريد إعطاء أو سحب الرتبة منه:',
            components: [new ActionRowBuilder().addComponents(userMenu)],
            ephemeral: true
          });
        }

        if (['sendmsg', 'lock', 'clear'].includes(action)) {
          const channelMenu = new ChannelSelectMenuBuilder()
            .setCustomId(`adm_pick_channel_${action}_${stateKey}`)
            .setPlaceholder('اختر الشات المستهدف من القائمة...')
            .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

          return interaction.reply({
            content: '💬 اختر الشات المطلوب:',
            components: [new ActionRowBuilder().addComponents(channelMenu)],
            ephemeral: true
          });
        }
      }

      if (interaction.isUserSelectMenu() && interaction.customId.startsWith('adm_pick_user_')) {
        const rest = interaction.customId.replace('adm_pick_user_', '');
        const [action, stateKey] = rest.split('_');
        const targetUserId = interaction.values[0];
        const rec = pendingSelections.get(stateKey) || { action };
        rec.userId = targetUserId;
        pendingSelections.set(stateKey, rec);

        const modal = new ModalBuilder()
          .setCustomId(`adm_modal_${action}_${stateKey}`)
          .setTitle('تأكيد الإجراء الإداري');

        if (action === 'mute') {
          const durationInput = new TextInputBuilder()
            .setCustomId('field_duration')
            .setLabel('مدة الكتم (مثال: 10m أو 1h أو 1d)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('1h')
            .setRequired(true);

          const reasonInput = new TextInputBuilder()
            .setCustomId('field_reason')
            .setLabel('سبب الكتم')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

          modal.addComponents(
            new ActionRowBuilder().addComponents(durationInput),
            new ActionRowBuilder().addComponents(reasonInput)
          );
        } else {
          const reasonInput = new TextInputBuilder()
            .setCustomId('field_reason')
            .setLabel(action === 'warn' ? 'نص التحذير / السبب' : 'السبب')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
        }

        return interaction.showModal(modal);
      }

      if (interaction.isUserSelectMenu() && interaction.customId.startsWith('adm_pick_roleuser_')) {
        const rest = interaction.customId.replace('adm_pick_roleuser_', '');
        const [action, stateKey] = rest.split('_');
        const targetUserId = interaction.values[0];
        const rec = pendingSelections.get(stateKey) || { action };
        rec.userId = targetUserId;
        pendingSelections.set(stateKey, rec);

        const roleMenu = new RoleSelectMenuBuilder()
          .setCustomId(`adm_pick_role_${action}_${stateKey}`)
          .setPlaceholder('الآن اختر الرتبة من القائمة...');

        return interaction.update({
          content: `🎖️ العضو المختار: <@${targetUserId}> — اختر الرتبة الآن:`,
          components: [new ActionRowBuilder().addComponents(roleMenu)]
        });
      }

      if (interaction.isRoleSelectMenu() && interaction.customId.startsWith('adm_pick_role_')) {
        const rest = interaction.customId.replace('adm_pick_role_', '');
        const [action, stateKey] = rest.split('_');
        const roleId = interaction.values[0];
        const rec = pendingSelections.get(stateKey);
        if (!rec?.userId) {
          return interaction.update({ content: '❌ انتهت الجلسة، أعد المحاولة.', components: [] });
        }

        const member = await interaction.guild.members.fetch(rec.userId).catch(() => null);
        const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
        if (!member || !role) {
          return interaction.update({ content: '❌ تعذر العثور على العضو أو الرتبة.', components: [] });
        }

        if (action === 'addrole') {
          await member.roles.add(role, `بواسطة ${interaction.user.tag} من لوحة نُخبة`);
          await sendModLog(
            interaction.guild,
            '➕ إعطاء رتبة من اللوحة',
            [
              { name: 'العضو', value: `<@${member.id}> (${member.id})`, inline: true },
              { name: 'الرتبة', value: `<@&${role.id}>`, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true }
            ],
            0x22c55e
          );
          return interaction.update({
            content: `✅ تم إعطاء رتبة <@&${role.id}> للعضو <@${member.id}>.`,
            components: []
          });
        } else {
          await member.roles.remove(role, `بواسطة ${interaction.user.tag} من لوحة نُخبة`);
          await sendModLog(
            interaction.guild,
            '➖ سحب رتبة من اللوحة',
            [
              { name: 'العضو', value: `<@${member.id}> (${member.id})`, inline: true },
              { name: 'الرتبة', value: `<@&${role.id}>`, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true }
            ],
            0xef4444
          );
          return interaction.update({
            content: `✅ تم سحب رتبة <@&${role.id}> من العضو <@${member.id}>.`,
            components: []
          });
        }
      }

      if (interaction.isChannelSelectMenu() && interaction.customId.startsWith('adm_pick_channel_')) {
        const rest = interaction.customId.replace('adm_pick_channel_', '');
        const [action, stateKey] = rest.split('_');
        const channelId = interaction.values[0];
        const rec = pendingSelections.get(stateKey) || { action };
        rec.channelId = channelId;
        pendingSelections.set(stateKey, rec);

        if (action === 'lock') {
          const targetChannel = await interaction.guild.channels.fetch(channelId).catch(() => null);
          if (!targetChannel) {
            return interaction.update({ content: '❌ لم يتم العثور على الشات.', components: [] });
          }

          const everyoneRole = interaction.guild.roles.everyone;
          const canSend = targetChannel.permissionsFor(everyoneRole)?.has(PermissionsBitField.Flags.SendMessages);
          const shouldLock = Boolean(canSend);

          await targetChannel.permissionOverwrites.edit(everyoneRole, {
            SendMessages: !shouldLock
          });

          await sendModLog(
            interaction.guild,
            shouldLock ? '🔒 قفل شات' : '🔓 فتح شات',
            [
              { name: 'الشات', value: `<#${channelId}>`, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true }
            ],
            shouldLock ? 0xf59e0b : 0x22c55e
          );

          return interaction.update({
            content: shouldLock
              ? `🔒 تم قفل الشات <#${channelId}> بنجاح.`
              : `🔓 تم فتح الشات <#${channelId}> بنجاح.`,
            components: []
          });
        }

        const modal = new ModalBuilder()
          .setCustomId(`adm_modal_${action}_${stateKey}`)
          .setTitle(action === 'sendmsg' ? 'إرسال رسالة في الشات' : 'تنظيف الشات');

        if (action === 'sendmsg') {
          const msgInput = new TextInputBuilder()
            .setCustomId('field_message')
            .setLabel('نص الرسالة المراد إرسالها')
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(msgInput));
        } else {
          const countInput = new TextInputBuilder()
            .setCustomId('field_count')
            .setLabel('عدد الرسائل المراد حذفها (1 إلى 100)')
            .setStyle(TextInputStyle.Short)
            .setPlaceholder('20')
            .setRequired(true);

          modal.addComponents(new ActionRowBuilder().addComponents(countInput));
        }

        return interaction.showModal(modal);
      }

      if (interaction.isModalSubmit() && interaction.customId.startsWith('adm_modal_')) {
        const rest = interaction.customId.replace('adm_modal_', '');
        const [action, stateKey] = rest.split('_');
        const rec = pendingSelections.get(stateKey);
        pendingSelections.delete(stateKey);

        if (!rec) {
          return interaction.reply({ content: '❌ انتهت مدة الطلب، أعد المحاولة.', ephemeral: true });
        }

        if (action === 'mute') {
          const durationStr = interaction.fields.getTextInputValue('field_duration').trim();
          const reasonStr = interaction.fields.getTextInputValue('field_reason').trim();
          const ms = parseDurationToMs(durationStr);
          if (!ms) {
            return interaction.reply({ content: '❌ صيغة المدة غير صحيحة (مثال: `10m` أو `1h` أو `1d`).', ephemeral: true });
          }

          const member = await interaction.guild.members.fetch(rec.userId).catch(() => null);
          if (!member) {
            return interaction.reply({ content: '❌ العضو غير موجود في السيرفر.', ephemeral: true });
          }

          await member.timeout(ms, `${reasonStr} — بواسطة ${interaction.user.tag}`);
          await sendModLog(
            interaction.guild,
            '🔇 كتم عضو من اللوحة',
            [
              { name: 'العضو', value: `<@${member.id}> (${member.id})`, inline: true },
              { name: 'المدة', value: durationStr, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'السبب', value: reasonStr, inline: false }
            ],
            0xf59e0b
          );
          return interaction.reply({ content: `✅ تم كتم <@${member.id}> لمدة **${durationStr}**.`, ephemeral: true });
        }

        if (action === 'ban') {
          const reasonStr = interaction.fields.getTextInputValue('field_reason').trim();
          await interaction.guild.members.ban(rec.userId, { reason: `${reasonStr} — بواسطة ${interaction.user.tag}` });
          await sendModLog(
            interaction.guild,
            '🔨 باند عضو من اللوحة',
            [
              { name: 'العضو', value: `<@${rec.userId}> (${rec.userId})`, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'السبب', value: reasonStr, inline: false }
            ],
            0xdc2626
          );
          return interaction.reply({ content: `✅ تم حظر <@${rec.userId}> بنجاح.`, ephemeral: true });
        }

        if (action === 'kick') {
          const reasonStr = interaction.fields.getTextInputValue('field_reason').trim();
          const member = await interaction.guild.members.fetch(rec.userId).catch(() => null);
          if (!member) {
            return interaction.reply({ content: '❌ العضو غير موجود في السيرفر.', ephemeral: true });
          }

          await member.kick(`${reasonStr} — بواسطة ${interaction.user.tag}`);
          await sendModLog(
            interaction.guild,
            '👢 طرد عضو من اللوحة',
            [
              { name: 'العضو', value: `<@${member.id}> (${member.id})`, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'السبب', value: reasonStr, inline: false }
            ],
            0xef4444
          );
          return interaction.reply({ content: `✅ تم طرد <@${member.id}> بنجاح.`, ephemeral: true });
        }

        if (action === 'warn') {
          const reasonStr = interaction.fields.getTextInputValue('field_reason').trim();
          const warnEmbed = new EmbedBuilder()
            .setTitle('⚠️ تحذير إداري — نُخبة')
            .setColor(0xfbbf24)
            .addFields(
              { name: 'العضو', value: `<@${rec.userId}>`, inline: true },
              { name: 'بواسطة', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'السبب', value: reasonStr, inline: false }
            )
            .setTimestamp();

          await interaction.channel.send({ content: `<@${rec.userId}>`, embeds: [warnEmbed] });
          await sendModLog(
            interaction.guild,
            '⚠️ تحذير عضو من اللوحة',
            [
              { name: 'العضو', value: `<@${rec.userId}> (${rec.userId})`, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'السبب', value: reasonStr, inline: false }
            ],
            0xfbbf24
          );
          return interaction.reply({ content: `✅ تم إرسال التحذير للعضو <@${rec.userId}>.`, ephemeral: true });
        }

        if (action === 'sendmsg') {
          const msgText = interaction.fields.getTextInputValue('field_message').trim();
          const targetChannel = await interaction.guild.channels.fetch(rec.channelId).catch(() => null);
          if (!targetChannel || !targetChannel.isTextBased()) {
            return interaction.reply({ content: '❌ تعذر إرسال الرسالة في الشات المحدد.', ephemeral: true });
          }

          await targetChannel.send(msgText);
          await sendModLog(
            interaction.guild,
            '✉️ إرسال رسالة عبر اللوحة',
            [
              { name: 'الشات', value: `<#${targetChannel.id}>`, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true },
              { name: 'الرسالة', value: msgText.slice(0, 1000), inline: false }
            ],
            0x6366f1
          );
          return interaction.reply({ content: `✅ تم إرسال الرسالة إلى <#${targetChannel.id}>.`, ephemeral: true });
        }

        if (action === 'clear') {
          const count = parseInt(interaction.fields.getTextInputValue('field_count').trim(), 10);
          if (!count || count < 1 || count > 100) {
            return interaction.reply({ content: '❌ أدخل عدداً صحيحاً بين `1` و `100`.', ephemeral: true });
          }

          const targetChannel = await interaction.guild.channels.fetch(rec.channelId).catch(() => null);
          if (!targetChannel || !targetChannel.isTextBased() || typeof targetChannel.bulkDelete !== 'function') {
            return interaction.reply({ content: '❌ تعذر تنظيف هذا الشات.', ephemeral: true });
          }

          const deleted = await targetChannel.bulkDelete(count, true);
          await sendModLog(
            interaction.guild,
            '🧹 تنظيف شات من اللوحة',
            [
              { name: 'الشات', value: `<#${targetChannel.id}>`, inline: true },
              { name: 'عدد الرسائل المحذوفة', value: `${deleted.size}`, inline: true },
              { name: 'المنفذ', value: `<@${interaction.user.id}>`, inline: true }
            ],
            0x64748b
          );
          return interaction.reply({ content: `🧹 تم حذف **${deleted.size}** رسالة من <#${targetChannel.id}>.`, ephemeral: true });
        }
      }
    } catch (err) {
      console.error('Admin panel error:', err);
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: '❌ حدث خطأ أثناء التنفيذ (تأكد من صلاحيات البوت وترتيب رتبته).',
          ephemeral: true
        }).catch(() => {});
      }
    }
  });
}

module.exports = { setupAdminPanel };