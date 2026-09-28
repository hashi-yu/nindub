# Nindub 言語

[English](LANGUAGE.md) | 日本語

**状態:草案。** 構文は例によって決める。現在の例は [`examples/todo.nindub`](../examples/todo.nindub) で、この文書はそのファイルに何が書いてあるかを説明する。パーサ、インタプリタ(`nindub run`)、俯瞰(`nindub outline`)はある。Survey はまだない。

## 見た目

Nindub は Rust のように読める。`struct`、`enum`、`fn`、`let`、`match`、`Result<T, E>`、クロージャ、`//` コメント。似せているのは意図的である([D16](DESIGN.ja.md#d16-構文は-rust-風にする) を参照)。違うのはトップレベルの語彙で、Map は関数とモジュールではなく、下の構文で組み立てる。それぞれが Survey の観測対象に対応している。

## 領土:region と road

Map は上から下へ読む。ファイルの先頭は**領土**である。どの region があり、それぞれに何が住み、何が何と話すか。本体は最後に `impl` ブロックとして置く。ファイルの最初の一画面がプロジェクト全体の俯瞰になる(D21)。

```rust
region api: Service(ts) {
    road sql  -> store;
    road http -> directory;

    action create(user: UserId, title: Text) -> Result<TodoId, Error>;
    query  list(user: UserId)                -> Vec<Todo>;
}

region store: Postgres {
    state todos: Table<Todo>;
    invariant "ids are unique";
}

impl api {
    action create(user: UserId, title: Text) -> Result<TodoId, Error> { ... }
    query  list(user: UserId) -> Vec<Todo> { ... }
}
```

- **region** は領土の区画である。ブラウザ、プロセス、データベース、外部サービス、送信チャネル。その中で宣言した要素はそこに住む。region は入れ子にできる(`region api { region todos { ... } }`、`impl api::todos { ... }`)。
- region の**種類**が、そこに何が住めるかと、Survey がどの計器で観測するかを決める。

  | 種類 | 住めるもの | 計器 |
  |---|---|---|
  | `Client` | `view` | ブラウザ(アクセシビリティツリー) |
  | `Service(lang)` | `action`、`query` | HTTP クライアント |
  | `Postgres`、`Store` | `state`、`invariant` | DB リーダー |
  | `External` | `port` | ネットワーク境界。リクエストを捕まえ、応答を注入する |
  | `Outbound` | `effect` | 送信境界。effect を捕まえ、実行はしない |

  型と `inject` はどこにでも置け、region の外にも置ける。種類のない region は何でも受け入れ、特定の計器では観測されない。
- **road** `road name -> region;` は、囲んでいる region がその region に到達してよいことを宣言する。本体が別の region の要素を使うなら、そこへの road が必要である(または一方が他方を含んでいること)。なければ解決に失敗する。road は、モジュールの依存を Map に書き、検査する手段である。
- 署名だけで宣言した要素(`action create(...) -> ...;`)は、その region の `impl` でちょうど一度、同じ署名で定義しなければならない。小さな Map は `impl` を使わず本体を直接書いてよい。
- 要素の名前は Map 全体で一意である。region は要素をまとめるが、名前空間にはしない。

`nindub outline file.nindub` は本体を省いた領土を表示する。`--depth 1` なら region と road だけ。導出なので、本体を直接書いた Map でも使える。

## トップレベルの構文

| 構文 | 宣言するもの | Survey が観測するもの |
|---|---|---|
| `map Name;` | Map の名前。1ファイルに1つ。 | — |
| `region name: Kind(args) { roads; items }` | 領土の区画と、そこに住むもの。 | 種類が指定する計器を通して |
| `road name -> region;` | 囲んでいる region が別の region に到達してよいこと。 | Terrain への依存制約として |
| `impl region { items }` | region が宣言した要素の本体。 | — |
| `struct`、`enum`、`type`、`opaque` | 型。`opaque` は Map が中身を見ない型(外部ディレクトリのユーザーなど)。 | — |
| `inject name: Kind;` | Map が必要とする非決定性の供給源。`Clock`、`IdSource`、`Random`。Survey が両側に与える(D8)。 | 与えた値 |
| `state name: Type;` | Map が保持する状態。何らかの query か view から到達できなければならない(D9)。 | 直接には決して見ない(D6) |
| `invariant "説明" { 式 }` | すべての action の後に成り立つべき条件。 | Map では直接検査。Terrain では query を通して |
| `action name(引数) -> Result<T, E> { ... }` | 状態を変えうる操作。 | 結果とエラーの種類 |
| `query name(引数) -> T { ... }` | 状態を変えずに読む操作。 | 結果 |
| `view Name(引数) { ... }` | 画面。何が表示され、何が操作できるか。 | その構造をデータとして |
| `effect Name { フィールド }` | 外界への副作用。`emit` で出力し、実行はしない。 | 出力された effect の列 |
| `port Name { fn ...; }` | 外部サービス。`Name.fn(...)` で呼ぶ。 | 送ったリクエスト。応答は注入される |

## 本体の中

- `requires 条件 else Error::Variant;` — 事前条件。満たさなければ指定したエラーを返す。エラーを宣言し、種類で比べられるようにする仕組み(D10)。
- `let x = 式 else Error::Variant;` — 束縛する。式が値を持たなければエラーで失敗する。
- `emit EffectName { ... };` — effect を記録する。
- `Port.fn(...)` — port にリクエストを送る。応答は Survey が注入したものになる。
- `inject` した値は `clock.now()`、`ids.fresh()` のように使う。
- コレクション:`Table<T>`(`id` で引く)に `get`、`insert`、`remove`、`filter`、`all`、`unique_by`、`sorted_by`。`Vec<T>`、`Option<T>`。

## view の中

view の本体は要素の列である。各要素は内容か操作のどちらかである。

| 要素 | 種類 |
|---|---|
| `heading(text)`、`text(text)`、`item(text, ...属性) { 子要素 }` | 内容 |
| `button(ラベル, action呼び出し)` | 操作:action を実行する |
| `form(ラベル, \|フィールド\| action呼び出し)` | 操作:入力を集めて action を実行する |
| `link(ラベル, View呼び出し)` | 操作:別の view へ移動する |
| `.then(View呼び出し)` | 操作の action の後に移動する |

制御構文(`if`、`for`、`match`)は普通に使える。view は query を呼べるが、action を直接呼ぶことはできない。action には操作を通してしか到達できないので、ユーザーにできることは view が宣言したものと正確に一致する。

## Map を単体で動かす

インタプリタは Terrain なしで Map を動かす。action・query・view への呼び出しはすべて **Observation** を返す。結果、出力された effect、port へのリクエストと注入された応答。

```
$ node src/cli.ts run examples/todo.nindub
> :port Directory.email_of Ok("alice@example.com")
> create("alice", "Buy milk")
{ "action": "create", "result": { "Ok": "id-1" } }
> complete("alice", "id-1")
{ "action": "complete", "result": { "Ok": null },
  "effects": [{ "to": "alice@example.com", "subject": "Done: Buy milk", "body": "You completed \"Buy milk\"." }],
  "ports": [{ "Directory.email_of": ["alice"], "response": { "Ok": "alice@example.com" } }] }
> List("alice")
```

REPL では文字列リテラルが id の代わりになる。id と時刻は決定的にカウントアップする注入源から来る。port の応答は `:port` で設定したものになる。

### 知っておくべき意味論

- **action は原子的である。** `Err` を返した場合、その action が行った状態変更と effect はすべて破棄される。不変条件は成功した action のたびに検査され、違反は action 自身の結果とは別に Map のバグとして報告される。
- **ローカル変数はスナップショットである。** `let todo = todos.get(id)` はコピーであり、その後の `todos[id].done = true` は `todo` を変えない。変更できるのは `state` だけで、state 名を根とする場所への代入か、state の Table への `insert`/`remove` を通してのみ変わる。
- **query は action を呼べない。** action は他の action を呼べる。その effect と port リクエストは呼び出し側の Observation に畳み込まれる。
- **view の中の action 呼び出しは操作(affordance)である。** `button("Done", complete(user, id))` は、ボタンがその引数で `complete` を呼ぶことを記録するだけで、何も実行しない。view の中の query 呼び出しは実行される。したがって view の描画は状態を変えず、effect も出さない。
- **`let x = e else err;`** は `Some`/`Ok` を剥がすか、囲んでいる action か query から `Err(err)` を返す。`requires c else err;` は `c` が偽なら `Err(err)` を返す。

## Pin は Terrain にあり、Map にはない

Map はファイル名、ルート、フレームワークを一切書かない。要素がどこで実現されるかは Terrain の裁量であり(D5)、Terrain が整理し直されたからといって Map が変わってはならない(D17)。したがって Pin は Terrain から Map を指す。逆ではない。

```ts
// src/api/todos.ts
/** @nindub action create at POST /todos */
export async function create(user: UserId, title: string) { ... }
```

- 注釈は、そのコードが実現する Map の要素を名指しする。
- どの計器で観測するかは、要素が住む region の種類から決まる(D21)。Pin ではない。Pin は action のルートや view の URL のような、計器に固有の詳細を添えてよい。

Nindub のツールは Pin を集め、Map の隣に索引を生成する(`todo.pins`。ロックファイルのようにコミットする)。Zoom は索引を読み、ビューアは Pin を Map に重ねて表示する。Projection は Map にある要素のシグネチャ、その region の種類、Pin にある詳細から生成する(D7)。

## Amendment(改訂提案)

Realize の途中で、AI は Map が間違っている、足りない、沈黙している箇所を見つける。AI は Map を編集しない。Amendment を提出する。Map への diff に理由を添え、さらに現在の Terrain を改訂前の Map に対して Survey した結果を添えて、その変更が許すことになる振る舞いが見えるようにする。人間は採用(Remap:Map が変わる)、却下(Terrain を直す)、裁量(Map は意図的に沈黙したままにする)のいずれかを選ぶ。D17 と D18 を参照。

## まだ設計していないもの

- `event`:非同期に到着する入力(webhook、タイマー)。D6 の非同期の扱いに必要。
- セッションと認証:今は `user: UserId` をすべての引数に明示的に渡している。
- モジュール:Map は1ファイルだが、大きな Map をどう区切るかは未定。
- Terrain 側での `browser(...)` の観測の形(アクセシビリティツリーが候補)。
