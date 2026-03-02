import { ActionRowBuilder, ButtonBuilder, ButtonStyle, Client, GatewayIntentBits, ChannelType } from 'discord.js';
import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';

dotenv.config();

// --- [1] 設定 ---
const QUEUE_CHANNEL_ID = '1477928783372877875';
const CATEGORY_ID = '1477177022517350451';
const TEXT_CATEGORY_ID = '1477290108054147072';
const LOG_CHANNEL_ID = '1477304663144402944';
const COUNTER_FILE = './gameCounter.json';
const TEAM_SIZE = 4;
const TOTAL_REQUIRED = TEAM_SIZE * 2;

// チーム情報を一時保存するメモリ
const gameData = new Map();

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates],
});

let gameCounter = fs.existsSync(COUNTER_FILE) ? JSON.parse(fs.readFileSync(COUNTER_FILE, 'utf8')).nextId : 1;

client.once('ready', () => console.log(`🎉 ${client.user.tag} が起動しました！`));

// --- [2] イベントリスナー ---
client.on('voiceStateUpdate', async (oldState, newState) => {
    if (newState.channelId !== QUEUE_CHANNEL_ID || oldState.channelId === newState.channelId) return;
    const channel = newState.channel;
    if (channel && channel.members.size >= TOTAL_REQUIRED) {
        const gameId = String(gameCounter).padStart(3, '0');
        gameCounter = (gameCounter >= 999) ? 1 : gameCounter + 1;
        fs.writeFileSync(COUNTER_FILE, JSON.stringify({ nextId: gameCounter }));

        const [v1, v2] = await createVoiceChannels(newState.guild, gameId);
        const textChannel = await createTextChannel(newState.guild, gameId);
        const teams = await moveMembers(channel.members, v1, v2);
        
        // チーム情報を保存
        gameData.set(gameId, teams);
        
        await notifyTeamSetup(textChannel, gameId, teams);
    }
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    const guild = interaction.guild;

    // ゲーム終了ボタン
    if (interaction.customId.startsWith('delete_game_')) {
        const gameId = interaction.customId.replace('delete_game_', '');
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`win_team1_${gameId}`).setLabel('Team 1 勝利').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId(`win_team2_${gameId}`).setLabel('Team 2 勝利').setStyle(ButtonStyle.Danger)
        );
        await interaction.reply({ content: `Game#${gameId} の勝者はどちらですか？`, components: [row], ephemeral: true });
    }

    // 勝敗選択ボタンが押されたとき
    if (interaction.customId.startsWith('win_team')) {
        const [_, winner, gameId] = interaction.customId.split('_');
        
        // 【重要】チャンネル削除前に、まずインタラクションに応答（deferUpdate）する
        // これにより「Unknown Message」エラーを回避できます
        await interaction.deferUpdate();

        const guild = interaction.guild;
        const teams = gameData.get(gameId);

        // チャンネル削除処理
        const channels = guild.channels.cache.filter(c => 
            c.name.includes(`Game#${gameId}`) || c.name.includes(`game-${gameId}`)
        );
        for (const [id, ch] of channels) {
            await ch.delete().catch(console.error);
        }

        // ログ送信
        const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
        if (logChannel && teams) {
            await logChannel.send({
                embeds: [{
                    title: `🏆 Game#${gameId} 最終結果`,
                    color: winner === 'team1' ? 0x00ff00 : 0xff0000,
                    fields: [
                        { name: 'Team 1', value: teams.team1.map(m => m.toString()).join('\n'), inline: true },
                        { name: 'Team 2', value: teams.team2.map(m => m.toString()).join('\n'), inline: true },
                        { name: '勝者', value: winner === 'team1' ? 'Team 1' : 'Team 2', inline: false },
                        { name: '終了時刻', value: new Date().toLocaleTimeString('ja-JP'), inline: false }
                    ],
                    timestamp: new Date(),
                }]
            });
        }
        
        gameData.delete(gameId); // メモリ解放
        console.log(`✅ Game#${gameId} の処理が完了しました`);
    }
});

// --- [3] 関数 ---
async function createVoiceChannels(guild, gameId) {
    const t1 = await guild.channels.create({ name: `Game#${gameId} Team 1`, type: ChannelType.GuildVoice, parent: CATEGORY_ID });
    const t2 = await guild.channels.create({ name: `Game#${gameId} Team 2`, type: ChannelType.GuildVoice, parent: CATEGORY_ID });
    return [t1, t2];
}

async function createTextChannel(guild, gameId) {
    return await guild.channels.create({ name: `game-${gameId}`, type: ChannelType.GuildText, parent: TEXT_CATEGORY_ID });
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
        new ButtonBuilder().setCustomId(`delete_game_${gameId}`).setLabel('ゲームを終了').setStyle(ButtonStyle.Danger)
    );
    await channel.send({
        embeds: [{
            title: `🎮 Game#${gameId} チーム編成`,
            color: 0x0099ff,
            fields: [
                { name: 'Team 1', value: format(teams.team1) || 'なし', inline: true },
                { name: 'Team 2', value: format(teams.team2) || 'なし', inline: true }
            ],
        }],
        components: [row]
    });
}

client.login(process.env.DISCORD_TOKEN);
const app = express();
app.listen(process.env.PORT || 3000);