/**
 * Discord音楽Bot用のメインプレーヤークラス
 * このファイルは音楽の再生、キュー管理、音声処理を担当します
 */

// 必要なモジュールのインポート
import { Guild, ChatInputCommandInteraction, VoiceBasedChannel } from 'discord.js';
import { 
    AudioPlayer, 
    createAudioPlayer, 
    createAudioResource, 
    joinVoiceChannel, 
    VoiceConnection, 
    AudioPlayerStatus, 
    NoSubscriberBehavior,
    VoiceConnectionStatus,
    StreamType,
    AudioResource,
    entersState,
    AudioPlayerState
} from '@discordjs/voice';
import { google } from 'googleapis';
import youtubeDl from 'youtube-dl-exec';
import { createWriteStream, mkdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import cliProgress from 'cli-progress';  // 追加
import SpotifyWebApi from 'spotify-web-api-node';

const youtube = google.youtube({
    version: 'v3',
    auth: process.env.YOUTUBE_API_KEY
});

/**
 * キューアイテムのインターフェース定義
 * 各音楽トラックの情報を保持する構造体
 */
interface QueueItem {
    title: string;      // 曲のタイトル
    url: string;        // 動画/音楽のURL
    duration: string;   // 再生時間
    thumbnail: string;  // サムネイル画像のURL
    filePath?: string;  // 一時ファイルのパス（オプション）
}

// NodeJSのエラー型を定義
interface NodeError extends Error {
    code?: string;
}

/**
 * MusicPlayerクラス
 * Discordサーバー（ギルド）ごとに音楽再生を管理するクラス
 */
export class MusicPlayer {
    // プライベートプロパティの定義
    private queue: QueueItem[] = [];                    // 再生待ちの曲のキュー
    private connection: VoiceConnection | null = null;  // ボイスチャンネルへの接続
    private audioPlayer: AudioPlayer;                   // 音声プレーヤー
    private guild: Guild;                              // Discordサーバー
    private downloading: boolean = false;               // ダウンロード中かどうか
    private readonly tempDir: string;                  // 一時ファイル用ディレクトリ
    private currentlyPlaying: QueueItem | null = null; // 現在再生中の曲
    private spotify: SpotifyWebApi;                    // SpotifyのAPI
    private repeat: 'off' | 'single' | 'all' = 'off';  // リピートモード

    /**
     * コンストラクタ
     * MusicPlayerの初期化と必要な設定を行う
     * @param guild Discordサーバーのインスタンス
     */
    constructor(guild: Guild) {
        this.guild = guild;
        this.tempDir = join(__dirname, '..', 'temp');
        
        // 一時ディレクトリの作成
        if (!existsSync(this.tempDir)) {
            mkdirSync(this.tempDir, { recursive: true });
        }

        this.audioPlayer = createAudioPlayer({
            behaviors: {
                noSubscriber: NoSubscriberBehavior.Play
            }
        });

        // より詳細なエラーハンドリング
        this.audioPlayer.on('error', error => {
            console.error('プレーヤーエラー:', error);
            this.queue.shift();
            setTimeout(() => this.playNext(), 1000);
        });

        // 詳細な状態変更ログ
        this.audioPlayer.on('stateChange', (oldState, newState) => {
            console.log(`状態変更: ${oldState.status} -> ${newState.status}`);
            // リソースの存在確認を修正
            const hasResource = 'resource' in newState && newState.resource instanceof AudioResource;
            console.log('リソース情報:', hasResource ? 'あり' : 'なし');
        });

        this.audioPlayer.on(AudioPlayerStatus.Idle, () => {
            const finished = this.queue.shift();
            if (finished?.filePath) {
                try {
                    unlinkSync(finished.filePath);
                } catch (error) {
                    console.error('ファイル削除エラー:', error);
                }
            }
            this.playNext();
        });

        this.spotify = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET
        });

        // Spotifyトークンの自動更新
        this.refreshSpotifyToken();
    }

    /**
     * SpotifyのAPIトークンを更新
     * トークンは1時間で期限切れになるため、定期的な更新が必要
     */
    private async refreshSpotifyToken() {
        try {
            const data = await this.spotify.clientCredentialsGrant();
            this.spotify.setAccessToken(data.body.access_token);
            // 50分後にトークンを更新（有効期限は60分）
            setTimeout(() => this.refreshSpotifyToken(), 50 * 60 * 1000);
        } catch (error) {
            console.error('Spotify token refresh error:', error);
        }
    }

    /**
     * ボイスチャンネルへの接続を確保
     * 未接続の場合は新規接続し、切断時の再接続も処理
     * @param channel 接続先のボイスチャンネル
     * @returns 接続成功したかどうか
     */
    private async ensureConnection(channel: VoiceBasedChannel): Promise<boolean> {
        try {
            if (!this.connection) {
                this.connection = joinVoiceChannel({
                    channelId: channel.id,
                    guildId: this.guild.id,
                    adapterCreator: this.guild.voiceAdapterCreator as any,
                    selfDeaf: true,
                    selfMute: false,
                });

                // 接続状態が Ready になるまで待機
                await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
                console.log('ボイスチャンネル接続完了');

                this.connection.on(VoiceConnectionStatus.Disconnected, async () => {
                    try {
                        await Promise.race([
                            entersState(this.connection!, VoiceConnectionStatus.Signalling, 5_000),
                            entersState(this.connection!, VoiceConnectionStatus.Connecting, 5_000),
                        ]);
                    } catch (error) {
                        this.connection?.destroy();
                        this.connection = null;
                    }
                });

                this.connection.subscribe(this.audioPlayer);
            }

            // 接続状態の再確認
            if (this.connection.state.status !== VoiceConnectionStatus.Ready) {
                await entersState(this.connection, VoiceConnectionStatus.Ready, 30_000);
            }

            return true;
        } catch (error) {
            console.error('ボイスチャンネル接続エラー:', error);
            this.connection?.destroy();
            this.connection = null;
            return false;
        }
    }

    private async downloadVideo(url: string): Promise<Readable> {
        return new Promise((resolve, reject) => {
            try {
                const progressBar = new cliProgress.SingleBar({
                    format: 'ダウンロード進捗 |{bar}| {percentage}%',
                    barCompleteChar: '=',
                    barIncompleteChar: '-',
                });

                const ytdlp = spawn('yt-dlp', [
                    '-f', 'bestaudio',
                    '--no-playlist',
                    '--progress',
                    '-o', '-',
                    url
                ]);

                const ffmpeg = spawn('ffmpeg', [
                    '-i', 'pipe:0',
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2',
                    '-loglevel', 'error',
                    '-buffer_size', '16M',  // バッファサイズを増やす
                    'pipe:1'
                ]);

                progressBar.start(100, 0);

                // yt-dlpの進捗処理
                ytdlp.stderr?.on('data', (data) => {
                    const output = data.toString();
                    if (output.includes('[download]')) {
                        const match = output.match(/(\d+\.?\d*)%/);
                        if (match) {
                            const progress = parseFloat(match[1]);
                            progressBar.update(progress);
                        }
                    }
                });

                ytdlp.on('error', (error: NodeError) => {
                    progressBar.stop();
                    reject(error);
                });

                ffmpeg.on('error', (error: NodeError) => {
                    progressBar.stop();
                    reject(error);
                });

                ffmpeg.on('close', () => {
                    progressBar.stop();
                });

                ytdlp.stdout.pipe(ffmpeg.stdin);
                resolve(ffmpeg.stdout);

            } catch (error) {
                console.error('Download error:', error);
                reject(error);
            }
        });
    }

    private async findYoutubeVideo(searchQuery: string): Promise<string | null> {
        try {
            // 検索クエリをエンコード
            const encodedQuery = encodeURIComponent(searchQuery);
            const searchResponse = await youtube.search.list({
                part: ['snippet'],
                q: encodedQuery,
                maxResults: 1,
                type: ['video'],
                key: process.env.YOUTUBE_API_KEY
            });

            if (searchResponse.data.items?.[0]?.id?.videoId) {
                return `https://www.youtube.com/watch?v=${searchResponse.data.items[0].id.videoId}`;
            }
            
            // YouTube APIが失敗した場合のフォールバック
            return await this.findVideoWithYtDlp(searchQuery);
        } catch (error) {
            console.error('YouTube search error:', error);
            return await this.findVideoWithYtDlp(searchQuery);
        }
    }

    private async findVideoWithYtDlp(searchQuery: string): Promise<string | null> {
        try {
            const result = await youtubeDl.exec(`ytsearch1:${searchQuery}`, {
                dumpSingleJson: true,
                noWarnings: true,
                callHome: false,  // noCallHomeをcallHomeに変更
                preferFreeFormats: true
            });

            if (typeof result === 'string') {
                const data = JSON.parse(result);
                return data.webpage_url || null;
            }
            return null;
        } catch (error) {
            console.error('yt-dlp search error:', error);
            return null;
        }
    }

    private async handleSpotifyUrl(url: string): Promise<QueueItem[]> {
        const items: QueueItem[] = [];
        const urlParts = new URL(url);
        
        try {
            // まずSpotifyトークンを更新
            await this.refreshSpotifyToken();
            
            if (url.includes('/playlist/')) {
                const playlistId = urlParts.pathname.split('/').pop()!;
                try {
                    const playlist = await this.spotify.getPlaylist(playlistId);
                    let tracks = playlist.body.tracks.items;

                    // プレイリストが空の場合
                    if (!tracks?.length) {
                        throw new Error('Playlist is empty');
                    }

                    // プログレスバーの設定
                    const progressBar = new cliProgress.SingleBar({
                        format: 'Spotifyプレイリストの処理中 |{bar}| {percentage}% | {value}/{total} 曲',
                        barCompleteChar: '=',
                        barIncompleteChar: '-'
                    });

                    progressBar.start(tracks.length, 0);

                    for (const [index, track] of tracks.entries()) {
                        if (!track.track) continue;

                        const trackData = track.track;
                        if (!trackData.name || !trackData.artists?.[0]?.name) continue;

                        try {
                            const searchQuery = `${trackData.name} ${trackData.artists[0].name} official`;
                            const videoUrl = await this.findYoutubeVideo(searchQuery);
                            
                            if (videoUrl) {
                                items.push({
                                    title: `${trackData.name} - ${trackData.artists[0].name}`,
                                    url: videoUrl,
                                    duration: this.formatDuration(Math.floor(trackData.duration_ms / 1000)),
                                    thumbnail: trackData.album?.images?.[0]?.url || ''
                                });
                            }
                        } catch (itemError) {
                            console.error('Error processing track:', trackData.name, itemError);
                        }

                        progressBar.update(index + 1);
                        await new Promise(resolve => setTimeout(resolve, 500)); // APIレート制限対策
                    }

                    progressBar.stop();
                } catch (error) {
                    console.error('Error fetching Spotify playlist:', error);
                    throw new Error('プレイリストの取得に失敗しました');
                }
            } else if (url.includes('/track/')) {
                
                const trackId = urlParts.pathname.split('/').pop()!;
                const trackResponse = await this.spotify.getTrack(trackId);
                const trackData = trackResponse.body;

                if (!trackData.name || !trackData.artists?.[0]?.name) {
                    throw new Error('Invalid track data');
                }

                const searchQuery = `${trackData.name} ${trackData.artists[0].name}`;
                const videoUrl = await this.findYoutubeVideo(searchQuery);
                
                if (videoUrl) {
                    const videoInfo = await youtubeDl(videoUrl, {
                        dumpJson: true,
                        quiet: true
                    });

                    items.push({
                        title: trackData.name,
                        url: videoUrl,
                        // ここも同様に修正
                        duration: this.formatDuration(Math.floor(trackData.duration_ms / 1000)),
                        thumbnail: trackData.album?.images?.[0]?.url || ''
                    });
                }
            }
        } catch (error) {
            console.error('Spotify handling error:', error);
            throw error;
        }

        return items;
    }

    private isSpotifyUrl(url: string): boolean {
        return url.includes('spotify.com');
    }

    private isYoutubeUrl(url: string): boolean {
        return url.includes('youtube.com') || url.includes('youtu.be');
    }

    async play(interaction: ChatInputCommandInteraction, query: string) {
        try {
            const member = await interaction.guild?.members.fetch(interaction.user.id);
            if (!member?.voice.channel) {
                await interaction.editReply('ボイスチャンネルに参加してください！');
                return;
            }

            const connected = await this.ensureConnection(member.voice.channel);
            if (!connected) {
                await interaction.editReply('ボイスチャンネルへの接続に失敗しました。');
                return;
            }

            // クエリの種類を判定して適切な処理を実行
            if (this.isSpotifyUrl(query)) {
                await interaction.editReply('Spotifyコンテンツを処理中...');
                const items = await this.handleSpotifyUrl(query);
                if (items.length > 0) {
                    this.queue.push(...items);
                    await interaction.editReply(
                        `✅ ${items.length}曲をキューに追加しました！\n` +
                        `最初の曲: ${items[0].title}`
                    );
                } else {
                    await interaction.editReply('⚠️ 楽曲の取得に失敗しました。');
                    return;
                }
            } else if (this.isYoutubeUrl(query)) {
                // YouTube URL の処理
                if (query.includes('list=')) {
                    // プレイリストの処理
                    const playlistId = new URL(query).searchParams.get('list');
                    if (!playlistId) {
                        await interaction.editReply('プレイリストIDが見つかりませんでした。');
                        return;
                    }
                    await this.handleYoutubePlaylist(interaction, playlistId);
                } else {
                    // 単一動画の処理
                    await this.handleYoutubeSingleVideo(interaction, query);
                }
            } else {
                // 検索クエリとして処理
                const videoUrl = await this.findYoutubeVideo(query);
                if (!videoUrl) {
                    await interaction.editReply('動画が見つかりませんでした。');
                    return;
                }
                await this.handleYoutubeSingleVideo(interaction, videoUrl);
            }

            if (this.queue.length === 1 && !this.downloading) {
                await this.playNext();
            }
        } catch (error) {
            console.error('Error in play:', error);
            await interaction.editReply('再生中にエラーが発生しました。');
        }
    }

    private async handleYoutubePlaylist(interaction: ChatInputCommandInteraction, playlistId: string) {
        const playlistResponse = await youtube.playlistItems.list({
            part: ['snippet', 'contentDetails'],
            playlistId: playlistId,
            maxResults: 50
        });

        if (!playlistResponse.data.items?.length) {
            await interaction.editReply('プレイリストが空か、非公開の可能性があります。');
            return;
        }

        const items = playlistResponse.data.items;
        for (const item of items) {
            const videoId = item.contentDetails?.videoId;
            if (!videoId) continue;

            const videoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const videoInfo = await youtubeDl(videoUrl, {
                dumpJson: true,
                quiet: true
            });

            this.queue.push({
                title: item.snippet?.title || 'Unknown Title',
                url: videoUrl,
                duration: this.formatDuration(Math.floor(videoInfo.duration)),  // Math.floorを追加
                thumbnail: item.snippet?.thumbnails?.default?.url || ''
            });
        }

        await interaction.editReply(`プレイリストから${items.length}曲を追加しました！`);
    }

    private async handleYoutubeSingleVideo(interaction: ChatInputCommandInteraction, url: string) {
        const videoInfo = await youtubeDl(url, {
            dumpJson: true,
            quiet: true,
            format: 'bestaudio'
        });

        this.queue.push({
            title: videoInfo.title || 'Unknown Title',
            url: url,
            duration: this.formatDuration(Math.floor(videoInfo.duration)),  // Math.floorを追加
            thumbnail: videoInfo.thumbnail || ''
        });

        await interaction.editReply(`キューに追加: ${videoInfo.title}`);
    }

    // 現在再生中の曲情報を表示する新メソッド
    async nowPlaying(interaction: ChatInputCommandInteraction) {
        if (!this.currentlyPlaying) {
            await interaction.reply('現在再生中の曲はありません。');
            return;
        }

        await interaction.reply({
            embeds: [{
                title: '🎵 現在再生中',
                description: `[${this.currentlyPlaying.title}](${this.currentlyPlaying.url})`,
                color: 0x00ff00,
                thumbnail: {
                    url: this.currentlyPlaying.thumbnail
                },
                fields: [
                    {
                        name: '長さ',
                        value: this.currentlyPlaying.duration,
                        inline: true
                    }
                ]
            }]
        });
    }

    // リピートモードの設定メソッドを追加
    async setRepeat(interaction: ChatInputCommandInteraction, mode: 'off' | 'single' | 'all') {
        this.repeat = mode;
        const modeEmoji = {
            'off': '➡️',
            'single': '🔂',
            'all': '🔁'
        };
        await interaction.reply(`リピートモードを${modeEmoji[mode]} ${mode}に設定しました。`);
    }

    // playNextメソッドを修正してリピート機能を実装
    private async playNext() {
        if (this.queue.length === 0 && this.repeat !== 'all') {
            console.log('キューが空になりました。接続を維持します。');
            return;
        }

        let current: QueueItem;
        if (this.repeat === 'single' && this.currentlyPlaying) {
            // 単曲リピートの場合
            current = this.currentlyPlaying;
        } else {
            // 通常再生またはプレイリストリピートの場合
            current = this.queue.shift()!;
            if (this.repeat === 'all') {
                // プレイリストリピートの場合は末尾に追加
                this.queue.push({ ...current });
            }
        }

        try {
            this.downloading = true;
            console.log(`\n${current.title} をダウンロード中...`);
            const audioStream = await this.downloadVideo(current.url);
            console.log('\nダウンロード完了');
            this.downloading = false;

            if (!this.connection?.state?.status) {
                throw new Error('接続が確立されていません');
            }

            await entersState(this.connection, VoiceConnectionStatus.Ready, 30000);

            const resource = createAudioResource(audioStream, {
                inputType: StreamType.Raw,
                inlineVolume: true
            });

            resource.volume?.setVolume(0.5);
            this.audioPlayer.play(resource);

            this.currentlyPlaying = current;  // 現在再生中の曲を設定

            return new Promise<void>((resolve) => {
                const onStateChange = (oldState: AudioPlayerState, newState: AudioPlayerState) => {
                    if (newState.status === AudioPlayerStatus.Playing) {
                        console.log('再生開始:', current.title);
                    } else if (newState.status === AudioPlayerStatus.Idle && 
                             oldState.status !== AudioPlayerStatus.Idle) {
                        this.audioPlayer.removeListener('stateChange', onStateChange);
                        this.queue.shift();
                        resolve();
                        setTimeout(() => this.playNext(), 1000);
                    }
                };

                this.audioPlayer.on('stateChange', onStateChange);
            });

        } catch (error) {
            console.error('PlayNext error:', error);
            this.currentlyPlaying = null;
            this.queue.shift();
            this.downloading = false;
            setTimeout(() => this.playNext(), 5000);
        }
    }

    // stopメソッドを明示的に呼んだ時のみ接続を切断
    stop() {
        this.queue = [];
        this.audioPlayer.stop();
        this.connection?.destroy();
        this.connection = null;
        console.log('再生を停止し、ボイスチャンネルから切断しました。');
    }

    // 新しいメソッドを追加：明示的に切断するコマンド用
    disconnect() {
        this.stop();
    }

    skip() {
        this.audioPlayer.stop();
    }

    async showQueue(interaction: ChatInputCommandInteraction) {
        if (this.queue.length === 0) {
            await interaction.reply('キューは空です。');
            return;
        }

        const queueList = this.queue
            .map((item, index) => `${index + 1}. ${item.title}`)
            .join('\n');
        
        await interaction.reply(`現在のキュー:\n${queueList}`);
    }

    private formatDuration(seconds: number): string {
        const minutes = Math.floor(seconds / 60);
        const remainingSeconds = Math.floor(seconds % 60);
        return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
    }
}
