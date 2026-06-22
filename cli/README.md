# kb-service-cli

> kb-service 知识库命令行工具 — 终端即可完成知识的上传、管理与检索

[![npm version](https://img.shields.io/npm/v/kb-cli)](https://www.npmjs.com/package/kb-cli)

## 安装

```bash
npm install -g kb-cli
```

需要 Node.js >= 18。

## 快速开始

```bash
# 1. 配置服务端地址
kb config set server https://kb.example.com

# 2. 登录
kb login admin

# 3. 上传文档
kb push ./doc.md -c 1

# 4. 搜索
kb search "关键词"
```

## 命令概览

| 分组 | 命令 | 说明 |
|------|------|------|
| 认证 | `login` | 登录 kb-service |
| | `logout` | 退出登录 |
| | `whoami` | 查看当前用户 |
| 配置 | `config set` | 设置服务端地址 |
| | `config get` | 查看当前配置 |
| 集合 | `collection list` | 列出全部集合 |
| | `collection create` | 创建集合 |
| | `collection delete` | 删除集合 |
| 文档 | `push` | 上传文件到集合 |
| | `list` | 列出集合下的文档 |
| | `search` | 全文检索 |
| | `get` | 查看文档详情 |
| | `download` | 下载文档 |
| | `update` | 更新文档元信息 |
| | `delete` | 删除文档 |
| 分享 | `share collection` | 集合分享链接 |
| | `share document` | 文档分享链接 |

所有列表类命令支持 `--json` 输出机器可读格式。

## 命令详解

### 配置

```bash
# 设置服务端地址（只需一次）
kb config set server https://kb.example.com

# 查看配置
kb config get
```

### 认证

```bash
# 交互式登录
kb login

# 指定用户名
kb login admin

# 查看当前用户
kb whoami

# 退出登录
kb logout
```

### 集合管理

```bash
# 列出集合
kb collection list
kb col list                # 简写

# 创建集合
kb collection create "技术文档"
kb collection create "项目" -d "项目知识归档"

# 删除集合（需确认）
kb collection delete 1
kb collection delete 1 -y  # 跳过确认
```

### 文档上传

```bash
# 上传单个文件
kb push ./doc.md -c 1

# 批量上传
kb push ./docs/*.md -c 1

# 上传多个指定文件
kb push a.md b.html c.md -c 1
```

### 文档查询

```bash
# 列出集合下的文档
kb list -c 1
kb list -c 1 --json         # JSON 输出

# 查看文档详情
kb get 1

# 全文检索
kb search "部署流程"
kb search "API" --json       # JSON 输出
```

### 文档更新

```bash
# 更新标题
kb update 1 --title "新标题"

# 更新标签
kb update 1 --tags "api,guide"

# 同时更新多项
kb update 1 --title "新标题" --tags "api" --note "补充说明"
```

### 文档下载

```bash
# 下载到当前目录
kb download 1

# 下载到指定目录
kb download 1 -o ./downloads
```

### 文档删除

```bash
# 删除（需确认）
kb delete 1

# 跳过确认
kb delete 1 -y
```

### 分享链接

```bash
# 生成集合分享链接
kb share collection 1

# 生成文档分享链接
kb share document 5

# JSON 输出
kb share collection 1 --json
```

## JSON 模式

所有列表及详情命令支持 `--json` 标志，输出机器可读的 JSON 数据，适合脚本管道处理：

```bash
kb list -c 1 --json | jq '.[].title'
kb search "关键词" --json > results.json
```

## 配置文件

CLI 配置保存在 `~/.kbconfig.json`：

```json
{
  "server": "https://kb.example.com",
  "token": "eyJhbG...",
  "username": "admin"
}
```

## 环境要求

- Node.js >= 18
- Windows / macOS / Linux
- 需要部署 kb-service 后端服务（参见 [kb-service](https://github.com/wind-zhou5210/kb-service)）

## License

MIT
