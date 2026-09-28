# Glossary

## 名前

### Gudea(言語)
プロジェクト全体の観測可能な振る舞いを記述する超高級言語。実行でき、テストできる。

由来は紀元前2100年頃のラガシュの王グデア。その座像の膝には、建てる前の神殿の平面図が刻まれている。現存する古代の地図の多くは「すでにある土地を後から写したもの」だが、グデアの図は「地図が先で、地形が後」の最古級の例である。

### Gudea Driven Development(開発手法)
自然言語の仕様書を持たず、Gudea で書かれた Map を唯一の正として開発する手法。人間は AI と Map を書き、AI が Terrain を Realize し、Survey がその一致を保証する。

## 用語

| 語 | 定義 |
|---|---|
| **Map**(地図) | Gudea で書かれた、プロジェクトの観測可能な振る舞いをすべて記述した1ファイル。実行でき、正である。 |
| **Terrain**(地形) | Map の下にある実装(ts / rust / python など)。AI が生成し、人間は普段読まない。 |
| **Pin** | Map の要素と Terrain の位置を結ぶ紐付け。 |
| **Zoom** | Pin をたどって下の階層を見る操作。 |
| **Scale**(縮尺) | Zoom の階層の深さ。Map の要素は Gudea でさらに分解されるか、Pin で Terrain に紐付くかのどちらか。 |
| **Projection**(投影) | Terrain の状態を Map の状態に写す関数。 |
| **Survey**(測量) | 同じ操作列を Map と Terrain に流し、Projection を通して結果を比べる検証。 |
| **Drift** | Survey が不一致を出した状態。 |
| **Surface rule** | 観測できる振る舞いは Map に書く。観測できないもの(データ構造、DB の選択、最適化、ライブラリ)は Terrain の裁量。 |
| **Realize** | AI が Map から Terrain を作り、Survey が通るまで直す行為。 |

## 避ける言葉

- **Spec**:Gudea Driven Development は仕様書の否定から始まる。
- **Model**:UML 時代のモデル駆動開発や、機械学習のモデルと紛らわしい。
- **Blueprint**:「作る前の設計図」を連想させ、Map が実行できることが伝わらない。
