// `state todos`, kept in Nindub's store (D23): rows in the Map's shape,
// readable by Survey through `POST /__nindub/state`. The Map declares
// `region store: Postgres`; this Terrain uses the store's in-memory backend
// (Amendment 1, ruled discretion). Insertion order is preserved, as a table
// with a serial key would.

import { readFileSync } from "node:fs";
import { parse } from "../../../../src/parser.ts";
import { NindubStore } from "../../../../src/store.ts";
import type { Todo, TodoId, TodoStore } from "../domain.ts";

/** @nindub state todos */
export class NindubTodoStore implements TodoStore {
  private readonly store = new NindubStore(parse(readFileSync(new URL("../../../todo.nindub", import.meta.url), "utf8")));
  private readonly todos = this.store.table<Todo>("todos");

  get(id: TodoId): Todo | undefined {
    return this.todos.get(id);
  }
  insert(todo: Todo): void {
    this.todos.put(todo);
  }
  update(todo: Todo): void {
    if (!this.todos.has(todo.id)) throw new Error(`no todo ${todo.id}`);
    this.todos.put(todo);
  }
  remove(id: TodoId): void {
    this.todos.delete(id);
  }
  all(): Todo[] {
    return this.todos.all();
  }
  clear(): void {
    this.store.clear();
  }
  state(): Record<string, unknown> {
    return this.store.state();
  }
}
