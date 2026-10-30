# Card Studio v1.2.1

A browser-based data merge and layout editor for personalized cards, built to replace a Publisher workflow. It currently prints on Avery 5911 business cards, 5523/58163 shipping labels, and 5160 address labels. The interface starts with an editable example design and twelve fictional sample records.

## Try it

Head over to [Card Studio](https://eastmath-fcps.github.io/card-studio/) to check it out!

## Choose paper stock

Use **Paper stock** in **Design card** or **Preview & print**. Both controls select the same stock for the current layout.

| Paper stock | Card/label size | Page | Arrangement |
| --- | --- | --- | --- |
| Avery 5911 | 3.5 × 2 inches | US Letter | 2 columns × 5 rows; no gaps |
| Avery 5523/58163 | 4 × 2 inches | US Letter | 2 columns × 5 rows; gap between columns |
| Avery 5160 | 2⅝ × 1 inch | US Letter | 3 columns × 10 rows; gaps between columns |

The selected stock controls the canvas dimensions, rounded label corners, safe-area guide, sheet preview, starting-slot choices, alignment test, and printing. It is included in saved and exported layouts.

Switching stock **preserves every object's size, position, and style**. Review the design after switching: objects beyond the new outline are flagged in both Design and Print and may be clipped. Background color fills the new card/label size. Stock changes can be undone/redone. **New** starts a blank design using the currently selected stock.

When the physical geometry changes, printer offsets reset to zero and the starting position resets to the first card. These session settings are not part of the saved layout or Undo history. Run an alignment test on the stock you intend to use.

## Import your records

Choose **Import data**, then drop a CSV, XLS, or XLSX file into the import area or choose a file. The first row supplies the merge-field names. Excel workbooks expose a worksheet selector.

- CSV values remain text, including leading zeros, Unicode characters, and formula-looking strings. Quoted commas, embedded line breaks, escaped double quotes, comma/semicolon/tab delimiters, UTF-8, and BOM-marked UTF-16 are supported. For other encodings, export as **CSV UTF-8** in Excel first.
- Excel tends to remove leading zeros.
- Excel formulas use their saved/cached result; this app does not recalculate formulas or execute macros. Recalculate and save the workbook in Excel first when needed.
- Empty records are skipped. A column with data but no heading receives `Column N`. Duplicate headings receive suffixes such as `Name (2)`, and the app explains the change.
- Merge fields are case-sensitive. `FirstName` and `Firstname` are different fields. Spaces at the ends of headings are trimmed; spaces within headings are supported.
- Limits: 20 MB per spreadsheet, 10,000 records, 250 columns, and 20,000 characters per cell. For an Excel sheet with a large unused formatted range, remove unused rows/columns or export that worksheet as CSV.
- All rows from the selected worksheet are imported, including hidden or filtered-out rows. Export only the intended records if you need a subset.

Use **Clear records** to remove the imported records from the current page. Refreshing or closing the page also discards the records; the next visit starts with the fictional example.

## Design a card

Use **Text**, **Image**, and **Shape** to add objects. Select an object on the card or in the Layers list to edit it.

A text object can mix static text and multiple merge fields:

```text
<<LastName>>, <<FirstName>>
ID: <<RecordID>>
Category <<Category>> - Location <<Location>>
```

Select a text box and click a merge-field chip to insert it at the text editor's cursor. If no text box is selected, the chip creates a new one. **Show merged text** previews the current record; switch it off to see the placeholders. The record controls let you inspect other records.

- Move objects by dragging. Resize with the four corner handles, or use exact inch values in the properties panel.
- Rotate with the circular handle or enter a degree value. Hold **Shift** while rotating to snap to 15-degree increments.
- The **Snap** control snaps movement to 0.025 inches. Hold **Alt** while dragging to bypass it.
- Images preserve proportions by default. Hold **Shift** during a corner resize to preserve any object's proportions. Fit, crop, and stretch modes are available for images.
- Text supports font, point size, color, bold, italic, underline, alignment, and automatic shrinking to fit. All text in one box shares the same formatting; use separate boxes for different styles.
- Shrink-to-fit can wrap text and reduce it to 6 pt. It never increases the chosen size. If it still cannot fit, printing stops and identifies the affected records and layers.
- Supported image inputs are PNG, JPEG, WebP, GIF, and SVG. Images are embedded in the layout, normalized to PNG/JPEG, and reduced to a maximum dimension of 1600 pixels. GIFs use one frame and SVGs become raster images. Image inputs are limited to 10 MB / 60 megapixels; embedded images are limited to approximately 6 MB each.
- Shapes supply solid rectangles, borders, and divider rules. Bring forward / Send backward changes stacking; the top layer in the list is the front of the card.
- Press **Escape** or click empty card space to deselect and edit the card background.
- The dashed 1/8-inch safe area is only a design guide. Objects outside the card are clipped. Avoid placing important text on the edge.
- Cards support up to 100 objects, with up to 80 undo-history states.

### Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Arrow keys | Move the selected object 0.01 inch |
| Shift + arrows | Move 0.1 inch |
| Delete / Backspace | Delete the selected object |
| Ctrl/Cmd + D | Duplicate the selected object |
| Ctrl/Cmd + Z | Undo |
| Ctrl/Cmd + Shift + Z | Redo |
| Ctrl/Cmd + S | Save layout |
| Ctrl/Cmd + P | Prepare and print cards |
| Escape | Deselect |

Text-editing controls keep their normal keyboard behavior.

## Save, copy, and reuse designs

**Save layout** stores the current design in this browser's IndexedDB. Change its name in the header. **Layouts** opens saved designs, makes independent copies, imports a layout file, or deletes a saved layout. **Save current as a copy** saves the current design under a new identity and switches to that copy.

**Export** downloads a versioned `.cardlayout.json` file. It includes the paper-stock ID, card dimensions, object positions, styles, static text, background, and embedded images. It excludes the spreadsheet rows and workbook. **Caution: Any personal information you manually type into static text or import as an image is part of the saved design.**

Export files for backups, sharing with colleagues, or moving to a different computer. Import through **Layouts → Import layout**, then save the imported design. Re-import the current spreadsheet separately.

Browser saves belong to this browser profile and site origin. They do not sync between devices, and clearing site data can remove them. **Changes are saved explicitly; the app does not auto-save.** It warns before replacing an unsaved layout or leaving the page when the browser supports that warning. Keep exported backups.

## Preview and print

1. Select your paper stock, import your real records, and check the design against several records, especially long names.
2. Open **Preview & print**. Choose the record range, number of copies per record, and first available card on the first sheet.
3. Review the sheet preview. Records fill left to right and top to bottom; copies of a record are adjacent. Starting slots apply only to the first sheet; remaining slots on the last sheet are blank.
4. Use **Print alignment test** on plain Letter paper. Hold it against your card or label stock to check placement. Positive horizontal/vertical adjustments move right/down; negative values move left/up. These settings apply to the current session, not the saved design.
5. Click **Print cards / Save PDF**. The app loads the fonts and checks all selected records for missing merge fields and overflowing text before opening the print dialog.
6. Set **Letter**, **Portrait**, **100% / Actual size**, **Margins: None**, **Headers and footers: Off**, and **Background graphics: On**. Print single-sided. Choose **Save as PDF** if you want a PDF first.

The app cannot change your printer driver settings. Do not use Fit to page or a second scaling step when printing a saved PDF. If alignment drifts progressively down the sheet, verify the paper size and scaling; an offset will not fix a scaling error. Don't use the browser's menu-based Print command - use the app's print button (or its Ctrl/Cmd+P shortcut) for card printing.

## Dependencies and local hosting

The application consists of `index.html`, `style.css`, `templates.js`, `google-fonts.js`, `fonts.js`, `script.js`, `pwa.js`, `sw.js`, `manifest.webmanifest`, and the `assets/` and `vendor/` directories. Keep them together. The HTML loads installation support independently, then the template catalog, Google Fonts catalog, and font manager before the main editor script.

### Excel reader

XLS/XLSX parsing uses the bundled **SheetJS Community Edition 0.20.3** full standalone build at `vendor/xlsx.full.min.js`. The service worker precaches it for offline availability, but it is executed only when an Excel file is imported. No CDN request is needed. The full build preserves XLS support.

The upstream script is unmodified. Its Apache 2.0 license, attribution, source URL, and checksum are included in `vendor/`. If the reader cannot load, CSV import remains available.

- [SheetJS standalone installation](https://docs.sheetjs.com/docs/getting-started/installation/standalone/)
- [SheetJS license information](https://docs.sheetjs.com/docs/miscellany/license/)

### Fonts

The default menu offers six system fonts (*Arial*, *Verdana*, *Georgia*, *Times New Roman*, *Trebuchet MS*, and *Courier New*) and three Google Fonts (*Roboto*, *Merriweather*, and *Libre Barcode 39*)

Select a text object and choose **More fonts…** to open the font picker. Fonts you apply are added to the menu for reuse during the session; fonts referenced by a saved layout reappear when you open that layout.

#### Google Fonts

Search by family name, filter by category, and browse the results. Click a family to load its preview, then choose **Use this font**. Only fonts you preview or use are downloaded. The bundled catalog contains 1,950 families from Google Fonts, captured October 27, 2026, and also works when opening `index.html` directly. For a family added after that snapshot, enter its exact Google Fonts name and click **Preview the entered name**.

#### Local fonts

In **More fonts… → Local fonts**, choose either route:

- **Installed font name:** Enter the font's full name (for example, `Team 401`), click **Preview installed font**, then **Use this font**. The browser verifies that it can access the installed face. If the name is not recognized, try its full or PostScript name, or import the font file instead.
- **Font file:** Choose a `.ttf`, `.otf`, `.woff`, or `.woff2` file up to 20 MB, edit its menu label if desired, and click **Import font file**, then **Use this font**. Files are read locally and saved in this browser's IndexedDB; they are not uploaded. Each import registers one face, so bold and italic may be synthesized.

Imported font files remain available after reloading in the same browser profile and site origin. Clearing site data removes them. Exported layouts contain the font source, name, and a content-based file reference, **not the font bytes**. On another computer, installed-font references need the same installed font; imported-file references need the exact same font file imported again. Reimporting that file restores matching references even if you give it a different menu label. Keep the original font files with your layout backups.

Text line height automatically expands when the selected font’s glyphs would extend outside the usual line box. This prevents tall display fonts from being clipped at the top or overlapping between lines.

Missing Google or local fonts produce an actionable message and block printing until they load or you choose a replacement. The six system-font choices continue to use the browser's normal platform fallbacks.

Layouts now export as schema version 3. Versions 1 and 2 remain supported, including layouts using former defaults such as Inter, Open Sans, Montserrat, Lato, and Oswald. Use this updated app to open new exports.

Font loading, persistence, and picker behavior are isolated in `fonts.js`; `google-fonts.js` holds family names, categories, and available styles. To refresh the catalog, preserve its `CardStudioGoogleFonts` array shape and regenerate entries from Google's metadata, ordered by popularity.

- [Google Fonts catalog metadata](https://fonts.google.com/metadata/fonts)
- [Google Fonts CSS2 API](https://developers.google.com/fonts/docs/css2)
- [Browser FontFace API](https://developer.mozilla.org/en-US/docs/Web/API/FontFace/FontFace)

### Code 39 barcodes

Select **Libre Barcode 39** for a text box and enter `*<<RecordID>>*` (replace `RecordID` with your column name), or a static value such as `*001234*`. The asterisks supply the required start/stop markers; the app does not add them automatically. The font supports uppercase A–Z, digits, spaces, and `- . $ / + %`. This renders bars only - add a separate ordinary text box for readable values if needed. Barcode "text" always renders in regular style; bold, italic, and underline controls are disabled while this font is selected. The font loads on demand, is preserved in saved/exported layouts, and must load successfully before printing. Keep each barcode on one line, leave clear white space on both sides, and test the printed result with your scanner at the intended size. Shrink-to-fit can make bars too small to scan; enlarge the box or disable shrinking when setting a fixed barcode size.

[Libre Barcode Code 39 documentation](https://graphicore.github.io/librebarcode/documentation/code39)

## Data handling

The app has no analytics, accounts, upload endpoint, or backend. It reads files through the browser's File API and holds the records in memory. Spreadsheet cells are displayed as literal text, not executable HTML. Google Fonts receives ordinary font-resource requests, not spreadsheet uploads. The Excel reader is bundled locally; using system or imported fonts avoids external font requests.

## Adding paper-stock templates

`templates.js` is the catalog; the editor and print code do not contain product-specific geometry. All measurements are in **inches**.

- `geometries`: page dimensions/name/orientation, card width/height/corner radius, grid rows/columns, left/top margins, horizontal/vertical gaps, and safe-area inset.
- `stocks`: a unique ID, display name, description, source URL, and a `geometryId`. Products with identical geometry reference the same entry.
- Keep existing IDs and geometries stable: saved layouts reference the stock ID. Use a new ID for an incompatible format. Unknown IDs are rejected instead of silently printing on the wrong stock.

To add a format, verify its manufacturer's actual template, add its geometry (or reuse a matching one), and add a stock entry. The app derives page size, slot count, pitch, editing limits, and controls from the catalog.

### Geometry sources

- [Avery 5911](https://www.avery.com/templates/5911)
- [Avery 5523](https://www.avery.com/templates/5523)/[Avery 58163](https://www.avery.com/templates/58163) (these have identical layouts)
- [Avery 5160](https://www.avery.com/templates/5160)

## Brand icon

The brand mark and favicon use **“id” by Olivia**, from [Noun Project](https://thenounproject.com/icon/id-1987656/), licensed under [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). (`assets/noun-id-1987656.png` preserves the original 512-pixel PNG supplied by Noun Project.)