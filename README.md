# 探阔 Tanviko

跨境电商研究工作台与数据客户端。项目提供选品研究、候选报告、商品助手、竞店监控、货源匹配、利润测算，以及租户、权限和用量管理。

这是可自行部署的开源源码。原托管服务已停止运营；仓库不提供生产数据、用户报告、账号、供应商凭据或可直接复用的云资源。

## 目录

- `platform/`：React 用户端及管理端、Node.js 服务、PostgreSQL 迁移、隔离 Agent 与测试。
- `src/`：TypeScript 电商数据客户端。
- `skills/`：研究技能及确定性分析脚本。
- `schemas/`：工具和业务数据契约。
- `docs/`：数据接入契约及接口说明。

## 开发与检查

需要 Node.js 22.18+。平台运行还需要自行配置 PostgreSQL、私有文件存储目录、主密钥及 Worker 认证；执行器需要 Docker。模型和数据供应商需要部署者自行申请账号、权限及额度。

```sh
npm run check
npm test
cd platform
npm ci
npm run check
npm run build
npm test
```

根目录客户端配置参考 `.env.example`；平台服务配置参考 `platform/.env.example`。不要将实际凭据提交到仓库。数据库集成测试使用单独的测试库，通过 `TEST_DATABASE_URL` 提供连接；无配置时部分测试会跳过。

平台开发入口见 [平台说明](platform/README.md)，部署注意事项见 [部署说明](platform/deploy/README.md)。浏览器前端通过 `npm run web` 启动，后端通过 `npm run dev` 启动；服务环境和数据库需先配置完成。

## 开源范围

保留应用源码、迁移、测试、技能和通用部署模板。原私有仓库中的实际报告、用户及后台截图、历史部署记录、商业资料、一次性运营脚本和个人路径不在公开版本中。历史固定报告的兼容导入需要部署者自己的数据，不随开源版本提供。

## 许可证

本项目源码采用 [MIT License](LICENSE)。第三方依赖、SDK、接口服务与数据分别遵守各自许可证和服务条款。
