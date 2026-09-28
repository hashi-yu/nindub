// Terrain for examples/todo.nindub — domain types.
//
// This is the Terrain: the implementation the Map describes. It is written
// from the Map's outline. Where it realizes a Map element, a Pin comment
// (`@nindub ...`) says which one.

export type UserId = string;
export type TodoId = string;

/** @nindub struct Todo */
export interface Todo {
  id: TodoId;
  owner: UserId;
  title: string;
  done: boolean;
  created_at: number;
}

/** @nindub enum Error */
export type TodoError = "NotFound" | "Forbidden" | "InvalidTitle";

export type Result<T, E = TodoError> = { ok: true; value: T } | { ok: false; error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

/** @nindub enum DirectoryError */
export type DirectoryError = "Unknown" | "Unreachable";

/** @nindub effect SendMail */
export interface SendMail {
  to: string;
  subject: string;
  body: string;
}

// Everything the api region reaches through a road, injectable so that
// Survey can supply the clock, ids and port responses (D8).
export interface Deps {
  now(): number;
  freshId(): TodoId;
  store: TodoStore;
  /** @nindub port Directory */
  directory: { email_of(user: UserId): Promise<Result<string, DirectoryError>> };
  /** @nindub region mailer */
  mail: { send(m: SendMail): Promise<void> };
}

/** @nindub state todos */
export interface TodoStore {
  get(id: TodoId): Todo | undefined;
  insert(todo: Todo): void;
  update(todo: Todo): void;
  remove(id: TodoId): void;
  all(): Todo[];
  /** Back to the initial state; the harness protocol's reset. */
  clear(): void;
  /** Every state in the wire encoding: what `POST /__nindub/state` answers. */
  state(): Record<string, unknown>;
}
