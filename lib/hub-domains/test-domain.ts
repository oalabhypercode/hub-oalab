import type { CustomerDomain } from "./types";

/** The live and test website of one project („Projekte“), seen from „Vertrag & Domain“. Admins only. */
export type ProjectSite = {
  customerId: string;
  projectId: string;
  projectName: string;
  liveUrl: string | null;
  testUrl: string | null;
};

/**
 * Whether a customer's website has its own test domain, where every change lands before the customer approves it:
 * - `ok`: a test domain, apart from the live website;
 * - `live`: the stored test domain is the live website itself (same host as the live domain or a contract domain);
 * - `missing`: a website without test domain;
 * - null: no website of OALab's (no project with a domain, no domain hosted on Vercel), nothing to test.
 */
export type TestDomain =
  | { kind: "ok" | "live"; url: string; host: string; projectId: string; projectName: string }
  | { kind: "missing"; projectId: string | null; projectName: string | null };

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

/** The one test domain of a customer: the one of the live project first, like the head under „Projekte“. */
export function testDomainOf(sites: readonly ProjectSite[], domains: readonly CustomerDomain[]): TestDomain | null {
  const live = sites.find((site) => site.liveUrl) ?? null;
  const tested = live?.testUrl ? live : sites.find((site) => site.testUrl) ?? null;
  if (tested?.testUrl) {
    const host = hostOf(tested.testUrl);
    const liveHosts = new Set([...sites.flatMap((site) => site.liveUrl ? [hostOf(site.liveUrl)] : []), ...domains.map((domain) => domain.domain.replace(/^www\./, ""))]);
    return { kind: liveHosts.has(host) ? "live" : "ok", url: tested.testUrl, host, projectId: tested.projectId, projectName: tested.projectName };
  }
  const onVercel = domains.some((domain) => domain.details?.status !== "ended" && /vercel/i.test(domain.details?.websiteHost ?? ""));
  if (!live && !onVercel) return null;
  const website = live ?? sites[0] ?? null;
  return { kind: "missing", projectId: website?.projectId ?? null, projectName: website?.projectName ?? null };
}

/** The short warning of the tab and the customer list; null while the test domain is fine or not needed. */
export function testDomainAlert(test: TestDomain | null): string | null {
  if (!test || test.kind === "ok") return null;
  return test.kind === "missing" ? "Testdomain fehlt" : "Testdomain ist die Live-Website";
}
