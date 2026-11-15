"use client";

import { useState } from "react";
import Link from "next/link";
import { Bot, Building2, KeyRound, LogOut, MessageCircleQuestion, Palette, Scale, ScrollText, ShieldCheck, Sparkles, UserCog, UserRound } from "lucide-react";
import { categories, categoriesFor, categoryLabel, type CategoryId } from "@/lib/categories";
import { appearanceHref, hubHref, previewAccount, sectionLabels } from "@/lib/hub-data";
import { packageCatalog } from "@/lib/service-packages";
import { LegalLinks } from "@/components/legal-links";
import { LEGAL_PATHS } from "@/lib/legal-links";
import { metricMeta, metricOrder } from "@/lib/hub-metrics";
import { HeaderActions } from "../app-shell";
import { MetricCard } from "../cards";
import { SearchField } from "../controls";
import { CategoryIcon, GlassCard, SectionHeader, TitleIcon } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { InsetGroupedList, ListRow } from "../list";
import { sectionIcons } from "../navigation";
import { useHubShell } from "../shell-context";
import { WhatsAppCard } from "../whatsapp-card";
import { NotificationSettingsCard } from "../notification-settings-card";
import { SecondFactorCard } from "../second-factor-card";
import type { ScreenProps } from "./types";

export function CategoryTitle({ category }: { category: CategoryId }) {
  return <span className="title-icon"><CategoryIcon category={category} size={24} /></span>;
}

export function CategoryMetrics({ model, category }: Pick<ScreenProps, "model"> & { category: CategoryId }) {
  const metrics = metricOrder.filter((id) => metricMeta[id].category === category);
  return <div className="metric-grid section-first">{metrics.map((id) => <MetricCard key={id} metric={model.metrics[id]} />)}</div>;
}

export function DiscoverScreen({ model, preview, populated, admin, freelancer }: ScreenProps) {
  const { openPanel, manageUsers } = useHubShell();
  const [query, setQuery] = useState("");
  const term = query.trim().toLowerCase();
  const shownCategories = categoriesFor(freelancer).filter((id) => categoryLabel(id, admin || freelancer).toLowerCase().includes(term) || (term && metricOrder.some((metric) => metricMeta[metric].category === id && metricMeta[metric].name.toLowerCase().includes(term))));
  const shownMetrics = term && populated ? metricOrder.filter((id) => metricMeta[id].name.toLowerCase().includes(term)) : [];
  const showInsights = sectionLabels.insights.toLowerCase().includes(term);
  return (
    <>
      <LargeTitleHeader title="Mehr" icon={<TitleIcon icon={sectionIcons.discover!} />} actions={<HeaderActions />} />
      <div className="section-first"><SearchField glass value={query} onChange={setQuery} placeholder="Bereiche und Kennzahlen" label="Bereiche und Kennzahlen durchsuchen" /></div>
      {shownMetrics.length > 0 && <>
        <SectionHeader title="Kennzahlen" />
        <InsetGroupedList label="Kennzahlen" className="list-icons">
          {shownMetrics.map((id) => <ListRow key={id} compact href={model.metrics[id].href} icon={<CategoryIcon category={metricMeta[id].category} size={24} />} title={metricMeta[id].name} trailing={<span className="numeric list-value">{model.metrics[id].value} {model.metrics[id].unit}</span>} />)}
        </InsetGroupedList>
      </>}
      {/* "Mehr" is the last tab on phones: first what the tab bar has no room for, as at the top of the sidebar. */}
      {showInsights && (
        <InsetGroupedList label="Insights" className="list-icons section-first">
          <ListRow compact href={hubHref(preview, "insights")} icon={<Sparkles size={24} color="var(--insights)" aria-hidden="true" />} title={sectionLabels.insights} subtitle="Zusammenfassung und Highlights" />
        </InsetGroupedList>
      )}
      <SectionHeader title="Bereiche" />
      {shownCategories.length ? (
        <InsetGroupedList label="Bereiche" className="list-icons">
          {shownCategories.map((id) => <ListRow key={id} compact href={hubHref(preview, categories[id].section)} icon={<CategoryIcon category={id} size={24} />} title={categoryLabel(id, admin || freelancer)} />)}
        </InsetGroupedList>
      ) : <GlassCard><p className="t-subheadline t-secondary">Keine Treffer für „{query}“.</p></GlassCard>}
      {/* The tab bar has no room for them, so phones reach the user management and the AI log from here. */}
      {/* Same split as the sidebar: admins find the patch notes under "Verwaltung", customers under "Neuigkeiten". */}
      <SectionHeader title={manageUsers ? "Verwaltung" : "Neuigkeiten"} />
      <InsetGroupedList label={manageUsers ? "Verwaltung" : "Neuigkeiten"} className="list-icons">
        {manageUsers && <ListRow compact href={hubHref(preview, "users")} icon={<UserCog size={24} color="var(--accent-text)" aria-hidden="true" />} title={sectionLabels.users} subtitle="Registrierungen, Zugänge und Kunden" />}
        {manageUsers && <ListRow compact href={hubHref(preview, "ai-log")} icon={<Bot size={24} color="var(--accent-text)" aria-hidden="true" />} title={sectionLabels["ai-log"]} subtitle="Vorschläge des Assistenten und was daraus wurde" />}
        {manageUsers && <ListRow compact href={hubHref(preview, "keychain")} icon={<KeyRound size={24} color="var(--accent-text)" aria-hidden="true" />} title={sectionLabels.keychain} subtitle="Zugänge und Passwörter, nur mit App-Code" />}
        <ListRow compact href={hubHref(preview, "patch-notes")} icon={<ScrollText size={24} color="var(--accent-text)" aria-hidden="true" />} title={sectionLabels["patch-notes"]} subtitle="Alle Änderungen am Hub, Paket für Paket" />
      </InsetGroupedList>
      <SectionHeader title="Konto" />
      <InsetGroupedList label="Konto" className="list-icons">
        <ListRow compact href={hubHref(preview, "settings")} icon={<UserRound size={24} color="var(--system-gray)" aria-hidden="true" />} title="Profil" />
        <ListRow compact href={appearanceHref(preview)} icon={<Palette size={24} color="var(--system-gray)" aria-hidden="true" />} title="Darstellung" />
        <ListRow compact onClick={() => openPanel("help")} icon={<MessageCircleQuestion size={24} color="var(--system-gray)" aria-hidden="true" />} title="Assistent & Hilfe" />
      </InsetGroupedList>
      {/* Phones and tablets reach imprint and privacy policy from here: two taps from every page (§ 5 DDG, Art. 13 DSGVO). */}
      <SectionHeader title="Rechtliches" />
      <InsetGroupedList label="Rechtliches" className="list-icons">
        <ListRow compact href={LEGAL_PATHS.imprint} icon={<Scale size={24} color="var(--system-gray)" aria-hidden="true" />} title="Impressum" />
        <ListRow compact href={LEGAL_PATHS.privacy} icon={<ShieldCheck size={24} color="var(--system-gray)" aria-hidden="true" />} title="Datenschutz" />
      </InsetGroupedList>
    </>
  );
}

/** What the user management keeps about this login and its customer, read-only for the customer. */
function AccountDetailsCard() {
  const { account } = useHubShell();
  const details = account.customerDetails;
  // The country alone (the default "Deutschland") is no address yet.
  const address = details && (details.street || details.city) ? [details.street, [details.postalCode, details.city].filter(Boolean).join(" "), details.country].filter(Boolean).join(", ") : "";
  const rows = [
    ["Name", account.name],
    ["Position", account.person?.position],
    ["Telefon", account.person?.phone],
    ["Unternehmen", account.company],
    ["Kundennummer", account.customerNumber],
    ["Pakete", account.packages.map((id) => packageCatalog[id].name).join(", ")],
    ["Anschrift", address],
    ["Kontakt", [details?.contactEmail, details?.phone].filter(Boolean).join(" · ")],
    ["Website", details?.website.replace(/^https?:\/\//, "")],
  ].filter((row): row is [string, string] => Boolean(row[1]));
  return (
    <GlassCard className="settings-card">
      <h2 className="t-headline settings-card-title"><Building2 size={20} color="var(--accent-text)" aria-hidden="true" />Deine Angaben</h2>
      <dl className="account-details">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={label === "Kundennummer" ? "numeric" : undefined}>{value}</dd></div>)}</dl>
      <p className="t-footnote t-secondary">Diese Angaben pflegt dein oalab-Team. Wenn sich etwas ändert, gib ihm einfach Bescheid.</p>
    </GlassCard>
  );
}

export function ProfileScreen({ preview, email }: ScreenProps & { email: string }) {
  const { openPanel, signOut, signingOut, logoutError, account } = useHubShell();
  return (
    <>
      <LargeTitleHeader title="Profil" icon={<TitleIcon icon={sectionIcons.settings!} />} actions={<HeaderActions />} />
      <div className="settings-grid section-first">
        {(account.person || account.company) && !account.admin && <AccountDetailsCard />}
        <GlassCard className="settings-card">
          <h2 className="t-headline settings-card-title"><KeyRound size={20} color="var(--accent-text)" aria-hidden="true" />Dein Konto</h2>
          <label className="settings-label" htmlFor="account-email">E-Mail-Adresse</label>
          <input id="account-email" className="account-input" readOnly value={preview ? previewAccount.email : email} />
          <p className="t-footnote t-secondary">{preview ? "Fiktives Beispielkonto für die Designvorschau." : "Die E-Mail-Adresse deines angemeldeten Kontos."}</p>
          <Link className="text-link" href="/auth/forgot-password">Passwort zurücksetzen</Link>
        </GlassCard>
        {!preview ? <SecondFactorCard /> : <GlassCard className="settings-card">
          <h2 className="t-headline settings-card-title"><ShieldCheck size={20} color="var(--accent-text)" aria-hidden="true" />Du siehst die Vorschau.</h2>
          <p className="t-subheadline t-secondary">Die Vorschau verwendet ausschließlich Beispieldaten. Melde dich an, um deinen persönlichen Workspace zu öffnen.</p>
          <Link className="text-link" href="/auth/login">Zur Anmeldung</Link>
        </GlassCard>}
        {!preview && <NotificationSettingsCard admin={account.admin} />}
        {!preview && <WhatsAppCard />}
      </div>
      <SectionHeader title="Einstellungen" />
      <InsetGroupedList label="Einstellungen" className="list-icons">
        <ListRow compact href={appearanceHref(preview)} icon={<Palette size={24} color="var(--system-gray)" aria-hidden="true" />} title="Darstellung" subtitle="Hell oder dunkel, Hintergrund, Glas und Bewegung" />
        <ListRow compact onClick={() => openPanel("help")} icon={<MessageCircleQuestion size={24} color="var(--system-gray)" aria-hidden="true" />} title="Assistent & Hilfe" />
        <ListRow compact onClick={signOut} icon={<LogOut size={24} color="var(--system-gray)" aria-hidden="true" />} title={preview ? "Vorschau verlassen" : signingOut ? "Wird abgemeldet …" : "Abmelden"} chevron={false} />
      </InsetGroupedList>
      {logoutError && <p role="alert" className="form-error stack-gap">{logoutError}</p>}
      <LegalLinks className="legal-links hub-legal-links" />
    </>
  );
}
