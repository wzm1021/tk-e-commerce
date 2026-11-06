import { Field } from "../../components/ui.jsx";
import { Select } from "../../components/Select.jsx";
export const emptyProfile = () => ({
  company_name: "",
  contact_name: "",
  address: "",
  tax_id: "",
  phone: "",
  company_size: "",
  annual_revenue: "",
  revenue_currency: "CNY",
  revenue_year: new Date().getFullYear() - 1,
});
export function ProfileFields({ value, onChange, email, onEmail }) {
  const set = (key, val) => onChange({ ...value, [key]: val });
  const fields = [
    ["company_name", "公司名称", 200, "organization"],
    ["contact_name", "联系人", 80, "name"],
    ["phone", "电话", 40, "tel"],
  ];
  return (
    <div className="form-grid customer-profile-fields">
      {fields.map(([key, label, maxLength, autoComplete]) => (
        <Field
          key={key}
          label={`${label} *`}
          hint={
            key === "phone" ? "请包含国家区号，例如 +86 138 0000 0000" : null
          }
        >
          <input
            value={value[key]}
            onChange={(e) => set(key, e.target.value)}
            required
            maxLength={maxLength}
            autoComplete={autoComplete}
            type={key === "phone" ? "tel" : "text"}
            pattern={
              key === "phone"
                ? String.raw`\+[1-9][0-9 \(\)\-]{5,30}`
                : undefined
            }
          />
        </Field>
      ))}
      {onEmail && (
        <Field label="Email *">
          <input
            type="email"
            value={email}
            onChange={(e) => onEmail(e.target.value)}
            required
            maxLength={254}
            autoComplete="email"
          />
        </Field>
      )}
      <Field label="公司规模 *">
        <Select
          variant="box"
          ariaLabel="公司规模"
          value={value.company_size}
          onChange={(v) => set("company_size", v)}
          options={[
            { value: "", title: "请选择规模" },
            ...[
              "1–5人",
              "6–20人",
              "21–50人",
              "51–200人",
              "201–500人",
              "500人以上",
            ].map((v) => ({ value: v, title: v })),
          ]}
        />
      </Field>
      <Field label="年营业额 *" hint="上一完整财年，可填写 0">
        <input
          value={value.annual_revenue}
          onChange={(e) => set("annual_revenue", e.target.value)}
          type="number"
          min="0"
          max="999999999999999"
          step="0.01"
          required
        />
      </Field>
      <Field label="币种 *">
        <Select
          variant="box"
          ariaLabel="营业额币种"
          value={value.revenue_currency}
          onChange={(v) => set("revenue_currency", v)}
          options={[
            "CNY",
            "USD",
            "EUR",
            "GBP",
            "JPY",
            "HKD",
            "SGD",
            "AUD",
            "CAD",
          ].map((v) => ({ value: v, title: v }))}
        />
      </Field>
      <Field label="营业额所属年份 *">
        <input
          type="number"
          min="2000"
          max={new Date().getFullYear()}
          value={value.revenue_year}
          onChange={(e) => set("revenue_year", Number(e.target.value))}
          required
        />
      </Field>
      <Field label="公司地址 *">
        <input
          value={value.address}
          onChange={(e) => set("address", e.target.value)}
          required
          maxLength={600}
          autoComplete="street-address"
        />
      </Field>
      <Field label="税号（非必填）">
        <input
          value={value.tax_id}
          onChange={(e) => set("tax_id", e.target.value)}
          maxLength={100}
        />
      </Field>
    </div>
  );
}
