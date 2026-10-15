import { Wordmark } from "./wordmark";

export function HubLoading() {
  return <div className="hub-loading" role="status"><Wordmark /><p>Dein Workspace wird geladen …</p><span className="loading-line" /></div>;
}
