# Discord Music Bot

Discord用の高機能音楽Bot。YouTube、Spotifyの再生に対応した多機能音楽プレーヤーです。

## 主な機能

### 音楽再生
- YouTubeの動画/プレイリストの再生
- Spotifyのトラック/プレイリストの再生
- キーワード検索による再生
- 高品質なオーディオストリーミング（48kHz, 16bit）
- プログレスバーによるダウンロード進捗表示

### プレイリスト管理
- 再生キューの管理
- 現在再生中の曲情報表示
- キュー内の曲一覧表示
- プレイリストの一括追加（最大50曲）

### リピート機能
- 通常再生（リピートなし）
- 1曲リピート
- 全曲リピート（プレイリストループ）

### その他
- スラッシュコマンド対応
- エラー時の自動リトライ
- 接続が切れた際の自動再接続
- 詳細なエラーメッセージ

## 必要要件

### システム要件
- Node.js (v16.9.0以上)
- FFmpeg
- Python 3
- yt-dlp

### 必要なAPI
- Discord Bot Token
- YouTube Data API キー
- Spotify API (Client ID & Secret)

## セットアップ手順

### 1. 必要なAPIキーの取得

#### Discord Bot Token & Client ID
1. [Discord Developer Portal](https://discord.com/developers/applications)にアクセス
2. 「New Application」をクリック
3. Bot セクションで「Add Bot」をクリック
4. トークンを生成し、保存
5. OAuth2 セクションでClient IDをコピー

#### YouTube API Key
1. [Google Cloud Console](https://console.cloud.google.com/)にアクセス
2. プロジェクトを作成
3. YouTube Data API v3を有効化
4. 認証情報でAPIキーを作成

#### Spotify API Credentials
1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)にアクセス
2. アプリケーションを作成
3. Client IDとClient Secretを取得

### 2. インストール
コンソールにて npm i

使い方
Botの起動: npm start

コマンドについては/helpで確認してください