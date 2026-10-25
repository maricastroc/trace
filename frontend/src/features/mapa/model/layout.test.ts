import { describe, expect, it } from "vitest";
import { dataset, relation, version } from "./fixtures";
import { buildMapModel } from "./graph";
import {
  CARD_W,
  COL_GAP,
  computeLayout,
  fieldCenter,
  fitInto,
  frameCamera,
  freeArea,
  HEAD_H,
  linkGeometry,
  lodFor,
  placeMarks,
  pointOnCurve,
  routeBetween,
  sheetHeight,
  sheetView,
  showsAllFields,
  showsVolumeRuler,
  zoomAround,
  type SheetGeometry,
} from "./layout";

const chain = buildMapModel(
  [dataset("atendimentos", 9756), dataset("beneficiarios", 1248), dataset("cozinhas", 12)],
  {
    "v-atendimentos": version("atendimentos", [{ key: "id" }, { key: "beneficiario_id", profile: { unique: false } }, { key: "data", type: "date" }]),
    "v-beneficiarios": version("beneficiarios", [{ key: "id" }, { key: "cozinha_id", profile: { unique: false } }, { key: "nome", type: "text" }]),
    "v-cozinhas": version("cozinhas", [{ key: "id" }, { key: "nome", type: "text" }]),
  },
  [relation("ab", ["atendimentos", "beneficiario_id"], ["beneficiarios", "id"]), relation("bc", ["beneficiarios", "cozinha_id"], ["cozinhas", "id"])],
);

describe("computeLayout", () => {
  it("places referenced tables to the left of the tables that point to them", () => {
    const layout = computeLayout(chain).positions;
    expect(layout.cozinhas.x).toBe(0);
    expect(layout.beneficiarios.x).toBe(CARD_W + COL_GAP);
    expect(layout.atendimentos.x).toBe(2 * (CARD_W + COL_GAP));
  });

  it("keeps positions stable when a relation is rejected", () => {
    const rejected = { ...chain, relations: chain.relations.map((r) => ({ ...r, status: "rejected" as const })) };
    expect(computeLayout(rejected).positions).toEqual(computeLayout(chain).positions);
  });
});

function wideTables(count: number, columnsEach: number) {
  const keys = Array.from({ length: count }, (_, i) => `t${i}`);
  return buildMapModel(
    keys.map((key, i) => dataset(key, 10 ** (i + 1))),
    Object.fromEntries(keys.map((key) => [`v-${key}`, version(key, Array.from({ length: columnsEach }, (_, c) => ({ key: c === 0 ? "id" : `c${c}`, type: "text" as const })))])),
    keys.slice(1).map((key) => relation(`r-${key}`, [key, "c1"], ["t0", "id"])),
  );
}

describe("field budget and ruler", () => {
  it("shows every field of a small map, with no hidden fields button", () => {
    const small = wideTables(2, 4);
    expect(showsAllFields(small.tables)).toBe(true);
    expect(computeLayout(small).allFields).toBe(true);
    const view = sheetView(small.tables[1], "detail", false, true);
    expect(view.columns).toHaveLength(4);
    expect(view.showMore || view.showLess).toBe(false);
  });

  it("keeps only the relevant fields when tables are wide or stacks get too tall", () => {
    expect(showsAllFields(wideTables(2, 9).tables)).toBe(false);
    const stacked = wideTables(3, 6);
    expect(showsAllFields(stacked.tables)).toBe(true);
    expect(computeLayout(stacked).allFields).toBe(false);
  });

  it("places any number of tables without overlapping cards", () => {
    for (const count of [1, 2, 5, 9]) {
      const model = wideTables(count, 3);
      const { positions, allFields } = computeLayout(model);
      const rects = model.tables.map((t) => ({ ...positions[t.key], w: CARD_W, h: sheetHeight(sheetView(t, "detail", false, allFields), "detail") }));
      expect(rects).toHaveLength(count);
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
          expect(overlap).toBe(false);
        }
    }
  });

  it("shows the volume ruler only when tables differ by two orders of magnitude", () => {
    expect(showsVolumeRuler(wideTables(2, 3).tables)).toBe(false);
    expect(showsVolumeRuler(wideTables(3, 3).tables)).toBe(true);
    expect(showsVolumeRuler(wideTables(1, 3).tables)).toBe(false);
  });
});

describe("sheet views", () => {
  const table = chain.byKey.get("beneficiarios")!;

  it("shows only the relevant fields in detail, with a button for the rest", () => {
    const view = sheetView(table, "detail", false);
    expect(view.columns.map((c) => c.key)).toEqual(["id", "cozinha_id"]);
    expect(view).toMatchObject({ hidden: 1, showMore: true, showLess: false });
    expect(sheetHeight(view, "detail")).toBe(HEAD_H.detail + 6 + 2 * 46 + 38 + 10);
    expect(fieldCenter(view, "detail", "cozinha_id")).toBe(HEAD_H.detail + 6 + 46 + 23);
    expect(fieldCenter(view, "detail", "nome")).toBeNull();
  });

  it("hides fields in the overview and shows all of them when expanded", () => {
    expect(sheetHeight(sheetView(table, "overview", false), "overview")).toBe(HEAD_H.overview);
    const expanded = sheetView(table, "overview", true);
    expect(expanded.columns).toHaveLength(3);
    expect(expanded.showLess).toBe(true);
  });
});

describe("link geometry", () => {
  const layout = computeLayout(chain).positions;
  const sheets: Record<string, SheetGeometry> = Object.fromEntries(
    chain.tables.map((t) => {
      const view = sheetView(t, "detail", false);
      return [t.key, { rect: { ...layout[t.key], w: CARD_W, h: sheetHeight(view, "detail") }, view, lod: "detail" as const }];
    }),
  );

  it("leaves the source from the side facing the target, at the field row", () => {
    const geometry = linkGeometry(chain.relations[1], sheets, chain.relations)!;
    expect(geometry.dir).toBe(-1);
    expect(geometry.loop).toBe(false);
    expect(geometry.curve.p0).toEqual({ x: layout.beneficiarios.x, y: layout.beneficiarios.y + HEAD_H.detail + 6 + 46 + 23 });
    expect(geometry.curve.p1.x).toBe(CARD_W);
  });

  it("detours around a card that blocks the straight curve", () => {
    const curve = routeBetween({ x: 0, y: 100 }, { x: 1000, y: 100 }, 1, [{ x: 400, y: 50, w: 200, h: 100 }]);
    expect(curve.c1.y).not.toBe(100);
    const middle = pointOnCurve(curve, 0.5);
    expect(middle.y < 50 || middle.y > 150).toBe(true);
  });

  it("spreads relation marks so they do not overlap", () => {
    const curve = { p0: { x: 0, y: 0 }, c1: { x: 500, y: 0 }, c2: { x: 500, y: 0 }, p1: { x: 1000, y: 0 } };
    const marks = placeMarks([{ id: "a", curve }, { id: "b", curve }]);
    expect(Math.hypot(marks.a.x - marks.b.x, marks.a.y - marks.b.y)).toBeGreaterThan(60);
  });
});

describe("frameCamera", () => {
  const area = { x: 24, y: 84, w: 816, h: 600 };
  const left = { x: 0, y: 0, w: 360, h: 300 };
  const right = { x: 530, y: 0, w: 360, h: 300 };

  it("keeps the camera when the selection is already visible", () => {
    expect(frameCamera({ s: 0.8, tx: 30, ty: 100 }, [left], [right], area)).toBeNull();
  });

  it("brings a hidden table back together with its neighbour, without zooming in", () => {
    const current = { s: 1.2, tx: 100, ty: 120 };
    const next = frameCamera(current, [right], [left], area)!;
    expect(next.s).toBeLessThanOrEqual(1.2);
    for (const r of [left, right]) {
      const x0 = r.x * next.s + next.tx;
      expect(x0).toBeGreaterThanOrEqual(area.x - 0.5);
      expect(x0 + r.w * next.s).toBeLessThanOrEqual(area.x + area.w + 0.5);
    }
  });

  it("only pans when the content fits at the current scale", () => {
    const next = frameCamera({ s: 0.8, tx: 300, ty: 120 }, [right], [left], area)!;
    expect(next.s).toBe(0.8);
    expect(right.x * 0.8 + next.tx + right.w * 0.8).toBeLessThanOrEqual(area.x + area.w);
  });

  it("gives up the neighbour before making the selection unreadable", () => {
    const far = { x: 4000, y: 0, w: 360, h: 300 };
    const next = frameCamera({ s: 1, tx: 0, ty: 100 }, [far], [left], area)!;
    expect(next.s).toBe(1);
    expect(far.x * next.s + next.tx).toBeGreaterThanOrEqual(area.x);
  });

  it("never shrinks below the comfortable scale just to show a neighbour", () => {
    const narrow = { x: 24, y: 84, w: 600, h: 600 };
    const next = frameCamera({ s: 1, tx: 300, ty: 100 }, [right], [left], narrow)!;
    expect(next.s).toBe(1);
    expect(right.x + next.tx + right.w).toBeLessThanOrEqual(narrow.x + narrow.w);
  });

  it("shows the top of a selection too large to fit comfortably, at the comfortable scale", () => {
    const tall = { x: 0, y: 0, w: 360, h: 2000 };
    const next = frameCamera({ s: 1, tx: 900, ty: 100 }, [tall], [], area)!;
    expect(next.s).toBe(0.8);
    expect(tall.y * next.s + next.ty).toBe(area.y);
  });

  it("does not zoom in when the user is already further out", () => {
    const next = frameCamera({ s: 0.5, tx: 900, ty: 100 }, [right], [left], area)!;
    expect(next.s).toBe(0.5);
  });
});

describe("freeArea", () => {
  const card = { x: 24, y: 20, w: 360, h: 300 };

  it("uses the space beside the paths card on wide screens", () => {
    const free = freeArea({ w: 1440, h: 800 }, card, { top: 84, bottom: 72, right: 0 });
    expect(free.x).toBe(card.x + card.w + 24);
    expect(free.x + free.w).toBe(1440 - 24);
  });

  it("uses the space below the card when the side is too narrow", () => {
    const free = freeArea({ w: 760, h: 900 }, card, { top: 84, bottom: 72, right: 0 });
    expect(free.y).toBe(card.y + card.h + 16);
    expect(free.x).toBe(24);
  });

  it("leaves out the side panel", () => {
    const free = freeArea({ w: 1440, h: 800 }, null, { top: 84, bottom: 72, right: 576 });
    expect(free.x + free.w).toBe(1440 - 576 - 24);
  });
});

describe("camera", () => {
  it("fits the content inside the free area and never zooms past the limit", () => {
    const camera = fitInto({ x: 0, y: 0, w: 100, h: 100 }, { x: 20, y: 100, w: 960, h: 650 }, 1.1);
    expect(camera.s).toBe(1.1);
    const large = fitInto({ x: 0, y: 0, w: 4000, h: 3000 }, { x: 0, y: 0, w: 1000, h: 800 }, 1.1);
    expect(large.s).toBeLessThan(0.5);
    expect(large.tx).toBeCloseTo(0);
  });

  it("keeps the point under the cursor fixed while zooming, within the scale limits", () => {
    const camera = zoomAround({ s: 1, tx: 0, ty: 0 }, 1.25, 200, 100);
    expect(camera.s).toBe(1.25);
    expect((200 - camera.tx) / camera.s).toBeCloseTo(200);
    expect(zoomAround({ s: 1.5, tx: 0, ty: 0 }, 4, 0, 0).s).toBe(1.6);
    expect(lodFor(0.4)).toBe("overview");
    expect(lodFor(0.6)).toBe("detail");
  });
});
