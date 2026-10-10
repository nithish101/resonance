import { useEffect, useRef } from "react";
import { flags, registerRenderer } from "../app/controller";
import { RenderHost } from "../app/renderHost";
import { setApp, useApp } from "../app/store";

/** The full-window canvas. The renderer lives in a worker when possible (RD-3). */
export function Stage() {
  const ref = useRef<HTMLDivElement>(null);
  const caps = useApp((s) => s.caps);

  useEffect(() => {
    if (!ref.current || !caps) return;
    const host = new RenderHost(ref.current, {
      caps,
      settings: useApp.getState().settings,
      force: flags.renderer,
      onStats: (render) => setApp({ render }),
      onInfo: (renderer) => setApp({ renderer }),
      onRecovered: () => setApp({ gpuRecoveries: useApp.getState().gpuRecoveries + 1 }),
    });
    registerRenderer(host);
    return () => {
      registerRenderer(null);
      host.dispose();
    };
  }, [caps]);

  return <div className="stage" ref={ref} />;
}
