/** Fixed, colourful layer below all hub content; the glass surfaces float above it. */
export function BackgroundLayer() {
  return (
    <div className="background-layer" aria-hidden="true">
      <span className="background-orb background-orb-1" />
      <span className="background-orb background-orb-2" />
      <span className="background-orb background-orb-3" />
    </div>
  );
}
