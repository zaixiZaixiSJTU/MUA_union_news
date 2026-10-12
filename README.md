# MUA 高校社团联合资讯

聚合高校 Minecraft 社团官网资讯，提供公开浏览页面、采集管理后台和 SJMCL 兼容接口。项目使用 Node.js、Express 与 MySQL。

![资讯首页](ui-home.png)

![管理后台](ui-admin.png)

## 功能

- 内置 25 所高校来源，支持 RSS、WordPress、SJMCL、HTML、JSON 和自定义规则。
- 按计划自动采集，也可在后台立即采集单个或全部来源。
- 后台可新增、编辑、停用和删除来源，管理员名单热更新。
- 使用 MUA 用户中心 OAuth 登录，写操作带会话和 CSRF 校验。
- `/api-sjmcl/article` 输出 SJMCL 兼容数据，文章标签包含所属学校。

## 本地启动

需要 Node.js 20.18+、Docker Desktop。

```powershell
Copy-Item .env.example .env
# 编辑 .env，填写数据库密码、OAuth 客户端和初始管理员邮箱
docker compose up -d mysql
npm install
npm start
```

- 首页：<http://localhost:3000/>
- 后台：<http://localhost:3000/admin>
- API：<http://localhost:3000/api-sjmcl/article?pageSize=12>

OAuth 应用的回调地址应设置为：

```text
http://localhost:3000/auth/callback
```

## 配置

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | MySQL 连接地址 |
| `BASE_URL` | 网站公开地址；生产环境使用 HTTPS |
| `SESSION_SECRET` | 会话签名密钥 |
| `OAUTH_CLIENT_ID` / `OAUTH_CLIENT_SECRET` | MUA OAuth 应用凭据，必须属于同一个应用 |
| `ADMIN_EMAILS` | 首次建库时导入的管理员邮箱，多个邮箱用逗号分隔 |
| `SOURCE_NAME` / `SOURCE_FULL_NAME` / `SOURCE_ICON_URL` | SJMCL 来源信息 |

`ADMIN_EMAILS` 只在管理员表为空时导入。之后请在后台增删管理员，无需重启。

## SJMCL 接口

```text
GET /api-sjmcl/article?pageSize=12
GET /api-sjmcl/article?pageSize=12&cursor=12
GET /api-sjmcl/article?pageSize=0
```

返回 `sourceInfo`、`posts` 和下一页 `next`。`pageSize=0` 只返回来源信息。接口格式参考[发现页官网文章接口](https://notes.sjtu.edu.cn/LD9Y-X7dRxaq_Q7rW7PNcw)。

## 维护

默认每 60 分钟检查所有启用来源，后台可将周期调整为 15–1440 分钟。Node.js 服务必须持续运行。

```powershell
npm test                         # 本地测试
npm run crawl-now -- 2 4 10     # 按来源 ID 立即采集
npm run backfill-rules           # 更新内置规则到已有数据库
node scripts/test-rules.js       # 检查真实站点规则
```

采集规则保存在数据库中，可在后台直接编辑 JSON。删除来源会同时删除该来源的文章。
