# Nindub

[English](README.md) | 日本語

> 地図が領土に先行する。 — the map precedes the territory.

仕様書のない AI 開発のための超高級言語。

プロジェクト全体を1つの **Map** に Nindub で書く。Map は実行でき、テストでき、唯一の正である。Map の要素を **Zoom** すると、AI が書いた実装(**Terrain**)が現れる。Terrain が Map に従っているかは **Survey** が機械的に検証する。

この開発手法を **Nindub Driven Development** と呼ぶ。

用語は [GLOSSARY.ja.md](GLOSSARY.ja.md)、これまでの設計上の決定とその理由は [docs/DESIGN.ja.md](docs/DESIGN.ja.md)、Map がどう見えるかは [docs/LANGUAGE.ja.md](docs/LANGUAGE.ja.md) と [examples/todo.nindub](examples/todo.nindub) を参照。

## 開発

ツールは TypeScript で書かれ、Node 22.18 以降でビルドなしに動く。

```sh
npm install
npm run check                                  # 型検査とテスト
node src/cli.ts outline examples/todo.nindub   # 領土の俯瞰:region、road、署名
node src/cli.ts run examples/todo.nindub       # Map を単体で動かす。:help でコマンド一覧
node src/cli.ts parse examples/todo.nindub     # Map の AST を JSON で表示

node src/cli.ts serve examples/todo.nindub     # Map 自身を Terrain として提供し、別のシェルで:
node src/cli.ts survey examples/todo.nindub --terrain http://127.0.0.1:PORT --steps 200
```

Terrain が Survey にどう答えるかは [docs/SURVEY.ja.md](docs/SURVEY.ja.md) を参照。

## 文書について

文書は英語と日本語の両方で書く。英語版は `NAME.md`、日本語版は `NAME.ja.md` に置き、内容は常に揃える。

## ライセンス

次のいずれかを選んで利用できる。

- Apache License, Version 2.0([LICENSE-APACHE](LICENSE-APACHE))
- MIT license([LICENSE-MIT](LICENSE-MIT))

明示的に別段の意思表示をしない限り、このプロジェクトに取り込まれることを意図して提出された貢献(Apache-2.0 ライセンスの定義による)は、追加の条件なしに上記のデュアルライセンスで提供されるものとする。
