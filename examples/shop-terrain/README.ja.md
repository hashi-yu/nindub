# Shop Terrain

[English](README.md) | 日本語

[`../shop.nindub`](../shop.nindub) の Terrain。Map の俯瞰から書いた TypeScript のサービスで、ハーネスプロトコル([docs/SURVEY.ja.md](../../docs/SURVEY.ja.md))で Survey に応答し、製品としての本物のルートも持つ。依存なし。

```sh
node examples/shop-terrain/src/server.ts                       # 既定は PORT=3001
node src/cli.ts survey examples/shop.nindub --terrain http://127.0.0.1:3001 --steps 600
```

`npm test` は 8 シード × 600 ステップの Survey と、下のスクリプトの再生を行う。

## 構成

| Map | Terrain |
|---|---|
| `region api::catalog`、`::cart`、`::orders`、`::staff` | `src/api/catalog.ts`、`cart.ts`、`orders.ts`、`staff.ts` |
| `region api`(プロセス) | `src/server.ts`。ハーネスのエンドポイントは `src/harness.ts` |
| `region db: Postgres` | `src/store/memory.ts`。Todo Terrain と同じ代替品(そちらの Amendment 1、裁量) |
| `port Payments` | `Deps.payments` |
| `effect Ship`、`Receipt`、`Refunded` | `Deps.shipping`、`Deps.mail` |
| `inject clock`、`ids` | `Deps.now`、`Deps.freshId` |
| `region web: Client` | 未実装(view にはブラウザの計器が要る) |

ここでも action は原子的である。ハーネスは呼び出しの前にストアのスナップショットを取り、`Err` を返すか失敗したら戻し、出力した effect も捨てる。`place` は在庫を触る前に課金するので、決済拒否はどちらにせよ何も変えない。

## Realize の記録

この Terrain は Map の本体を書き写すのではなく、俯瞰と意図から書いた。Survey に見つけるものがあるように。実際に見つかった。

1. **シード 1、ステップ 306、`products()`:結果に Drift。** Map は名前を素の文字列比較(コード単位。`"Buy milk"` が `"a"` より前)で並べる。Terrain は `localeCompare` を使っていた(`"a"` が `"Buy milk"` より前)。JavaScript のソートと DB の `ORDER BY` を分けるのとまさに同じ種類の照合順序の差。Terrain を修正。
2. **シード 1〜5 × 400:Drift なし。** しかし既知の差が 1 つ捕まらずに残っていた。カートに既にある sku を追加する場合。Map は古い行を消して合算した行を末尾に足すので、行が末尾に移る。Terrain はその場で更新していた。**シード 10〜39 × 600:30 回中 2 回で Drift**、いずれもステップ 480 前後、いずれも `cart(...)`。7 ステップのスクリプトで再現できる。教訓は 2 つ。ランダムな生成器はそういう状態に到達するが稀である(2 つの sku を持つカート、再追加、`place` がカートを空にする前の読み取りが要る)。そして一度見つかった Drift はスクリプトとして保存する価値がある(`terrain.test.ts`)。再現する列はそのためにある。
3. **Terrain は今は準拠している**(合算した行は末尾に移る)。下の Amendment 2 は、Map がそれを意図していたかを問う。

## Amendment 2:合算したカートの行は末尾に移るべきか

Map の `add_to_cart` は、既にカートにある sku について `others.push(Line { ... })` と書かれている。合算した行は最後になる。それが意図なのか、本体の書き方の偶然なのかは人間の問いである(D18)。多くのカートは行の位置を保つ。

- **採用**:Map を、行の位置を保つように変える(Remap)。Terrain はその場での更新に戻す。
- **却下**:Map は書いてあるとおりを意図している。Terrain は今のまま。
- **裁量**:カートの順序を観測しないと宣言する。たとえば `cart` が sku でソートした行を返すようにして、どちらの順序も問わないようにする。
