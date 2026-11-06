# MCP Schema 快照

配置 `FASTMOSS_API_KEY` 后运行：

```bash
npm run fastmoss:sync-tools
```

脚本会通过 FastMoss MCP 的 `tools/list` 将当前工具名、说明、输入 Schema 和服务端提供的输出 Schema 保存为 `fastmoss-tools.snapshot.json`，并同步生成 `src/fastmoss/generated-inputs.ts`。快照带同步时间，便于发现服务端接口变更。
