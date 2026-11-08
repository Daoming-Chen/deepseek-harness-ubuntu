Ubuntu x64 个人维护版本，基于 DeepSeek Harness 官方开源源码。

- 提供可安装的 .deb、桌面图标和 Wayland 输入法启动参数。
- Linux 后台使用包内独立 Node，避免 Electron 与 sharp 的 GLib 冲突。
- 支持客户端检查更新、下载校验和安装重启；Ubuntu 可能要求管理员认证。
- 构建包含类型检查、相关回归测试、真实运行时测试和 Debian 更新器联调。

源码版本见 upstream.json，安装包 SHA-256 见 SHA256SUMS。此发行版由个人维护，不是 DeepSeek 官方发布的 Linux 客户端。
