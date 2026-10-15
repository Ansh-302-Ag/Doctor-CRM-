"use client";

/**
 * A small 3D scene drawn on a 2D canvas — no WebGL, no library. Points live in
 * 3D, are rotated and perspective-projected each frame, then drawn back to
 * front, so near points are larger and brighter than far ones.
 *
 *   helix  — a DNA double helix with rungs (sign-in panel, calendar hero)
 *   sphere — a network globe: points on a sphere joined to their neighbours
 *            (the doctor's day, the board)
 *
 * The pointer tilts the scene. It pauses off screen and in a background tab,
 * and reduced-motion users get one still frame. Purely decorative: the canvas
 * is aria-hidden and takes no clicks.
 */
import { useEffect, useRef } from "react";
import { cn } from "@/components/lib/utils";

type P = [number, number, number];

function helix(): { pts: P[]; links: [number, number][] } {
  const pts: P[] = [], links: [number, number][] = [];
  const n = 42;
  for (let i = 0; i < n; i++) {
    const t = (i / (n - 1)) * Math.PI * 4;
    const y = (i / (n - 1)) * 2 - 1;
    pts.push([Math.cos(t) * 0.42, y * 1.15, Math.sin(t) * 0.42]);
    pts.push([Math.cos(t + Math.PI) * 0.42, y * 1.15, Math.sin(t + Math.PI) * 0.42]);
    const a = i * 2;
    if (i % 2 === 0) links.push([a, a + 1]);
    if (i > 0) links.push([a - 2, a], [a - 1, a + 1]);
  }
  return { pts, links };
}

function sphere(): { pts: P[]; links: [number, number][] } {
  const pts: P[] = [], links: [number, number][] = [];
  const n = 90, phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2, r = Math.sqrt(1 - y * y), t = phi * i;
    pts.push([Math.cos(t) * r * 0.95, y * 0.95, Math.sin(t) * r * 0.95]);
  }
  // Join each point to its near neighbours, once.
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const [a, b] = [pts[i], pts[j]];
      if ((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2 < 0.11) links.push([i, j]);
    }
  return { pts, links };
}

export function Scene3D({
  variant = "helix", className, color = "255 255 255", accent = "94 234 212", speed = 1,
}: { variant?: "helix" | "sphere"; className?: string; color?: string; accent?: string; speed?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const { pts, links } = variant === "helix" ? helix() : sphere();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0, h = 0, raf = 0, visible = true, angle = 0.6, last = performance.now();
    const tilt = { x: 0, y: 0, tx: 0, ty: 0 };

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth; h = canvas.clientHeight;
      canvas.width = Math.max(1, w * dpr); canvas.height = Math.max(1, h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    const frame = (now: number) => {
      const dt = Math.min(64, now - last); last = now;
      angle += dt * 0.00035 * speed;
      tilt.x += (tilt.tx - tilt.x) * 0.06; tilt.y += (tilt.ty - tilt.y) * 0.06;
      const ay = angle + tilt.y * 0.6, ax = (variant === "helix" ? 0.35 : 0.25) + tilt.x * 0.4;
      const [sy, cy, sx, cx] = [Math.sin(ay), Math.cos(ay), Math.sin(ax), Math.cos(ax)];
      const scale = Math.min(w, h) * (variant === "helix" ? 0.42 : 0.4);
      const proj = pts.map(([x, y, z]) => {
        // Rotate about Y, then X; perspective with the camera at z = 3.
        const x1 = x * cy - z * sy, z1 = x * sy + z * cy;
        const y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx;
        const k = 3 / (3 + z2);
        return { x: w / 2 + x1 * scale * k, y: h / 2 + y2 * scale * k, z: z2, k };
      });

      ctx.clearRect(0, 0, w, h);
      ctx.lineWidth = 1;
      for (const [a, b] of links) {
        const p = proj[a], q = proj[b];
        const depth = 1 - ((p.z + q.z) / 2 + 1) / 2; // 1 near, 0 far
        ctx.strokeStyle = `rgb(${color} / ${0.06 + depth * 0.32})`;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
      }
      const order = proj.map((p, i) => i).sort((i, j) => proj[j].z - proj[i].z);
      for (const i of order) {
        const p = proj[i];
        const depth = 1 - (p.z + 1) / 2;
        const r = (variant === "helix" ? 2.6 : 2) * p.k * (0.6 + depth);
        const tint = i % 7 === 0 ? accent : color;
        ctx.fillStyle = `rgb(${tint} / ${0.25 + depth * 0.75})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
        if (depth > 0.8 && i % 7 === 0) {
          ctx.fillStyle = `rgb(${accent} / 0.18)`;
          ctx.beginPath(); ctx.arc(p.x, p.y, r * 3.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      if (!reduce && visible && !document.hidden) raf = requestAnimationFrame(frame);
    };

    const start = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(frame); };
    const onMove = (e: PointerEvent) => {
      const b = canvas.getBoundingClientRect();
      tilt.ty = ((e.clientX - b.left) / Math.max(1, b.width) - 0.5) * 2;
      tilt.tx = ((e.clientY - b.top) / Math.max(1, b.height) - 0.5) * 2;
    };
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !reduce) start();
    });
    const ro = new ResizeObserver(() => { resize(); if (reduce) frame(performance.now()); });
    const onVis = () => { if (!document.hidden && visible && !reduce) start(); };

    resize();
    io.observe(canvas); ro.observe(canvas);
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("visibilitychange", onVis);
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [variant, color, accent, speed]);

  return <canvas ref={ref} aria-hidden="true" className={cn("pointer-events-none block h-full w-full", className)} />;
}
