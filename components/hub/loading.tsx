import { BackgroundLayer } from "./background-layer";
import { SkeletonCards } from "./glass";

/** Page-level fallback inside the shell: skeleton glass cards in the same style. */
export function HubContentLoading() {
  return (
    <div role="status" aria-label="Dein Workspace wird geladen">
      <div className="skeleton-title" aria-hidden="true"><span className="skeleton-bar" /><span className="skeleton-bar" /></div>
      <SkeletonCards count={4} />
    </div>
  );
}

/** Layout-level fallback before the shell exists; brings its own background so nothing flashes. */
export function HubLoading() {
  return (
    <div className="hub-app">
      <BackgroundLayer />
      <div className="hub-main hub-main-loading"><div className="hub-content"><HubContentLoading /></div></div>
    </div>
  );
}
