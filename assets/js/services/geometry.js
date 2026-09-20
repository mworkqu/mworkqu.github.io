/* ── Geometry extraction ───────────────────────────────────
   Measures a CAD file **in this browser**. Nothing is uploaded; the
   numbers this produces are the only thing that may ever reach a
   provider, which is the whole reason it runs here.

   Loaders are fetched from a CDN on first use and only for the format
   actually picked, so opening the page costs nothing and a client who
   only ever uploads STLs never downloads the STEP kernel (a few MB of
   WebAssembly).

     STL          hand-written parser, below
     OBJ          hand-written parser, below
     3MF          three.js 3MFLoader (zip + XML)
     STEP / IGES  occt-import-js (OpenCascade, WASM)
     DXF          dxf-parser

   ── Every failure is soft ──
   A blocked CDN, an offline client, a corrupt file, a mesh too large
   to walk — each returns { ok:false, reason } and the classifier
   falls back to the extension rules. Geometry makes the answer
   better; its absence must never make the page worse.

   ── Units ──
   STL and OBJ carry none. Everything is reported in millimetres by
   assumption and flagged `unitsAssumed`, because being silently wrong
   by a factor of 25.4 is the worst outcome available here. */

window.GeometryService = (function () {

  /* Pinned versions. A floating tag would let a CDN update change
     what the classifier measures without a commit here. */
  const CDN = {
    occt:  'https://cdn.jsdelivr.net/npm/occt-import-js@0.0.23/dist/occt-import-js.js',
    dxf:   'https://cdn.jsdelivr.net/npm/dxf-parser@1.1.2/dist/dxf-parser.js',
    threeMF: 'three/addons/loaders/3MFLoader.js'   /* resolved by the page's import map */
  };

  /* Walking a very large mesh to find connected bodies is O(n) but
     with a big constant, and freezing the tab is a worse outcome than
     not knowing the body count. */
  const MAX_TRIANGLES_FOR_BODY_SPLIT = 250000;
  const LOAD_TIMEOUT_MS = 20000;

  const MESH_EXT  = ['stl', 'obj', '3mf'];
  const SOLID_EXT = ['step', 'stp', 'iges', 'igs'];
  const FLAT_EXT  = ['dxf'];

  function kindOf(ext) {
    if (MESH_EXT.indexOf(ext) !== -1)  return 'mesh';
    if (SOLID_EXT.indexOf(ext) !== -1) return 'solid';
    if (FLAT_EXT.indexOf(ext) !== -1)  return 'flat2d';
    return 'unknown';
  }

  const supports = (ext) => kindOf(ext) !== 'unknown';

  /* ── script loading ──────────────────────────────────── */

  const loaded = Object.create(null);

  function loadScript(url) {
    if (loaded[url]) return loaded[url];
    loaded[url] = new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = url;
      el.async = true;
      const timer = setTimeout(() => reject(new Error('timeout loading ' + url)), LOAD_TIMEOUT_MS);
      el.onload  = () => { clearTimeout(timer); resolve(true); };
      el.onerror = () => { clearTimeout(timer); reject(new Error('failed loading ' + url)); };
      document.head.appendChild(el);
    }).catch((err) => {
      /* Let the next attempt retry rather than caching the failure —
         a CDN blip should not disable geometry for the session. */
      delete loaded[url];
      throw err;
    });
    return loaded[url];
  }

  /* ── maths shared by every format ────────────────────── */

  /* positions: Float64Array|Array of x,y,z triples, 3 per triangle. */
  function measureTriangles(positions, triangleCount) {
    const box = {
      minX:  Infinity, minY:  Infinity, minZ:  Infinity,
      maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity
    };

    let area   = 0;
    let volume = 0;   /* signed, via the divergence theorem */

    for (let i = 0; i < triangleCount; i++) {
      const o = i * 9;
      const ax = positions[o],     ay = positions[o + 1], az = positions[o + 2];
      const bx = positions[o + 3], by = positions[o + 4], bz = positions[o + 5];
      const cx = positions[o + 6], cy = positions[o + 7], cz = positions[o + 8];

      if (ax < box.minX) box.minX = ax; if (ax > box.maxX) box.maxX = ax;
      if (bx < box.minX) box.minX = bx; if (bx > box.maxX) box.maxX = bx;
      if (cx < box.minX) box.minX = cx; if (cx > box.maxX) box.maxX = cx;
      if (ay < box.minY) box.minY = ay; if (ay > box.maxY) box.maxY = ay;
      if (by < box.minY) box.minY = by; if (by > box.maxY) box.maxY = by;
      if (cy < box.minY) box.minY = cy; if (cy > box.maxY) box.maxY = cy;
      if (az < box.minZ) box.minZ = az; if (az > box.maxZ) box.maxZ = az;
      if (bz < box.minZ) box.minZ = bz; if (bz > box.maxZ) box.maxZ = bz;
      if (cz < box.minZ) box.minZ = cz; if (cz > box.maxZ) box.maxZ = cz;

      /* Cross product of two edges: twice the triangle's area. */
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      area += Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;

      /* Signed volume of the tetrahedron to the origin. Summed over a
         closed surface this is the enclosed volume; over an open one
         it is meaningless, which is why it is clamped below. */
      volume += (ax * (by * cz - bz * cy)
               + ay * (bz * cx - bx * cz)
               + az * (bx * cy - by * cx)) / 6;
    }

    return { box: box, surfaceArea: area, volume: Math.abs(volume) };
  }

  /* Connected components over shared vertex positions. Quantised so
     that exported meshes, which repeat a vertex per triangle rather
     than indexing it, still join up. */
  function countBodies(positions, triangleCount) {
    if (triangleCount > MAX_TRIANGLES_FOR_BODY_SPLIT) return null;

    const parent = new Int32Array(triangleCount);
    for (let i = 0; i < triangleCount; i++) parent[i] = i;

    function find(a) {
      while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; }
      return a;
    }
    function union(a, b) {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent[rb] = ra;
    }

    const seen = new Map();
    const q = (v) => Math.round(v * 1000) / 1000;

    for (let i = 0; i < triangleCount; i++) {
      const o = i * 9;
      for (let v = 0; v < 3; v++) {
        const key = q(positions[o + v * 3]) + ',' +
                    q(positions[o + v * 3 + 1]) + ',' +
                    q(positions[o + v * 3 + 2]);
        const prev = seen.get(key);
        if (prev === undefined) seen.set(key, i);
        else union(prev, i);
      }
    }

    const roots = new Set();
    for (let i = 0; i < triangleCount; i++) roots.add(find(i));
    return roots.size;
  }

  /* ── STL ─────────────────────────────────────────────── */

  function parseSTL(buffer) {
    const view = new DataView(buffer);

    /* Binary STL declares its triangle count at byte 80. If that
       count matches the file length exactly, trust it — an ASCII file
       beginning "solid" can still be binary, so the length check is
       the reliable test, not the header text. */
    if (buffer.byteLength >= 84) {
      const n = view.getUint32(80, true);
      if (84 + n * 50 === buffer.byteLength && n > 0) {
        const positions = new Float64Array(n * 9);
        for (let i = 0; i < n; i++) {
          const o = 84 + i * 50 + 12;       /* skip the facet normal */
          for (let v = 0; v < 9; v++) {
            positions[i * 9 + v] = view.getFloat32(o + v * 4, true);
          }
        }
        return { positions: positions, triangleCount: n };
      }
    }

    const text  = new TextDecoder().decode(buffer);
    const nums  = [];
    const re    = /vertex\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      nums.push(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
    }
    const count = Math.floor(nums.length / 9);
    if (!count) throw new Error('no triangles found');
    return { positions: Float64Array.from(nums.slice(0, count * 9)), triangleCount: count };
  }

  /* ── OBJ ─────────────────────────────────────────────── */

  function parseOBJ(text) {
    const verts = [];
    const tris  = [];

    text.split('\n').forEach((line) => {
      const s = line.trim();
      if (s.startsWith('v ')) {
        const p = s.split(/\s+/);
        verts.push([parseFloat(p[1]), parseFloat(p[2]), parseFloat(p[3])]);
      } else if (s.startsWith('f ')) {
        const idx = s.split(/\s+/).slice(1).map((tok) => {
          const i = parseInt(tok.split('/')[0], 10);
          return i < 0 ? verts.length + i : i - 1;   /* OBJ indexes from 1 */
        });
        /* Fan-triangulate any n-gon. */
        for (let k = 1; k + 1 < idx.length; k++) tris.push([idx[0], idx[k], idx[k + 1]]);
      }
    });

    if (!tris.length) throw new Error('no faces found');
    const positions = new Float64Array(tris.length * 9);
    tris.forEach((t, i) => {
      for (let v = 0; v < 3; v++) {
        const p = verts[t[v]] || [0, 0, 0];
        positions[i * 9 + v * 3]     = p[0];
        positions[i * 9 + v * 3 + 1] = p[1];
        positions[i * 9 + v * 3 + 2] = p[2];
      }
    });
    return { positions: positions, triangleCount: tris.length };
  }

  /* ── 3MF (three.js) ──────────────────────────────────── */

  async function parse3MF(buffer) {
    const mod    = await import(/* webpackIgnore: true */ CDN.threeMF);
    const loader = new mod.ThreeMFLoader();
    const group  = loader.parse(buffer);

    const chunks = [];
    let total = 0;
    group.traverse((child) => {
      const g = child.geometry;
      if (!g || !g.attributes || !g.attributes.position) return;
      const pos = g.attributes.position;
      const idx = g.index;
      const n   = idx ? idx.count / 3 : pos.count / 3;
      const out = new Float64Array(n * 9);
      for (let i = 0; i < n; i++) {
        for (let v = 0; v < 3; v++) {
          const vi = idx ? idx.getX(i * 3 + v) : i * 3 + v;
          out[i * 9 + v * 3]     = pos.getX(vi);
          out[i * 9 + v * 3 + 1] = pos.getY(vi);
          out[i * 9 + v * 3 + 2] = pos.getZ(vi);
        }
      }
      chunks.push(out);
      total += n;
    });

    if (!total) throw new Error('no geometry in 3MF');
    const positions = new Float64Array(total * 9);
    let at = 0;
    chunks.forEach((c) => { positions.set(c, at); at += c.length; });
    return { positions: positions, triangleCount: total, bodyCount: chunks.length };
  }

  /* ── STEP / IGES (OpenCascade) ───────────────────────── */

  async function parseSolid(buffer, ext) {
    await loadScript(CDN.occt);
    if (typeof occtimportjs !== 'function') throw new Error('occt-import-js did not register');

    const occt  = await occtimportjs();
    const bytes = new Uint8Array(buffer);
    const res   = (ext === 'iges' || ext === 'igs')
      ? occt.ReadIgesFile(bytes, null)
      : occt.ReadStepFile(bytes, null);

    if (!res || !res.success || !res.meshes || !res.meshes.length) {
      throw new Error('could not read the solid model');
    }

    let total = 0;
    res.meshes.forEach((m) => { total += m.index.array.length / 3; });

    const positions = new Float64Array(total * 9);
    let at = 0;
    res.meshes.forEach((m) => {
      const p = m.attributes.position.array;
      const ix = m.index.array;
      for (let i = 0; i < ix.length; i += 3) {
        for (let v = 0; v < 3; v++) {
          const vi = ix[i + v] * 3;
          positions[at++] = p[vi];
          positions[at++] = p[vi + 1];
          positions[at++] = p[vi + 2];
        }
      }
    });

    /* A STEP file states its own bodies, so this is a real count
       rather than the connected-component guess a mesh needs. */
    return { positions: positions, triangleCount: total, bodyCount: res.meshes.length, exact: true };
  }

  /* ── DXF ─────────────────────────────────────────────── */

  async function parseDXF(text) {
    await loadScript(CDN.dxf);
    const Parser = window.DxfParser || (window.DxfParser && window.DxfParser.default);
    if (!Parser) throw new Error('dxf-parser did not register');

    const dxf = new Parser().parseSync(text);
    if (!dxf || !dxf.entities || !dxf.entities.length) throw new Error('no entities in DXF');

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const take = (x, y) => {
      if (typeof x !== 'number' || typeof y !== 'number') return;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    };

    dxf.entities.forEach((e) => {
      if (e.vertices) e.vertices.forEach((v) => take(v.x, v.y));
      if (e.center && typeof e.radius === 'number') {
        take(e.center.x - e.radius, e.center.y - e.radius);
        take(e.center.x + e.radius, e.center.y + e.radius);
      }
      if (e.position) take(e.position.x, e.position.y);
      if (e.startPoint) take(e.startPoint.x, e.startPoint.y);
      if (e.endPoint)   take(e.endPoint.x, e.endPoint.y);
    });

    if (!isFinite(minX)) throw new Error('no coordinates in DXF');

    /* A DXF is a profile, not a solid: it has no thickness at all,
       which is exactly what makes it a laser job. Reported as flat
       with an unknown thickness rather than a fabricated one. */
    return {
      flat2d: true,
      width:  maxX - minX,
      height: maxY - minY,
      entityCount: dxf.entities.length,
      blockCount: dxf.blocks ? Object.keys(dxf.blocks).length : 0
    };
  }

  /* ── deriving the features rules read ────────────────── */

  function featuresFromMesh(measured, triangleCount, bodyCount, settings) {
    const s = settings || {};
    const b = measured.box;

    const dims = [b.maxX - b.minX, b.maxY - b.minY, b.maxZ - b.minZ]
      .map((d) => (isFinite(d) ? d : 0));
    const sorted = dims.slice().sort((x, y) => x - y);
    const minDim = sorted[0], midDim = sorted[1], maxDim = sorted[2];

    const flatAspectMax  = s.flatAspectMax || 0.12;
    const flatMaxThick   = s.flatMaxThicknessMm || 10;
    const constTol       = s.constantThicknessTolerance || 0.35;

    const isFlat = maxDim > 0
      && minDim <= flatMaxThick
      && (minDim / maxDim) <= flatAspectMax;

    /* If the part really is a plate, volume divided by its footprint
       must come back to the thickness. When it does not, the section
       varies — a pocket, a boss, a taper — and a laser cannot cut it.
       An approximation, and named as one. */
    const footprint = midDim * maxDim;
    const effective = footprint > 0 ? measured.volume / footprint : 0;
    const constantThickness = isFlat && minDim > 0
      && Math.abs(effective - minDim) / minDim <= constTol;

    /* Surface area against the bounding box's own area. A cube scores
       1; anything curved, hollow or lattice-like scores well above. */
    const boxArea = 2 * (dims[0] * dims[1] + dims[1] * dims[2] + dims[0] * dims[2]);
    const surfaceRatio = boxArea > 0 ? measured.surfaceArea / boxArea : 0;

    return {
      hasGeometry: true,
      boundingBoxXMm: round(dims[0]),
      boundingBoxYMm: round(dims[1]),
      boundingBoxZMm: round(dims[2]),
      boundingBoxMaxMm: round(maxDim),
      minDimensionMm: round(minDim),
      volumeMm3: round(measured.volume),
      surfaceAreaMm2: round(measured.surfaceArea),
      surfaceRatio: round(surfaceRatio, 3),
      isFlat: isFlat,
      constantThickness: constantThickness,
      thicknessMm: isFlat ? round(minDim) : null,
      triangleCount: triangleCount,
      bodyCount: bodyCount
    };
  }

  function round(v, places) {
    const p = Math.pow(10, places === undefined ? 2 : places);
    return Math.round((v || 0) * p) / p;
  }

  /* ── the entry point ─────────────────────────────────── */

  async function extract(file, ext, settings) {
    const kind = kindOf(ext);
    if (kind === 'unknown') {
      return { ok: false, reason: 'unsupported_format', features: { hasGeometry: false } };
    }

    try {
      let parsed;
      let unitsAssumed = false;

      if (ext === 'stl') {
        parsed = parseSTL(await file.arrayBuffer());
        unitsAssumed = true;
      } else if (ext === 'obj') {
        parsed = parseOBJ(await file.text());
        unitsAssumed = true;
      } else if (ext === '3mf') {
        parsed = await parse3MF(await file.arrayBuffer());
      } else if (kind === 'solid') {
        parsed = await parseSolid(await file.arrayBuffer(), ext);
      } else if (kind === 'flat2d') {
        const d = await parseDXF(await file.text());
        return {
          ok: true,
          features: {
            hasGeometry: true,
            boundingBoxXMm: round(d.width),
            boundingBoxYMm: round(d.height),
            boundingBoxZMm: 0,
            boundingBoxMaxMm: round(Math.max(d.width, d.height)),
            minDimensionMm: 0,
            volumeMm3: 0,
            surfaceAreaMm2: round(d.width * d.height),
            surfaceRatio: 0,
            isFlat: true,
            constantThickness: true,
            thicknessMm: null,
            triangleCount: 0,
            bodyCount: d.blockCount || 1,
            entityCount: d.entityCount,
            unitsAssumed: true,
            profileOnly: true
          }
        };
      }

      const measured = measureTriangles(parsed.positions, parsed.triangleCount);
      const bodies = parsed.bodyCount !== undefined
        ? parsed.bodyCount
        : countBodies(parsed.positions, parsed.triangleCount);

      const features = featuresFromMesh(measured, parsed.triangleCount, bodies, settings);
      features.unitsAssumed = unitsAssumed;
      features.bodyCountExact = !!parsed.exact || parsed.bodyCount !== undefined;

      return { ok: true, features: features };

    } catch (err) {
      /* Soft by design. The classifier drops back to the extension
         rules and the user is told the geometry could not be read. */
      if (window.console) console.warn('[geometry] extraction failed', err);
      return {
        ok: false,
        reason: String((err && err.message) || err),
        features: { hasGeometry: false }
      };
    }
  }

  return { extract: extract, supports: supports, kindOf: kindOf };

})();
