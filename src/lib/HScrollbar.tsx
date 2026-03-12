"use client";

/**
 * HScrollbar — scrollbar horizontale personnalisée toujours visible.
 * Remplace la scrollbar native du navigateur (invisible sur macOS).
 *
 * Usage :
 *   const wrapRef = useRef<HTMLDivElement>(null);
 *   <HScrollbar scrollRef={wrapRef} />
 *   <div ref={wrapRef} style={{ overflowX: "hidden" }}>...</div>
 *
 * Le conteneur doit avoir overflowX: "hidden" (on gère le scroll via ce composant).
 * Le scroll trackpad fonctionne toujours via wheel events sur le conteneur.
 */

import { useEffect, useRef, useCallback, useState } from "react";

interface Props {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

export function HScrollbar({ scrollRef, className }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  // Recalcule taille/position du thumb
  const updateThumb = useCallback(() => {
    const el    = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;

    const ratio      = el.clientWidth / el.scrollWidth;
    const hasScroll  = ratio < 0.9999; // contenu plus large que le conteneur
    setVisible(hasScroll);
    if (!hasScroll) return;

    const trackW  = track.clientWidth;
    const thumbW  = Math.max(40, ratio * trackW);
    const maxScroll = el.scrollWidth - el.clientWidth;
    const thumbLeft = maxScroll > 0
      ? (el.scrollLeft / maxScroll) * (trackW - thumbW)
      : 0;

    thumb.style.width = thumbW + "px";
    thumb.style.left  = thumbLeft + "px";
  }, [scrollRef]);

  // Sync scroll → thumb position
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateThumb();
    el.addEventListener("scroll", updateThumb, { passive: true });
    const ro = new ResizeObserver(updateThumb);
    ro.observe(el);
    // also observe children in case table width changes
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => { el.removeEventListener("scroll", updateThumb); ro.disconnect(); };
  }, [scrollRef, updateThumb]);

  // Wheel sur le track → scroll le conteneur
  useEffect(() => {
    const track = trackRef.current;
    const el    = scrollRef.current;
    if (!track || !el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      el.scrollLeft += e.deltaX || e.deltaY;
    };
    track.addEventListener("wheel", onWheel, { passive: false });
    return () => track.removeEventListener("wheel", onWheel);
  }, [scrollRef]);

  // Wheel sur le conteneur (trackpad) → autoriser le scroll natif
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        e.preventDefault();
        el.scrollLeft += e.deltaX;
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [scrollRef]);

  // Drag thumb
  const handleThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const el    = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;

    const startX      = e.clientX;
    const startScroll = el.scrollLeft;
    const trackW      = track.clientWidth;
    const thumbW      = thumb.clientWidth;
    const maxScroll   = el.scrollWidth - el.clientWidth;
    const maxLeft     = trackW - thumbW;

    const onMove = (ev: MouseEvent) => {
      const dx    = ev.clientX - startX;
      const ratio = maxLeft > 0 ? dx / maxLeft : 0;
      el.scrollLeft = Math.max(0, Math.min(maxScroll, startScroll + ratio * maxScroll));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
      if (thumb) thumb.style.cursor = "grab";
    };
    thumb.style.cursor = "grabbing";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }, [scrollRef]);

  // Clic sur le track (hors thumb) → sauter à la position
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    const el    = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;
    // ignore si c'est un clic sur le thumb lui-même
    if (e.target === thumbRef.current) return;
    const rect   = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio  = clickX / rect.width;
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
  }, [scrollRef]);

  return (
    <div
      ref={trackRef}
      className={`hscrollbar-track${className ? " " + className : ""}${visible ? "" : " hscrollbar-track--hidden"}`}
      onClick={handleTrackClick}
    >
      <div
        ref={thumbRef}
        className="hscrollbar-thumb"
        onMouseDown={handleThumbMouseDown}
      />
    </div>
  );
}
