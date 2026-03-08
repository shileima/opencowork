---
name: video-download
description: 使用 yt-dlp 从 YouTube、B站、Twitter 等数千站点下载视频或音频。当用户要求下载视频、保存网页视频、导出为 MP3/MP4、抓取播放列表时使用本技能。支持画质选择、仅音频、字幕、Cookie 登录。
---

# 视频下载（yt-dlp）

使用 [yt-dlp](https://github.com/yt-dlp/yt-dlp) 从支持的站点下载视频或音频。支持 YouTube、Bilibili、Twitter/X、抖音等数千站点。

## 何时使用

- 用户要求「下载视频」「保存这个网页里的视频」「导出为 MP3/MP4」
- 需要从 YouTube、B站、Twitter 等链接抓取视频或音频
- 需要下载播放列表、指定画质、仅要音频、或带字幕

## 前置条件

1. **安装 yt-dlp**（二选一）：
   - **pip**：`pip install yt-dlp` 或 `pip3 install yt-dlp`
   - **Homebrew（macOS）**：`brew install yt-dlp`
2. **FFmpeg**（可选但推荐）：合并音视频流、转码为 MP3 时需要。  
   - macOS：`brew install ffmpeg`

安装验证：`yt-dlp --version`

## 基本用法

```bash
# 默认：最佳画质，自动选格式
yt-dlp "https://example.com/video"

# 指定输出目录
yt-dlp -o "/path/to/output/%(title)s.%(ext)s" "URL"

# 当前目录，文件名用标题
yt-dlp -o "%(title)s.%(ext)s" "URL"
```

## 画质与格式

```bash
# 列出所有可用格式
yt-dlp -F "URL"

# 最佳视频+音频（通常需 FFmpeg 合并）
yt-dlp -f "bv*+ba/b" "URL"

# 指定分辨率（如 1080p、720p）
yt-dlp -f "bv*[height<=1080]+ba/b" "URL"
yt-dlp -f "bv*[height<=720]+ba/b" "URL"

# 优先 MP4 容器
yt-dlp -f "bv*[ext=mp4]+ba[ext=m4a]/b" "URL"
```

## 仅音频（导出 MP3/M4A）

```bash
# 仅音频，转为 MP3（需 FFmpeg）
yt-dlp -x --audio-format mp3 "URL"

# 仅音频，M4A（通常无需转码）
yt-dlp -x --audio-format m4a "URL"

# 指定音质（0=最佳）
yt-dlp -x --audio-format mp3 --audio-quality 0 "URL"
```

## 播放列表

```bash
# 下载整个播放列表
yt-dlp "https://youtube.com/playlist?list=PLxxx"

# 只下载前 N 个
yt-dlp --playlist-end 10 "PLAYLIST_URL"

# 从第 M 个到第 N 个
yt-dlp --playlist-start 5 --playlist-end 20 "PLAYLIST_URL"

# 输出到子目录（按上传者/标题组织）
yt-dlp -o "%(uploader)s/%(playlist_index)s - %(title)s.%(ext)s" "PLAYLIST_URL"
```

## 字幕

```bash
# 下载指定语言字幕（如英、中）
yt-dlp --write-subs --sub-langs "en,zh-Hans" "URL"

# 仅下载字幕，不下载视频
yt-dlp --write-subs --skip-download "URL"

# 自动生成字幕（若站点支持）
yt-dlp --write-auto-subs --sub-langs "en" "URL"
```

## 需要登录 / 年龄限制

```bash
# 从 Chrome 读取 Cookie（需已在该浏览器登录）
yt-dlp --cookies-from-browser chrome "URL"

# 从 Firefox 读取
yt-dlp --cookies-from-browser firefox "URL"
```

## 输出路径与命名

常用模板变量：`%(title)s`、`%(id)s`、`%(uploader)s`、`%(ext)s`、`%(playlist_index)s`。

```bash
# 按上传者分目录，文件名为标题
yt-dlp -o "%(uploader)s/%(title)s.%(ext)s" "URL"

# 带序号（播放列表）
yt-dlp -o "%(playlist_index)s - %(title)s.%(ext)s" "PLAYLIST_URL"
```

## 其他常用选项

| 选项 | 说明 |
|------|------|
| `-i` / `--ignore-errors` | 单个失败不中断（播放列表有用） |
| `-r RATE` | 限速（如 `50K`、`2M`） |
| `--no-overwrites` | 已存在文件不覆盖 |
| `-U` / `--update` | 将 yt-dlp 更新到最新版 |

## 示例汇总

```bash
# 1. 下载单视频，最佳画质，保存到当前目录
yt-dlp -o "%(title)s.%(ext)s" "https://www.youtube.com/watch?v=xxxx"

# 2. 仅音频 MP3
yt-dlp -x --audio-format mp3 -o "%(title)s.%(ext)s" "URL"

# 3. 1080p MP4，输出到指定目录
yt-dlp -f "bv*[height<=1080]+ba/b" -o "/path/to/%(title)s.%(ext)s" "URL"

# 4. 播放列表前 5 个，带英文字幕
yt-dlp --playlist-end 5 --write-subs --sub-langs en -o "%(title)s.%(ext)s" "PLAYLIST_URL"

# 5. 需登录时用 Chrome Cookie
yt-dlp --cookies-from-browser chrome "URL"
```

## 注意事项

- **版权与条款**：仅下载你有权下载的内容，遵守站点服务条款与当地法律。
- **FFmpeg**：下载「最佳画质」或「转成 MP3」时多数情况会用到，未安装时 yt-dlp 会提示。
- **站点支持**：支持站点列表见 `yt-dlp --list-extractors`；部分站点需 Cookie 或会变更，失败时可先 `yt-dlp -U` 更新。
- **网络**：若被限速或封禁，可尝试 `--proxy URL` 或使用 Cookie/登录。
