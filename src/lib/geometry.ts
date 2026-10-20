import type { PageLayout, Quad } from "../types";
export function unprojectPoint(
  point: [number, number],
  layout: Pick<PageLayout, "width" | "height" | "transform">,
  display: number[],
): [number, number] {
  const [a, b, c, d, e, f] = display,
    det = a * d - b * c;
  const x = point[0] - e,
    y = point[1] - f;
  const px = (d * x - c * y) / det,
    py = (-b * x + a * y) / det;
  const t = layout.transform;
  return [
    Math.max(0, Math.min(1, (t[0] * px + t[2] * py + t[4]) / layout.width)),
    Math.max(0, Math.min(1, (t[1] * px + t[3] * py + t[5]) / layout.height)),
  ];
}
export function projectPoint(
  point: [number, number],
  layout: Pick<PageLayout, "width" | "height" | "transform">,
  display: number[],
): [number, number] {
  const [a, b, c, d, e, f] = layout.transform,
    det = a * d - b * c;
  const x = point[0] * layout.width - e,
    y = point[1] * layout.height - f;
  const px = (d * x - c * y) / det,
    py = (-b * x + a * y) / det;
  return [
    display[0] * px + display[2] * py + display[4],
    display[1] * px + display[3] * py + display[5],
  ];
}
export function projectQuad(
  quad: Quad,
  layout: Pick<PageLayout, "width" | "height" | "transform">,
  display: number[],
) {
  const ps = quad.map((p) => projectPoint(p, layout, display));
  return {
    left: Math.min(...ps.map((p) => p[0])),
    top: Math.min(...ps.map((p) => p[1])),
    width: Math.max(...ps.map((p) => p[0])) - Math.min(...ps.map((p) => p[0])),
    height: Math.max(...ps.map((p) => p[1])) - Math.min(...ps.map((p) => p[1])),
  };
}
