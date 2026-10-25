# GitHub 构建 Docker 与安卓正式版

统一入口：GitHub Actions → **Release Docker & Android**（`build.yml`）。
GitHub 执行前端/Go/Flutter 检查、Docker 多架构构建和安卓签名；本地无需安装 Docker 或 Flutter。

## 一次性配置安卓签名

沿用已有正式版的 `release.keystore`，不能重新生成签名私钥，否则已有用户无法覆盖升级。
签名文件在 Linux 发布服务器时，在该服务器执行以下步骤。不要把密码或密钥内容粘贴到聊天、Issue 或仓库。

1. 安装 Python 3 与 GitHub CLI，使用 `gh auth login` 登录有仓库管理权限的账号。
2. 把本次工作流和脚本提交推送到 GitHub，然后更新服务器上的代码。
3. 在服务器运行（输入文件保持在服务器上）：

   ```bash
   cd /root/nowen-reader
   python3 scripts/android-signing.py configure \
     --properties /root/nowen-reader/flutter_app/android/key.properties \
     --repo cropflre/nowen-reader
   ```

脚本读取 `storeFile` 指向的现有密钥文件，以及本地的别名、密码；通过标准输入调用 `gh secret set`，
只显示 Secret 名称，不输出、临时落盘或通过命令参数传递密码。请先检查目标 `--repo` 是否正确。
它设置以下 Repository Actions Secrets：

| Secret | 内容 |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | 现有 keystore 的 Base64 内容 |
| `ANDROID_STORE_PASSWORD` | keystore 密码 |
| `ANDROID_KEY_PASSWORD` | 私钥密码 |
| `ANDROID_KEY_ALIAS` | 已有私钥别名，例如 `nowen-reader` |

脚本支持当前示例中的单行 `key=value` 配置；含 Java properties 转义或续行的配置会拒绝自动导入，
此时在 GitHub 的 **Settings → Secrets and variables → Actions** 中直接配置以上四项。
不要将整个 `key.properties` 上传为构建产物。Linux 的 `/root/...` 路径不会写入 GitHub 配置；
构建机会在临时目录中还原密钥，并写入自己的路径，结束时清理。

如密码已在公开或共享渠道泄露，应更换密钥容器和私钥密码并更新 Secrets，保留原私钥及证书。
正式构建缺少签名时直接失败，不再回退为 debug 签名。开发调试构建无需正式签名。

## 镜像仓库配置

在同一仓库设置：

| Secret | 内容 |
| --- | --- |
| `DOCKERHUB_USERNAME` | 有权限推送 `cropflre/nowen-reader` 的 Docker Hub 账号 |
| `DOCKERHUB_TOKEN` | 该账号的 Docker Hub 访问令牌 |

GHCR 使用工作流的 `GITHUB_TOKEN` 和 `packages: write`。若 GHCR 包已存在，
需允许当前仓库的 Actions 写入该包；首次发布后按需要在包设置里调整可见性。

## 先做一次不发布的构建

1. 打开 Actions → **Release Docker & Android** → **Run workflow**。
2. 选择包含本次工作流的分支，填写版本（例如 `1.2.4`）。
3. 保持 `publish` 未勾选。

这次运行会测试、构建并保存签名 APK 和包含 amd64/arm64 的 OCI 镜像归档，
不推送镜像、不创建版本标签、不创建 Release。候选构建也使用正式签名 Secrets。

产物包括：

- `release-android`：三个 ABI 的 APK、证书 SHA-256、APK 校验和（保存 14 天）。
- `release-container`：多架构 OCI 归档及校验和（保存 7 天）。
- `release-metadata`：源码 commit、版本、Android 基础构建号、构建时间（保存 14 天）。

## 正式发布

代码审核、测试和候选构建完成后，将版本标签推送到目标提交：

```bash
git tag v1.2.4 <要发布的提交SHA>
git push origin v1.2.4
```

这就是正式发布操作。请按版本顺序逐个发布，上一版本结束后再触发下一版本。
也可在 Run workflow 选择已存在的同名版本标签，并勾选 `publish`；从分支直接发布会被拒绝。

正式流程依次执行：

1. 验证版本与源码提交；测试前端、Go、Flutter。
2. 并行构建安卓 APK 和 Docker 多架构 OCI 归档；此阶段不推送镜像。
3. 验证每个 APK 的应用 ID、版本、非调试标志和签名证书；上传前校验下载的产物。
4. 从同一 OCI 归档向 Docker Hub 和 GHCR 发布 `v版本号` 镜像，不重新构建镜像。
5. 创建对应 GitHub Release，附上 APK、校验和、证书摘要和源码元数据。
6. 稳定版完成后更新两个镜像仓库的 `latest`；`alpha`、`beta`、`rc` 预发布不改 `latest`。

普通 `main` 推送由 `docker.yml` 构建 GHCR 的 `edge` 和 SHA 标签，不更新正式版 `latest`。
原来重复的 `deploy.yml` 已并入统一发布入口；此流程不通过 SSH 自动重启生产服务。
本地 `release.sh` 保留为备用，不能对同一版本同时运行本地发布和 GitHub 发布。

## 版本号与升级

Docker 和 APK 使用同一版本、同一源码提交。APK 的 `versionName` 由标签去掉 `v` 得到。
基础构建号默认是仓库变量 `ANDROID_BUILD_NUMBER_BASE`（默认 1000）加本工作流运行序号；
手动运行时可用 `build_number` 覆盖。Flutter 按 ABI 拆分 APK 时会追加架构偏移，最终
`versionCode` 分别是基础构建号加 1000（armeabi-v7a）、2000（arm64-v8a）、4000（x86_64）。
基础构建号范围为 1 到 2099996000，为架构偏移保留空间。
首次迁移前，应分别核对最近已发布各架构 APK 的 `versionCode`，确保新包的最终值更大，
并按需要提高基数。`release-info.json` 中的 `build_number` 记录基础构建号。
重跑同一次运行保持同一个基础构建号及各架构的 `versionCode`。

## 失败与重试

任何测试、签名或构建失败都会阻止整个发布 job，且不更新 `latest`。
Docker Hub、GHCR 与 GitHub Release 是独立服务，发布阶段网络失败可能留下部分版本产物，
不能承诺跨服务事务回滚。查看失败步骤后再恢复，避免盲目重新打标签或覆盖已发布产物。

在 Release 创建前失败，可重跑失败 job，继续使用该次运行保存的构建产物。
若 Release 已创建而 `latest` 提升失败，应核对镜像摘要、APK 校验和及 Release 后，
手动将已存在的该版本镜像提升为 `latest`；不要重跑完整流程去覆盖 Release。
已存在的 Release 会在新一次运行的预检查中阻止发布。

工作流代码通过本地检查不代表 GitHub 构建或正式发布已完成；以目标 commit 的实际 Actions 运行及产物为准。
