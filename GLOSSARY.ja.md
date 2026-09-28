# 用語集

[English](GLOSSARY.md) | 日本語

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
| **Terrain**(地形) | Map の下にある実装(ts / rust / python など)。AI が生成し、人間は何をするかを知るためには読まない。 |
| **Region**(区画) | 領土の区画。ブラウザ、プロセス、データベース、外部サービス、送信チャネル。すべての action・query・view・state・port・effect はどれかの region に住む。region の種類(`Client`、`Service`、`Postgres`、`External`、`Outbound`)が、そこに何が住めるかと、Survey がどの計器で観測するかを決める。region は入れ子にできる。 |
| **Road**(道) | ある region から別の region への、宣言された接続。本体が別の region の要素を使えるのは road に沿ってだけ。road は Map におけるモジュール依存の宣言であり、Terrain に対して検査される。 |
| **Pin** | Terrain 側の注釈。実現している Map の要素を名指しし、計器に固有の詳細(action のルートなど)を添える。Pin は Terrain から Map を指し、逆は決してない。Map ファイルには Pin はない。ツールが集めて索引を生成する。 |
| **Amendment**(改訂提案) | Map への変更の提案。Realize の途中で AI が、理由と、改訂前の Map に対する Survey 結果を添えて提出する。人間が採用、却下、裁量のいずれかを判断する。採用された Amendment は Remap で適用される。 |
| **Remap** | 採用された 1 つの Amendment を Map に適用する行為。Map が変わる唯一の方法であり、Terrain が Map に影響する唯一の門。常に部分的な修正であり、Terrain から Map を再生成することでは決してない。Amendment と Remap の関係は、pull request と merge の関係と同じ。 |
| **Zoom** | 一段下へ降りる操作。領土から region へ、region からその要素へ、要素から Pin をたどって Terrain へ。 |
| **Scale**(縮尺) | Zoom の深さ。Map の先頭には region と road が見え、その下に各 region の要素、その下に本体、その下に Terrain がある。`nindub outline --depth N` で Scale を選ぶ。 |
| **Observation**(観測) | 入力に応じて Map や Terrain から出てくるものすべて。経路は4つ:結果、view、effect、port。Survey は観測を比べ、内部状態は比べない。 |
| **Action** | 状態を変えうる操作。戻り値と宣言されたエラーが観測される。 |
| **Query** | 状態を変えずに読む操作。戻り値が観測される。 |
| **View** | 画面。何が表示され、何が操作できるかの構造として書く。データとして観測し、ピクセルは見ない。 |
| **Effect** | 外界への副作用(メールを送る、カードに課金する)。実行せずデータとして出力する。effect の列が観測される。 |
| **Port** | プロジェクトが依存する外部サービス。型とエラーを宣言する。そこへのリクエストが観測され、応答は注入される。 |
| **Projection**(投影) | Survey が Terrain を駆動し観測するためのアダプタ。Map の宣言と Pin のトランスポートから生成する。人間も AI も手で書かない。 |
| **Survey**(測量) | 同じ入力列を Map と Terrain に流し、Projection を通して観測を比べる検証。探索であり、証明ではない。 |
| **Drift** | Survey が不一致を出した状態。 |
| **Surface rule** | 観測できる振る舞いは Map に書く。観測できないもの(データ構造、DB の選択、最適化、ライブラリ、UI では色・レイアウト・フレームワーク)は Terrain の裁量。 |
| **Realize** | AI が Map から Terrain を作り、Survey が通るまで直す行為。 |

## 避ける言葉

- **Spec**:Nindub Driven Development は仕様書の否定から始まる。
- **Model**:UML 時代のモデル駆動開発や、機械学習のモデルと紛らわしい。
- **Blueprint**:「作る前の設計図」を連想させ、Map が実行できることが伝わらない。
