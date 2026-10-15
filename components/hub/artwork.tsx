export function ProjectArtwork({ variant = "orange", brand = "NORDLICHT" }: { variant?: "orange" | "sage" | "lilac"; brand?: string }) {
  return (
    <div className={`project-art project-art-${variant}`} aria-hidden="true">
      {variant === "orange" ? (
        <>
          <div className="art-caption">{brand}®<span>DESIGNED TO MOVE FORWARD.</span></div>
          <div className="orbit-sculpture">
            {Array.from({ length: 9 }, (_, i) => <i key={i} style={{ transform: `rotate(${i * 20}deg)` }} />)}
          </div>
          <div className="art-bottom"><span>Neue Perspektiven.</span><span>↗</span></div>
        </>
      ) : variant === "sage" ? (
        <><span className="art-small-label">{brand} / BRAND STUDY</span><div className="brand-sculpture">{brand.charAt(0).toLowerCase()}<span>®</span></div><span className="art-small-footer">A different kind of familiar.</span></>
      ) : (
        <><span className="art-small-label">A LITTLE MORE YOU.</span><div className="asterisk-sculpture">✳</div><span className="art-small-footer">{brand}. In guter Gesellschaft.</span></>
      )}
    </div>
  );
}
