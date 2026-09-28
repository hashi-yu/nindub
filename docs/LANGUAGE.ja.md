# Nindub 言語

[English](LANGUAGE.md) | 日本語

**状態:草案。** 構文は例によって決める。現在の例は [`examples/todo.nindub`](../examples/todo.nindub) で、この文書はそのファイルに何が書いてあるかを説明する。まだ何も実装されていない。

## 見た目

Nindub は Rust のように読める。`struct`、`enum`、`fn`、`let`、`match`、`Result<T, E>`、クロージャ、`#[属性]`、`//` コメント。似せているのは意図的である([D16](DESIGN.ja.md#d16-構文は-rust-風にする) を参照)。違うのはトップレベルの語彙で、Map は関数とモジュールではなく、下の構文で組み立てる。それぞれが Survey の観測対象に対応している。

## トップレベルの構文

| 構文 | 宣言するもの | Survey が観測するもの |
|---|---|---|
| `map Name;` | Map の名前。1ファイルに1つ。 | — |
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

## Pin は Terrain にあり、Map にはない

Map はファイル名、ルート、フレームワークを一切書かない。要素がどこで実現されるかは Terrain の裁量であり(D5)、Terrain が整理し直されたからといって Map が変わってはならない(D17)。したがって Pin は Terrain から Map を指す。逆ではない。

```ts
// src/api/todos.ts
/** @nindub action create via http POST /todos */
export async function create(user: UserId, title: string) { ... }
```

- 注釈は、そのコードが実現する Map の要素を名指しする。
- `via` は Survey がそれを観測するトランスポート。action と query は `http ...`、view は `browser ...`。state は観測しない。port と effect は、それが越える境界で観測する。

Nindub のツールは Pin を集め、Map の隣に索引を生成する(`todo.pins`。ロックファイルのようにコミットする)。Zoom は索引を読み、ビューアは Pin を Map に重ねて表示する。Projection は Map にある要素のシグネチャと、Pin にあるトランスポートから生成する(D7)。

## Amendment(改訂提案)

Realize の途中で、AI は Map が間違っている、足りない、沈黙している箇所を見つける。AI は Map を編集しない。Amendment を提出する。Map への diff に理由を添え、さらに現在の Terrain を改訂前の Map に対して Survey した結果を添えて、その変更が許すことになる振る舞いが見えるようにする。人間は採用(Map が変わる)、却下(Terrain を直す)、裁量(Map は意図的に沈黙したままにする)のいずれかを選ぶ。D18 を参照。

## まだ設計していないもの

- `event`:非同期に到着する入力(webhook、タイマー)。D6 の非同期の扱いに必要。
- セッションと認証:今は `user: UserId` をすべての引数に明示的に渡している。
- モジュール:Map は1ファイルだが、大きな Map をどう区切るかは未定。
- Terrain 側での `browser(...)` の観測の形(アクセシビリティツリーが候補)。
