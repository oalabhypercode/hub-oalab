/** The oalab service packages. Every customer holds at least one active package. */
export type ServicePackageId = "website-mail" | "website-lite" | "website-extra" | "website-max";

export const servicePackages: Record<ServicePackageId, { name: string }> = {
  "website-mail": { name: "Oalab-Website & Mail" },
  "website-lite": { name: "Oalab-Website lite" },
  "website-extra": { name: "Oalab-Website extra" },
  "website-max": { name: "Oalab-Website Max" },
};

export const SERVICE_PLATFORM_URL = "https://service.oalab.de";
