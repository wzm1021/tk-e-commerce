# AI 测品中文 PDF

导出使用已确认的报告、中文译文缓存和已归档截图；不调用测品 SDK、模型或商品页面。中文反馈未完整就绪时暂不导出。API 只排队，现有 `tidelab-ai-testing` worker 顺序执行离线 Chromium 排版，避免 API 进程承担浏览器内存。

应用机需保留现有 Playwright Chromium，以及中文字体 `fonts-noto-cjk`（Ubuntu 可通过 `apt-get install fonts-noto-cjk` 安装）。`PLAYWRIGHT_BROWSERS_PATH` 沿用 AI 测品服务环境设置。不得重新启用商品网页自动截图来生成 PDF。

文件保存为租户私有 `report` 产物，沿用登录、工作空间授权与附件下载接口。请求、生成状态和缓存保存在 `ai_test_runs.result.pdf_zh`，导出审计写入 `ai_test_events`；无数据库迁移。缓存按报告、确认配置、截图和模板版本校验，模板发生变化时递增 `PDF_VERSION`。失败可重试，已完成测品状态和扣次不变。

验收需覆盖完整中文文本、所有消费者、比较指标与区间、有效商品链接、确认截图、PDF 字体嵌入及分页；并检查重复下载不新增 SDK / 模型调用、不变更钱包与账本，跨工作空间不能下载。仅生成 `%PDF` 文件头不构成版面验收。
