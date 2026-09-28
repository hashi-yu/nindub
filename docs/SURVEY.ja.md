# Survey(測量)

[English](SURVEY.md) | 日本語

Survey は同じ呼び出しの列を Map と Terrain に流し、出てきたものを比べる(D6)。探索であり、通ったということは探した範囲で Drift が見つからなかったということである(D12)。

```
$ node src/cli.ts survey examples/todo.nindub --terrain http://localhost:3000 --seed 7 --steps 200
survey Todo against http://localhost:3000  seed 7  steps 23
 1 create("u1", "Buy milk")                          ok
 2 complete("u3", "id-1")                            ok
 ...
23 complete("u1", "id-1")                            DRIFT in effects
    map:     [{"name":"SendMail","fields":{"to":"a@example.com","subject":"Done: Buy milk","body":"You completed \"Buy milk\"."}}]
    terrain: []

replay with --script and these lines:
create("u1", "Buy milk")
...
```

## 1 ステップの流れ

1. Survey が呼び出しを生成する(または `--script` の次の行を取る)。引数は宣言された型から作る。id は以前の結果で見たもの(たまに未知のもの)、文字列は空文字や 200 文字の境界の内外を含む一覧から、など。生成器はシード付きで、同じ実行を正確に繰り返せる。
2. Survey がその呼び出しを Map で実行する。Observation には、結果、出力された effect、port へのリクエストと注入した応答、消費した時刻と id が記録される。
3. Survey が同じ呼び出しを、**同じ注入値とともに** Terrain へ送る。時刻、id、port の応答を順序どおりに(D8)。予備の port 応答も添えるので、Map が呼ばなかった port を呼ぶ Terrain も最後まで実行できる。
4. Survey が 3 つの経路を順に比べる。**結果**、**effect**、**port**(どの port の関数をどの引数で呼んだか)。最初の差が Drift であり、実行はそこで止まり、再現する列を出す。
5. Terrain が state を Nindub の store(下記)に保存していれば、Survey はその state を読み、Map の state と比べる。**state** 経路である(D23)。Table は id をキーにした行の集合として比べ、Vec は順序を保つ。状態のずれは、誰かが読むかどうかに関わらず、原因のステップで現れる。`--no-state` で切れる。

view はまだ測量しない。ブラウザの計器が必要である。

## 次の一手を計画する(`--plan`)

既定では手順 1 の呼び出しは乱数で選ぶ。`--plan` を付けると、Survey は候補の action をいくつか Map のコピーの上で試し、この実行でまだ起きていない種類の一手を選ぶ。無ければ乱数で選ぶ。一手の種類とは、action 名、本体が通った分岐、書いたものの形(カートの行数、列が伸びたか並び替わったか)である。乱数の選択は Drift が隠れる状態をなかなか作らない。fuzzing の網羅誘導と同じ考え方で、網羅の対象は Map 自身の制御の流れと状態である。Terrain には選ばれた呼び出しだけが送られる。

Drift が見つかったときは、その背後にある state のセルを最後に書いたステップも報告する。

```
 9 add_to_cart("u2", "id-1", 2)                     DRIFT in state
    map:     {"carts":[{"id":"u2","lines":[{"sku":"id-5",...},{"sku":"id-1",...}]}]}
    terrain: {"carts":[{"id":"u2","lines":[{"sku":"id-1",...},{"sku":"id-5",...}]}]}
    carts[u2] was last written at step 9
```

Amendment 2 の前の Shop(Map は合算したカートの行を末尾に動かし、Terrain はその場に残す)で seed 10〜39、600 手を測った。乱数生成は 30 回中 2 回で Drift を見つけ、計画は 10 回、計画と state 経路は 12 回(1200 手では 3、13、14 回)。state 経路があれば Drift は `add_to_cart` のステップそのもので現れ、無ければ後で誰かが注文を読んだときに現れる。率を制限しているのは、ずれを見ることではなく、ずれが隠れる状態に到達することである。

## ハーネスプロトコル

最初の計器は、Terrain 側の 2 つの HTTP エンドポイントである。意図的に最小にしてある。Terrain の本物のルートや画面を駆動する計器ができる前に、一周を閉じるためのものである(D22)。

`POST {terrain}/__nindub/reset` — 初期状態に戻る。Survey は実行の前に一度呼び、両側が Map の開始点から始まるようにする。2xx を返せばよい。

`POST {terrain}/__nindub/call`

```json
{
  "name": "complete",
  "args": ["u1", "id-1"],
  "clock": ["3"],
  "ids": [],
  "ports": { "Directory.email_of": [{ "Ok": "a@example.com" }, { "Err": "DirectoryError::Unknown" }] }
}
```

- `args` は action または query の引数。下のワイヤ形式で、宣言順。
- `clock` と `ids` は、この呼び出しの間に Terrain の時計と id 供給源が順に返さなければならない値。Terrain は呼び出しの間、自分の時計を使ったり id を自分で作ったりしてはならない。
- `ports` は `Port.fn` から、Terrain の port クライアントが順に返さなければならない応答への対応。Terrain は本物のサービスに接続してはならない。

応答:

```json
{
  "result": { "Ok": null },
  "effects": [{ "name": "SendMail", "fields": { "to": "a@example.com", "subject": "Done: Buy milk", "body": "You completed \"Buy milk\"." } }],
  "ports": [{ "port": "Directory", "fn": "email_of", "args": ["u1"] }]
}
```

- `effects` は呼び出しが出力した effect。順序どおり、どれも実行されていない。
- `ports` は呼び出しが行ったリクエスト。順序どおり。
- Terrain が呼び出しを完了できなかった場合(注入値が尽きた、例外が出た)は、`"error": "..."` と、そこまでに要求した `ports` を返す。Survey はこれを通信の失敗ではなく Drift として報告する。

`POST {terrain}/__nindub/state` — 宣言された state を Map の形で返す(D23):

```json
{ "todos": [{ "id": "id-1", "owner": "u1", "title": "Buy milk", "done": true, "created_at": 0 }] }
```

state を Nindub の store に保存している Terrain は、これを何も書かずに得る(下記)。そうでない Terrain は 404 を返し、Survey は観測だけを比べる。

`nindub serve examples/todo.nindub` は Map 自身をこのプロトコルの後ろで提供する。準拠する Terrain が何を答えるべきかの参照実装である。

## Nindub の store

D23 の下では、Map の `state` 宣言は Terrain がその state を保存する形でもあり、Nindub はその形を store として提供する。Survey が state を読むためのコードを Terrain の作者が書くことはない。TypeScript では:

```ts
import { NindubStore } from "nindub/src/store.ts";
const store = new NindubStore(parse(readFileSync("shop.nindub", "utf8")));
const carts = store.table<CartRow>("carts"); // get, has, put, delete, all, size
```

`put` はワイヤ形式の行を受け取り、宣言された行の型に照らして検査する。形の違う行は、後で見つかるのではなく、書き込む時点で拒否される。`store.state()` が `POST /__nindub/state` の答えであり、`store.snapshot()` と `store.restore()` で action をロールバックできる。store が固定するのは宣言された state の形だけで、索引、キャッシュ、非正規化した複製、その他 Terrain がデータに到達する方法はすべて Terrain のものである。最初の backend はメモリで、`Postgres` region は D21 の DB 計器ができればそれが直接読む。

## ワイヤ形式

インタプリタの値の JSON 表現と同じである。

| Nindub | JSON |
|---|---|
| `()` | `null` |
| `bool`、`Int`、`Text`、`Email` | boolean、number、string、string |
| `Id<T>` | string |
| `Instant` | number |
| struct | フィールドのオブジェクト |
| ペイロードのない enum の variant | `"Enum::Variant"` |
| ペイロードのある variant | `{ "Variant": payload }`(1 つ)または `{ "Variant": [payloads] }` |
| `Ok(x)`、`Err(e)`、`Some(x)`、`None` | `{ "Ok": x }`、`{ "Err": e }`、`{ "Some": x }`、`"Option::None"` |
| `Vec<T>`、`Table<T>` | 配列 |

オブジェクトのキーの順序は問わない。
