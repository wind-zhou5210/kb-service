# kb-service-cli

> kb-service 知识库命令行工具 — 终端即可完成知识集合、文档包、工作空间的上传、管理、检索与分享

[![npm version](https://img.shields.io/npm/v/kb-service-cli)](https://www.npmjs.com/package/kb-service-cli)

## 安装

```bash
npm install -g kb-service-cli
```

需要 Node.js >= 18。命令名为 `kb`。

## 快速开始

```bash
# 1. 配置服务端地址
kb config set server https://kb.example.com

# 2. 登录
kb login admin

# 3. 上传文档（.md/.html 单文件，.zip 文档包自动识别）
kb push ./doc.md -c 1
kb push ./prd-with-images.zip -c 1

# 4. 搜索
kb search "关键词"

# 5. 工作空间（多文件/原型）
kb ws upload 1 ./dist.zip
kb ws share 1 --file todo.html
```

## 命令概览

| 分组 | 命令 | 说明 |
|------|------|------|
| 认证 | `login` | 登录 kb-service（支持 `-p` 非交互） |
| | `logout` | 退出登录（清除本地令牌） |
| | `whoami` | 查看当前用户并校验令牌有效性 |
| 配置 | `config set` | 设置 server / token / username |
| | `config get` | 查看当前配置与来源 |
| | `config unset` | 清除 token / username |
| 集合 | `collection list` | 列出全部集合（含文档数、排序、分享状态） |
| | `collection get` | 查看集合详情 |
| | `collection create` | 创建集合 |
| | `collection update` | 修改名称/描述/封面/排序 |
| | `collection delete` | 删除集合（级联删除文档） |
| 文档 | `push` | 上传文档；`.zip` 自动走文档包端点（md + 图片资产） |
| | `list` | 列出集合下的文档 |
| | `search` | 全文检索（命中词终端高亮） |
| | `get` | 查看文档详情（含版本、包内目录、分享链接） |
| | `raw` | 终端直接输出文档正文（类似 `cat`） |
| | `download` | 下载文档；`--all -c <id>` 批量下载整个集合 |
| | `update` | 更新标题/标签/备注/排序 |
| | `move` | 移动文档到其他集合 |
| | `delete` | 删除文档 |
| 版本 | `version:list` | 查看文档版本历史 |
| | `version:view` | 查看指定版本内容 |
| | `version:restore` | 恢复到指定版本 |
| | `version:delete` | 删除指定历史版本 |
| 工作空间 | `workspace list` | 列出全部工作空间（含文件数、体积、分享状态） |
| | `workspace get` | 查看工作空间详情 |
| | `workspace create` | 新建工作空间 |
| | `workspace update` | 修改名称/描述 |
| | `workspace delete` | 删除工作空间（含磁盘文件） |
| | `workspace tree` | 查看目录树；`--filter` 按关键词查文件路径 |
| | `workspace upload` | zip 全量替换（清空后重建） |
| | `workspace push` | 单文件新增/替换（增量，可指定目标路径） |
| | `workspace rm` | 删除单个文件 |
| | `workspace cat` | 输出文件原始内容 |
| | `workspace download` | 整包下载（zip，保留目录结构） |
| | `workspace share` | 生成分享链接；`--file` 精确到某个文件 |
| | `workspace unshare` | 撤销分享 |
| 分享 | `share collection` | 集合分享链接 |
| | `share document` | 文档分享链接 |
| | `share workspace` | 工作空间分享链接（支持文件级直链） |
| | `share list` | 列出所有已分享对象（集合/文档/工作空间） |
| | `share revoke <类型>` | 撤销分享（collection / document / workspace） |

`workspace` 可简写为 `ws`，`collection` 可简写为 `col`。
所有列表及详情类命令支持 `--json` 输出机器可读格式。

## 命令详解

### 配置

```bash
# 设置服务端地址（只需一次）
kb config set server https://kb.example.com

# 直接注入令牌（免交互登录，适合脚本）
kb config set token <jwt>

# 查看配置（标注值来源：配置文件 or 环境变量）
kb config get

# 清除令牌
kb config unset token
```

### 认证

```bash
kb login                      # 交互式输入用户名与密码
kb login admin                # 交互输入密码
kb login admin -p secret      # 非交互登录（脚本）
kb whoami                     # 查看当前用户并校验令牌是否有效
kb logout                     # 退出登录
```

### 集合管理

```bash
kb collection list                       # 列出集合
kb col list                              # 简写
kb collection get 1                      # 集合详情
kb collection create "技术文档"            # 创建
kb collection create "项目" -d "项目归档"  # 带描述创建
kb collection update 1 --name "新名称"     # 改名
kb collection update 1 --sort 3           # 调整排序
kb collection delete 1 -y                # 删除（跳过确认）
```

### 文档上传

```bash
# 单文件 / 批量 / 目录（递归收集 .md/.html/.htm）
kb push ./doc.md -c 1
kb push ./docs/*.md -c 1
kb push ./docs -c 1

# 覆盖同名文档（保留文档 ID 与元数据，旧内容存为可追溯版本）
kb push ./doc.md -c 1 -o

# 文档包：zip 内含 md/html 入口与图片资产，md 内相对图片引用自动解析
kb push ./prd.zip -c 1
kb push ./prd.zip -c 1 -o
```

文档包说明：zip 内**每个 md/html 各建一个文档**，包内全部图片作为资产挂到每个文档下（sha1 内容寻址去重）；渲染时 md 的相对图片引用被重写为资产端点。

### 文档查询

```bash
kb list -c 1                  # 列出集合下文档
kb list -c 1 --json           # JSON 输出
kb get 1                      # 文档详情（含当前版本、包内目录、分享链接）
kb raw 1                      # 输出正文到终端
kb raw 1 | head -20           # 管道处理
kb raw 1 -o ./out.md          # 保存为本地文件
kb search "部署流程"           # 全文检索（命中词高亮）
kb search "API" --json        # JSON 输出（纯文本摘要，无 ANSI 码）
```

### 文档更新与移动

```bash
kb update 1 --title "新标题"
kb update 1 --tags "api,guide" --note "补充说明"
kb update 1 --sort 3          # 调整集合内排序
kb move 1 -c 2                # 移动文档到集合 2
kb delete 1 -y                # 删除文档
```

### 文档下载

```bash
kb download 1                          # 下载单个文档到当前目录
kb download 1 -o ./downloads           # 下载到指定目录
kb download --all -c 1 -o ./export     # 批量下载集合内全部文档
```

### 版本历史

```bash
kb version:list 1               # 查看版本列表
kb version:view 1 2             # 查看 v2 内容
kb version:view 1 2 -o v2.md    # 保存 v2 到文件
kb version:restore 1 2 -y       # 恢复到 v2（当前内容存为新版本）
kb version:delete 1 1 -y        # 删除 v1（释放存储引用）
```

### 工作空间

工作空间是隔离的多文件目录（适合原型站点、AI 产出的多页面包）。

```bash
kb ws list                              # 列出工作空间
kb ws create "产品原型" -d "V1 原型"      # 新建
kb ws get 1                             # 详情（文件数/体积/存储路径/分享）
kb ws update 1 --name "新名称"           # 改名

# 整包上传（全量替换：先清空目录再解压重建，需确认或 -y）
kb ws upload 1 ./dist.zip -y

# 目录树与文件查询
kb ws tree 1                            # 树形展示
kb ws tree 1 --filter todo              # 按关键词查文件路径
kb ws tree 1 --json                     # 原始树结构

# 单文件增量操作（不影响其他文件）
kb ws push 1 ./todo.html -p pages/todo.html   # 上传到指定路径
kb ws push 1 ./todo.html                      # 默认用文件名
kb ws cat 1 pages/todo.html                   # 输出文件内容
kb ws cat 1 pages/todo.html -o ./local.html   # 保存到本地
kb ws rm 1 pages/todo.html -y                 # 删除文件

# 整包下载（保留目录结构，可直接改后再 upload 往返）
kb ws download 1 -o ./out

# 分享
kb ws share 1                           # 整空间链接
kb ws share 1 --file todo.html          # 直达该文件的链接（?file= 深链）
kb ws unshare 1 -y                      # 撤销分享

kb ws delete 1 -y                       # 删除工作空间（含磁盘文件）
```

### 分享链接

```bash
kb share collection 1                 # 集合分享链接
kb share document 5                   # 文档分享链接
kb share workspace 1                  # 工作空间分享链接
kb share workspace 1 -f todo.html     # 文件级直链
kb share list                         # 所有已分享对象总览
kb share collection 1 --json          # JSON 输出

# 撤销（原链接立即失效）
kb share revoke collection 1 -y
kb share revoke document 5 -y
kb share revoke workspace 1 -y
```

## 上传限制

与后端及前端三方对齐，CLI 在**上传前**即校验体积，避免大文件白传后才被拒：

| 类型 | 上限 | 说明 |
|------|------|------|
| 单文档 `.md/.html/.htm` | 10 MB | `kb push` |
| zip 文档包 | 100 MB | `kb push xxx.zip`（解压后累计同样受限） |
| 工作空间文件 | 500 MB | `kb ws upload` / `kb ws push` |

超限时提示形如：`big.md 过大（10.5 MB），上限 10MB，请精简后重试`。
即使被 nginx 等中间层拦截（返回 HTML 413 无 JSON detail），CLI 也会按端点补出限制说明。

上传过程显示实时进度百分比（大文件不再是静态 spinner）。

## JSON 模式

所有列表及详情命令支持 `--json`，输出机器可读数据，适合脚本管道：

```bash
kb list -c 1 --json | jq '.[].标题'
kb search "关键词" --json > results.json
kb ws tree 1 --json | jq '.. | .path? // empty'
kb share list --json | jq '.[] | select(.类型=="文档")'
```

`--json` 输出保证**不含 ANSI 颜色码**（如搜索摘要会剔除高亮标记后输出纯文本）。

## CI/CD 与非交互登录

三种方式，任选其一：

```bash
# 方式 1：环境变量（推荐，凭据不落盘）
export KB_SERVER=https://kb.example.com
export KB_TOKEN=<jwt>
export KB_USERNAME=admin          # 可选
kb ws list

# 方式 2：非交互登录（写入 ~/.kbconfig.json）
kb login admin -p "$KB_PASSWORD"

# 方式 3：直接注入令牌
kb config set server https://kb.example.com
kb config set token <jwt>
```

环境变量**优先于**配置文件；`kb config get` 会标注每项值的来源，便于排查。

失败命令统一以退出码 `1` 结束，便于 `set -e` 与流水线判定。

## 配置文件

CLI 配置保存在 `~/.kbconfig.json`：

```json
{
  "server": "https://kb.example.com",
  "token": "eyJhbG...",
  "username": "admin"
}
```

支持的环境变量：`KB_SERVER`、`KB_TOKEN`、`KB_USERNAME`。

## 错误处理

CLI 将 HTTP 错误统一转为可读中文提示，并以退出码 1 结束：

| 场景 | 提示示例 |
|------|---------|
| 未登录 / 令牌过期 | `未登录或登录已过期，请执行: kb login` |
| 密码错误 | `用户名或密码错误` |
| 资源不存在 | `文件不存在` / `资源不存在（404）：请检查 ID / 路径是否正确` |
| 内容重复 | `以下文件内容与集合中已有文件重复，已跳过: doc1.md` |
| 超出体积限制 | `xxx.zip 过大（120.5 MB），上限 100MB，请精简后重试` |
| 服务端不可达 | `无法连接到服务端，请检查地址: http://...` |
| 服务端错误 | `服务端错误（500），请查看服务端日志` |

## 环境要求

- Node.js >= 18
- Windows / macOS / Linux
- 需要部署 kb-service 后端服务（参见 [kb-service](https://github.com/wind-zhou5210/kb-service)）

## License

MIT
