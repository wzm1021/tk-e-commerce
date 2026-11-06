import { useState } from "react";
import { Plus, ArrowRight } from "lucide-react";

import { PageTitle } from "../../components/PageTitle.jsx";
import {
  Button,
  Field,
  Badge,
  Empty,
  ErrorBox,
  Loading,
} from "../../components/ui.jsx";
import { Dialog } from "../../components/Dialog.jsx";
import { Select } from "../../components/Select.jsx";

import { choices } from "./helpers.mjs";
import { useRecords } from "../../hooks/useRecords.mjs";
import { SaveForm } from "./SaveForm.jsx";
export function ExperimentsPage({ api, version, reload }) {
  const [tab, setTab] = useState("experiment"),
    [form, setForm] = useState(false),
    [edit, setEdit] = useState(null),
    [error, setError] = useState("");
  const { data } = useRecords(api, tab, version),
    { data: ops } = useRecords(api, "opportunity", version);
  async function update(row, data) {
    try {
      await api("/api/records/" + row.id, {
        method: "PUT",
        body: { version: row.version, data },
      });
      setEdit(null);
      reload();
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="TEST & LEARN"
        title="实验与行动"
        description="把研究建议变成有负责人、有验证口径的行动，再记录真实结果。"
      >
        <Button onClick={() => setForm(true)}>
          <Plus size={16} />
          {tab === "experiment" ? "新增内容实验" : "新增行动"}
        </Button>
      </PageTitle>
      <div className="tabs">
        <button
          className={tab === "experiment" ? "active" : ""}
          onClick={() => setTab("experiment")}
        >
          内容实验
        </button>
        <button
          className={tab === "action" ? "active" : ""}
          onClick={() => setTab("action")}
        >
          改进行动
        </button>
      </div>
      <ErrorBox error={error} />
      {!data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty
          title={tab === "experiment" ? "还没有内容实验" : "还没有待办行动"}
        >
          可将内容拆解、评论洞察和经营诊断中的建议整理为实验或行动。
        </Empty>
      ) : (
        <div className="opportunity-grid">
          {data.items.map((r) => (
            <article className="opportunity-card" key={r.id}>
              <div className="section-line">
                <Badge value={r.data.status} />
                <small>{r.data.owner}</small>
              </div>
              <h2>{r.data.title}</h2>
              <p>{r.data.hypothesis || r.data.evidence}</p>
              <small>
                {r.data.metric
                  ? `${r.data.metric} · 目标 ${r.data.target}`
                  : r.data.due_at
                    ? "截止 " + r.data.due_at
                    : ""}
              </small>
              <p>{r.data.result || r.data.notes}</p>
              <Button secondary onClick={() => setEdit(r)}>
                记录进展
                <ArrowRight size={15} />
              </Button>
            </article>
          ))}
        </div>
      )}
      {form && (
        <Dialog
          title={tab === "experiment" ? "新增内容实验" : "新增改进行动"}
          onClose={() => setForm(false)}
          wide
        >
          <SaveForm
            api={api}
            kind={tab}
            onSaved={() => {
              setForm(false);
              reload();
            }}
            convert={(f) => {
              const record = {
                title: f.get("title"),
                owner: f.get("owner"),
                status: tab === "experiment" ? "planned" : "open",
              };
              if (f.get("opportunity_id"))
                record.opportunity_id = f.get("opportunity_id");
              if (tab === "experiment")
                Object.assign(record, {
                  hypothesis: f.get("hypothesis"),
                  script: f.get("script"),
                  metric: f.get("metric"),
                  target: f.get("target"),
                  result: "",
                });
              else {
                Object.assign(record, {
                  evidence: f.get("evidence"),
                  notes: "",
                });
                if (f.get("due_at")) record.due_at = f.get("due_at");
              }
              return record;
            }}
          >
            <div className="form-grid">
              <Field label="名称" wide>
                <input name="title" required />
              </Field>
              <Field label="对应商品">
                <Select
                  variant="box"
                  name="opportunity_id"
                  options={[
                    { value: "", title: "不关联特定商品" },
                    ...choices(ops?.items || [], (r) => r.data.title),
                  ]}
                />
              </Field>
              <Field label="负责人">
                <input name="owner" required />
              </Field>
              {tab === "experiment" ? (
                <>
                  <Field label="待验证假设" wide>
                    <textarea name="hypothesis" required rows={2} />
                  </Field>
                  <Field label="原创脚本 / 拍摄 brief" wide>
                    <textarea name="script" required rows={5} />
                  </Field>
                  <Field label="衡量指标">
                    <input
                      name="metric"
                      required
                      placeholder="例如：落地页点击率"
                    />
                  </Field>
                  <Field label="目标与停止规则">
                    <input name="target" required />
                  </Field>
                </>
              ) : (
                <>
                  <Field label="行动依据与证据" wide>
                    <textarea name="evidence" required rows={4} />
                  </Field>
                  <Field label="截止日期">
                    <input name="due_at" type="date" />
                  </Field>
                </>
              )}
            </div>
          </SaveForm>
        </Dialog>
      )}
      {edit && (
        <Dialog title={edit.data.title} onClose={() => setEdit(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              update(edit, {
                ...edit.data,
                status: f.get("status"),
                [tab === "experiment" ? "result" : "notes"]: f.get("result"),
              });
            }}
          >
            {edit.data.script && (
              <p className="preserve-lines">{edit.data.script}</p>
            )}
            <Field label="状态">
              <Select
                variant="box"
                name="status"
                defaultValue={edit.data.status}
                options={(tab === "experiment"
                  ? [
                      ["planned", "计划中"],
                      ["running", "进行中"],
                      ["completed", "已完成"],
                      ["cancelled", "已取消"],
                    ]
                  : [
                      ["open", "待处理"],
                      ["doing", "进行中"],
                      ["done", "已完成"],
                      ["cancelled", "已取消"],
                    ]
                ).map(([k, v]) => ({ value: k, title: v }))}
              />
            </Field>
            <Field label="真实结果 / 进展">
              <textarea
                name="result"
                rows={5}
                defaultValue={edit.data.result || edit.data.notes}
              />
            </Field>
            <div className="dialog-actions">
              <Button>保存进展</Button>
            </div>
          </form>
        </Dialog>
      )}
    </>
  );
}
