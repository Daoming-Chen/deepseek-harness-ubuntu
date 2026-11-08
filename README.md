# DeepSeek Harness Ubuntu

用于构建和发布 Ubuntu x64 个人维护版的配置、源码补丁及工作流。应用复用官方界面和更新流程，后台使用包内独立 Node。此仓库不是 DeepSeek 官方发行渠道。

## 本地构建

需要 Ubuntu x64、Git、Python 3、PyYAML（Ubuntu 包名 `python3-yaml`）、Node 24.9 或更高版本和 Corepack。执行 `./build.sh` 后，安装包、更新清单和 SHA-256 位于 `dist/`；`work/` 是可重建的中间目录。上游源码固定在 `upstream.json` 指定的提交，补丁不匹配时构建会停止。

设置 `DSH_DESKTOP_BUILD_VERSION` 为递增的版本号，例如 `0.2.2-rc.1.20261108.2`。设置 `DSH_DESKTOP_LINUX_UPDATE_URL` 为提供 `stable-linux.yml` 和 `.deb` 的 HTTPS 目录。单纯添加 `+build` 后缀不能让客户端认为版本更新。

## 客户端更新

客户端沿用官方的 electron-updater 和更新对话框，通过 DebUpdater 安装 Ubuntu 包。客户端校验 SHA-512、拒绝降级，并在安装前检查运行中的任务。下载与检查失败可以重试；系统安装可能需要 Ubuntu 管理员认证。

发布新版时，先上传完整 `.deb`，再公开引用该文件的 `stable-linux.yml`。更新清单中的版本、文件名、长度和 SHA-512 必须与安装包一致。HTTPS 更新目录的控制者决定客户端能够安装的版本。

## GitHub Releases

推送经过审查的改动到 `main` 会运行完整构建和验证，成功后发布 GitHub Release 并更新 `releases/latest/download/`。手动运行工作流时，默认只构建 Actions artifact；显式选中 `publish` 才发布。用户的客户端无需 GitHub 密钥。

当前候选更新地址是 `https://github.com/Daoming-Chen/deepseek-harness-ubuntu/releases/latest/download/`。只有仓库及 Release 实际创建并发布后，该地址才可提供在线更新。源码与发布工作流已经发布到上述仓库；首个线上安装包由 GitHub Actions 构建并验证。

上游更新时，先修改 `upstream.json` 中的提交并确认补丁兼容，再跑完整工作流。构建失败不会发布更新，也不会修改用户客户端。

## 验证范围

已在开发机验证真实桌面启动、中文目录选择、模拟模型的中文请求与回复、关闭窗口最小化、独立运行时及办公转换。真实 DebUpdater 的网络失败恢复、同版本与旧版本处理、损坏下载拒绝、完整下载校验和安装重启交接已验证。系统级升级与 GitHub Actions 工作流需要在首次部署后验证。

## 自动跟随官方 Release

`Follow official DeepSeek releases` 每小时检查官方公开发布的 `dsh-v*` Release，默认跟随正式版和 RC。alpha、nightly、草稿和低于当前源码版本的发布不触发日用客户端更新。GitHub 的定时任务可能延迟，因此不会保证与官方秒级同步。

检测到更高版本后，工作流核对标签、源码提交和 package.json 版本，并要求源码历史向前推进，再使用 Ubuntu 补丁构建并执行验证。成功后才发布新版和更新清单，最后记录新的上游提交。补丁冲突、测试失败或源码版本不一致时，GitHub Actions 会失败，上一版线上客户端继续可用。

我们的仓库保存适配和发行流程，构建时取官方源码；固定的 `upstream.json` 表示上一次已经验证并发布的官方来源。

失败的候选版本会暂停自动重试，避免每小时重复构建和通知。上游发布更高版本、构建输入修复后会重新尝试；维护者也可手动运行同步工作流并勾选 `retry_failed`。无新版本时保持安静；长期没有代码更新时，按月记录一次真实的检查结果，便于排查监控是否持续运行。
