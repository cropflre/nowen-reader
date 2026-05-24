#!/usr/bin/env bash
# =============================================================================
# nowen-reader 发布脚本（两阶段：先全量构建，再统一发布）
#
# 设计原则：
#   ★ 任何单个产物（Docker / APK / Git Tag）构建失败 → 不发布任何东西
#   ★ 阶段 1：本地构建 Docker 镜像 + 安卓 APK + 创建本地 git tag（全部不推送）
#   ★ 阶段 2：全部就绪后，统一推送 Docker、Git Tag、GitHub Release
#
# 使用：
#   ./release.sh                     # 全交互，默认同时构建 amd64 + arm64
#   ./release.sh -v 1.3.0 -y         # 指定版本 + 跳过确认（CI 常用）
#   ./release.sh -v 1.3.0 --amd64-only       # 只发 amd64
#   ./release.sh -v 1.3.0 --arm64-only       # 只发 arm64
#   ./release.sh -v 1.3.0-rc.1 --no-latest   # 预发布，不动 latest
#   ./release.sh -v 1.3.0 --no-pull          # 不 git pull
#   ./release.sh -v 1.3.0 --no-git-tag       # 不打 git tag
#   ./release.sh -v 1.3.0 --dry-run          # 只打印命令不执行
# =============================================================================

set -euo pipefail

# -------------------- 配置 --------------------
IMAGE_NAME="cropflre/nowen-reader"
DEFAULT_BRANCH="main"
# 多架构平台：覆盖 x86_64 服务器 + ARM64 设备（OES / A311D / OECT / RK3566 等）
DEFAULT_PLATFORMS="linux/amd64,linux/arm64"
# buildx builder 名称（自动创建）
BUILDX_BUILDER="nowen-reader-builder"
# Flutter 安卓项目目录（位于仓库根目录下的 flutter_app）
FLUTTER_APP_DIR="flutter_app"
# GitHub Release 仓库（owner/repo），留空则从 git remote 自动解析
GITHUB_REPO=""

# -------------------- 彩色输出 --------------------
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
    C_RED="$(tput setaf 1)"
    C_GREEN="$(tput setaf 2)"
    C_YELLOW="$(tput setaf 3)"
    C_BLUE="$(tput setaf 4)"
    C_CYAN="$(tput setaf 6)"
    C_BOLD="$(tput bold)"
    C_RESET="$(tput sgr0)"
else
    C_RED=""; C_GREEN=""; C_YELLOW=""; C_BLUE=""; C_CYAN=""; C_BOLD=""; C_RESET=""
fi

info()  { echo "${C_BLUE}[*]${C_RESET} $*"; }
ok()    { echo "${C_GREEN}[✓]${C_RESET} $*"; }
warn()  { echo "${C_YELLOW}[!]${C_RESET} $*" >&2; }
die()   { echo "${C_RED}[✗]${C_RESET} $*" >&2; exit 1; }
step()  { echo; echo "${C_BOLD}${C_CYAN}==== $* ====${C_RESET}"; }

# Ctrl-C 友好退出
trap 'echo; die "已被用户中断（SIGINT）"' INT

# -------------------- 参数解析 --------------------
VERSION=""
ASSUME_YES=0
DO_PULL=1
DO_LATEST=1
DO_GIT_TAG=1
DRY_RUN=0
# 发布前是否自动清理未跟踪文件（如缓存、日志等残留目录）
# 默认开启：发布服务器一般只拉代码 + 构建，残留的未跟踪文件几乎都是可丢弃的临时产物
DO_AUTO_CLEAN=1
# 多架构相关
PLATFORMS="$DEFAULT_PLATFORMS"
MULTIARCH=1

# 跟踪用户是否通过命令行显式指定了某些选项
# （显式指定过，则交互式菜单不再询问，直接用用户给的值）
EXPLICIT_LATEST=0
EXPLICIT_GIT_TAG=0
EXPLICIT_MULTIARCH=0
EXPLICIT_PLATFORM=0
EXPLICIT_ANDROID=0
EXPLICIT_GH_RELEASE=0

# Android APK + GitHub Release 相关
DO_ANDROID=0          # 是否同时构建 Android APK
DO_GH_RELEASE=1       # 是否把 APK 上传到 GitHub Release（仅 DO_ANDROID=1 时生效）
ANDROID_SPLIT_ABI=1   # 是否按 ABI 拆分 APK（armeabi-v7a / arm64-v8a / x86_64）
ANDROID_BUILD_AAB=0   # 是否同时构建 AAB（Google Play 上架用）

# 跳过 Docker 构建+推送（仅 Android 套餐使用，默认 0）
SKIP_DOCKER=0

usage() {
    cat <<EOF
用法: $0 [选项]

不带任何参数运行时，进入${C_BOLD}懒人交互模式${C_RESET}（一路回车即用默认值）。

选项:
  -v, --version VERSION    指定版本号（例: 1.3.0 或 v1.3.0）
  -y, --yes                跳过所有确认（全默认，适合 CI）
      --no-pull            不执行 git pull
      --no-latest          不打 :latest tag
      --no-git-tag         不打 git tag / 不推送到 GitHub
      --auto-clean         自动清理工作区未跟踪文件（git clean -fd，已跟踪的修改仍会拦截）
      --no-auto-clean      关闭自动清理，遇到脏工作区直接报错（CI 严格模式）
      --no-multiarch       只构建本机架构（单架构 + 本地 load，不走 buildx push）
      --amd64-only         只构建 linux/amd64（仍用 buildx 推送）
      --arm64-only         只构建 linux/arm64（仍用 buildx 推送）
      --platform LIST      指定构建平台（默认: $DEFAULT_PLATFORMS）
                           示例: linux/amd64,linux/arm64,linux/arm/v7
      --with-android       同时构建 Android APK 并上传到 GitHub Release
      --no-android         不构建 Android APK（默认）
      --android-no-split   构建单个 fat APK（不按 ABI 拆分）
      --android-aab        额外构建 AAB（Google Play 上架包）
      --no-gh-release      只本地构建 APK，不上传到 GitHub Release
      --gh-repo OWNER/REPO 指定 GitHub 仓库（默认从 git remote 解析）
      --dry-run            仅打印命令，不真实执行
  -h, --help               显示帮助

示例:
  $0                              # 全交互（懒人模式），默认 amd64 + arm64
  $0 -y                           # 全默认，适合 CI / 重复发布
  $0 -v 1.3.0                     # 指定版本 + 其余交互
  $0 -v 1.3.0 -y --amd64-only     # CI 快速发 amd64
  $0 -v 1.3.0 -y --arm64-only     # CI 快速发 arm64
  $0 -v 1.3.0-rc.1 --no-latest    # 预发布，不动 latest
  $0 -v 1.3.0 -y --with-android   # Docker + Android APK 一键发布到 GitHub Release
  $0 -v 1.3.0 --with-android --no-gh-release   # 只本地打 APK，不上传 GitHub
EOF
    exit 0
}

while [ $# -gt 0 ]; do
    case "$1" in
        -v|--version)   VERSION="${2:-}"; shift 2 ;;
        -y|--yes)       ASSUME_YES=1; shift ;;
        --no-pull)      DO_PULL=0; shift ;;
        --no-latest)    DO_LATEST=0; EXPLICIT_LATEST=1; shift ;;
        --no-git-tag)   DO_GIT_TAG=0; EXPLICIT_GIT_TAG=1; shift ;;
        --auto-clean)   DO_AUTO_CLEAN=1; shift ;;
        --no-auto-clean) DO_AUTO_CLEAN=0; shift ;;
        --no-multiarch) MULTIARCH=0; EXPLICIT_MULTIARCH=1; shift ;;
        --amd64-only)   MULTIARCH=1; PLATFORMS="linux/amd64"; EXPLICIT_MULTIARCH=1; EXPLICIT_PLATFORM=1; shift ;;
        --arm64-only)   MULTIARCH=1; PLATFORMS="linux/arm64"; EXPLICIT_MULTIARCH=1; EXPLICIT_PLATFORM=1; shift ;;
        --platform)     PLATFORMS="${2:-}"; EXPLICIT_PLATFORM=1; shift 2 ;;
        --with-android) DO_ANDROID=1; EXPLICIT_ANDROID=1; shift ;;
        --no-android)   DO_ANDROID=0; EXPLICIT_ANDROID=1; shift ;;
        --android-no-split) ANDROID_SPLIT_ABI=0; shift ;;
        --android-aab)  ANDROID_BUILD_AAB=1; shift ;;
        --no-gh-release) DO_GH_RELEASE=0; EXPLICIT_GH_RELEASE=1; shift ;;
        --gh-repo)      GITHUB_REPO="${2:-}"; shift 2 ;;
        --dry-run)      DRY_RUN=1; shift ;;
        -h|--help)      usage ;;
        *)              die "未知参数: $1（使用 -h 查看帮助）" ;;
    esac
done

# 参数互斥校验：--no-multiarch 与 --platform / --amdxx-only 不能同时出现
if [ "$MULTIARCH" = "0" ] && [ "$EXPLICIT_PLATFORM" = "1" ]; then
    die "--no-multiarch 与 --platform / --amd64-only / --arm64-only 互斥，请二选一"
fi

# --platform 传空的保护
if [ "$MULTIARCH" = "1" ] && [ -z "${PLATFORMS// }" ]; then
    die "--platform 不能为空（可常用值：linux/amd64,linux/arm64）"
fi

run() {
    if [ "$DRY_RUN" = "1" ]; then
        echo "  ${C_YELLOW}DRY-RUN${C_RESET} $*"
    else
        eval "$@"
    fi
}

# run_argv：按参数数组原样执行（不经 eval 二次解析），用于参数含空格/等号等
# 特殊字符的场景（例如 docker build 的 --label k=v 参数）。
run_argv() {
    if [ "$DRY_RUN" = "1" ]; then
        echo "  ${C_YELLOW}DRY-RUN${C_RESET} $*"
    else
        "$@"
    fi
}

# -------------------- 前置检查 --------------------
# 脚本位于仓库根目录，直接以脚本所在目录为工作目录
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$SCRIPT_DIR"
cd "$REPO_ROOT"

info "工作目录：$REPO_ROOT"

# 必须在 git 仓库里
git rev-parse --is-inside-work-tree >/dev/null 2>&1 \
    || die "当前目录不是 git 仓库"

# docker 可用
command -v docker >/dev/null 2>&1 || die "未安装 docker"
docker info >/dev/null 2>&1 || die "docker daemon 不可用（请启动 docker）"

# buildx 可用（多架构构建必需）
if [ "$MULTIARCH" = "1" ]; then
    if ! docker buildx version >/dev/null 2>&1; then
        warn "docker buildx 不可用。安装方式："
        warn "  • Windows / macOS  : Docker Desktop 已自带（请确认已启用并启动）"
        warn "  • Debian / Ubuntu  : apt install docker-buildx-plugin"
        warn "  • 其他发行版    : https://docs.docker.com/build/install-buildx/"
        die "请先安装 docker buildx 后重试"
    fi
fi

# Android 打包依赖检查（flutter / gh）
if [ "$DO_ANDROID" = "1" ]; then
    if ! command -v flutter >/dev/null 2>&1; then
        warn "未检测到 flutter 命令。安装方式："
        warn "  • Debian / Ubuntu  : sudo snap install flutter --classic"
        warn "                        或：下载 https://docs.flutter.dev/get-started/install/linux 安装包"
        warn "  • 设置完后运行：   flutter doctor --android-licenses"
        die "请先安装 Flutter SDK 后重试"
    fi
    # WSL 场景：拒绝使用 Windows 挂载点（/mnt/c, /mnt/d ...）下的 flutter SDK
    # 原因：Windows 版 SDK 的 shell 脚本是 CRLF 行尾，bash 解析报 $'\r'；
    #       且其内部 gradle/sdkmanager 走 cmd.exe，无法在 WSL 内正确构建 APK
    FLUTTER_BIN_PATH="$(command -v flutter)"
    FLUTTER_REAL_PATH="$(readlink -f "$FLUTTER_BIN_PATH" 2>/dev/null || echo "$FLUTTER_BIN_PATH")"
    case "$FLUTTER_REAL_PATH" in
        /mnt/[a-z]/*)
            warn "检测到当前 flutter 来自 Windows 挂载点：$FLUTTER_REAL_PATH"
            warn "  Windows 版 Flutter SDK 在 WSL 中无法用于 Android 打包（CRLF 行尾会导致 \$'\\r' 报错）"
            warn ""
            warn "  推荐：在 WSL 内单独安装 Linux 版 Flutter（一次配置，长期受益）："
            warn "    sudo apt update"
            warn "    sudo apt install -y curl git unzip xz-utils zip libglu1-mesa openjdk-17-jdk"
            warn "    git clone -b stable https://github.com/flutter/flutter.git \$HOME/flutter"
            warn "    echo 'export PATH=\"\$HOME/flutter/bin:\$PATH\"' >> ~/.bashrc"
            warn "    source ~/.bashrc"
            warn "    flutter --version          # 验证：确认 which flutter 指向 \$HOME/flutter/bin/flutter"
            warn "    flutter doctor --android-licenses"
            die "请先在 WSL 内安装 Linux 版 Flutter SDK 后重试"
            ;;
    esac
    # 实际拉一次 flutter --version，验证 SDK 真正可用（防止假成功）
    FLUTTER_VERSION_OUT="$(flutter --version 2>&1 || true)"
    if ! printf '%s' "$FLUTTER_VERSION_OUT" | grep -qE '^Flutter [0-9]+\.[0-9]+'; then
        warn "flutter --version 输出异常，疑似 SDK 不可用："
        printf '%s\n' "$FLUTTER_VERSION_OUT" | sed 's/^/    /'
        die "Flutter SDK 不可用，请检查安装（建议参考上方 WSL Linux 版 Flutter 安装步骤）"
    fi
    if [ ! -d "$REPO_ROOT/$FLUTTER_APP_DIR" ]; then
        die "Flutter 项目目录不存在: $REPO_ROOT/$FLUTTER_APP_DIR"
    fi
    if [ ! -f "$REPO_ROOT/$FLUTTER_APP_DIR/pubspec.yaml" ]; then
        die "Flutter 项目未找到 pubspec.yaml: $REPO_ROOT/$FLUTTER_APP_DIR/pubspec.yaml"
    fi
    # 签名检查：未配置 key.properties 会回退到 debug 签名，给不了产品化质量
    if [ ! -f "$REPO_ROOT/$FLUTTER_APP_DIR/android/key.properties" ]; then
        warn "未检测到 $FLUTTER_APP_DIR/android/key.properties，APK 将使用 debug 签名（不适合发布）"
        warn "正式发布请参考 $FLUTTER_APP_DIR/android/key.properties.example 生成签名配置"
        if [ "$ASSUME_YES" != "1" ]; then
            read -r -p "仍然继续使用 debug 签名打包？[y/N] " ans
            case "$ans" in [yY]|[yY][eE][sS]) ;; *) die "已取消（请先准备 keystore 后重试）" ;; esac
        fi
    fi
    # GitHub CLI 检查（仅在要上传 Release 时必需）
    if [ "$DO_GH_RELEASE" = "1" ]; then
        if ! command -v gh >/dev/null 2>&1; then
            warn "未检测到 gh（GitHub CLI）。Debian 安装方式："
            warn "  curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \\"
            warn "    | sudo dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg"
            warn "  echo \"deb [arch=\$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main\" \\"
            warn "    | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null"
            warn "  sudo apt update && sudo apt install gh -y"
            warn "登录认证：gh auth login"
            die "请先安装 GitHub CLI 后重试（或使用 --no-gh-release 跳过上传）"
        fi
        if ! gh auth status >/dev/null 2>&1; then
            die "gh 未登录，请先执行：gh auth login（或使用 --no-gh-release 跳过上传）"
        fi
        # 上传 Release 依赖 git tag，若用户同时传了 --no-git-tag，提醒冲突
        if [ "$DO_GIT_TAG" != "1" ]; then
            warn "--with-android + --no-gh-release 未同时使用时，需要 git tag 才能创建 GitHub Release"
            die "请去掉 --no-git-tag，或加上 --no-gh-release 只本地构建 APK"
        fi
    fi
fi

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
info "当前分支：$CURRENT_BRANCH"
if [ "$CURRENT_BRANCH" != "$DEFAULT_BRANCH" ]; then
    warn "当前不在 $DEFAULT_BRANCH 分支，继续？"
    if [ "$ASSUME_YES" != "1" ]; then
        read -r -p "[y/N] " ans
        case "$ans" in [yY]|[yY][eE][sS]) ;; *) die "已取消" ;; esac
    fi
fi

# 工作区脏检查（区分：已跟踪的修改 vs 未跟踪的残留）
#   - 已跟踪的修改：默认拦截，要求用户手动 commit / stash，避免误丢工作成果
#     例外：Flutter 工具链每次 pub get 都会重写的"自动生成"文件
#         （linux/windows 的 generated_plugin_registrant.* / generated_plugins.cmake
#          macOS 的 GeneratedPluginRegistrant.swift / iOS 的 Generated.xcconfig 等）
#         即便它们误被 git 追踪过，也会出现"假阳性"脏改动，
#         脚本会自动 git checkout 还原后继续，不打断发布。
#   - 未跟踪的文件/目录：视为临时残留（缓存、日志等），在 DO_AUTO_CLEAN=1 时自动清理
TRACKED_DIRTY="$(git status --porcelain --untracked-files=no)"
UNTRACKED_DIRTY="$(git ls-files --others --exclude-standard)"

# Flutter 工具链生成文件白名单：每次 flutter pub get 都会重写，可安全丢弃
FLUTTER_AUTOGEN_FILES=(
    "flutter_app/linux/flutter/generated_plugin_registrant.cc"
    "flutter_app/linux/flutter/generated_plugin_registrant.h"
    "flutter_app/linux/flutter/generated_plugins.cmake"
    "flutter_app/windows/flutter/generated_plugin_registrant.cc"
    "flutter_app/windows/flutter/generated_plugin_registrant.h"
    "flutter_app/windows/flutter/generated_plugins.cmake"
    "flutter_app/macos/Flutter/GeneratedPluginRegistrant.swift"
    "flutter_app/ios/Flutter/Generated.xcconfig"
    "flutter_app/ios/Runner/GeneratedPluginRegistrant.h"
    "flutter_app/ios/Runner/GeneratedPluginRegistrant.m"
)

# 判断 path 是否在 Flutter 自动生成白名单内
is_flutter_autogen() {
    local p="$1"
    for w in "${FLUTTER_AUTOGEN_FILES[@]}"; do
        [ "$p" = "$w" ] && return 0
    done
    return 1
}

if [ -n "$TRACKED_DIRTY" ]; then
    # 把脏改动拆成 (autogen, real) 两组：
    #   - autogen : 全部都是 Flutter 自动生成文件 → 自动 checkout 还原后继续
    #   - real    : 含真实业务改动 → 仍然拦截
    AUTOGEN_DIRTY_LIST=()
    REAL_DIRTY_LIST=()
    while IFS= read -r line; do
        # porcelain 格式: "XY <path>" 或 "XY <old> -> <new>"（重命名）
        # 取第 2 段及以后作为路径，并去掉可能的 " -> " 重命名箭头左半部分
        path_part="${line:3}"
        case "$path_part" in
            *' -> '*) path_part="${path_part##* -> }" ;;
        esac
        if is_flutter_autogen "$path_part"; then
            AUTOGEN_DIRTY_LIST+=( "$path_part" )
        else
            REAL_DIRTY_LIST+=( "$path_part" )
        fi
    done <<< "$TRACKED_DIRTY"

    if [ "${#REAL_DIRTY_LIST[@]}" -gt 0 ]; then
        warn "工作区有已跟踪文件的未提交改动（脚本不会自动处理，避免误删你的工作成果）："
        printf '   M %s\n' "${REAL_DIRTY_LIST[@]}" | head -20
        if [ "${#AUTOGEN_DIRTY_LIST[@]}" -gt 0 ]; then
            warn "（另有 ${#AUTOGEN_DIRTY_LIST[@]} 个 Flutter 自动生成文件可被脚本自动还原，但因还有真实改动，本轮不处理）"
        fi
        die "请先 commit / stash 后再发布"
    fi

    if [ "${#AUTOGEN_DIRTY_LIST[@]}" -gt 0 ]; then
        info "检测到 ${#AUTOGEN_DIRTY_LIST[@]} 个 Flutter 自动生成文件被工具链改写（pub get 副作用）："
        printf '   ~ %s\n' "${AUTOGEN_DIRTY_LIST[@]}"
        info "自动 git checkout 还原它们（不影响业务代码）"
        for f in "${AUTOGEN_DIRTY_LIST[@]}"; do
            run_argv git checkout -- "$f"
        done
        ok "已自动还原 Flutter 工具链生成文件，继续发布"
    fi
fi

if [ -n "$UNTRACKED_DIRTY" ]; then
    warn "检测到工作区存在未跟踪文件/目录："
    echo "$UNTRACKED_DIRTY" | sed 's/^/  ?? /' | head -20

    if [ "$DO_AUTO_CLEAN" != "1" ]; then
        die "请先提交/忽略这些文件，或使用 --auto-clean 让脚本自动清理"
    fi

    # 默认自动清理，但非 -y 模式下给用户一次反悔机会
    if [ "$ASSUME_YES" != "1" ]; then
        echo
        warn "即将执行：git clean -fd  （不可恢复地删除以上未跟踪文件/目录）"
        read -r -p "继续清理？[Y/n]（默认 Y）: " clean_ans
        case "${clean_ans:-y}" in
            [yY]|[yY][eE][sS]) ;;
            *) die "已取消（可加 --no-auto-clean 关闭自动清理）" ;;
        esac
    fi

    info "清理未跟踪文件：git clean -fd"
    run_argv git clean -fd
    ok "未跟踪文件已清理"
fi

# 暂存区检查
if ! git diff --cached --quiet; then
    die "暂存区有未提交的改动，请先 commit"
fi

# -------------------- git pull --------------------
if [ "$DO_PULL" = "1" ]; then
    info "git pull --ff-only origin $CURRENT_BRANCH ..."
    run "git pull --ff-only origin \"$CURRENT_BRANCH\""
    ok "代码已是最新：$(git log -1 --pretty=format:'%h  %s')"
else
    info "跳过 git pull（--no-pull）"
fi

# -------------------- 版本号确定 --------------------
# 找最新的 v*.*.* tag，算下一版本建议值
suggest_next_version() {
    local latest
    latest="$(git tag --list 'v[0-9]*.[0-9]*.[0-9]*' --sort=-v:refname | head -1 | sed 's/^v//')" || latest=""
    if [ -z "$latest" ]; then
        echo "0.1.0"
        return
    fi
    # 只取基础 MAJOR.MINOR.PATCH，忽略预发布后缀
    local base="${latest%%-*}"
    local major="${base%%.*}"
    local rest="${base#*.}"
    local minor="${rest%%.*}"
    local patch="${rest#*.}"
    # 防御：非数字时退化为 0
    [[ "$major" =~ ^[0-9]+$ ]] || major=0
    [[ "$minor" =~ ^[0-9]+$ ]] || minor=0
    [[ "$patch" =~ ^[0-9]+$ ]] || patch=0
    patch=$((patch + 1))
    echo "${major}.${minor}.${patch}"
}

validate_version() {
    # 支持 1.2.3 / 1.2.3-rc.1 / 1.2.3-beta.2 等
    echo "$1" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'
}

if [ -z "$VERSION" ]; then
    SUGGEST="$(suggest_next_version)"
    echo
    echo "${C_BOLD}请输入本次发布版本号${C_RESET}（格式：1.2.3 或 v1.2.3，可带 -rc.1 等后缀）"
    echo "   建议：${C_GREEN}${SUGGEST}${C_RESET}（回车使用建议值）"
    read -r -p "> " VERSION
    VERSION="${VERSION:-$SUGGEST}"
fi

# 去除前缀 v
VERSION="${VERSION#v}"
validate_version "$VERSION" || die "版本号格式非法：$VERSION（期望 X.Y.Z 或 X.Y.Z-rc.N）"
VERSION_TAG="v${VERSION}"

# 检查 git tag 是否已存在
if [ "$DO_GIT_TAG" = "1" ] && git rev-parse "refs/tags/${VERSION_TAG}" >/dev/null 2>&1; then
    die "git tag ${VERSION_TAG} 已存在"
fi

# -------------------- 懒人交互菜单 --------------------
# 非 -y 模式下，针对用户未显式指定的选项逐项询问，全部带默认值，回车即选默认。
# 已通过命令行显式指定过的选项会被跳过，尊重用户的输入。
if [ "$ASSUME_YES" != "1" ]; then
    step "发布选项（回车使用默认值）"

    # 0) 发布套餐（一键选择发布范围，避免逐项问近十个问题）
    PRESET=""
    if [ "$EXPLICIT_ANDROID" = "0" ] && [ "$EXPLICIT_GH_RELEASE" = "0" ]; then
        echo "  请选择发布范围套餐："
        echo "    ${C_GREEN}1)${C_RESET} 全平台一键发布  ${C_BOLD}[推荐]${C_RESET}  Docker 多架构 + Android APK + GitHub Release + Git tag"
        echo "    2) 仅 Docker 镜像            只推 Docker Hub + Git tag（不打安卓 APK）"
        echo "    3) 仅 Android APK            只打 APK 并传 GitHub Release（跳过 Docker）"
        echo "    4) 自定义                    逐项询问每个选项"
        read -r -p "  选择 [1/2/3/4]（默认 1）: " preset_ans
        case "${preset_ans:-1}" in
            1|"")
                PRESET="all"
                DO_ANDROID=1; EXPLICIT_ANDROID=1
                DO_GH_RELEASE=1; EXPLICIT_GH_RELEASE=1
                info "套餐：全平台一键发布（Docker + Android + GitHub Release）"
                ;;
            2)
                PRESET="docker"
                DO_ANDROID=0; EXPLICIT_ANDROID=1
                info "套餐：仅 Docker 镜像"
                ;;
            3)
                PRESET="android"
                DO_ANDROID=1; EXPLICIT_ANDROID=1
                DO_GH_RELEASE=1; EXPLICIT_GH_RELEASE=1
                # 仅 Android 套餐：跳过 Docker 构建
                MULTIARCH=0; EXPLICIT_MULTIARCH=1
                PLATFORMS=""
                SKIP_DOCKER=1
                info "套餐：仅 Android APK + GitHub Release（跳过 Docker 构建）"
                ;;
            4)
                PRESET="custom"
                info "套餐：自定义，将逐项询问"
                ;;
            *)
                die "无效选择：$preset_ans"
                ;;
        esac
        echo
    fi

    # 1) 构建模式（傻瓜式菜单：直接按数字选，不用懂 linux/amd64 这种平台串）
    if [ "$EXPLICIT_MULTIARCH" = "0" ] && [ "$EXPLICIT_PLATFORM" = "0" ]; then
        echo "  请选择要发布的架构："
        echo "    ${C_GREEN}1)${C_RESET} amd64 + arm64  ${C_BOLD}[默认，推荐]${C_RESET}  适合同时发布到服务器和 ARM 设备"
        echo "    2) 仅 amd64               只发 x86_64（服务器/PC/NAS）"
        echo "    3) 仅 arm64               只发 ARM64（树莓派/OES/A311D/RK 系列等）"
        echo "    4) 仅本机架构             最快，仅本地自测用（不推送多架构 manifest）"
        echo "    5) 自定义平台列表         进阶：手动输入 linux/xxx,linux/yyy"
        read -r -p "  选择 [1/2/3/4/5]（默认 1）: " mode_ans
        case "${mode_ans:-1}" in
            1|"")
                MULTIARCH=1
                PLATFORMS="$DEFAULT_PLATFORMS"
                info "已选择：amd64 + arm64"
                ;;
            2)
                MULTIARCH=1
                PLATFORMS="linux/amd64"
                info "已选择：仅 amd64"
                ;;
            3)
                MULTIARCH=1
                PLATFORMS="linux/arm64"
                info "已选择：仅 arm64"
                ;;
            4)
                MULTIARCH=0
                info "已选择：仅本机架构"
                ;;
            5)
                MULTIARCH=1
                read -r -p "  输入平台列表（逗号分隔，如 linux/amd64,linux/arm64,linux/arm/v7）: " custom_platforms
                if [ -z "${custom_platforms// }" ]; then
                    warn "未输入，回退到默认 $DEFAULT_PLATFORMS"
                    PLATFORMS="$DEFAULT_PLATFORMS"
                else
                    PLATFORMS="$custom_platforms"
                fi
                info "已选择：${PLATFORMS}"
                ;;
            *)
                die "无效选择：$mode_ans"
                ;;
        esac
        echo
    fi

    # 2) 是否同步打 :latest
    if [ "$EXPLICIT_LATEST" = "0" ]; then
        default_hint="Y/n"
        read -r -p "  同时打 :latest tag？[${default_hint}]（默认 Y）: " latest_ans
        case "${latest_ans:-y}" in
            [yY]|[yY][eE][sS]) DO_LATEST=1 ;;
            [nN]|[nN][oO])     DO_LATEST=0 ;;
            *)                 DO_LATEST=1 ;;
        esac
        echo
    fi

    # 3) 是否打 git tag 并推送
    if [ "$EXPLICIT_GIT_TAG" = "0" ]; then
        read -r -p "  同时打 git tag 并推送到 GitHub？[Y/n]（默认 Y）: " tag_ans
        case "${tag_ans:-y}" in
            [yY]|[yY][eE][sS]) DO_GIT_TAG=1 ;;
            [nN]|[nN][oO])     DO_GIT_TAG=0 ;;
            *)                 DO_GIT_TAG=1 ;;
        esac
        echo
    fi

    # 4) 是否同时打 Android APK（无条件询问，询问后再校验环境）
    if [ "$EXPLICIT_ANDROID" = "0" ]; then
        read -r -p "  同时构建 Android APK 并上传到 GitHub Release？[y/N]（默认 N）: " apk_ans
        case "${apk_ans:-n}" in
            [yY]|[yY][eE][sS]) DO_ANDROID=1 ;;
            *)                 DO_ANDROID=0 ;;
        esac
        echo
    fi

    # 用户选了打 APK 但环境缺依赖 → 明确报错（不再静默跳过）
    if [ "$DO_ANDROID" = "1" ]; then
        APK_ENV_OK=1
        if [ ! -d "$REPO_ROOT/$FLUTTER_APP_DIR" ]; then
            warn "未找到 Flutter 项目目录：$REPO_ROOT/$FLUTTER_APP_DIR"
            APK_ENV_OK=0
        fi
        if ! command -v flutter >/dev/null 2>&1; then
            warn "未检测到 flutter 命令，请先安装 Flutter SDK：https://docs.flutter.dev/get-started/install/linux"
            APK_ENV_OK=0
        fi
        if [ "$APK_ENV_OK" = "0" ]; then
            echo
            echo "    在当前机器上不能打 Android APK。可选："
            echo "      a) 在本机安装 Flutter SDK（推荐参考 Linux 官方文档）"
            echo "      b) 在含 Flutter 环境的开发机上运行本脚本"
            echo "      c) 本次跳过 Android，仅发 Docker"
            read -r -p "  是否本次跳过 Android，仅发 Docker？[Y/n]（默认 Y）: " skip_ans
            case "${skip_ans:-y}" in
                [nN]|[nN][oO]) die "已取消：请准备好 Flutter 环境后重试" ;;
                *) DO_ANDROID=0; warn "已跳过 Android 构建，仅发布 Docker" ;;
            esac
            echo
        fi
    fi

    # 5) Android 子选项（仅开启 Android 时询问）
    if [ "$DO_ANDROID" = "1" ]; then
        if [ "$EXPLICIT_GH_RELEASE" = "0" ]; then
            read -r -p "  上传 APK 到 GitHub Release？[Y/n]（默认 Y）: " gh_ans
            case "${gh_ans:-y}" in
                [yY]|[yY][eE][sS]) DO_GH_RELEASE=1 ;;
                [nN]|[nN][oO])     DO_GH_RELEASE=0 ;;
                *)                 DO_GH_RELEASE=1 ;;
            esac
            echo
        fi
        # 上传 GitHub Release 依赖 git tag，自动开启
        if [ "$DO_GH_RELEASE" = "1" ] && [ "$DO_GIT_TAG" != "1" ]; then
            warn "上传 GitHub Release 依赖 git tag，已自动启用 git tag 推送"
            DO_GIT_TAG=1
        fi
    fi

    # 用户选择打 git tag 时，再次校验 tag 冲突（避免用户在菜单里改主意后漏检）
    if [ "$DO_GIT_TAG" = "1" ] && git rev-parse "refs/tags/${VERSION_TAG}" >/dev/null 2>&1; then
        die "git tag ${VERSION_TAG} 已存在"
    fi
fi

# -------------------- 发布摘要 --------------------
GIT_COMMIT="$(git log -1 --pretty=format:'%h  %s')"
GIT_SHA="$(git rev-parse HEAD)"
BUILD_DATE="$(date -u +'%Y-%m-%dT%H:%M:%SZ')"

step "发布摘要"
echo "  镜像仓库      : ${IMAGE_NAME}"
echo "  版本 tag      : ${VERSION_TAG}"
echo "  同步 latest   : $([ "$DO_LATEST" = "1" ] && echo yes || echo no)"
echo "  同步 git tag  : $([ "$DO_GIT_TAG" = "1" ] && echo yes || echo no)"
if [ "$DO_ANDROID" = "1" ]; then
    if [ "$ANDROID_SPLIT_ABI" = "1" ]; then
        ANDROID_BUILD_DESC="split-per-abi (armeabi-v7a / arm64-v8a / x86_64)"
    else
        ANDROID_BUILD_DESC="fat APK"
    fi
    [ "$ANDROID_BUILD_AAB" = "1" ] && ANDROID_BUILD_DESC="$ANDROID_BUILD_DESC + AAB"
    echo "  Android APK   : ${ANDROID_BUILD_DESC}"
    echo "  GitHub Release: $([ "$DO_GH_RELEASE" = "1" ] && echo yes || echo "no (仅本地构建)")"
else
    echo "  Android APK   : no"
fi
if [ "$MULTIARCH" = "1" ]; then
    echo "  构建架构      : ${PLATFORMS}"
    echo "  构建模式      : buildx 多架构（build + push 合并）"
else
    echo "  构建架构      : 本机单架构（--no-multiarch）"
    echo "  构建模式      : 经典 docker build + docker push"
fi
echo "  git commit    : ${GIT_COMMIT}"
echo "  构建时间      : ${BUILD_DATE}"
[ "$DRY_RUN" = "1" ] && echo "  ${C_YELLOW}模式          : DRY-RUN（不真实执行）${C_RESET}"

if [ "$ASSUME_YES" != "1" ]; then
    echo
    read -r -p "确认发布？[y/N] " ans
    case "$ans" in [yY]|[yY][eE][sS]) ;; *) die "已取消" ;; esac
fi

# -------------------- build & push --------------------
# 多架构模式：使用 buildx，一次性 build + push（多架构 image 无法 load 到
# 本地 daemon，必须直接推远端）
# 单架构模式：沿用传统 docker build + docker push 两步
START_TS=$(date +%s)

BUILD_TAGS=( -t "${IMAGE_NAME}:${VERSION_TAG}" )
[ "$DO_LATEST" = "1" ] && BUILD_TAGS+=( -t "${IMAGE_NAME}:latest" )

# 构建参数：与 Dockerfile 中的 ARG 对齐，便于把版本信息编译进二进制
BUILD_ARGS=(
    --build-arg "VERSION=${VERSION_TAG}"
    --build-arg "BUILD_TIME=${BUILD_DATE}"
    --build-arg "GIT_COMMIT=${GIT_SHA}"
)

# OCI 标签：便于 docker inspect 时追溯
OCI_LABELS=(
    --label "org.opencontainers.image.version=${VERSION_TAG}"
    --label "org.opencontainers.image.revision=${GIT_SHA}"
    --label "org.opencontainers.image.created=${BUILD_DATE}"
    --label "org.opencontainers.image.source=https://github.com/cropflre/nowen-reader"
    --label "org.opencontainers.image.title=nowen-reader"
    --label "org.opencontainers.image.description=nowen-reader release image (multi-arch: ${PLATFORMS})"
)

# Docker Hub 登录预检：避免最后 push 阶段才失败
if [ "$DRY_RUN" != "1" ] && [ "$SKIP_DOCKER" != "1" ]; then
    if ! docker system info 2>/dev/null | grep -qE '^\s*Username:'; then
        warn "未检测到 Docker Hub 登录态（docker info 未发现 Username）"
        warn "若推送到 ${IMAGE_NAME} 需要认证，请先执行：docker login"
        if [ "$ASSUME_YES" != "1" ]; then
            read -r -p "仍然继续？[y/N] " ans
            case "$ans" in [yY]|[yY][eE][sS]) ;; *) die "已取消" ;; esac
        fi
    fi
fi

# ============================================================================
# 阶段 1：本地构建（Docker 镜像 + Android APK + 本地 git tag）
#   - 任意一步失败 → 不会推送任何东西到远端
#   - Docker 多架构：使用 buildx 缓存，待全部就绪后再 push（--push 推迟到阶段 2）
#   - Docker 单架构：本地 docker build 完成（不 push）
#   - Android：本地构建 APK 落到 dist/
#   - Git tag：本地 git tag -a（不 push）
# ============================================================================
step "阶段 1/2：本地构建"

if [ "$SKIP_DOCKER" = "1" ]; then
    info "跳过 Docker 构建（套餐选择：仅 Android APK）"
    BUILD_DURATION=0
    PUSH_DURATION=0
elif [ "$MULTIARCH" = "1" ]; then
    # ========== 多架构路径 ==========
    info "准备 buildx builder（多架构构建必须使用 docker-container 驱动）"
    NEED_BUILDER=1
    if docker buildx inspect "$BUILDX_BUILDER" >/dev/null 2>&1; then
        info "复用已存在的 builder: $BUILDX_BUILDER"
        run_argv docker buildx use "$BUILDX_BUILDER"
        NEED_BUILDER=0
    fi
    if [ "$NEED_BUILDER" = "1" ]; then
        info "创建 buildx builder: $BUILDX_BUILDER（docker-container 驱动）"
        run_argv docker buildx create --name "$BUILDX_BUILDER" --driver docker-container --use
    fi
    # 启动并拉取 QEMU 模拟器（跨架构构建在 x86 主机上需要）
    info "初始化 builder（bootstrap QEMU 多架构支持）"
    run_argv docker buildx inspect --bootstrap

    info "开始构建多架构镜像（${PLATFORMS}） → 本地 builder 缓存（暂不推送）"
    # 关键：阶段 1 不 push，使用 --output type=image,push=false 把镜像构建到 builder 缓存
    # 这样后续的 APK / git tag 构建失败时，远端 Docker Hub 仍是干净的
    BUILD_CMD=(
        docker buildx build
        --platform "$PLATFORMS"
        -f "$REPO_ROOT/Dockerfile"
        "${BUILD_TAGS[@]}"
        "${BUILD_ARGS[@]}"
        "${OCI_LABELS[@]}"
        --output "type=image,push=false"
        "$REPO_ROOT"
    )
    echo "  ${BUILD_CMD[*]}"

    BUILD_START=$(date +%s)
    run_argv "${BUILD_CMD[@]}"
    BUILD_END=$(date +%s)
    BUILD_DURATION=$((BUILD_END - BUILD_START))
    ok "多架构镜像构建完成（已缓存到 builder，等待统一发布），用时 ${BUILD_DURATION}s"
    PUSH_DURATION=0   # 推送将在阶段 2 完成
else
    # ========== 单架构路径（经典 docker build，不在阶段 1 push） ==========
    info "开始构建单架构镜像（本机架构） → 本地 docker（暂不推送）"
    BUILD_CMD=( docker build -f "$REPO_ROOT/Dockerfile" "${BUILD_TAGS[@]}" "${BUILD_ARGS[@]}" "${OCI_LABELS[@]}" "$REPO_ROOT" )
    echo "  ${BUILD_CMD[*]}"

    BUILD_START=$(date +%s)
    run_argv "${BUILD_CMD[@]}"
    BUILD_END=$(date +%s)
    BUILD_DURATION=$((BUILD_END - BUILD_START))
    ok "单架构镜像构建完成（本地 docker，等待统一发布），用时 ${BUILD_DURATION}s"
    PUSH_DURATION=0   # 推送将在阶段 2 完成
fi

# -------------------- Android APK 本地构建（仍属阶段 1）--------------------
ANDROID_DURATION=0
GH_RELEASE_DURATION=0
ANDROID_OUT_FILES=()

if [ "$DO_ANDROID" = "1" ]; then
    info "构建 Android APK（产物落到 dist/，暂不上传）"

    APK_BUILD_START=$(date +%s)
    FLUTTER_DIR="$REPO_ROOT/$FLUTTER_APP_DIR"

    info "flutter --version"
    run_argv flutter --version

    info "flutter pub get（位于 $FLUTTER_DIR）"
    if [ "$DRY_RUN" = "1" ]; then
        echo "  ${C_YELLOW}DRY-RUN${C_RESET} cd $FLUTTER_DIR && flutter pub get"
    else
        ( cd "$FLUTTER_DIR" && flutter pub get )
    fi

    # 注：split-per-abi 会按 ABI 拆出 3 个独立 APK，体积更小、上架更友好
    BUILD_ANDROID_CMD=( flutter build apk --release )
    [ "$ANDROID_SPLIT_ABI" = "1" ] && BUILD_ANDROID_CMD+=( --split-per-abi )
    BUILD_ANDROID_CMD+=(
        --build-name "${VERSION}"
        --dart-define=APP_VERSION="${VERSION_TAG}"
        --dart-define=GIT_COMMIT="${GIT_SHA}"
    )

    info "开始构建 APK：${BUILD_ANDROID_CMD[*]}（CWD=$FLUTTER_DIR）"
    if [ "$DRY_RUN" = "1" ]; then
        echo "  ${C_YELLOW}DRY-RUN${C_RESET} cd $FLUTTER_DIR && ${BUILD_ANDROID_CMD[*]}"
    else
        ( cd "$FLUTTER_DIR" && "${BUILD_ANDROID_CMD[@]}" )
    fi
    ok "APK 构建完成"

    # 可选：同时构建 AAB（Google Play 上架包）
    if [ "$ANDROID_BUILD_AAB" = "1" ]; then
        info "开始构建 AAB（appbundle）"
        BUILD_AAB_CMD=(
            flutter build appbundle --release
            --build-name "${VERSION}"
            --dart-define=APP_VERSION="${VERSION_TAG}"
            --dart-define=GIT_COMMIT="${GIT_SHA}"
        )
        if [ "$DRY_RUN" = "1" ]; then
            echo "  ${C_YELLOW}DRY-RUN${C_RESET} cd $FLUTTER_DIR && ${BUILD_AAB_CMD[*]}"
        else
            ( cd "$FLUTTER_DIR" && "${BUILD_AAB_CMD[@]}" )
        fi
        ok "AAB 构建完成"
    fi

    # 收集产物并按版本号重命名（便于 Release 资源辨识）
    APK_OUT_DIR="$FLUTTER_DIR/build/app/outputs/flutter-apk"
    AAB_OUT_DIR="$FLUTTER_DIR/build/app/outputs/bundle/release"
    DIST_DIR="$REPO_ROOT/dist/${VERSION_TAG}"

    if [ "$DRY_RUN" != "1" ]; then
        mkdir -p "$DIST_DIR"

        if [ "$ANDROID_SPLIT_ABI" = "1" ]; then
            for abi in armeabi-v7a arm64-v8a x86_64; do
                src="$APK_OUT_DIR/app-${abi}-release.apk"
                if [ -f "$src" ]; then
                    dst="$DIST_DIR/nowen-reader-${VERSION_TAG}-${abi}.apk"
                    cp -f "$src" "$dst"
                    ANDROID_OUT_FILES+=( "$dst" )
                    sz="$(du -h "$dst" 2>/dev/null | awk '{print $1}')"
                    ok "产物：$(basename "$dst")  (${sz})"
                else
                    warn "未找到 APK 产物：$src"
                fi
            done
        else
            src="$APK_OUT_DIR/app-release.apk"
            if [ -f "$src" ]; then
                dst="$DIST_DIR/nowen-reader-${VERSION_TAG}.apk"
                cp -f "$src" "$dst"
                ANDROID_OUT_FILES+=( "$dst" )
                sz="$(du -h "$dst" 2>/dev/null | awk '{print $1}')"
                ok "产物：$(basename "$dst")  (${sz})"
            else
                warn "未找到 APK 产物：$src"
            fi
        fi

        if [ "$ANDROID_BUILD_AAB" = "1" ]; then
            src="$AAB_OUT_DIR/app-release.aab"
            if [ -f "$src" ]; then
                dst="$DIST_DIR/nowen-reader-${VERSION_TAG}.aab"
                cp -f "$src" "$dst"
                ANDROID_OUT_FILES+=( "$dst" )
                sz="$(du -h "$dst" 2>/dev/null | awk '{print $1}')"
                ok "产物：$(basename "$dst")  (${sz})"
            else
                warn "未找到 AAB 产物：$src"
            fi
        fi

        # 生成 SHA256 校验文件，便于用户下载后核验
        if [ "${#ANDROID_OUT_FILES[@]}" -gt 0 ] && command -v sha256sum >/dev/null 2>&1; then
            CHECKSUM_FILE="$DIST_DIR/SHA256SUMS.txt"
            ( cd "$DIST_DIR" && sha256sum *.apk *.aab 2>/dev/null > "$CHECKSUM_FILE" || true )
            if [ -s "$CHECKSUM_FILE" ]; then
                ANDROID_OUT_FILES+=( "$CHECKSUM_FILE" )
                ok "产物：SHA256SUMS.txt"
            fi
        fi
    fi

    APK_BUILD_END=$(date +%s)
    ANDROID_DURATION=$((APK_BUILD_END - APK_BUILD_START))
    # 严格校验：开启了 --with-android 但产物收集失败 → 直接 die，不进入阶段 2
    if [ "$DRY_RUN" != "1" ] && [ "${#ANDROID_OUT_FILES[@]}" = "0" ]; then
        die "Android 构建未产出任何 APK/AAB 文件，发布中止（不会推送任何内容到远端）"
    fi
    ok "Android 产物构建完成（${#ANDROID_OUT_FILES[@]} 个文件，等待统一发布），用时 ${ANDROID_DURATION}s"
fi

# -------------------- 阶段 1：本地 git tag（不 push）--------------------
if [ "$DO_GIT_TAG" = "1" ]; then
    if git rev-parse -q --verify "refs/tags/${VERSION_TAG}" >/dev/null 2>&1; then
        info "本地 tag ${VERSION_TAG} 已存在，跳过创建"
    else
        info "创建本地 git tag：${VERSION_TAG}（暂不推送）"
        run "git tag -a \"${VERSION_TAG}\" -m \"Release ${VERSION_TAG}\""
    fi
    ok "本地 git tag 已就绪（等待统一发布）"
fi

# 阶段 1 全部成功 → 进入阶段 2 统一发布
step "阶段 1/2 完成 ✅  所有产物已在本地就绪"
if [ "$SKIP_DOCKER" != "1" ]; then
    echo "  • Docker 镜像   : ${IMAGE_NAME}:${VERSION_TAG}$([ "$DO_LATEST" = "1" ] && echo " + :latest")（本地缓存）"
fi
if [ "$DO_ANDROID" = "1" ]; then
    echo "  • Android 产物  : ${#ANDROID_OUT_FILES[@]} 个（$REPO_ROOT/dist/${VERSION_TAG}/）"
fi
if [ "$DO_GIT_TAG" = "1" ]; then
    echo "  • Git tag       : ${VERSION_TAG}（本地）"
fi

# ============================================================================
# 阶段 2：统一发布（任一步骤失败 → 阻止后续步骤继续）
#   顺序：Docker push → Git tag push → GitHub Release
#   set -e 已经保证任意命令失败立即退出
# ============================================================================
step "阶段 2/2：统一发布到远端"

# --- 2.1 Docker 镜像推送 ---
PUSH_START=$(date +%s)
if [ "$SKIP_DOCKER" = "1" ]; then
    info "跳过 Docker 推送（套餐选择：仅 Android APK）"
elif [ "$MULTIARCH" = "1" ]; then
    info "推送多架构镜像到 Docker Hub（${PLATFORMS}）"
    # 第二次 buildx build：直接命中阶段 1 的缓存，仅产生 push 流量
    PUSH_CMD=(
        docker buildx build
        --platform "$PLATFORMS"
        -f "$REPO_ROOT/Dockerfile"
        "${BUILD_TAGS[@]}"
        "${BUILD_ARGS[@]}"
        "${OCI_LABELS[@]}"
        --push
        "$REPO_ROOT"
    )
    echo "  ${PUSH_CMD[*]}"
    run_argv "${PUSH_CMD[@]}"

    if [ "$DRY_RUN" != "1" ]; then
        info "远端 manifest 摘要（${VERSION_TAG}）："
        docker buildx imagetools inspect "${IMAGE_NAME}:${VERSION_TAG}" 2>/dev/null \
            | grep -E 'Name:|MediaType:|Platform:' | head -20 || true
        if [ "$DO_LATEST" = "1" ]; then
            info "远端 manifest 摘要（latest）："
            docker buildx imagetools inspect "${IMAGE_NAME}:latest" 2>/dev/null \
                | grep -E 'Name:|MediaType:|Platform:' | head -20 || true
        fi
    fi
else
    info "推送：${IMAGE_NAME}:${VERSION_TAG}"
    run_argv docker push "${IMAGE_NAME}:${VERSION_TAG}"
    if [ "$DO_LATEST" = "1" ]; then
        info "推送：${IMAGE_NAME}:latest"
        run_argv docker push "${IMAGE_NAME}:latest"
    fi
fi
PUSH_END=$(date +%s)
PUSH_DURATION=$((PUSH_END - PUSH_START))
if [ "$SKIP_DOCKER" != "1" ]; then
    ok "Docker 镜像推送完成，用时 ${PUSH_DURATION}s"
fi

# 尝试获取 digest
DIGEST=""
if [ "$DRY_RUN" != "1" ] && [ "$SKIP_DOCKER" != "1" ]; then
    if [ "$MULTIARCH" = "1" ]; then
        DIGEST="$(docker buildx imagetools inspect "${IMAGE_NAME}:${VERSION_TAG}" --format '{{.Manifest.Digest}}' 2>/dev/null || echo "")"
        [ -n "$DIGEST" ] && DIGEST="${IMAGE_NAME}@${DIGEST}"
    else
        DIGEST="$(docker inspect --format='{{index .RepoDigests 0}}' "${IMAGE_NAME}:${VERSION_TAG}" 2>/dev/null || echo "")"
    fi
fi

# --- 2.2 Git tag 推送 ---
if [ "$DO_GIT_TAG" = "1" ]; then
    info "git push origin ${VERSION_TAG}"
    if [ "$DRY_RUN" = "1" ]; then
        echo "  (dry-run) git push origin \"${VERSION_TAG}\""
    elif git push origin "${VERSION_TAG}"; then
        ok "git tag ${VERSION_TAG} 已推送"
    else
        echo
        echo "${C_YELLOW}[!] git push tag 失败（Docker 镜像已成功推送，本地 tag 已保留）${C_RESET}"
        echo "    常见原因：GitHub 已禁用密码认证，需使用 PAT 或 SSH key"
        echo "    修复方式任选一种，然后补推："
        echo "      git push origin ${VERSION_TAG}"
        echo
        echo "    方案 A（PAT，推荐）："
        echo "      1. https://github.com/settings/tokens 生成 fine-grained token（Contents: RW）"
        echo "      2. git config --global credential.helper store"
        echo "      3. git push origin ${VERSION_TAG}   # 用户名: GitHub 用户名；密码: 粘贴 PAT"
        echo
        echo "    方案 B（SSH key）："
        echo "      1. ssh-keygen -t ed25519 -C \"\$(hostname)\""
        echo "      2. cat ~/.ssh/id_ed25519.pub  → 添加到 https://github.com/settings/keys"
        echo "      3. git remote set-url origin git@github.com:<user>/<repo>.git"
        echo "      4. git push origin ${VERSION_TAG}"
        die "git tag 推送失败"
    fi
else
    info "跳过 git tag（--no-git-tag）"
fi

# --- 2.3 GitHub Release（含 Android APK 上传）---
if [ "$DO_ANDROID" = "1" ] && [ "$DO_GH_RELEASE" = "1" ]; then
    info "创建 GitHub Release 并上传 Android 产物"
    GH_START=$(date +%s)

    # 解析 GitHub 仓库（owner/repo）
    if [ -z "$GITHUB_REPO" ]; then
        ORIGIN_URL="$(git config --get remote.origin.url 2>/dev/null || echo '')"
        # 支持 https://github.com/owner/repo(.git) 与 git@github.com:owner/repo.git
        GITHUB_REPO="$(echo "$ORIGIN_URL" \
            | sed -E 's#(git@github.com:|https?://github.com/)##; s#\.git$##' \
            | grep -E '^[^/]+/[^/]+$' || true)"
    fi
    if [ -z "$GITHUB_REPO" ]; then
        warn "无法从 git remote 自动解析 GitHub 仓库（owner/repo），请用 --gh-repo 指定"
        die "GitHub Release 上传失败：未指定仓库"
    fi
    info "目标仓库：$GITHUB_REPO"

    GH_TITLE="NowenReader ${VERSION_TAG}"
    GH_NOTES_FILE="$(mktemp)"
    {
        echo "Auto-released by release.sh"
        echo
        echo "- Docker image: \`${IMAGE_NAME}:${VERSION_TAG}\`"
        echo "- git commit:   \`${GIT_SHA}\`"
        echo "- build time:   ${BUILD_DATE}"
        echo
        echo "## Android APK"
        echo
        for f in "${ANDROID_OUT_FILES[@]}"; do
            echo "- $(basename "$f")"
        done
    } > "$GH_NOTES_FILE"

    # Release 已存在则补传资源；否则创建新 Release
    if [ "$DRY_RUN" = "1" ]; then
        echo "  ${C_YELLOW}DRY-RUN${C_RESET} gh release create ${VERSION_TAG} -R $GITHUB_REPO -t \"$GH_TITLE\" -F <notes> ${ANDROID_OUT_FILES[*]}"
    else
        if gh release view "${VERSION_TAG}" -R "$GITHUB_REPO" >/dev/null 2>&1; then
            info "Release ${VERSION_TAG} 已存在，使用 gh release upload --clobber 覆盖上传产物"
            if [ "${#ANDROID_OUT_FILES[@]}" -gt 0 ]; then
                gh release upload "${VERSION_TAG}" "${ANDROID_OUT_FILES[@]}" -R "$GITHUB_REPO" --clobber
            fi
        else
            info "创建 GitHub Release ${VERSION_TAG} 并上传 ${#ANDROID_OUT_FILES[@]} 个产物"
            GH_CREATE_ARGS=(
                release create "${VERSION_TAG}"
                -R "$GITHUB_REPO"
                -t "$GH_TITLE"
                -F "$GH_NOTES_FILE"
            )
            # 预发布版本（带 -rc / -beta / -alpha 后缀）自动标记为 prerelease
            case "$VERSION" in
                *-rc.*|*-beta*|*-alpha*|*-pre*) GH_CREATE_ARGS+=( --prerelease ) ;;
            esac
            if [ "${#ANDROID_OUT_FILES[@]}" -gt 0 ]; then
                gh "${GH_CREATE_ARGS[@]}" "${ANDROID_OUT_FILES[@]}"
            else
                gh "${GH_CREATE_ARGS[@]}"
            fi
        fi
        rm -f "$GH_NOTES_FILE"
        ok "GitHub Release 资源已就绪：https://github.com/$GITHUB_REPO/releases/tag/${VERSION_TAG}"
    fi

    GH_END=$(date +%s)
    GH_RELEASE_DURATION=$((GH_END - GH_START))
elif [ "$DO_ANDROID" = "1" ]; then
    info "跳过 GitHub Release 上传（--no-gh-release），产物保留在：$REPO_ROOT/dist/${VERSION_TAG}/"
fi

# -------------------- 完成 --------------------
END_TS=$(date +%s)
TOTAL=$((END_TS - START_TS))

step "发布完成"
if [ "$SKIP_DOCKER" != "1" ]; then
    echo "  ${C_GREEN}${IMAGE_NAME}:${VERSION_TAG}${C_RESET}  ←  已推送"
    [ "$DO_LATEST" = "1" ] && echo "  ${C_GREEN}${IMAGE_NAME}:latest${C_RESET}  ←  已推送"
fi
[ "$DO_GIT_TAG" = "1" ] && echo "  ${C_GREEN}git tag ${VERSION_TAG}${C_RESET}  ←  已推送到 GitHub"
if [ "$DO_ANDROID" = "1" ]; then
    if [ "${#ANDROID_OUT_FILES[@]}" -gt 0 ]; then
        echo "  ${C_GREEN}Android 产物${C_RESET}（${#ANDROID_OUT_FILES[@]} 个）  ←  $REPO_ROOT/dist/${VERSION_TAG}/"
        for f in "${ANDROID_OUT_FILES[@]}"; do
            echo "    • $(basename "$f")"
        done
    fi
    if [ "$DO_GH_RELEASE" = "1" ] && [ -n "$GITHUB_REPO" ]; then
        echo "  ${C_GREEN}GitHub Release${C_RESET}  ←  https://github.com/$GITHUB_REPO/releases/tag/${VERSION_TAG}"
    fi
fi
if [ "$MULTIARCH" = "1" ]; then
    extra=""
    [ "$DO_ANDROID" = "1" ] && extra="${extra} + android ${ANDROID_DURATION}s"
    [ "$DO_ANDROID" = "1" ] && [ "$DO_GH_RELEASE" = "1" ] && extra="${extra} + gh ${GH_RELEASE_DURATION}s"
    echo "  总耗时        : ${TOTAL}s （buildx build+push ${BUILD_DURATION}s${extra}）"
else
    extra=""
    [ "$DO_ANDROID" = "1" ] && extra="${extra} + android ${ANDROID_DURATION}s"
    [ "$DO_ANDROID" = "1" ] && [ "$DO_GH_RELEASE" = "1" ] && extra="${extra} + gh ${GH_RELEASE_DURATION}s"
    echo "  总耗时        : ${TOTAL}s （build ${BUILD_DURATION}s + push ${PUSH_DURATION}s${extra}）"
fi
[ -n "$DIGEST" ] && echo "  digest        : ${DIGEST}"

echo
ok "发布成功 🎉"
