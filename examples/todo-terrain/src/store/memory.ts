// In-memory store. The Map declares `region store: Postgres`; this first
// Terrain keeps rows in memory instead (see the Amendment in the PR that
// added it). Insertion order is preserved, as a table with a serial key
// would.

import type { Todo, TodoId, TodoStore } from "../domain.ts";

/** @nindub state todos */
export class MemoryTodoStore implements TodoStore {
  private readonly rows = new Map<TodoId, Todo>();

  get(id: TodoId): Todo | undefined {
    return this.rows.get(id);
  }
  insert(todo: Todo): void {
    this.rows.set(todo.id, { ...todo });
  }
  update(todo: Todo): void {
    if (!this.rows.has(todo.id)) throw new Error(`no todo ${todo.id}`);
    this.rows.set(todo.id, { ...todo });
  }
  remove(id: TodoId): void {
    this.rows.delete(id);
  }
  all(): Todo[] {
    return [...this.rows.values()].map((t) => ({ ...t }));
  }
  clear(): void {
    this.rows.clear();
  }
}
