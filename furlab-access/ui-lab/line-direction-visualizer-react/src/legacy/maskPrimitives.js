export function morphErode(mask, w, h, radius) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let ok = 1;
      for (let dy = -radius; dy <= radius && ok; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h || !mask[ny * w + nx]) {
            ok = 0;
            break;
          }
        }
      }
      out[y * w + x] = ok;
    }
  }
  return out;
}

export function morphDilate(mask, w, h, radius) {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let hit = 0;
      for (let dy = -radius; dy <= radius && !hit; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          if (mask[ny * w + nx]) {
            hit = 1;
            break;
          }
        }
      }
      out[y * w + x] = hit;
    }
  }
  return out;
}

export function bfsCollectComponent(mask, visited, sx, sy, w, h, opts = {}) {
  const useDiagonal = !!opts.useDiagonal;
  const innerOnly = !!opts.innerOnly;
  const qx = [sx];
  const qy = [sy];
  const out = [];
  visited[sy * w + sx] = 1;
  let head = 0;

  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const i = y * w + x;
    out.push(i);

    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (!useDiagonal && dx !== 0 && dy !== 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (innerOnly) {
          if (nx < 1 || ny < 1 || nx >= w - 1 || ny >= h - 1) continue;
        } else {
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        }
        const ni = ny * w + nx;
        if (visited[ni] || !mask[ni]) continue;
        visited[ni] = 1;
        qx.push(nx);
        qy.push(ny);
      }
    }
  }

  return out;
}

export function bfsMaskComponent(mask, visited, sx, sy, w, h) {
  return bfsCollectComponent(mask, visited, sx, sy, w, h, { useDiagonal: true, innerOnly: true });
}

export function bfsComponent(mask, visited, sx, sy, w, h) {
  return bfsCollectComponent(mask, visited, sx, sy, w, h, { useDiagonal: false, innerOnly: false });
}

export function floodFillOuterMaskWithBlocker(blockMask, outerBgMask, w, h) {
  const qx = [];
  const qy = [];
  const push = (x, y) => {
    const i = y * w + x;
    if (blockMask[i] || outerBgMask[i]) return;
    outerBgMask[i] = 1;
    qx.push(x);
    qy.push(y);
  };

  for (let x = 0; x < w; x++) {
    push(x, 0);
    push(x, h - 1);
  }
  for (let y = 0; y < h; y++) {
    push(0, y);
    push(w - 1, y);
  }

  let head = 0;
  while (head < qx.length) {
    const x = qx[head];
    const y = qy[head];
    head++;
    const nbs = [[x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1]];
    for (let k = 0; k < nbs.length; k++) {
      const nx = nbs[k][0];
      const ny = nbs[k][1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (blockMask[ni] || outerBgMask[ni]) continue;
      outerBgMask[ni] = 1;
      qx.push(nx);
      qy.push(ny);
    }
  }
}

export function floodFillOuterOnTraversable(blockMask, outerBgMask, w, h) {
  floodFillOuterMaskWithBlocker(blockMask, outerBgMask, w, h);
}

export function floodFillOuterBackground(mainMask, outerBgMask, w, h) {
  floodFillOuterMaskWithBlocker(mainMask, outerBgMask, w, h);
}
