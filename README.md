# Cloudflare-Accel
基于 Cloudflare Workers 的 GitHub 和 Docker 加速服务，自动生成加速链接与命令。
# Cloudflare-Accel

是一个基于 Cloudflare Workers 或 Cloudflare Pages 的反向代理服务，旨在加速 GitHub 文件下载和 Docker 镜像拉取。通过 Cloudflare 的全球边缘网络，提供更快、更稳定的下载体验。项目提供直观的网页界面，支持将 GitHub 文件链接和 Docker 镜像地址转换为加速链接或命令，并自动复制到剪贴板。界面针对 PC 和移动端（iPhone、Android）进行了优化，加速链接支持换行，复制功能兼容主流浏览器，GitHub 请求通过反向代理实现加速。

## 目录

- [特点](#特点)
- [部署方法](#部署方法)
  - [效果演示](#效果演示)
  - [使用 Cloudflare Workers 部署](#使用-cloudflare-workers-部署)
  - [使用 Cloudflare Pages 部署](#使用-cloudflare-pages-部署)
- [参数说明](#参数说明)
- [使用示例](#使用示例)
- [许可证](#许可证)

## 特点

- ⚡ GitHub 文件加速（反向代理），支持 `https://` 或 `http://` 链接输入，输出加速链接保留原始协议
- 🐳 Docker 镜像加速（反向代理）
- 🎨 现代化 UI，适配 PC 和移动端（iPhone、Android），加速链接支持换行
- 📋 复制功能兼容 PC、iPhone 和 Android 浏览器
- 🔒 白名单控制，GitHub 链接需以 `https://` 开头

## 部署方法

### 效果演示

<img width="2800" height="1420" alt="image" src="https://github.com/user-attachments/assets/ec0085f7-87a1-415c-9c19-66b6f8df982c" />

### 使用 Cloudflare Workers 部署

1. **创建 Cloudflare Worker**：
   - 登录 [Cloudflare 仪表板](https://dash.cloudflare.com/)。
   - 转到 Workers 部分，点击“创建 Worker”。
   - 将 `_worker.js` 代码（见项目仓库）粘贴到 Worker 编辑器。
   - 点击“部署”按钮，Worker 将上线。

2. **绑定域名**：
   - 在 Workers 路由中添加路由（如 `*.your-domain/*`），绑定到 Worker。
   - 确保 DNS 已配置（如 `accel.your-domain.com` 解析到 Cloudflare）。

3. **配置白名单（可选）**：
   - 修改 `_worker.js` 中的 `ALLOWED_HOSTS` 和 `ALLOWED_PATHS` 数组，添加允许的域名和路径（如 `cloudflare`）。
   - 设置 `RESTRICT_PATHS = true` 启用路径限制，仅允许 `ALLOWED_PATHS` 中的路径。

### 使用 Cloudflare Pages 部署

1. **创建 Cloudflare Pages 项目**：
   - 登录 [Cloudflare 仪表板](https://dash.cloudflare.com/)。
   - 转到 Pages 部分，点击“创建项目”。
   - 选择“连接到 Git 仓库”或“直接上传”。
     - **Git 仓库**：连接 GitHub 仓库（如 `fscarmen2/Cloudflare-Accel`），选择包含 `_worker.js` 的分支。
     - **直接上传**：上传包含 `_worker.js` 的文件夹（至少包含 `_worker.js` 文件）。

2. **配置构建设置**：
   - 项目名称：输入自定义名称（如 `cloudflare-accel`）。
   - 构建命令：留空（无需构建，`_worker.js` 为单一文件）。
   - 输出目录：留空或设为 `/`（Cloudflare Pages 自动识别 `_worker.js`）。
   - 环境变量：无需额外配置（除非有特殊需求）。
   - 点击“保存并部署”。

3. **绑定自定义域名**：
   - 在 Pages 项目设置中，点击“自定义域”。
   - 添加域名（如 `accel.your-domain.com`），确保 DNS 已解析到 Cloudflare。
   - 保存并等待 DNS 生效。

4. **验证部署**：
   - 访问 `https://your-pages-domain/`（或自定义域名），确认显示加速页面。
   - 确保 `_worker.js` 使用模块语法（`export default`），以兼容 Cloudflare Pages 的 Functions 功能。

5. **配置白名单（可选）**：
   - 编辑 `_worker.js` 中的 `ALLOWED_HOSTS` 和 `ALLOWED_PATHS` 数组，添加允许的域名和路径（如 `cloudflare`）。
   - 设置 `RESTRICT_PATHS = true` 启用路径限制。
   - 提交更改（Git 仓库）或重新上传文件（直接上传）。

## 参数说明

| 参数名            | 说明                                                                 | 默认值                                                                 |
|-------------------|----------------------------------------------------------------------|----------------------------------------------------------------------|
| `ALLOWED_HOSTS`   | 允许代理的域名列表（默认白名单），未列出的域名将返回 400 错误       | `['quay.io', 'gcr.io', 'k8s.gcr.io', 'registry.k8s.io', 'ghcr.io', 'docker.cloudsmith.io', 'registry-1.docker.io', 'github.com', 'api.github.com', 'raw.githubusercontent.com', 'gist.github.com', 'gist.githubusercontent.com']` |
| `RESTRICT_PATHS`  | 是否限制 GitHub 和 Docker 请求的路径，`true` 要求路径匹配 `ALLOWED_PATHS`，`false` 允许所有路径 | `false`                                                              |
| `ALLOWED_PATHS`   | 允许的 GitHub 和 Docker 路径关键字，仅当 `RESTRICT_PATHS = true` 时生效 | `['library', 'user-id-1', 'user-id-2']`（建议添加 `cloudflare`）     |

### 修改白名单
- **添加新域名**：编辑 `ALLOWED_HOSTS`，如添加 `docker.io`：
  ```javascript
  const ALLOWED_HOSTS = [...ALLOWED_HOSTS, 'docker.io'];
  ```
- **添加新路径**：编辑 `ALLOWED_PATHS`，如添加 `cloudflare`：
  ```javascript
  const ALLOWED_PATHS = [...ALLOWED_PATHS, 'cloudflare'];
  ```
- **启用路径限制**：设置 `RESTRICT_PATHS = true`，确保 `ALLOWED_PATHS` 包含所需路径（如 `cloudflare`）。

## 使用示例

1. **访问首页**：
   ```bash
   curl https://your-domain/
   ```
   - 显示网页，包含 GitHub 和 Docker 输入框，右上角主题切换按钮，黄色闪电 favicon。移动端显示优化，加速链接支持换行，复制按钮适配 iPhone 和 Android 浏览器。

2. **GitHub 文件加速**：
   - **输入要求**：GitHub 链接必须以 `https://` 开头，否则提示“链接必须以 https:// 开头”。
   - **示例 1**：
     - 输入：`https://github.com/cloudflare/cloudflared/releases/download/2025.7.0/cloudflared-linux-amd64`
     - 输出：`https://your-domain/https://github.com/cloudflare/cloudflared/releases/download/2025.7.0/cloudflared-linux-amd64`
   - **示例 2**：
     - 输入：`http://github.com/cloudflare/cloudflared/releases/download/2025.7.0/cloudflared-linux-amd64`
     - 输出：`https://your-domain/http://github.com/cloudflare/cloudflared/releases/download/2025.7.0/cloudflared-linux-amd64`
   - **无效输入**：
     - 输入：`github.com/cloudflare/...` 或 `http://github.com/...`
     - 输出：错误提示“链接必须以 https:// 开头”
   - **行为**：
     - 自动复制加速链接（支持 PC、iPhone、Android），弹窗提示“已复制到剪贴板”。
     - 显示 📋 复制 和 🔗 打开 按钮，移动端链接换行显示，避免溢出。
   - **测试（反向代理）**：
     ```bash
     curl -I https://your-domain/https://github.com/cloudflare/cloudflared/releases/download/2025.7.0/cloudflared-linux-amd64
     curl -I https://your-domain/http://github.com/cloudflare/cloudflared/releases/download/2025.7.0/cloudflared-linux-amd64
     curl -I https://your-domain/github.com/cloudflare/cloudflared/releases/download/2025.7.0/cloudflared-linux-amd64
     ```
     - 返回：`200 OK`，响应内容直接从 Worker 获取（而非 302 重定向）。
     - 日志：`Request: GET /github.com/cloudflare/...`（忽略 `https://` 或 `http://` 前缀）。
   - **测试（`RESTRICT_PATHS = true`）**：
     - 修改 `ALLOWED_PATHS` 包含 `cloudflare`：
       ```javascript
       const ALLOWED_PATHS = ['library', 'user-id-1', 'user-id-2', 'cloudflare'];
       const RESTRICT_PATHS = true;
       ```
     - 测试：
       ```bash
       curl https://your-domain/https://github.com/cloudflare/cloudflared/...  # 成功
       curl https://your-domain/https://github.com/other-user/repo/...  # 返回 403: Error: The path is not in the allowed paths.
       ```
   - **测试（`RESTRICT_PATHS = false`）**：
     ```bash
     curl https://your-domain/https://github.com/other-user/repo/...  # 成功
     ```

3. **Docker 镜像加速**：
   - 输入：`nginx` 或 `ghcr.io/user-id-1/hubproxy`
   - 输出：`docker pull your-domain/nginx`
   - 自动复制（支持 PC、iPhone、Android），弹窗提示“已复制到剪贴板”，显示 📋 复制 按钮。移动端命令换行显示，避免溢出。
   - 测试（`RESTRICT_PATHS = true`）：
     ```bash
     docker pull your-domain/nginx  # 成功（library）
     docker pull your-domain/ghcr.io/user-id-1/hubproxy  # 成功
     docker pull your-domain/ghcr.io/unknown/hubproxy  # 返回 403: Error: The path is not in the allowed paths.
     ```
   - 测试（`RESTRICT_PATHS = false`）：
     ```bash
     docker pull your-domain/ghcr.io/unknown/hubproxy  # 成功
     ```

4. **白名单外域名**：
   ```bash
   curl https://your-domain/invalid.com/path
   ```
   - 返回：`Error: Invalid target domain.`

## 许可证

本项目基于 MIT 许可证。详情见 [LICENSE](LICENSE) 文件。
