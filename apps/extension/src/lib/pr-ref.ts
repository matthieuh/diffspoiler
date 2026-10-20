export type PrRef =
  | { host: 'github'; repo: string; number: number }
  | { host: 'gitlab'; projectPath: string; iid: number };

const GITHUB_PR = /^\/([^/]+\/[^/]+)\/pull\/(\d+)(?:\/|$)/;
const GITLAB_MR = /^\/(.+?)\/-\/merge_requests\/(\d+)(?:\/|$)/;

export function parsePrUrl(url: string): PrRef | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.hostname === 'github.com') {
    const match = GITHUB_PR.exec(parsed.pathname);
    return match ? { host: 'github', repo: match[1]!, number: Number(match[2]) } : null;
  }
  if (parsed.hostname === 'gitlab.com') {
    const match = GITLAB_MR.exec(parsed.pathname);
    return match ? { host: 'gitlab', projectPath: match[1]!, iid: Number(match[2]) } : null;
  }
  return null;
}

export function prKey(ref: PrRef): string {
  return ref.host === 'github' ? `github:${ref.repo}#${ref.number}` : `gitlab:${ref.projectPath}!${ref.iid}`;
}
