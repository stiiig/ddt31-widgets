"use client";

/**
 * HScrollbar — scrollbar horizontale personnalisée, TOUJOURS visible.
 * Utilise ResizeObserver pour garder le thumb à jour.
 */

import { useEffect, useRef, useCallback } from "react";

interface Props {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  className?: string;
}

export function HScrollbar({ scrollRef, className }: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);

  const updateThumb = useCallback(() => {
    const el    = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;

    const trackW    = track.clientWidth;
    const ratio     = trackW > 0 ? el.clientWidth / el.scrollWidth : 1;
    const thumbW    = Math.max(40, ratio * trackW);
    const maxScroll = el.scrollWidth - el.clientWidth;
    const thumbLeft = maxScroll > 0
      ? (el.scrollLeft / maxScroll) * (trackW - thumbW)
      : 0;

    thumb.style.width   = thumbW + "px";
    thumb.style.left    = thumbLeft + "px";
    // cache le thumb si pas de scroll possible (contenu rentre dans le conteneur)
    thumb.style.display = ratio >= 0.9999 ? "none" : "block";
  }, [scrollRef]);

  // Sync scroll → thumb
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // délai pour laisser le navigateur calculer les dimensions
    const timer = requestAnimationFrame(updateThumb);
    el.addEventListener("scroll", updateThumb, { passive: true });
    const ro = new ResizeObserver(updateThumb);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      cancelAnimationFrame(timer);
      el.removeEventListener("scroll", updateThumb);
      ro.disconnect();
    };
  }, [scrollRef, updateThumb]);

  // Drag thumb
  const handleThumbMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
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
      ev.preventDefault();
      const dx    = ev.clientX - startX;
      const ratio = maxLeft > 0 ? dx / maxLeft : 0;
      el.scrollLeft = Math.max(0, Math.min(maxScroll, startScroll + ratio * maxScroll));
    };
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup",   onUp);
      thumb.style.cursor = "grab";
    };
    thumb.style.cursor = "grabbing";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
  }, [scrollRef]);

  // Clic sur le track (hors thumb) → jump
  const handleTrackClick = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).classList.contains("hscrollbar-thumb")) return;
    const el    = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const rect   = track.getBoundingClientRect();
    const clickX = e.clientX - rect.left;
    const ratio  = clickX / rect.width;
    el.scrollLeft = ratio * (el.scrollWidth - el.clientWidth);
  }, [scrollRef]);

  return (
    <div
      ref={trackRef}
      className={`hscrollbar-track${className ? " " + className : ""}`}
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
