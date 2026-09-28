// region api — actions and queries.

import { type Deps, type Result, type Todo, type TodoId, type UserId, err, ok } from "../domain.ts";

const TITLE_MIN = 1;
const TITLE_MAX = 200;

/** @nindub action create at POST /todos */
export async function create(deps: Deps, user: UserId, title: string): Promise<Result<TodoId>> {
  const len = [...title].length;
  if (len < TITLE_MIN || len > TITLE_MAX) return err("InvalidTitle");
  const id = deps.freshId();
  deps.store.insert({ id, owner: user, title, done: false, created_at: deps.now() });
  return ok(id);
}

/** @nindub action complete at POST /todos/{id}/complete */
export async function complete(deps: Deps, user: UserId, id: TodoId): Promise<Result<null>> {
  const todo = deps.store.get(id);
  if (!todo) return err("NotFound");
  if (todo.owner !== user) return err("Forbidden");

  deps.store.update({ ...todo, done: true });

  const email = await deps.directory.email_of(user);
  if (email.ok) {
    await deps.mail.send({
      to: email.value,
      subject: `Done: ${todo.title}`,
      body: `You completed "${todo.title}".`,
    });
  }
  return ok(null);
}

/** @nindub action remove at DELETE /todos/{id} */
export async function remove(deps: Deps, user: UserId, id: TodoId): Promise<Result<null>> {
  const todo = deps.store.get(id);
  if (!todo) return err("NotFound");
  if (todo.owner !== user) return err("Forbidden");
  deps.store.remove(id);
  return ok(null);
}

/** @nindub query get at GET /todos/{id} */
export async function get(deps: Deps, user: UserId, id: TodoId): Promise<Result<Todo>> {
  const todo = deps.store.get(id);
  if (!todo) return err("NotFound");
  if (todo.owner !== user) return err("Forbidden");
  return ok(todo);
}

/** @nindub query list at GET /todos */
export async function list(deps: Deps, user: UserId): Promise<Todo[]> {
  return deps.store
    .all()
    .filter((t) => t.owner === user)
    .sort((a, b) => a.created_at - b.created_at);
}
