// Blocker detectors — run in the ingestion layer only. Each regex fires on
// hook tool_response text or raw transcript lines; matches become blocker
// rows deduped per (cwd, label) while unresolved.
export interface Detector {
  label: string;
  re: RegExp;
}

export const DETECTORS: Detector[] = [
  { label: "Permission denied", re: /permission denied|EACCES|EPERM/i },
  { label: "Tests failing", re: /\btests? (?:are )?fail(?:ing|ed)\b|\bFAILED \(|\b[1-9]\d* fail(?:ed|ures)/i },
  { label: "Merge conflict", re: /merge conflict|CONFLICT \(|Automatic merge failed/i },
  { label: "Rate limited", re: /rate.?limit(?:ed)?|429 Too Many Requests|overloaded_error/i },
  { label: "Missing file/module", re: /command not found|Cannot find module|ModuleNotFoundError|No such file or directory/i },
];

export function detectBlockers(text: string): Detector[] {
  return DETECTORS.filter((d) => d.re.test(text));
}
