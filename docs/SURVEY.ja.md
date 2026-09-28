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

view はまだ測量しない。ブラウザの計器が必要である。

## 次の一手を計画する(`--plan`)

既定では手順 1 の呼び出しは乱数で選ぶ。`--plan` を付けると、Survey は Map を使って次の一手を決める。Map は Survey が実行もコピーもできるプログラムなので、呼び出しを実際に行う前に試せる。Terrain には選ばれた呼び出しだけが送られる。

- **書いた直後に読む。** action が書き換えた state のセル(たとえば `carts[u2]`)は、両側で query が読むまで「未読の負債」として残る。負債があるとき、次の一手はそれを最も多く読む query になる。引数はそれまでに見た id から作る。query は純粋なので、候補は Map 自身の上で試せる。これにより、状態のずれは、Terrain の出力に現れうる最初のステップで見つかる。乱数の読み取りがたまたま通りかかるのを待たない。
- **それ以外は、新しいことをする。** 候補の action を Map のコピーの上で試し、この実行の中で最も珍しい種類の一手を選ぶ。一手の種類とは、action 名、本体が通った分岐、書いたものの形(カートの行数、注文の status、列が伸びたか並び替わったか)である。候補の引数は直近に書かれたセルに含まれる id を優先し、前の一手の上に次を積めるようにする。fuzzing の網羅誘導と同じ考え方で、網羅の対象は Map 自身の制御の流れと状態である。

計画された読み取りは報告の中で `*` で示す。Drift が見つかったときは、ずれた呼び出しが読んだ各セルを最後に書いたステップも報告する。

```
 9   add_to_cart("u2", "id-1", 2)                   ok
10 * cart("u2")                                     DRIFT in result
    map:     [{"sku":"id-5",...},{"sku":"id-1",...}]
    terrain: [{"sku":"id-1",...},{"sku":"id-5",...}]
    carts[u2] was last written at step 9
```

Amendment 2 の前の Shop(Map は合算したカートの行を末尾に動かし、Terrain はその場に残す)で seed 10〜39 を測った。乱数生成では 600 手の実行 30 回のうち 2 回で Drift を見つけ、計画では 16 回。1200 手ではそれぞれ 3 回と 23 回。計画はステップの約半分を読み取りに使う。できないのは、既知の引数の query では読めない状態に届くことで、これは Terrain を外から観測することの限界として残る。

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

`nindub serve examples/todo.nindub` は Map 自身をこのプロトコルの後ろで提供する。準拠する Terrain が何を答えるべきかの参照実装である。

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
