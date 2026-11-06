import { useState } from "react";
import { ArrowUpRight, MessageSquare } from "lucide-react";
import { useLoad } from "../../hooks/useLoad.mjs";
import { PageTitle } from "../../components/PageTitle.jsx";
import {
  Button,
  Badge,
  Empty,
  ErrorBox,
  Loading,
} from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";

export function OpportunityPage({
  api,
  platform = "tiktok",
  version,
  reload,
  onResearch,
  onAssistant,
}) {
  const { data, error } = useLoad(
    api,
    `/api/records?kind=opportunity&platform=${platform}`,
    version,
  );
  const [err, setErr] = useState(""),
    [selected, setSelected] = useState([]);
  async function update(row, stage) {
    try {
      await api("/api/records/" + row.id, {
        method: "PUT",
        body: { version: row.version, data: { ...row.data, stage } },
      });
      reload();
    } catch (e) {
      setErr(e.message);
    }
  }
  return (
    <>
      <PageTitle
        eyebrow="OPPORTUNITY POOL"
        title="机会池"
        description="把值得继续验证的商品留下来，逐步推进货源、样品和内容实验。"
      >
        {onAssistant && (
          <Button
            secondary
            disabled={!selected.length || selected.length > 10}
            onClick={() =>
              onAssistant(
                selected.map((record_id) => ({
                  kind: "opportunity",
                  record_id,
                })),
              )
            }
          >
            <MessageSquare size={16} />
            将所选商品添加到助手（{selected.length}）
          </Button>
        )}
      </PageTitle>
      <ErrorBox error={error || err} />
      {!data ? (
        <Loading />
      ) : !data.items.length ? (
        <Empty title="机会来自你的判断">
          先在选品中心选择候选商品，再加入机会池。
        </Empty>
      ) : (
        <div className="opportunity-grid">
          {data.items.map((row) => (
            <article className="opportunity-card" key={row.id}>
              <div className="section-line">
                <input
                  type="checkbox"
                  aria-label={`选择机会 ${row.data.title}`}
                  checked={selected.includes(row.id)}
                  onChange={(e) =>
                    setSelected((old) =>
                      e.target.checked
                        ? [...old, row.id]
                        : old.filter((x) => x !== row.id),
                    )
                  }
                />
                <Badge value={row.data.stage} />
                <small>
                  {row.data.source.kind === "historical_report"
                    ? "历史报告"
                    : "研究 / 人工资料"}
                </small>
              </div>
              <h2>{row.data.title}</h2>
              <small className="id-line">{row.data.product_id}</small>
              <p className="muted">
                {row.data.notes ||
                  "等待进一步研究。货源匹配、测样和利润核验都可以围绕这个商品展开。"}
              </p>
              <div className="section-line">
                <Select
                  variant="box"
                  size="sm"
                  ariaLabel={"更新 " + row.data.title + " 的阶段"}
                  value={row.data.stage}
                  onChange={(stage) => update(row, stage)}
                  options={[
                    { value: "watch", title: "观察" },
                    { value: "research", title: "研究" },
                    { value: "sample", title: "测样" },
                    { value: "test", title: "小测" },
                    { value: "approved", title: "已通过" },
                    { value: "rejected", title: "已否决" },
                  ]}
                />
                <Button secondary onClick={() => onResearch(row)}>
                  继续研究
                  <ArrowUpRight size={15} />
                </Button>
                {onAssistant && (
                  <button
                    className="text-button"
                    onClick={() =>
                      onAssistant([{ kind: "opportunity", record_id: row.id }])
                    }
                  >
                    向助手提问
                  </button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </>
  );
}
