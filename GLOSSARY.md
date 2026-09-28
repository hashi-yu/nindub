# Glossary

## 名前

### Nindub(言語)
プロジェクト全体の観測可能な振る舞いを記述する超高級言語。実行でき、テストできる。

由来はシュメールの建築の神ニンドゥブ。ラガシュの王グデアの円筒碑文(紀元前2125年頃)によれば、グデアは夢の中で神殿を建てるよう命じられ、ニンドゥブがラピスラズリの板に神殿の平面図を描いた。グデアはその図のとおりに神殿を建てた。

| 夢 | Nindub Driven Development |
|---|---|
| 神の命令 | 人間の意図 |
| ニンドゥブが描いた平面図 | Map |
| グデアが建てた神殿 | Terrain |

### Nindub Driven Development(開発手法)
自然言語の仕様書を持たず、Nindub で書かれた Map を唯一の正として開発する手法。人間は AI と Map を書き、AI が Terrain を Realize し、Survey がその一致を保証する。

### 標語
> 地図が領土に先行する。 — the map precedes the territory.

ボードリヤール『シミュラークルとシミュレーション』より。コージブスキーの「地図は領土ではない」を反転させた言葉で、Map を正とする思想を表す。

## 用語

| 語 | 定義 |
|---|---|
| **Map**(地図) | Nindub で書かれた、プロジェクトの観測可能な振る舞いをすべて記述した1ファイル。実行でき、正である。 |
| **Terrain**(地形) | Map の下にある実装(ts / rust / python など)。AI が生成し、人間は普段読まない。 |
| **Pin** | Map の要素と Terrain の位置を結ぶ紐付け。 |
| **Zoom** | Pin をたどって下の階層を見る操作。 |
| **Scale**(縮尺) | Zoom の階層の深さ。Map の要素は Nindub でさらに分解されるか、Pin で Terrain に紐付くかのどちらか。 |
| **Projection**(投影) | Terrain の状態を Map の状態に写す関数。 |
| **Survey**(測量) | 同じ操作列を Map と Terrain に流し、Projection を通して結果を比べる検証。 |
| **Drift** | Survey が不一致を出した状態。 |
| **Surface rule** | 観測できる振る舞いは Map に書く。観測できないもの(データ構造、DB の選択、最適化、ライブラリ)は Terrain の裁量。 |
| **Realize** | AI が Map から Terrain を作り、Survey が通るまで直す行為。 |

## 避ける言葉

- **Spec**:Nindub Driven Development は仕様書の否定から始まる。
- **Model**:UML 時代のモデル駆動開発や、機械学習のモデルと紛らわしい。
- **Blueprint**:「作る前の設計図」を連想させ、Map が実行できることが伝わらない。
