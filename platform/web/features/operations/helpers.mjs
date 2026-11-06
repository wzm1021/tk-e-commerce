export const today = () => new Date().toISOString().slice(0, 10);
export const choices = (items, label) =>
  items.map((r) => ({ value: r.id, title: label(r) }));
