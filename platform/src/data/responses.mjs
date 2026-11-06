import { requireThat, hash } from "../common/core.mjs";

// Namespaces group client-executed functions; their members must not enable hosted tools.
// https://developers.openai.com/api/reference/cli/resources/responses/methods/create
export function clientToolsOnly(tools) {
  const local = (tool) => tool && ["function", "custom"].includes(tool.type);
  return (
    Array.isArray(tools) &&
    tools.every(
      (tool) =>
        local(tool) ||
        (tool?.type === "namespace" &&
          typeof tool.name === "string" &&
          Array.isArray(tool.tools) &&
          tool.tools.every(local)),
    )
  );
}

// Flatten namespace groups for providers that only translate ordinary function tools.
// Restore the client's original namespace on output; prior calls must use the same mapping.
export function adaptClientTools(body) {
  requireThat(clientToolsOnly(body.tools || []), "remote_tools_forbidden");
  const flatName = (namespace, name) =>
    `tl_${hash(`${namespace}\0${name}`).slice(0, 16)}_${name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40)}`;
  const byFlat = new Map(),
    byOriginal = new Map();
  const occupied = new Set(
    (body.tools || []).filter((t) => t.type !== "namespace").map((t) => t.name),
  );
  const tools = (body.tools || []).flatMap((group) => {
    if (group.type !== "namespace") return [group];
    return group.tools.map((tool) => {
      const key = `${group.name}\0${tool.name}`;
      const name = flatName(group.name, tool.name);
      requireThat(
        !occupied.has(name) && !byOriginal.has(key),
        "duplicate_tool_name",
      );
      occupied.add(name);
      byFlat.set(name, { namespace: group.name, name: tool.name });
      byOriginal.set(key, name);
      return { ...tool, name };
    });
  });
  const flatten = (item, historical = false) => {
    if (!item?.namespace) return item;
    let name = byOriginal.get(`${item.namespace}\0${item.name}`);
    // Codex compaction sends tools: [] but retains prior MCP calls and outputs.
    // These are history, not executable tools. Preserve their deterministic names
    // without adding definitions or permitting an undeclared tool_choice.
    if (!name && historical) {
      requireThat(
        typeof item.namespace === "string" &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(item.namespace) &&
          typeof item.name === "string" &&
          /^[a-zA-Z0-9_-]{1,128}$/.test(item.name),
        "unsupported_tool_namespace",
      );
      name = flatName(item.namespace, item.name);
      requireThat(!occupied.has(name), "duplicate_tool_name");
    }
    requireThat(name, "unsupported_tool_namespace");
    const copy = { ...item, name };
    delete copy.namespace;
    return copy;
  };
  const calls = new Set(["function_call", "custom_tool_call"]);
  const request = {
    ...body,
    tools,
    input: body.input.map((item) =>
      calls.has(item.type) ? flatten(item, true) : item,
    ),
  };
  if (body.tool_choice && typeof body.tool_choice === "object")
    request.tool_choice =
      body.tool_choice.type === "allowed_tools"
        ? {
            ...body.tool_choice,
            tools: body.tool_choice.tools.map((item) => flatten(item)),
          }
        : flatten(body.tool_choice);
  return {
    request,
    hasNamespaces: byFlat.size > 0,
    restore(response) {
      return {
        ...response,
        output: response.output?.map((item) => {
          const original = calls.has(item.type) && byFlat.get(item.name);
          return original ? { ...item, ...original } : item;
        }),
      };
    },
  };
}

// A completed upstream response can be replayed as SDK events without estimating token usage.
// Reference: https://openai.com/index/unrolling-the-codex-agent-loop/
export function responseEventStream(response) {
  requireThat(
    response?.id &&
      Array.isArray(response.output) &&
      ["completed", "incomplete"].includes(response.status),
    "invalid_completed_response",
    502,
  );
  const events = [];
  const emit = (type, fields) =>
    events.push({ type, sequence_number: events.length, ...fields });
  const initial = {
    ...response,
    status: "in_progress",
    output: [],
    usage: null,
  };
  emit("response.created", { response: initial });
  emit("response.in_progress", { response: initial });
  for (const [output_index, item] of response.output.entries()) {
    const index = { output_index, item_id: item.id };
    const added = { ...item, status: "in_progress" };
    if (item.type === "message") added.content = [];
    if (item.type === "function_call") added.arguments = "";
    if (item.type === "custom_tool_call") added.input = "";
    if (item.type === "reasoning") added.summary = [];
    emit("response.output_item.added", { output_index, item: added });
    if (item.type === "message")
      for (const [content_index, part] of (item.content || []).entries()) {
        const fields = { ...index, content_index };
        const key = part.type === "refusal" ? "refusal" : "text";
        const stem = part.type === "refusal" ? "refusal" : "output_text";
        emit("response.content_part.added", {
          ...fields,
          part: { ...part, [key]: "" },
        });
        if (part[key])
          emit(`response.${stem}.delta`, { ...fields, delta: part[key] });
        emit(`response.${stem}.done`, { ...fields, [key]: part[key] || "" });
        emit("response.content_part.done", { ...fields, part });
      }
    if (item.type === "function_call") {
      emit("response.function_call_arguments.delta", {
        ...index,
        delta: item.arguments,
      });
      emit("response.function_call_arguments.done", {
        ...index,
        arguments: item.arguments,
      });
    }
    if (item.type === "custom_tool_call") {
      emit("response.custom_tool_call_input.delta", {
        ...index,
        delta: item.input,
      });
      emit("response.custom_tool_call_input.done", {
        ...index,
        input: item.input,
      });
    }
    if (item.type === "reasoning")
      for (const [summary_index, part] of (item.summary || []).entries()) {
        const fields = { ...index, summary_index };
        emit("response.reasoning_summary_part.added", {
          ...fields,
          part: { ...part, text: "" },
        });
        if (part.text)
          emit("response.reasoning_summary_text.delta", {
            ...fields,
            delta: part.text,
          });
        emit("response.reasoning_summary_text.done", {
          ...fields,
          text: part.text || "",
        });
        emit("response.reasoning_summary_part.done", { ...fields, part });
      }
    emit("response.output_item.done", { output_index, item });
  }
  emit(`response.${response.status}`, { response });
  return events
    .map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
    .join("");
}
