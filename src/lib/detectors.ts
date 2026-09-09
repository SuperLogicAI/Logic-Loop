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
  { label: "Port in use", re: /\bEADDRINUSE\b|address already in use|port (?:\d+ )?(?:is )?already in use/i },
  { label: "Disk full", re: /\bENOSPC\b|No space left on device|disk (?:is )?full/i },
  { label: "Docker daemon down", re: /Cannot connect to the Docker daemon|Is the docker daemon running|docker daemon is not running/i },
  { label: "TLS/cert error", re: /\bCERT_HAS_EXPIRED\b|certificate has expired|SSL certificate problem|self.?signed certificate|unable to verify the first certificate|x509: certificate/i },
  { label: "Lock held", re: /\bELOCKED\b|Unable to acquire lock|another process has locked|Waiting for (?:the )?(?:cache )?lock|could not get lock/i },
];

export function detectBlockers(text: string): Detector[] {
  return DETECTORS.filter((d) => d.re.test(text));
}
