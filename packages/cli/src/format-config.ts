import type { ConfigGetResult, ConfigRule } from "../../protocol/gen/config-get-result.ts";

/** Settings first, then the tool rules in the order the daemon checks them. */
export function formatConfig(config: ConfigGetResult): string {
  const lines = [
    `config file      ${config.config_file}`,
    `default model    ${config.default_model}`,
    `log level        ${config.log_level}`,
    `session titles   ${config.session_titles ? "on" : "off"}`,
    `trusted projects ${config.trusted_projects.length > 0 ? config.trusted_projects.join(", ") : "none"}`,
  ];
  if (config.project_policy !== null && config.project_policy !== undefined) {
    const trust = config.project_trusted === true ? "trusted" : "not trusted, its allow rules are ignored";
    lines.push(`project policy   ${config.project_policy} (${trust})`);
  }
  lines.push("", "tool rules, first match wins:");
  const rows = config.rules.map((rule, index) => [String(index + 1), rule.action, ruleScope(rule), ruleNote(rule)]);
  const widths = [0, 1, 2].map((column) => rows.reduce((max, row) => Math.max(max, row[column]?.length ?? 0), 0));
  for (const row of rows) {
    const cells = row.map((cell, column) => (column < 3 ? cell.padEnd(widths[column] ?? 0) : cell));
    lines.push(`  ${cells.join("  ")}`.trimEnd());
  }
  return lines.join("\n");
}

function ruleScope(rule: ConfigRule): string {
  const parts = [rule.tool];
  if (rule.match !== null && rule.match !== undefined) {
    parts.push(`match "${rule.match}"`);
  }
  if (rule.path !== null && rule.path !== undefined) {
    parts.push(`path "${rule.path}"`);
  }
  return parts.join(" ");
}

function ruleNote(rule: ConfigRule): string {
  if (rule.ignored !== null && rule.ignored !== undefined) {
    return `${rule.source}, ignored: ${rule.ignored}`;
  }
  return rule.source;
}
