import { useState } from "react";
import { Field } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
import { AdminForm } from "./AdminForm.jsx";

export function ConnectionForm({ api, onSaved, existing }) {
  const [kind, setKind] = useState(existing?.kind || "model");
  return (
    <AdminForm
      api={api}
      path={
        existing
          ? `/api/admin/connections/${existing.id}/rotate`
          : "/api/admin/connections"
      }
      onSaved={onSaved}
      submitLabel={existing ? "保存新版本并暂停连接" : "保存"}
      convert={(f) => ({
        name: f.get("name"),
        kind,
        secret: f.get("secret"),
        config: {
          endpoint: f.get("endpoint"),
          protocol:
            kind === "model"
              ? "responses"
              : ["fastmoss", "sellersprite"].includes(kind)
                ? "mcp"
                : "1688-pending",
          ...(kind === "model"
            ? {
                model: f.get("model"),
                context_limit: Number(f.get("context_limit")),
                output_limit: Number(f.get("output_limit")),
              }
            : {}),
        },
      })}
    >
      <div className="form-grid">
        <Field label="连接类型">
          <Select
            variant="box"
            value={kind}
            onChange={setKind}
            disabled={Boolean(existing)}
            options={[
              { value: "model", title: "大模型 · Responses API" },
              { value: "fastmoss", title: "FastMoss · MCP" },
              { value: "sellersprite", title: "SellerSprite · 亚马逊 MCP" },
              { value: "1688", title: "1688 · 待文档核验" },
            ]}
          />
        </Field>
        <Field label="连接名称">
          <input name="name" defaultValue={existing?.name || ""} required />
        </Field>
        <Field
          label="完整 API 端点"
          wide
          hint="仅接受 HTTPS 公网端点；模型请填写包含 /responses 的完整地址。"
        >
          <input
            key={kind}
            name="endpoint"
            type="url"
            required
            defaultValue={
              existing?.config?.endpoint ||
              (kind === "fastmoss"
                ? "https://mcp.fastmoss.com/mcp"
                : kind === "sellersprite"
                  ? "https://mcp.sellersprite.com/mcp"
                  : "")
            }
          />
        </Field>
        {kind === "model" && (
          <>
            <Field label="供应商模型 ID" wide>
              <input
                name="model"
                defaultValue={existing?.config?.model || ""}
                required
              />
            </Field>
            <Field label="本平台上下文上限（token）">
              <input
                name="context_limit"
                type="number"
                min="1024"
                max="1000000"
                defaultValue={existing?.config?.context_limit || 64000}
                required
              />
            </Field>
            <Field label="单次输出上限（token）">
              <input
                name="output_limit"
                type="number"
                min="128"
                max="384000"
                defaultValue={existing?.config?.output_limit || 4096}
                required
              />
            </Field>
          </>
        )}
        <Field label="API Key" wide hint="仅写入加密存储，保存后不会回显。">
          <input
            name="secret"
            type="password"
            autoComplete="new-password"
            required
            minLength={8}
          />
        </Field>
      </div>
      <div className="notice">
        {existing && (
          <p>
            保存新版本会暂停此连接，使用它的任务将无法继续发起调用。请在空闲时更新，并在验证成功后重新启用。旧密钥不会回显。
          </p>
        )}
        保存后需要验证连接再启用。模型验证会发送一次最多 128 输出 token
        的小额探测；电商数据连接验证读取并固定接口目录。SellerSprite MCP
        仅用于已获授权的个人验证；多人正式服务须先确认正式 API 接入与授权。
      </div>
    </AdminForm>
  );
}
