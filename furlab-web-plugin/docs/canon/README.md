# FurLab Canon Sources

Canonical business/source docs used for implementation contracts.

- `FurLab_Data_Model_Glossary_v5.md` — Приложение X: термины, поля всех сущностей, ScrapStatus/ScrapQuality, ScrapReservation, ScrapTransaction
  - Source: `F:\FURLAB\Info\Приложение X. Справочник терминов и атрибутов модели данных FurLab_v5.docx`
- `FurLab_Layouts_Types_Parameters_Scenarios.md` — Приложение Y: типы выкладок, параметры, сценарии выполнения
  - Source: `F:\FURLAB\Info\Приложение Y. Выкладки FurLab, типы, параметры и сценарии выполнения.docx`
- `FurLab_Inventory_Waste_Accounting_v5.docx`
  - Source: `F:\FURLAB\Info\4. Инвентаризация и учёт меховых отходов в FurLab v5 .docx`

Working rule for this repo:

- Use only canonical FurLab terms from the sources above.
- Do not invent replacement terms for code, UI, contracts, reports, or debug strings when the canon already defines one.
- The local normalized instruction is fixed in `docs/canon/FurLab_Working_Canon.md`.

Do not edit canon source files in place; keep originals and add new versions рядом with explicit version suffix.
