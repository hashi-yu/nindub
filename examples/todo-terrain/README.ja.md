# Todo Terrain

[English](README.md) | 日本語

[`../todo.nindub`](../todo.nindub) の Terrain。Map の俯瞰から書いた TypeScript のサービスで、ハーネスプロトコル([docs/SURVEY.ja.md](../../docs/SURVEY.ja.md))で Survey に応答し、製品としての本物のルートも持つ。依存なしで、Node が直接動かす。

```sh
node examples/todo-terrain/src/server.ts                       # 既定は PORT=3000
node src/cli.ts survey examples/todo.nindub --terrain http://127.0.0.1:3000 --steps 300
```

`npm test` は、この Terrain に対して 5 つのシードで各 300 ステップの Survey を回す。

## 構成と、Map との対応

| Map | Terrain |
|---|---|
| `region api: Service(ts)` | `src/api/todos.ts`(action と query)、`src/server.ts`(プロセス) |
| `region store: Postgres` | `src/store/memory.ts` — **Postgres ではなくメモリ。下の Amendment を参照** |
| `region directory: External`、`port Directory` | `src/domain.ts` の `Deps.directory`。本番のクライアントは `src/server.ts` |
| `region mailer: Outbound`、`effect SendMail` | `Deps.mail`。Survey 下ではデータとして出力、本番ではログ |
| `road sql -> store`、`road http -> directory`、`road mail -> mailer` | `Deps` の 3 つのフィールド |
| `inject clock`、`inject ids` | `Deps.now`、`Deps.freshId` |
| `region browser: Client` | 未実装(view にはブラウザの計器が要る) |

Map の要素を実現する関数や型には Pin のコメント `/** @nindub action create at POST /todos */` が付く。Pin は Terrain から Map を指す(D17)。Map はこのディレクトリに言及しない。

本物のルート(`POST /todos`、`GET /todos`、`GET /todos/{id}`、`POST /todos/{id}/complete`、`DELETE /todos/{id}`。ユーザーは `x-user` ヘッダ)とハーネスのエンドポイントは、`src/api/todos.ts` の同じ関数を呼ぶ。違うのは `Deps` だけである。

## Realize の記録

この Terrain を通すまでに Survey が見つけたことを、順に記す。

1. **シード 1、300 ステップ:Drift なし。** ロジックは最初の実行で一致した。
2. **シード 2、ステップ 6、`list("u1")`:結果に Drift。** Map は `[]` を返し、Terrain は 10 件の todo を返した。前のシードの実行で入った行だった。Survey は毎回 Map の初期状態から始めるが、Terrain にも同じことをさせる手段がなかった。Terrain ではなくハーネスの欠陥である。プロトコルに `POST /__nindub/reset` を追加し、Survey が実行前に呼ぶようにして修正した。
3. **シード 1〜5、各 300 ステップ:Drift なし。**

## Amendment 1:`region store` は `Postgres` と宣言されているが、この Terrain はメモリを使う

Map は `region store: Postgres` と言う。この Terrain は行をメモリ上の `Map` に持つ。ハーネスプロトコル越しの Survey にはこの違いは見えない(D22 が制約として明記している)。D21 の DB の計器ができれば見える。

選択肢は(D18):**採用**(Map を `region store: Store` に変えて Remap)、**却下**(この Terrain が Postgres のストアを持つ)、**裁量**。

**判断:裁量**(2026-09-28)。Map は `Postgres` のまま。本番で意図するストアを述べており、その意図は正しい。この例の Terrain はストアの代替品であり、ここにそう記す。Remap はしない。DB の計器ができたとき、`region store` を実現すると主張する Terrain は Postgres でなければならず、そうでなければ新たな Amendment を起こす。
