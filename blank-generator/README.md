# pdf-generator

Generates valid PDF and JPEG files of an exact byte size and a chosen page size. No dependencies.

```bash
node index.js --size 5MB --pages 3 --page A4 --out output/example.pdf
```

| Option | Description |
| --- | --- |
| `-s, --size` | Exact file size: `12345`, `500KB`, `5MB`, `1.5GB` (1 KB = 1024 B) |
| `-p, --pages` | Number of pages (default `1`) |
| `--page` | `A3`, `A4`, `A5`, `Letter`, `Legal` or `WIDTHxHEIGHT[pt\|mm\|cm\|in]`, e.g. `100x150mm` |
| `-f, --format` | `pdf` or `jpeg` (default: from `--out` extension, else `pdf`). For JPEG, `--page` is in pixels |
| `-o, --out` | Output path (default `output.pdf`). The size in MB is appended, e.g. `output-5MB.pdf` |

The size is reached by embedding an unreferenced stream of plain text padding, so the file stays
a valid PDF. JPEGs are a solid gray image padded with comment segments.

```bash
node index.js --size 2MB --format jpeg --page 1920x1080
```
