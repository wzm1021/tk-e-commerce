export function DataPricing({ price }) {
  if (!price) return null;
  const entries = Object.entries(price.tools || {});
  const pending = entries.filter(([, value]) => value == null).length;
  return (
    <div>
      <p>
        TikTok 数据：未命中快照时按接口扣 0 / 1 / 2 / 3 积分；有效快照命中仍扣
        0.3 积分。
        零结果、明确失败和限流不扣费；同任务已归档请求重复读取不再扣费。
      </p>
      <p className="muted">
        按接口单价预留，返回后结算；连接中断等结果不确定的调用保留预留，核对后结算。
        空结果和错误结果不作为收费快照复用。亚马逊数据仍为实时 1 积分、快照 0.3
        积分。
      </p>
      {pending ? (
        <p className="notice">
          {pending}{" "}
          个接口的实时单价待确认；这些接口暂停实时查询，已有有效快照仍可使用。
        </p>
      ) : null}
      <details>
        <summary>查看各接口积分单价（{entries.length} 个）</summary>
        <div className="table-frame">
          <table>
            <thead>
              <tr>
                <th>查询接口</th>
                <th>实时积分 / 次</th>
                <th>快照积分 / 次</th>
              </tr>
            </thead>
            <tbody>
              {entries.map(([tool, value]) => (
                <tr key={tool}>
                  <td>
                    {tool}
                    {tool === "credit_usage_summary" ? "（平台内部）" : ""}
                  </td>
                  <td>{value ?? "待确认"}</td>
                  <td>{price.points_per_snapshot}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
