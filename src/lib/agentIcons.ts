// Agent marks shared by the tab bar and the side panel's re-entry brief.
// `new URL(…, import.meta.url)` instead of `import x from "….svg"`: Vite
// bundles it the same way, and the Node-run checks that import SidePanel
// helpers can load this module without an .svg loader.
const icon = (file: string) => new URL(`../../agents/${file}.svg`, import.meta.url).href;

export interface AgentIcon {
  src: string;
  label: string;
}

export const AGENT_ICONS: Record<string, AgentIcon> = {
  antigravity: { src: icon("agy"), label: "Antigravity" },
  claude: { src: icon("claude"), label: "Claude" },
  codex: { src: icon("codex"), label: "Codex" },
  deepseek: { src: icon("dsh"), label: "DeepSeek" },
  opencode: { src: icon("opencode"), label: "OpenCode" },
  pi: { src: icon("pi"), label: "Pi" },
};
