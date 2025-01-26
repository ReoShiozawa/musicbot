/**
 * Discord Botのメインエントリーポイント
 * コマンドの登録とイベントハンドリングを担当
 */

import dotenv from 'dotenv';
import { 
    Client, 
    GatewayIntentBits, 
    REST, 
    Routes, 
    SlashCommandBuilder,
    ChatInputCommandInteraction  // 追加
} from 'discord.js';
import { MusicPlayer } from './musicPlayer';
import play from 'play-dl';
import { google } from 'googleapis';

dotenv.config();

// トークンの存在確認
if (!process.env.DISCORD_TOKEN) {
    console.error('Discord トークンが設定されていません。');
    process.exit(1);
}

if (!process.env.YOUTUBE_API_KEY) {
    console.error('YouTube APIキーが設定されていません。');
    process.exit(1);
}

if (!process.env.CLIENT_ID) {
    console.error('Discord クライアントIDが設定されていません。');
    process.exit(1);
}

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

// play-dlの初期設定を追加
play.setToken({
    youtube: {
        cookie: process.env.YOUTUBE_COOKIE || ''
    }
});

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates,
    ]
});

const musicPlayers = new Map<string, MusicPlayer>();

/**
 * スラッシュコマンドの定義
 * Botが認識するコマンドとその設定を定義
 */
const commands = [
    // playコマンド：音楽の再生を開始
    new SlashCommandBuilder()
        .setName('play')
        .setDescription('音楽を再生')
        .addStringOption(option =>
            option.setName('query')
                .setDescription('URLまたは検索ワード')
                .setRequired(true)),
    
    // その他のコマンド定義
    new SlashCommandBuilder()
        .setName('skip')
        .setDescription('現在の曲をスキップ'),
    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('再生を停止'),
    new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('ボイスチャンネルから切断'),
    new SlashCommandBuilder()
        .setName('queue')
        .setDescription('再生待ちリストを表示'),
    new SlashCommandBuilder()
        .setName('np')
        .setDescription('現在再生中の曲の情報を表示'),
    new SlashCommandBuilder()
        .setName('help')
        .setDescription('コマンド一覧を表示'),
    new SlashCommandBuilder()
        .setName('repeat')
        .setDescription('リピートモードを設定')
        .addStringOption(option =>
            option.setName('mode')
                .setDescription('リピートモード')
                .setRequired(true)
                .addChoices(
                    { name: 'オフ', value: 'off' },
                    { name: '1曲リピート', value: 'single' },
                    { name: '全曲リピート', value: 'all' }
                )),
];

const rest = new REST().setToken(process.env.DISCORD_TOKEN!);

client.once('ready', async () => {
    try {
        console.log('スラッシュコマンドを登録中...');
        await rest.put(
            Routes.applicationCommands(process.env.CLIENT_ID!),
            { body: commands }
        );
        console.log('スラッシュコマンドを登録しました');
    } catch (error) {
        console.error(error);
    }
});

/**
 * スラッシュコマンドのハンドリング
 * ユーザーからのコマンド入力を処理
 */
client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;  // 変更
    
    try {
        const { commandName } = interaction;
        if (!interaction.guild) return;

        let player = musicPlayers.get(interaction.guild.id);
        if (!player) {
            player = new MusicPlayer(interaction.guild);
            musicPlayers.set(interaction.guild.id, player);
        }

        // interactionの型をChatInputCommandInteractionとして扱う
        const chatInteraction = interaction as ChatInputCommandInteraction;

        switch (commandName) {
            case 'play':
                const query = chatInteraction.options.getString('query', true);
                await chatInteraction.deferReply();
                await player.play(chatInteraction, query);
                break;
                
            case 'skip':
                player.skip();
                await interaction.reply('スキップしました！');
                break;

            case 'stop':
                player.stop();
                await interaction.reply('再生を停止しました！');
                break;

            case 'disconnect':
                player.disconnect();
                await interaction.reply('ボイスチャンネルから切断しました！');
                break;

            case 'queue':
                await player.showQueue(interaction);
                break;

            case 'np':
                await player.nowPlaying(interaction);
                break;

            case 'help':
                const helpText = commands
                    .map(cmd => `**/${cmd.name}**: ${cmd.description}`)
                    .join('\n');
                
                await interaction.reply({
                    embeds: [{
                        title: '🎵 音楽Bot コマンド一覧',
                        description: helpText,
                        color: 0x00ff00
                    }]
                });
                break;

            case 'repeat':
                const mode = chatInteraction.options.getString('mode', true) as 'off' | 'single' | 'all';
                await player.setRepeat(chatInteraction, mode);
                break;
        }
    } catch (error) {
        console.error('Interaction handling error:', error);
        const reply = { content: 'エラーが発生しました。', ephemeral: true };
        if (interaction.deferred) {
            await interaction.editReply(reply);
        } else {
            await interaction.reply(reply);
        }
    }
});

// ログインエラーハンドリングの追加
client.login(process.env.DISCORD_TOKEN).catch(error => {
    console.error('Discordへの接続に失敗しました:', error);
    process.exit(1);
});
