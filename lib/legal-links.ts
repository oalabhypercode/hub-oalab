/**
 * Imprint and privacy policy of oalab. Both must be reachable from every page (§ 5 DDG, Art. 13 DSGVO); the
 * addresses are set per environment (NEXT_PUBLIC_IMPRINT_URL, NEXT_PUBLIC_PRIVACY_URL). Only https addresses
 * count; without one the link is left out rather than pointing nowhere.
 */
function httpsUrl(value: string | undefined) {
  const url = value?.trim() ?? "";
  return /^https:\/\/[^\s"<>]+$/i.test(url) ? url : "";
}

export const legalLinks = {
  imprint: httpsUrl(process.env.NEXT_PUBLIC_IMPRINT_URL),
  privacy: httpsUrl(process.env.NEXT_PUBLIC_PRIVACY_URL),
};
