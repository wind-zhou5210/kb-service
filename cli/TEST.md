# kb-cli 测试用例

> 前置条件：后端运行在 `http://49.232.202.197:8000`，管理员账号 `admin / Kb@2026Secure!`

## 环境准备

```bash
cd D:\th\kb-service\cli
npm run build

# 连接后端
npm run start config set server http://49.232.202.197:8000
```

---

## 一、配置命令 (config)

### 1.1 查看默认配置
```bash
npm run start config get
```
**预期输出：**
```
server       (未配置)
username     (未登录)
token        (未登录)
config_path  ~/.kbconfig.json
```

### 1.2 设置服务端地址
```bash
npm run start config set server http://49.232.202.197:8000
```
**预期输出：**
```diff
+ ✓ 已设置 server = http://localhost:8000
```

### 1.3 再次查看配置确认
```bash
npm run start config get
```
**预期输出：** server 行显示 `http://localhost:8000`

### 1.4 设置不支持的配置项
```bash
npm run start config set foo bar
```
**预期输出：**
```diff
- ✗ 不支持的配置项: foo，目前仅支持 server
```
**预期退出码：** 1

### 1.5 URL 尾部斜杠自动去除
```bash
npm run start config set server http://example.com/
npm run start config get
```
**预期输出：** server 为 `http://example.com`（无尾部斜杠）

---

## 二、认证命令 (auth)

### 2.1 登录（直接传用户名）
```bash
npm run start login admin
```
**预期：** 提示输入密码 → 输入 `admin123` → 显示登录成功

### 2.2 登录（交互式用户名）
```bash
npm run start login
```
**预期：** 提示 `用户名: ` → 输入 `admin` → 提示密码 → 输入 `admin123` → 成功

### 2.3 登录失败（错误密码）
```bash
npm run start login -u admin
# 输入错误密码
```
**预期输出：**
```diff
✗ 用户名或密码错误
```

### 2.4 登录失败（服务端不可达）
```bash
npm run start config set server http://localhost:9999
npm run start login admin
```
**预期输出：**
```diff
✗ 无法连接到服务端，请检查地址: http://localhost:9999
```
> 恢复：`npm run start config set server http://49.232.202.197:8000`

### 2.5 查看当前用户
```bash
npm run start whoami
```
**预期输出：**
```
用户名       admin
服务端       http://localhost:8000
```

### 2.6 未登录查看用户
```bash
npm run start logout
npm run start whoami
```
**预期输出：**
```diff
- ✗ 未登录，请先执行: kb login
```

### 2.7 退出登录
```bash
npm run start logout
```
**预期输出：**
```diff
+ ✓ 已退出登录
```

### 2.8 退出后重新登录
```bash
npm run start login admin
```
**预期：** 正常登录成功，config get 中 username 恢复

---

## 三、集合命令 (collection)

### 3.1 创建集合
```bash
npm run start collection create "测试集合" -d "用于 CLI 测试"
```
**预期输出：**
```
✓ 集合已创建
┌────┬──────────┬────────────────┐
│ ID │ 名称     │ 描述           │
├────┼──────────┼────────────────┤
│ 1  │ 测试集合 │ 用于 CLI 测试   │
└────┴──────────┴────────────────┘
```

### 3.2 列出集合
```bash
npm run start collection list
```
**预期输出：** 表格显示集合列表，含 ID、名称、描述、文档数、更新时间

### 3.3 JSON 格式列出
```bash
npm run start collection list --json
```
**预期输出：** 合法 JSON 数组

### 3.4 简写别名 col
```bash
npm run start col list
```
**预期输出：** 同 3.2

### 3.5 创建不带描述的集合
```bash
npm run start collection create "无描述集合"
```
**预期输出：** 成功，描述列显示 `-`

### 3.6 删除集合（取消确认）
```bash
npm run start collection delete 999
# 输入 n 或直接回车
```
**预期输出：**
```
确认删除集合 ID=999 及其所有文档? (y/N) n
已取消
```

### 3.7 删除集合（确认）
```bash
npm run start collection delete 999 -y
```
**预期：** 删除成功（或报错"集合不存在"如果 999 不存在）

### 3.8 删除不存在的集合
```bash
npm run start collection delete 99999 -y
```
**预期输出：** 后端返回 404 错误提示

---

## 四、文档上传 (push)

### 4.1 单文件上传
```bash
# 先创建一个测试文件
echo "# Hello CLI Test" > test.md
npm run start push test.md -c 1
```
**预期输出：**
```
✓ 上传完成: 1 个文档
┌────┬───────────────┬─────────┬───────┐
│ ID │ 标题          │ 文件名  │ 大小  │
├────┼───────────────┼─────────┼───────┤
│ 1  │ Hello CLI ... │ test.md │ ...   │
└────┴───────────────┴─────────┴───────┘
```

### 4.2 通配符批量上传
```bash
echo "# Doc A" > a.md
echo "# Doc B" > b.md
npm run start push *.md -c 1
```
**预期输出：** 上传 a.md 和 b.md 两个文件（注意 test.md 也会被包含）

### 4.3 上传不支持的格式
```bash
echo "hello" > test.txt
npm run start push test.txt -c 1
```
**预期输出：**
```diff
! 文件不存在: test.txt
- ✗ 没有找到可上传的文件（仅支持 .md/.html/.htm）
```

### 4.4 上传到不存在的集合
```bash
npm run start push test.md -c 99999
```
**预期输出：**
```diff
✗ 集合不存在
```

### 4.5 文件路径不存在
```bash
npm run start push /nonexistent/file.md -c 1
```
**预期输出：**
```diff
! 文件不存在: /nonexistent/file.md
- ✗ 没有找到可上传的文件
```

---

## 五、文档查询 (list / get)

### 5.1 列出集合下文档
```bash
npm run start list -c 1
```
**预期输出：** 表格显示文档 ID、标题、文件名、类型、大小、标签、更新时间

### 5.2 JSON 格式列出
```bash
npm run start list -c 1 --json
```
**预期输出：** 合法 JSON 数组

### 5.3 空集合列表
```bash
npm run start list -c 99999
```
**预期输出：** 空表格（只有表头，无数据行）

### 5.4 查看文档详情
```bash
npm run start get 1
```
**预期输出：** 表格显示文档全部字段（ID、标题、文件名、类型、大小、标签、备注、SHA1、时间）

### 5.5 JSON 格式查看
```bash
npm run start get 1 --json
```
**预期输出：** 合法 JSON 对象

### 5.6 查看不存在的文档
```bash
npm run start get 99999
```
**预期输出：**
```diff
✗ 文件不存在
```

---

## 六、全文搜索 (search)

### 6.1 基础搜索
```bash
npm run start search "CLI"
```
**预期输出：** 表格显示匹配文档，含 ID、标题、所属集合、类型、高亮摘要

### 6.2 JSON 格式搜索
```bash
npm run start search "Hello" --json
```
**预期输出：** 合法 JSON 数组

### 6.3 无结果搜索
```bash
npm run start search "xyznonexistent123456"
```
**预期输出：**
```
未找到匹配 "xyznonexistent123456" 的文档
```

### 6.4 中文搜索
```bash
npm run start search "测试"
```
**预期输出：** 匹配包含中文关键词的文档

---

## 七、文档更新 (update)

### 7.1 更新标题
```bash
npm run start update 1 --title "新标题"
```
**预期输出：** 显示更新后的文档信息，标题为"新标题"

### 7.2 更新标签
```bash
npm run start update 1 --tags "cli,test"
```
**预期输出：** 标签显示 `cli,test`

### 7.3 更新备注
```bash
npm run start update 1 --note "这是测试笔记"
```
**预期输出：** 备注显示

### 7.4 同时更新多项
```bash
npm run start update 1 --title "最终标题" --tags "final" --note "完成"
```
**预期输出：** 三项全部更新

### 7.5 不传任何参数
```bash
npm run start update 1
```
**预期输出：**
```diff
- ✗ 请至少指定一个更新项: --title / --tags / --note
```

### 7.6 更新不存在的文档
```bash
npm run start update 99999 --title "x"
```
**预期输出：**
```diff
✗ 文件不存在
```

---

## 八、文档下载 (download)

### 8.1 下载到默认目录
```bash
npm run start download 1
```
**预期输出：**
```diff
+ ✓ 已下载: ./<原文件名>
```
**验证：** 当前目录出现对应文件

### 8.2 下载到指定目录
```bash
mkdir -p downloads
npm run start download 1 -o downloads
```
**预期输出：**
```diff
+ ✓ 已下载: downloads/<文件名>
```
**验证：** `downloads/` 目录下有对应文件

---

## 九、文档删除 (delete)

### 9.1 取消删除
```bash
npm run start delete 1
# 输入 n
```
**预期输出：**
```
确认删除文档 ID=1? (y/N) n
已取消
```

### 9.2 确认删除
```bash
npm run start delete 1
# 输入 y
```
**预期输出：**
```diff
✓ 文档已删除
```

### 9.3 跳过确认
```bash
npm run start delete 2 -y
```
**预期输出：** 直接删除，无确认提示

---

## 十、分享命令 (share)

### 10.1 生成集合分享链接
```bash
npm run start share collection 1
```
**预期输出：**
```diff
+ ✓ 分享链接: http://localhost:8000/share/<token>
```

### 10.2 JSON 格式分享
```bash
npm run start share collection 1 --json
```
**预期输出：**
```json
{
  "share_token": "<token>",
  "url": "http://localhost:8000/share/<token>"
}
```

### 10.3 生成文档分享链接
```bash
npm run start share document 1
```
**预期输出：**
```diff
+ ✓ 分享链接: http://localhost:8000/share/doc/<token>
```

### 10.4 分享不存在的集合/文档
```bash
npm run start share collection 99999
```
**预期输出：** 后端返回错误

---

## 十一、端到端完整流程

```bash
# 1. 配置
npm run start config set server http://49.232.202.197:8000
npm run start config get

# 2. 登录
npm run start login admin

# 3. 创建集合
npm run start collection create "E2E测试" -d "端到端测试"

# 4. 创建测试文件
echo "# E2E Test Document" > e2e_test.md
echo "<h1>E2E HTML</h1>" > e2e_test.html

# 5. 上传
npm run start push e2e_test.md e2e_test.html -c <集合ID>

# 6. 查看列表
npm run start list -c <集合ID>

# 7. 查看详情
npm run start get <文档ID>

# 8. 搜索
npm run start search "E2E"

# 9. 更新
npm run start update <文档ID> --title "E2E测试更新" --tags "e2e"

# 10. 分享
npm run start share collection <集合ID>
npm run start share document <文档ID>

# 11. 下载
npm run start download <文档ID> -o downloads

# 12. 删除文档
npm run start delete <文档ID> -y

# 13. 删除集合
npm run start collection delete <集合ID> -y

# 14. 登出
npm run start logout
```

---

## 十二、异常场景

| # | 场景 | 命令 | 预期 |
|---|------|------|------|
| 1 | 未配置 server | `npm run start collection list` | `✗ 未配置服务端地址，请先执行: kb config set server <url>` |
| 2 | 未登录执行需鉴权命令 | `npm run start collection list`（logout 后） | 同 #1 或 401 提示 |
| 3 | Token 过期 | 所有鉴权命令 | `✗ 登录已过期，请重新执行: kb login` |
| 4 | 服务端不可达 | `npm run start collection list` | `✗ 无法连接到服务端...` |
| 5 | 上传超大文件 | push 一个 >10MB 的文件 | 后端返回 413，CLI 提示文件过大 |
| 6 | JSON 模式下的错误 | 任意 --json 命令触发错误 | stderr 输出错误信息 |
| 7 | 并发问题 | 快速连续 push 同一文件 | 去重正常，不会重复存储 |
| 8 | 特殊字符文件名 | push 含空格/中文的文件 | 正常上传 |
| 9 | 空搜索串 | `npm run start search ""` | commander 应拦截（query 必传） |
| 10 | 删除后立即查询 | delete → get | 返回"文件不存在" |

---

## 快速回归清单

```bash
# 一键验证核心路径
npm run start config get           && echo "✓ config"
npm run start whoami               && echo "✓ whoami"
npm run start collection list      && echo "✓ col list"
npm run start collection list --json >nul && echo "✓ col list --json"
npm run start search "test"        && echo "✓ search"
npm run start search "test" --json >nul && echo "✓ search --json"
echo "=== ALL PASS ==="
```
