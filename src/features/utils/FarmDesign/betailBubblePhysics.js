const VIEWBOX_SIZE = 200;
const HEX_RADIUS = 88;
const CORE_RADIUS = 30;
const ROTATION_DURATION_MS = 34000;
const CENTER = { x: VIEWBOX_SIZE / 2, y: VIEWBOX_SIZE / 2 };

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const distance = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

const createVertex = (siteIndex) => {
  const angle = (Math.PI / 3) * siteIndex - Math.PI / 2;
  return {
    x: CENTER.x + HEX_RADIUS * Math.cos(angle),
    y: CENTER.y + HEX_RADIUS * Math.sin(angle),
  };
};

const TRIANGLES = Array.from({ length: 6 }, (_, siteIndex) => {
  const a = { ...CENTER };
  const b = createVertex(siteIndex);
  const c = createVertex(siteIndex + 1);
  return [a, b, c];
});

const EDGE_DATA = TRIANGLES.map((triangle) =>
  triangle.map((point, index) => {
    const next = triangle[(index + 1) % triangle.length];
    const ex = next.x - point.x;
    const ey = next.y - point.y;
    const len = Math.hypot(ex, ey) || 1;
    return {
      ax: point.x,
      ay: point.y,
      nx: -ey / len,
      ny: ex / len,
    };
  }),
);

const isValidSiteIndex = (siteIndex) => Number.isInteger(siteIndex) && siteIndex >= 0 && siteIndex < 6;

const computeVerticalGravityInLocalSpace = (rotationAngle, magnitude) => ({
  x: magnitude * Math.sin(rotationAngle),
  y: magnitude * Math.cos(rotationAngle),
});

export class BetailBubbleSimulator {
  constructor(items) {
    this.items = Array.isArray(items) ? items.filter((item) => isValidSiteIndex(item.siteIndex)) : [];
    this.elapsed = 0;
    this.bubbles = this.#createBubbles();
  }

  #createBubbles() {
    const countBySite = new Map();
    this.items.forEach((item) => {
      const current = countBySite.get(item.siteIndex) || 0;
      countBySite.set(item.siteIndex, current + 1);
    });

    const bubbles = [];
    this.items.forEach((item) => {
      const siteCount = countBySite.get(item.siteIndex) || 1;
      const radius = clamp(4.9 - (siteCount - 1) * 0.22, 3.0, 4.6);
      const position = this.#findPlacement(item.siteIndex, radius, bubbles);
      bubbles.push({
        id: item.id,
        avatarUrl: item.avatarUrl,
        siteIndex: item.siteIndex,
        radius,
        x: position.x,
        y: position.y,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        floatStrength: 3 + Math.random() * 2.3,
        phase: Math.random() * Math.PI * 2,
      });
    });

    return bubbles;
  }

  #findPlacement(siteIndex, radius, existingBubbles) {
    const minDistFromCore = CORE_RADIUS + radius + 2;
    const maxDist = HEX_RADIUS - radius - 3;
    const startAngle = (Math.PI / 3) * siteIndex - Math.PI / 2;
    const endAngle = (Math.PI / 3) * (siteIndex + 1) - Math.PI / 2;

    for (let attempt = 0; attempt < 260; attempt += 1) {
      const angle = startAngle + (endAngle - startAngle) * (0.08 + Math.random() * 0.84);
      const radial = minDistFromCore + Math.random() * Math.max(1, maxDist - minDistFromCore);
      const candidate = {
        x: CENTER.x + radial * Math.cos(angle),
        y: CENTER.y + radial * Math.sin(angle),
      };
      if (!this.#isInsideSite(candidate.x, candidate.y, radius, siteIndex)) continue;

      const overlapping = existingBubbles.some(
        (bubble) => distance(candidate.x, candidate.y, bubble.x, bubble.y) < radius + bubble.radius + 1.2,
      );
      if (!overlapping) return candidate;
    }

    const fallbackAngle = (startAngle + endAngle) / 2;
    const fallbackRadius = minDistFromCore + (maxDist - minDistFromCore) * 0.56;
    return {
      x: CENTER.x + fallbackRadius * Math.cos(fallbackAngle),
      y: CENTER.y + fallbackRadius * Math.sin(fallbackAngle),
    };
  }

  #isInsideSite(x, y, radius, siteIndex) {
    const edges = EDGE_DATA[siteIndex];
    if (!edges) return false;
    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const edge = edges[edgeIndex];
      const signedDistance = (x - edge.ax) * edge.nx + (y - edge.ay) * edge.ny;
      if (signedDistance < radius) return false;
    }
    const coreDistance = Math.hypot(x - CENTER.x, y - CENTER.y);
    return coreDistance >= CORE_RADIUS + radius + 1.2;
  }

  #resolveSiteBoundaries(bubble) {
    const edges = EDGE_DATA[bubble.siteIndex];
    if (!edges) return;

    for (let edgeIndex = 0; edgeIndex < edges.length; edgeIndex += 1) {
      const edge = edges[edgeIndex];
      const signedDistance = (bubble.x - edge.ax) * edge.nx + (bubble.y - edge.ay) * edge.ny;
      if (signedDistance >= bubble.radius) continue;

      const correction = bubble.radius - signedDistance + 0.04;
      bubble.x += edge.nx * correction;
      bubble.y += edge.ny * correction;

      const vn = bubble.vx * edge.nx + bubble.vy * edge.ny;
      if (vn < 0) {
        const restitution = 0.66;
        bubble.vx -= (1 + restitution) * vn * edge.nx;
        bubble.vy -= (1 + restitution) * vn * edge.ny;
      }
    }

    const dx = bubble.x - CENTER.x;
    const dy = bubble.y - CENTER.y;
    const dist = Math.hypot(dx, dy) || 1;
    const minCoreDist = CORE_RADIUS + bubble.radius + 1.2;
    if (dist < minCoreDist) {
      const nx = dx / dist;
      const ny = dy / dist;
      const correction = minCoreDist - dist + 0.04;
      bubble.x += nx * correction;
      bubble.y += ny * correction;
      const vn = bubble.vx * nx + bubble.vy * ny;
      if (vn < 0) {
        const restitution = 0.68;
        bubble.vx -= (1 + restitution) * vn * nx;
        bubble.vy -= (1 + restitution) * vn * ny;
      }
    }
  }

  #resolveBubbleCollisions() {
    for (let i = 0; i < this.bubbles.length; i += 1) {
      for (let j = i + 1; j < this.bubbles.length; j += 1) {
        const a = this.bubbles[i];
        const b = this.bubbles[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.0001;
        const minDist = a.radius + b.radius + 0.3;
        if (dist >= minDist) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;

        a.x -= nx * (overlap * 0.5);
        a.y -= ny * (overlap * 0.5);
        b.x += nx * (overlap * 0.5);
        b.y += ny * (overlap * 0.5);

        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const relVelocity = rvx * nx + rvy * ny;
        if (relVelocity >= 0) continue;

        const restitution = 0.74;
        const impulse = (-(1 + restitution) * relVelocity) / 2;
        a.vx -= impulse * nx;
        a.vy -= impulse * ny;
        b.vx += impulse * nx;
        b.vy += impulse * ny;
      }
    }
  }

  step(deltaSeconds, options = {}) {
    if (!this.bubbles.length) return;

    const dt = clamp(deltaSeconds, 1 / 200, 1 / 30);
    this.elapsed += dt;

    const rotate = Boolean(options.rotate);
    const rotationAngle = Number.isFinite(options.rotationAngle) ? options.rotationAngle : 0;
    const gravityMagnitude = rotate ? 28 : 0;

    this.bubbles.forEach((bubble) => {
      let ax = 0;
      let ay = 0;

      if (rotate) {
        const g = computeVerticalGravityInLocalSpace(rotationAngle, gravityMagnitude);
        ax = g.x;
        ay = g.y;
      } else {
        const t = this.elapsed + bubble.phase;
        ax = Math.sin(t * 0.9) * bubble.floatStrength * 0.52;
        ay = Math.cos(t * 0.7) * bubble.floatStrength * 0.4 - 0.26;
      }

      bubble.vx += ax * dt;
      bubble.vy += ay * dt;

      const drag = rotate ? 0.99 : 0.972;
      bubble.vx *= drag;
      bubble.vy *= drag;

      const maxSpeed = rotate ? 34 : 12;
      const speed = Math.hypot(bubble.vx, bubble.vy) || 0;
      if (speed > maxSpeed) {
        const scale = maxSpeed / speed;
        bubble.vx *= scale;
        bubble.vy *= scale;
      }

      bubble.x += bubble.vx * dt;
      bubble.y += bubble.vy * dt;
    });

    for (let pass = 0; pass < 2; pass += 1) {
      this.bubbles.forEach((bubble) => this.#resolveSiteBoundaries(bubble));
      this.#resolveBubbleCollisions();
    }
  }

  removeBubble(bubbleId) {
    this.bubbles = this.bubbles.filter((bubble) => bubble.id !== bubbleId);
  }

  getSnapshot() {
    return this.bubbles.map((bubble) => ({
      id: bubble.id,
      avatarUrl: bubble.avatarUrl,
      x: bubble.x,
      y: bubble.y,
      radius: bubble.radius,
      siteIndex: bubble.siteIndex,
    }));
  }
}

export {
  CENTER,
  CORE_RADIUS,
  ROTATION_DURATION_MS,
  VIEWBOX_SIZE,
};
