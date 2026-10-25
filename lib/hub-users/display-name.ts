/**
 * The name the hub greets a real login with: the person's name, else the company it represents (Service OALab
 * customers usually have no personal name, e.g. KalaClo), else the start of the e-mail address.
 */
export function accountDisplayName(person: { firstName: string; lastName: string } | null, company: string | null | undefined, email: string): string {
  return (person ? `${person.firstName} ${person.lastName}`.trim() : "") || company?.trim() || email.split("@")[0] || "Dein Konto";
}
