import { useEffect } from "react";

const CSS = [
  "::-webkit-scrollbar{-webkit-appearance:none!important;height:10px!important;width:10px!important}",
  "::-webkit-scrollbar-track{background:#e8e8e8!important;border-radius:5px!important}",
  "::-webkit-scrollbar-thumb{background:#999!important;border-radius:5px!important;min-width:40px!important;min-height:40px!important}",
  "::-webkit-scrollbar-thumb:hover{background:#555!important}",
  "*{scrollbar-width:thin!important;scrollbar-color:#999 #e8e8e8!important}",
].join("\n");

/**
 * Force les scrollbars toujours visibles (macOS Chrome / Electron).
 * Injecte une balise <style> dans le <head> au montage du composant.
 */
export function useForceScrollbars() {
  useEffect(() => {
    const existing = document.getElementById("__force-scrollbars__");
    if (existing) return; // already injected
    const el = document.createElement("style");
    el.id = "__force-scrollbars__";
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => {
      const node = document.getElementById("__force-scrollbars__");
      if (node) node.remove();
    };
  }, []);
}
