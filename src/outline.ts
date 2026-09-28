// Printing signatures, and the outline of a Map: the overview a reader gets
// from the top of the file, derived so that it is available even when a
// Map inlines its bodies.

import type * as ast from "./ast.ts";

export function printType(t: ast.Type): string {
  if (t.kind === "unit") return "()";
  return t.args.length ? `${t.name}<${t.args.map(printType).join(", ")}>` : t.name;
}

export function printParams(params: ast.Param[]): string {
  return `(${params.map((p) => `${p.name}: ${printType(p.type)}`).join(", ")})`;
}

export function printRegionKind(k: ast.RegionKind | null): string {
  if (!k) return "";
  return k.args.length ? `: ${k.name}(${k.args.join(", ")})` : `: ${k.name}`;
}

// One line per item, bodies omitted.
export function printSignature(item: ast.Item): string {
  switch (item.kind) {
    case "type":
      return `type ${item.name} = ${printType(item.type)}`;
    case "opaque":
      return `opaque ${item.name}`;
    case "struct":
      return `struct ${item.name} { ${item.fields.map((f) => `${f.name}: ${printType(f.type)}`).join(", ")} }`;
    case "enum":
      return `enum ${item.name} { ${item.variants
        .map((v) => (v.fields.length ? `${v.name}(${v.fields.map(printType).join(", ")})` : v.name))
        .join(", ")} }`;
    case "inject":
      return `inject ${item.name}: ${printType(item.type)}`;
    case "state":
      return `state ${item.name}: ${printType(item.type)}`;
    case "invariant":
      return `invariant ${JSON.stringify(item.description)}`;
    case "port":
      return `port ${item.name}`;
    case "effect":
      return `effect ${item.name} { ${item.fields.map((f) => `${f.name}: ${printType(f.type)}`).join(", ")} }`;
    case "action":
    case "query":
      return `${item.kind} ${item.name}${printParams(item.params)} -> ${printType(item.returns)}`;
    case "view":
      return `view ${item.name}${printParams(item.params)}`;
    case "region":
      return `region ${item.name}${printRegionKind(item.regionKind)}`;
    case "impl":
      return `impl ${item.path.join("::")}`;
  }
}

export interface OutlineOptions {
  // 1: regions and roads only. 2: also the items in each region. Default: everything.
  depth?: number;
}

export function outline(map: ast.MapDecl, options: OutlineOptions = {}): string {
  const depth = options.depth ?? Infinity;
  const lines: string[] = [`map ${map.name}`];
  const legend: ast.Item[] = [];

  const emitRegion = (r: ast.Region, indent: string, level: number) => {
    lines.push(`${indent}${printSignature(r)}`);
    for (const road of r.roads) lines.push(`${indent}  road ${road.name} -> ${road.to.join("::")}`);
    for (const item of r.items) {
      if (item.kind === "region") {
        if (level < depth) emitRegion(item, indent + "  ", level + 1);
        else lines.push(`${indent}  ${printSignature(item)}`);
      } else if (item.kind === "impl") {
        // impl blocks carry no new signatures
      } else if (depth >= 2) {
        lines.push(`${indent}  ${printSignature(item)}`);
        if (item.kind === "port") {
          for (const f of item.fns) {
            lines.push(`${indent}    fn ${f.name}${printParams(f.params)} -> ${printType(f.returns)}`);
          }
        }
      }
    }
  };

  for (const item of map.items) {
    if (item.kind === "region") {
      lines.push("");
      emitRegion(item, "", 1);
    } else if (item.kind !== "impl") {
      legend.push(item);
    }
  }

  if (legend.length && depth >= 2) {
    lines.push("", "legend");
    for (const item of legend) lines.push(`  ${printSignature(item)}`);
  }
  return lines.join("\n") + "\n";
}
