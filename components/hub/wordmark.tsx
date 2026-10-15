import Link from "next/link";
import Image from "next/image";

/** Original supplied artwork; never recreate or recolor the logo in CSS. */
export function BrandLogo({ className = "", preload = false }: { className?: string; preload?: boolean }) {
  return <Image src="/brand/oalab-logo.png" alt="oalab" width={876} height={777} className={`brand-logo ${className}`} sizes="(max-width: 760px) 300px, 480px" preload={preload} />;
}

export function Wordmark({ href = "/", light = false }: { href?: string; light?: boolean }) {
  return (
    <Link href={href} className={`wordmark${light ? " wordmark-light" : ""}`} aria-label="oalab Startseite">
      <span className="wordmark-symbol"><BrandLogo /></span>
      <span className="wordmark-name" aria-hidden="true">oalab</span>
    </Link>
  );
}
