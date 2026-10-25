export type Focus =
  | { kind: "result"; resultNo: number }
  | { kind: "others" }
  | { kind: "exclusions"; step: number; resultNo?: number }
  | { kind: "unreferenced"; step: number }
  | { kind: "row"; rowId: number }
  | { kind: "relationship"; id: string };

export function sameFocus(a: Focus | undefined, b: Focus) {
  return a !== undefined && JSON.stringify(a) === JSON.stringify(b);
}
