"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { backgroundPresets, GLASS_ALPHA_RANGE, GLASS_BLUR_RANGE, type ColorScheme, type ListView, type PageWidth } from "@/lib/appearance";
import { hubHref } from "@/lib/hub-data";
import { useAppearance } from "../appearance-provider";
import { BackgroundSwatch, ListViewSwatch, SchemeSwatch, Slider, Switch, WidthSwatch } from "../controls";
import { GlassCard, GlassLinkButton } from "../glass";
import { LargeTitleHeader } from "../large-title-header";
import { TextSizeTiles } from "./notes-settings";

const schemes: { id: ColorScheme; label: string }[] = [{ id: "system", label: "Automatisch" }, { id: "light", label: "Hell" }, { id: "dark", label: "Dunkel" }];
const listViews: { id: ListView; label: string }[] = [{ id: "minimal", label: "Minimalistisch" }, { id: "list", label: "Liste" }, { id: "tiles", label: "Kacheln" }, { id: "detail", label: "Detail" }];
const widths: { id: PageWidth; label: string }[] = [{ id: "standard", label: "Standard" }, { id: "xl", label: "Breit (XL)" }];

/** Profile › Appearance: every change applies live to the whole hub and is stored in this browser. */
export function AppearanceScreen({ preview, admin = false, freelancer = false }: { preview: boolean; admin?: boolean; freelancer?: boolean }) {
  const { appearance, update } = useAppearance();
  const profile = hubHref(preview, "settings");
  return (
    <>
      <LargeTitleHeader
        title="Darstellung"
        leading={<>
          <Link href={profile} className="on-bg-link"><ChevronLeft size={22} strokeWidth={2.5} aria-hidden="true" />Profil</Link>
          <GlassLinkButton href={profile}>Fertig</GlassLinkButton>
        </>}
      />
      <div className="appearance-stack section-first">
        <GlassCard aria-labelledby="appearance-scheme">
          <h2 className="t-headline" id="appearance-scheme">Erscheinungsbild</h2>
          <div className="swatch-grid">
            {schemes.map((scheme) => <SchemeSwatch key={scheme.id} scheme={scheme.id} label={scheme.label} selected={appearance.colorScheme === scheme.id} onSelect={() => update({ colorScheme: scheme.id })} />)}
          </div>
          <p className="t-footnote t-secondary">Automatisch folgt dem hellen oder dunklen Modus deines Geräts und wechselt mit ihm.</p>
        </GlassCard>

        <GlassCard aria-labelledby="appearance-width">
          <h2 className="t-headline" id="appearance-width">Breite</h2>
          <div className="swatch-grid list-swatches">
            {widths.map((width) => <WidthSwatch key={width.id} width={width.id} label={width.label} selected={appearance.pageWidth === width.id} onSelect={() => update({ pageWidth: width.id })} />)}
          </div>
          <p className="t-footnote t-secondary">Standard nutzt die ganze Fläche neben der Sidebar und wächst mit dem Bildschirm. Breit (XL) rückt wie ein Programm im Vollbild bis knapp an den Rand, auch nach unten. Auf Handy und Tablet bleibt alles gleich.</p>
        </GlassCard>

        {/* Notizen (22.11.2026): the same choice as „Aa“ on the notes page, per device. */}
        <GlassCard aria-labelledby="appearance-notes-text">
          <h2 className="t-headline" id="appearance-notes-text">Schriftgröße der Notizen</h2>
          <TextSizeTiles value={appearance.notesTextSize} onChange={(notesTextSize) => update({ notesTextSize })} />
          <p className="t-footnote t-secondary">Gilt nur auf diesem Gerät, für alle Notizen und in jeder Rolle; für andere ändert sich nichts. Titel, Abstände und Tabellen wachsen mit, und die Schreibfläche wird so breit, dass eine Zeile gleich viele Zeichen hat.</p>
        </GlassCard>

        {/* Every role has the files in these views since 27.11.2026 (customers under „Dateien“), so everyone gets the card. */}
        <GlassCard aria-labelledby="appearance-lists">
          <h2 className="t-headline" id="appearance-lists">Listen</h2>
          <div className="swatch-grid list-swatches">
            {listViews.map((view) => <ListViewSwatch key={view.id} view={view.id} label={view.label} selected={appearance.listView === view.id} onSelect={() => update({ listView: view.id })} />)}
          </div>
          <p className="t-footnote t-secondary">Minimalistisch zeigt je Zeile nur Symbol, Titel und Datum. Liste ordnet wie die Listenansicht im Finder: schmale Zeilen mit Name, Datum, Größe und Art, Ordner zum Aufklappen. Kacheln zeigt jede Datei als Karte, Logos und Bilder mit einem kleinen Vorschaubild; die Größe stellst du in der Liste unten rechts ein. Detail zeigt alle Spalten. Die Wahl gilt heute für {admin || freelancer ? "das Asset Management" : "die Dateien"} und später für weitere Listen. Oben rechts in der Liste lässt sie sich jederzeit umschalten.</p>
        </GlassCard>

        <GlassCard aria-labelledby="appearance-background">
          <h2 className="t-headline" id="appearance-background">Hintergrund</h2>
          <div className="swatch-grid">
            {backgroundPresets.map((preset) => <BackgroundSwatch key={preset.id} preset={preset} customColor={appearance.customColor} selected={appearance.backgroundPreset === preset.id} onSelect={() => update({ backgroundPreset: preset.id })} />)}
          </div>
          {appearance.backgroundPreset === "custom" && (
            <div className="settings-row">
              <label htmlFor="custom-color" className="t-body">Eigene Farbe</label>
              <input id="custom-color" type="color" className="color-input" value={appearance.customColor} onChange={(event) => update({ customColor: event.target.value })} />
            </div>
          )}
        </GlassCard>

        <GlassCard aria-labelledby="appearance-glass">
          <h2 className="t-headline" id="appearance-glass">Glas</h2>
          <Slider id="glass-alpha" label="Deckkraft" min={GLASS_ALPHA_RANGE.min} max={GLASS_ALPHA_RANGE.max} step={0.01} value={appearance.glassAlpha} onChange={(glassAlpha) => update({ glassAlpha })} format={(value) => `${Math.round(value * 100)} %`} />
          <Slider id="glass-blur" label="Unschärfe" min={GLASS_BLUR_RANGE.min} max={GLASS_BLUR_RANGE.max} step={1} value={appearance.glassBlur} onChange={(glassBlur) => update({ glassBlur })} format={(value) => `${value} px`} />
          <p className="t-footnote t-secondary">Mehr Deckkraft macht Texte und Zahlen besser lesbar, weniger zeigt mehr vom Hintergrund.</p>
        </GlassCard>

        <GlassCard>
          <div className="settings-row settings-row-flush">
            <label htmlFor="reduce-transparency" className="t-body">Transparenz reduzieren</label>
            <Switch id="reduce-transparency" checked={appearance.reduceTransparency} onChange={(reduceTransparency) => update({ reduceTransparency })} label="Transparenz reduzieren" />
          </div>
          <p className="t-footnote t-secondary">Ersetzt das Glas durch deckende Flächen, hell oder dunkel je nach Erscheinungsbild. Der Hintergrund bleibt sichtbar.</p>
        </GlassCard>

        <GlassCard>
          <div className="settings-row settings-row-flush">
            <label htmlFor="reduce-motion" className="t-body">Bewegung reduzieren</label>
            <Switch id="reduce-motion" checked={appearance.reduceMotion} onChange={(reduceMotion) => update({ reduceMotion })} label="Bewegung reduzieren" />
          </div>
          <p className="t-footnote t-secondary">Seiten erscheinen sofort, ohne nacheinander einzublenden. Auch Übergänge und andere Animationen entfallen.</p>
        </GlassCard>
      </div>
    </>
  );
}
