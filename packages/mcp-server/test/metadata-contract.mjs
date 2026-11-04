import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const baseline = JSON.parse(readFileSync(new URL("./fixtures/input-contract.json", import.meta.url), "utf8"));

// Reviewed against the corresponding API workflows: these only transform
// supplied records. They still enqueue charged account work, so are not reads.
const suppliedDataTools = new Set([
  "agentseo_content_keyword_map",
  "agentseo_content_action_plan",
  "agentseo_serp_volatility",
  "agentseo_ai_visibility_prompt_set",
  "agentseo_content_programmatic_template",
  "agentseo_content_cannibalization",
  "agentseo_content_competitor_gap_matrix",
  "agentseo_backlinks_opportunity_finder",
]);

// Strip only schema annotations. In particular, preserve a parameter NAMED
// description, and keep default/enum/const values byte-for-byte equivalent.
export function withoutDescriptions(schema) {
  if (typeof schema === "boolean" || schema === null) return schema;
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (key === "description") continue;
    if (["properties", "patternProperties", "$defs", "definitions"].includes(key)) {
      result[key] = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, withoutDescriptions(child)]));
    } else if (["items", "additionalProperties", "propertyNames", "contains", "not", "if", "then", "else"].includes(key)) {
      result[key] = Array.isArray(value) ? value.map(withoutDescriptions) : withoutDescriptions(value);
    } else if (["anyOf", "oneOf", "allOf", "prefixItems"].includes(key)) {
      result[key] = value.map(withoutDescriptions);
    } else result[key] = value;
  }
  return result;
}

function assertDescription(node, path) {
  assert.equal(typeof node.description, "string", `${path}: missing description`);
  assert.ok(node.description.trim().length >= 30, `${path}: purpose/format description is too short`);
  assert.match(node.description, /Type:/, `${path}: document the value type`);
  if (Object.hasOwn(node, "default")) {
    assert.ok(node.description.includes(`Default: ${JSON.stringify(node.default)}.`), `${path}: document the actual default`);
  }
  for (const value of node.enum ?? []) {
    assert.ok(node.description.includes(JSON.stringify(value)), `${path}: missing enum value ${value}`);
  }
  if (node.format === "uri") assert.match(node.description, /absolute.*URL/i, `${path}: document the URL format`);
  if (node.pattern) assert.ok(node.description.includes(node.pattern), `${path}: document the actual format pattern`);
  if (typeof node.exclusiveMinimum === "number") {
    assert.ok(node.description.includes(`greater than ${node.exclusiveMinimum}`), `${path}: document the exclusive minimum`);
  }
  for (const [key, prefix] of [["minLength", "Minimum"], ["maxLength", "Maximum"], ["minItems", "Minimum"], ["maxItems", "Maximum"], ["minimum", "Minimum"], ["maximum", "Maximum"]]) {
    if (typeof node[key] === "number" && Math.abs(node[key]) !== Number.MAX_SAFE_INTEGER) {
      assert.ok(node.description.includes(`${prefix}: ${node[key]}`), `${path}: document ${key}=${node[key]}`);
    }
  }
}

function checkSchema(node, path, counts, depth = 0) {
  if (!node || typeof node !== "object") return;
  for (const [key, child] of Object.entries(node.properties ?? {})) {
    assertDescription(child, `${path}.${key}`);
    counts[depth === 0 ? "topLevelFields" : "nestedFields"] += 1;
    checkSchema(child, `${path}.${key}`, counts, depth + 1);
  }
  for (const key of ["items", "additionalProperties", "propertyNames"]) {
    const child = node[key];
    if (child && typeof child === "object" && !Array.isArray(child)) {
      assertDescription(child, `${path}.${key}`);
      counts.containerSchemas += 1;
      checkSchema(child, `${path}.${key}`, counts, depth + 1);
    }
  }
  for (const key of ["anyOf", "oneOf", "allOf"]) {
    for (const [i, child] of (node[key] ?? []).entries()) checkSchema(child, `${path}.${key}[${i}]`, counts, depth + 1);
  }
}

export function assertMetadataContract(tools) {
  assert.deepEqual(tools.map(t => t.name).sort(), Object.keys(baseline).sort(), "tool inventory must remain unchanged");
  assert.equal(new Set(tools.map(t => t.name)).size, 45);
  const counts = { tools: tools.length, topLevelFields: 0, nestedFields: 0, containerSchemas: 0 };
  for (const tool of tools) {
    const polling = tool.name === "agentseo_job_status";
    assert.deepEqual(tool.annotations, {
      readOnlyHint: false,
      destructiveHint: !polling,
      idempotentHint: polling,
      openWorldHint: !suppliedDataTools.has(tool.name),
    }, `${tool.name}: annotations must reflect credit use, retries and external access`);
    assert.deepEqual(withoutDescriptions(tool.inputSchema), baseline[tool.name], `${tool.name}: validation/defaults changed in a metadata-only patch`);
    checkSchema(tool.inputSchema, tool.name, counts);
    if (polling) assert.match(tool.description, /resume pending work.*does not debit credits again/);
    else assert.match(tool.description, /credits.*repeating.*charged work/);
  }
  assert.equal(counts.topLevelFields, 398);
  assert.equal(counts.nestedFields, 109);
  return counts;
}
