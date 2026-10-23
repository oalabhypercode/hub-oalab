"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { backgroundPresets, GLASS_ALPHA_RANGE, GLASS_BLUR_RANGE } from "@/lib/appearance";
import { hubHref } from "@/lib/hub-data";
import { useAppearance } from "../appearance-provider";
import { BackgroundSwatch, Slider, Switch } from "../controls";
import { GlassCard, GlassLinkButton } from "../glass";
import { LargeTitleHeader } from "../large-title-header";

/** Profile › Appearance: every change applies live to the whole hub and is stored in this browser. */
export function AppearanceScreen({ preview }: { preview: boolean }) {
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
          <p className="t-footnote t-secondary">Ersetzt das Glas durch deckende weiße Flächen. Der Hintergrund bleibt sichtbar.</p>
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
