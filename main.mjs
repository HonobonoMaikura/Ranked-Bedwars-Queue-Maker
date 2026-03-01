import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, ChannelType } from 'discord.js';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';

dotenv.config();

// --- [1] 設定項目 ---
const QUEUE_CHANNEL_ID = '1477177057212366929';
const CATEGORY_ID = '1477177022517350451';
const TEXT_CATEGORY_ID = '1477290108054147072';
const LOG_CHANNEL_ID = '1477304663144402944'; // 通知用チャンネルID
const COUNTER_FILE = './gameCounter.json';
const TEAM_SIZE = 4; // 安定のため4人設定
const TOTAL_REQUIRED = TEAM_SIZE * 2;

// --- [2] 初期化 ---
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
    ],
});

let gameCounter = fs.existsSync(COUNTER_FILE) 
    ? JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).nextId 
    : 1;

// --- [3] イベントリスナー ---
client.once('ready', () => console.log(`🎉 ${client.user.tag} が起動しました！`));

// マッチング処理
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.channelId !== QUEUE_CHANNEL_ID || oldState.channelId === newState.channelId) return;

    const channel = newState.channel;
    if (channel && channel.members.size >= TOTAL_REQUIRED) {
        console.log(`✨ マッチング開始: ${TOTAL_REQUIRED}人集まりました`);
        
        const gameId = String(gameCounter).padStart(3, '0');
        gameCounter = (gameCounter >= 999) ? 1 : gameCounter + 1;
        fs.writeFileSync(COUNTER_FILE, JSON.stringify({ nextId: gameCounter }));

        const [v1, v2] = await createVoiceChannels(newState.guild, gameId);
        const textChannel = await createTextChannel(newState.guild, gameId);
        const teams = await moveMembers(channel.members, v1, v2);
        
        await notifyTeamSetup(textChannel, gameId, teams);
    }
});

// ゲーム終了ボタン処理
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (!interaction.customId.startsWith('delete_game_')) return;

    const gameId = interaction.customId.replace('delete_game_', '');
    const guild = interaction.guild;

    // チャンネル削除処理
    const allChannels = await guild.channels.fetch();
    const channelsToDelete = allChannels.filter(c => 
        c && (c.name.includes(`Game#${gameId}`) || c.name.includes(`game-${gameId}`))
    );

    for (const [id, channel] of channelsToDelete) {
        await channel.delete().catch(console.error);
    }
    console.log(`✅ Game#${gameId} のチャンネルを削除しました`);

    // 通知チャンネルへメッセージ送信
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
        await logChannel.send(`Game#${gameId}[4v4] は終了しました。`).catch(console.error);
    }
});

// --- [4] 処理関数 ---

async function createVoiceChannels(guild, gameId) {
    const t1 = await guild.channels.create({ name: `Game#${gameId} Team 1`, type: ChannelType.GuildVoice, parent: CATEGORY_ID });
    const t2 = await guild.channels.create({ name: `Game#${gameId} Team 2`, type: ChannelType.GuildVoice, parent: CATEGORY_ID });
    return [t1, t2];
}

async function createTextChannel(guild, gameId) {
    return await guild.channels.create({
        name: `game-${gameId}`,
        type: ChannelType.GuildText,
        parent: TEXT_CATEGORY_ID,
    });
}

async function moveMembers(members, v1, v2) {
    const shuffled = Array.from(members.values()).sort(() => 0.5 - Math.random());
    const team1 = shuffled.slice(0, TEAM_SIZE);
    const team2 = shuffled.slice(TEAM_SIZE, TEAM_SIZE * 2);
    
    for (const m of team1) await m.voice.setChannel(v1).catch(console.error);
    for (const m of team2) await m.voice.setChannel(v2).catch(console.error);
    
    return { team1, team2 };
}

async function notifyTeamSetup(channel, gameId, teams) {
    const format = (list) => list.map(m => m.toString()).join('\n');
    
    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`delete_game_${gameId}`)
            .setLabel('ゲームを終了')
            .setStyle(ButtonStyle.Danger)
    );

    await channel.send({
        embeds: [{
            title: `🎮 Game#${gameId} チーム編成`,
            color: 0x0099ff,
            fields: [
                { name: 'Team 1 (ボイス1)', value: format(teams.team1) || 'なし', inline: true },
                { name: 'Team 2 (ボイス2)', value: format(teams.team2) || 'なし', inline: true }
            ],
        }],
        components: [row]
    });
}

// --- [5] 起動 ---
client.login(process.env.DISCORD_TOKEN);
const app = express();
app.listen(process.env.PORT || 3000);