Attribute VB_Name = "W_FormBuilders"
Option Compare Database
Option Explicit

Public Const UI_DATETIME_FORMAT As String = "dd.mm.yyyy hh:nn"
Public Const STD_GRID_FONT As String = "Segoe UI"
Public Const STD_GRID_FONT_SIZE As Integer = 10
Public Const FORM_STD_WIDTH As Long = 19000
Public Const FORM_TITLEBAR_HEIGHT As Long = 520
Public Const FORM_TITLE_LEFT As Long = 300
Public Const FORM_TITLE_TOP As Long = 110
Public Const FORM_TITLE_WIDTH As Long = 9800
Public Const FORM_TITLE_TEXT_HEIGHT As Long = 260

Public Sub CreateF1_ScrapPieceRegistry()
    Dim frm As Form
    Dim ctl As Control
    Dim x As Long
    Dim y As Long
    Dim w As Long
    Dim h As Long

    DeleteFormIfExists "F1_ScrapPieceRegistry"
    Set frm = CreateForm
    frm.Caption = UiText("f1.caption", "F1 - ScrapPiece Registry")
    frm.RecordSource = ""
    frm.DefaultView = 0 ' single form
    frm.OnLoad = "=W_F1_OnLoad()"
    frm.AllowEdits = True
    frm.AllowAdditions = False
    frm.AllowDeletions = False
    frm.DataEntry = False
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 1800 ' header
    frm.Section(0).Height = 8200
    frm.Width = FORM_STD_WIDTH
    AddFormTitleBar frm, "f1.title", "Scrap pieces registry"

    x = 300: y = 820: w = 2400: h = 300
    Set ctl = CreateControl(frm.Name, acTextBox, acHeader, "", "", x, y, w, h)
    ctl.Name = "txtFindInventoryTag"
    ctl.ControlSource = ""
    ctl.Enabled = True
    ctl.Locked = False
    ctl.AfterUpdate = "=W_F1_RequeryFilters()"
    CreateLabel frm.Name, acHeader, ctl.Name, UiText("f1.filter.find", "Find inventory tag"), x, y - 250, w, 250

    x = 3000
    Set ctl = CreateControl(frm.Name, acComboBox, acHeader, "", "", x, y, 2200, h)
    ctl.Name = "cboFilterMaterial"
    ctl.ControlSource = ""
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT materialName FROM FurMaterial WHERE materialName Is Not Null ORDER BY materialName;"
    ctl.ColumnCount = 1
    ctl.BoundColumn = 1
    ctl.ColumnWidths = "2200"
    ctl.LimitToList = False
    ctl.AutoExpand = True
    ctl.Enabled = True
    ctl.Locked = False
    ctl.OnEnter = ""
    ctl.OnExit = ""
    ctl.OnGotFocus = ""
    ctl.OnLostFocus = ""
    ctl.OnChange = ""
    ctl.AfterUpdate = "=W_F1_RequeryFilters()"
    CreateLabel frm.Name, acHeader, ctl.Name, UiText("f1.filter.material", "Material"), x, y - 250, w, 250

    x = 5400
    Set ctl = CreateControl(frm.Name, acComboBox, acHeader, "", "", x, y, 1800, h)
    ctl.Name = "cboFilterStatus"
    ctl.ControlSource = ""
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT W_StatusLabel(code) AS statusLabel FROM ScrapStatusDict WHERE code Is Not Null ORDER BY code;"
    ctl.ColumnCount = 1
    ctl.BoundColumn = 1
    ctl.ColumnWidths = "1800"
    ctl.LimitToList = False
    ctl.AutoExpand = True
    ctl.Enabled = True
    ctl.Locked = False
    ctl.OnEnter = ""
    ctl.OnExit = ""
    ctl.OnGotFocus = ""
    ctl.OnLostFocus = ""
    ctl.OnChange = ""
    ctl.AfterUpdate = "=W_F1_RequeryFilters()"
    CreateLabel frm.Name, acHeader, ctl.Name, UiText("f1.filter.status", "Status"), x, y - 250, 1200, 250

    x = 7400
    Set ctl = CreateControl(frm.Name, acComboBox, acHeader, "", "", x, y, 1600, h)
    ctl.Name = "cboFilterLocCode"
    ctl.ControlSource = ""
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT locCode FROM StorageLocation WHERE locCode Is Not Null ORDER BY locCode;"
    ctl.ColumnCount = 1
    ctl.BoundColumn = 1
    ctl.ColumnWidths = "1600"
    ctl.LimitToList = False
    ctl.AutoExpand = True
    ctl.Enabled = True
    ctl.Locked = False
    ctl.OnEnter = ""
    ctl.OnExit = ""
    ctl.OnGotFocus = ""
    ctl.OnLostFocus = ""
    ctl.OnChange = ""
    ctl.AfterUpdate = "=W_F1_RequeryFilters()"
    CreateLabel frm.Name, acHeader, ctl.Name, UiText("f1.filter.location", "Location"), x, y - 250, 1200, 250

    x = 11750: y = 800
    Set ctl = CreateControl(frm.Name, acCommandButton, acHeader, "", "", x, y, 1700, 360)
    ctl.Name = "cmdOpenCard"
    ctl.Caption = UiText("f1.btn.open_card", "Open card")
    ctl.OnClick = "=W_F1_OpenCard()"

    y = 1260
    Set ctl = CreateControl(frm.Name, acCommandButton, acHeader, "", "", x, y, 1700, 360)
    ctl.Name = "cmdNewPiece"
    ctl.Caption = UiText("f1.btn.new_piece", "New piece")
    ctl.OnClick = "=W_F1_NewPiece()"

    x = 9300: y = 800
    Set ctl = CreateControl(frm.Name, acCommandButton, acHeader, "", "", x, y, 1300, 360)
    ctl.Name = "cmdApplyFilters"
    ctl.Caption = UiText("f1.btn.apply", "Apply")
    ctl.OnClick = "=W_F1_ApplyFiltersNow()"

    y = 1260
    Set ctl = CreateControl(frm.Name, acCommandButton, acHeader, "", "", x, y, 1300, 360)
    ctl.Name = "cmdResetFilters"
    ctl.Caption = UiText("f1.btn.reset", "Reset")
    ctl.OnClick = "=W_F1_ResetFilters()"

    Set ctl = CreateControl(frm.Name, acSubform, acDetail, "", "", 300, 280, 18400, 7780)
    ctl.Name = "subScrapPieceList"
    ctl.SourceObject = "Form.SF1_ScrapPieceList"
    HideAttachedLabel frm, "subScrapPieceList"
    CreateFreeLabel frm.Name, acDetail, UiText("f1.section.list", "Pieces list"), 300, 40, 2200, 220

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "F1_ScrapPieceRegistry"
End Sub

Public Sub CreateSF1_ScrapPieceList()
    Dim frm As Form
    Dim ctl As Control
    Dim x As Long

    DeleteFormIfExists "SF1_ScrapPieceList"
    Set frm = CreateForm
    frm.Caption = UiText("sf1.caption", "SF1 - ScrapPiece list")
    frm.RecordSource = "Q_F1_ScrapPieceList"
    frm.DefaultView = 2 ' Datasheet
    frm.OnLoad = "=W_AutoFitActiveDatasheet()"
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 0
    frm.Section(0).Height = 380
    frm.AllowEdits = False
    frm.AllowAdditions = False
    frm.AllowDeletions = False
    frm.DataEntry = False
    frm.Width = FORM_STD_WIDTH

    x = 0
    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & W_F1_FieldAlias("f1.col.inventoryTag", "Inv tag") & "]", x, 0, 1800, 300)
    ctl.Name = "txtInvTag"
    ctl.ColumnOrder = 1
    ctl.ColumnWidth = 1800
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.inventoryTag", "Inv tag"), x, 0, 1800, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1800

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & W_F1_FieldAlias("f1.col.material", "Material") & "]", x, 0, 2200, 300)
    ctl.Name = "txtMaterial"
    ctl.ColumnOrder = 2
    ctl.ColumnWidth = 2200
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.material", "Material"), x, 0, 2200, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 2200

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & W_F1_FieldAlias("f1.col.status", "Status") & "]", x, 0, 1400, 300)
    ctl.Name = "txtStatus"
    ctl.ColumnOrder = 3
    ctl.ColumnWidth = 1400
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.status", "Status"), x, 0, 1400, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1400

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & W_F1_FieldAlias("f1.col.quality", "Quality") & "]", x, 0, 1300, 300)
    ctl.Name = "txtQuality"
    ctl.ColumnOrder = 4
    ctl.ColumnWidth = 1300
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.quality", "Quality"), x, 0, 1300, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1300

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & W_F1_FieldAlias("f1.col.location", "Location") & "]", x, 0, 1200, 300)
    ctl.Name = "txtLocation"
    ctl.ColumnOrder = 5
    ctl.ColumnWidth = 1200
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.location", "Location"), x, 0, 1200, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1200

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & W_F1_FieldAlias("f1.col.area", "Area, mm2") & "]", x, 0, 1400, 300)
    ctl.Name = "txtAreaMm2"
    ctl.Format = "0"
    ctl.ColumnOrder = 6
    ctl.ColumnWidth = 1400
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.area", "Area, mm2"), x, 0, 1400, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1400

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & W_F1_FieldAlias("f1.col.nap", "Nap, deg") & "]", x, 0, 1300, 300)
    ctl.Name = "txtNapDeg"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 7
    ctl.ColumnWidth = 1300
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.nap", "Nap, deg"), x, 0, 1300, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1300

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & W_F1_FieldAlias("f1.col.updatedAt", "Updated") & "]", x, 0, 3000, 300)
    ctl.Name = "txtUpdatedAt"
    ctl.Format = UI_DATETIME_FORMAT
    ctl.ColumnOrder = 8
    ctl.ColumnWidth = 3000
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.updatedAt", "Updated"), x, 0, 3000, 220
    LockReadOnlyControl frm, ctl.Name

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "SF1_ScrapPieceList"
End Sub

Public Sub CreateSF2_ScrapTransactionHistory()
    Dim frm As Form
    Dim ctl As Control
    Dim x As Long
    Dim aInv As String
    Dim aTransAt As String
    Dim aType As String
    Dim aBefore As String
    Dim aAfter As String
    Dim aSource As String
    Const W_INV As Long = 1800
    Const W_TRANS_AT As Long = 2400
    Const W_TYPE As Long = 2200
    Const W_BEFORE As Long = 1900
    Const W_AFTER As Long = 1900
    Const W_SOURCE As Long = 2300

    DeleteFormIfExists "SF2_ScrapTransactionHistory"
    Set frm = CreateForm
    frm.Caption = UiText("sf2.tx.caption", "Scrap transaction history")
    aInv = W_F1_FieldAlias("sf2.tx.col.inventoryTag", "Inv. tag")
    aTransAt = W_F1_FieldAlias("sf2.tx.col.transAt", "Trans at")
    aType = W_F1_FieldAlias("sf2.tx.col.transType", "Type")
    aBefore = W_F1_FieldAlias("sf2.tx.col.before", "Before")
    aAfter = W_F1_FieldAlias("sf2.tx.col.after", "After")
    aSource = W_F1_FieldAlias("sf2.tx.col.sourceRef", "Source")
    frm.RecordSource = "SELECT sp.inventoryTag AS inventoryTagKey, sp.inventoryTag AS [" & aInv & "], st.transAt AS [" & aTransAt & "], " & _
                      "W_TransTypeLabel(Nz(st.transType,'')) AS [" & aType & "], " & _
                      "W_StatusLabel(Nz(st.statusBefore,'')) AS [" & aBefore & "], " & _
                      "W_StatusLabel(Nz(st.statusAfter,'')) AS [" & aAfter & "], st.sourceRef AS [" & aSource & "] " & _
                      "FROM ScrapPiece AS sp INNER JOIN ScrapTransaction AS st ON sp.id = st.scrapPieceId;"
    frm.DefaultView = 2 ' Datasheet
    frm.OnLoad = "=W_AutoFitActiveDatasheet()"
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 0
    frm.Section(0).Height = 380
    frm.AllowEdits = False
    frm.AllowAdditions = False
    frm.AllowDeletions = False
    frm.DataEntry = False
    frm.Width = FORM_STD_WIDTH
    x = 0
    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aInv & "]", x, 0, W_INV, 300)
    ctl.Name = "txtInventoryTag"
    ctl.ColumnOrder = 1
    ctl.ColumnWidth = W_INV
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.tx.col.inventoryTag", "Inv. tag"), x, 0, W_INV, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_INV

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aTransAt & "]", x, 0, W_TRANS_AT, 300)
    ctl.Name = "txtTransAt"
    ctl.ColumnOrder = 2
    ctl.ColumnWidth = W_TRANS_AT
    ctl.Format = UI_DATETIME_FORMAT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.tx.col.transAt", "Trans at"), x, 0, W_TRANS_AT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_TRANS_AT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aType & "]", x, 0, W_TYPE, 300)
    ctl.Name = "txtTransType"
    ctl.ColumnOrder = 3
    ctl.ColumnWidth = W_TYPE
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.tx.col.transType", "Type"), x, 0, W_TYPE, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_TYPE

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aBefore & "]", x, 0, W_BEFORE, 300)
    ctl.Name = "txtStatusBefore"
    ctl.ColumnOrder = 4
    ctl.ColumnWidth = W_BEFORE
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.tx.col.before", "Before"), x, 0, W_BEFORE, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_BEFORE

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aAfter & "]", x, 0, W_AFTER, 300)
    ctl.Name = "txtStatusAfter"
    ctl.ColumnOrder = 5
    ctl.ColumnWidth = W_AFTER
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.tx.col.after", "After"), x, 0, W_AFTER, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_AFTER

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aSource & "]", x, 0, W_SOURCE, 300)
    ctl.Name = "txtSourceRef"
    ctl.ColumnOrder = 6
    ctl.ColumnWidth = W_SOURCE
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.tx.col.sourceRef", "Source"), x, 0, W_SOURCE, 220
    LockReadOnlyControl frm, ctl.Name

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "SF2_ScrapTransactionHistory"
End Sub

Public Sub CreateSF2_UsageHistory()
    Dim frm As Form
    Dim ctl As Control
    Dim x As Long
    Dim aInv As String
    Dim aLayout As String
    Dim aFragment As String
    Dim aRot As String
    Dim aOffX As String
    Dim aOffY As String
    Const W_INV As Long = 1700
    Const W_LAYOUT As Long = 2400
    Const W_FRAGMENT As Long = 2400
    Const W_ROT As Long = 1700
    Const W_OFFX As Long = 2200
    Const W_OFFY As Long = 2200

    DeleteFormIfExists "SF2_UsageHistory"
    Set frm = CreateForm
    frm.Caption = UiText("sf2.usage.caption", "Scrap usage history")
    frm.RecordSource = "Q_F4_UsageHistory"
    frm.DefaultView = 2 ' Datasheet
    frm.OnLoad = "=W_AutoFitActiveDatasheet()"
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 0
    frm.Section(0).Height = 380
    frm.AllowEdits = False
    frm.AllowAdditions = False
    frm.AllowDeletions = False
    frm.DataEntry = False
    frm.Width = FORM_STD_WIDTH
    aInv = W_F1_FieldAlias("f4.col.inventoryTag", "Inv tag")
    aLayout = W_F1_FieldAlias("f4.col.layoutRunId", "Layout run")
    aFragment = W_F1_FieldAlias("f4.col.fragmentId", "Fragment")
    aRot = W_F1_FieldAlias("f4.col.rotationDeg", "Rotation, deg")
    aOffX = W_F1_FieldAlias("f4.col.offsetXmm", "Offset X, mm")
    aOffY = W_F1_FieldAlias("f4.col.offsetYmm", "Offset Y, mm")

    x = 0
    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aInv & "]", x, 0, W_INV, 300)
    ctl.Name = "txt_inventoryTag"
    ctl.ColumnOrder = 1
    ctl.ColumnWidth = W_INV
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.usage.col.inventoryTag", "Inv. tag"), x, 0, W_INV, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_INV

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aLayout & "]", x, 0, W_LAYOUT, 300)
    ctl.Name = "txt_layoutRunId"
    ctl.ColumnOrder = 2
    ctl.ColumnWidth = W_LAYOUT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.usage.col.layoutRunId", "Layout run"), x, 0, W_LAYOUT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_LAYOUT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aFragment & "]", x, 0, W_FRAGMENT, 300)
    ctl.Name = "txt_fragmentId"
    ctl.ColumnOrder = 3
    ctl.ColumnWidth = W_FRAGMENT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.usage.col.fragmentId", "Fragment"), x, 0, W_FRAGMENT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_FRAGMENT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aRot & "]", x, 0, W_ROT, 300)
    ctl.Name = "txt_rotationDeg"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 4
    ctl.ColumnWidth = W_ROT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.usage.col.rotationDeg", "Rotation, deg"), x, 0, W_ROT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_ROT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aOffX & "]", x, 0, W_OFFX, 300)
    ctl.Name = "txt_offsetXmm"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 5
    ctl.ColumnWidth = W_OFFX
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.usage.col.offsetXmm", "Offset X, mm"), x, 0, W_OFFX, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_OFFX

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aOffY & "]", x, 0, W_OFFY, 300)
    ctl.Name = "txt_offsetYmm"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 6
    ctl.ColumnWidth = W_OFFY
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("sf2.usage.col.offsetYmm", "Offset Y, mm"), x, 0, W_OFFY, 220
    LockReadOnlyControl frm, ctl.Name

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "SF2_UsageHistory"
End Sub

Public Sub CreateF2_ScrapPieceCard()
    Dim frm As Form
    Dim ctl As Control
    Const TOP_LABEL_Y As Long = 120
    Const TOP_CTRL_Y As Long = 360
    Const EDIT_LABEL_Y As Long = 760
    Const EDIT_CTRL_Y As Long = 1000
    Const RESV_SECTION_Y As Long = 2200
    Const RESV_LABEL_Y As Long = 2440
    Const RESV_CTRL_Y As Long = 2680
    Const RESV_BTN_Y As Long = RESV_CTRL_Y
    Const PREVIEW_TITLE_Y As Long = 2200
    Const PREVIEW_MODE_LABEL_Y As Long = 2440
    Const PREVIEW_CTRL_Y As Long = 2680
    Const OUTPUT_LABEL_Y As Long = 3120
    Const OUTPUT_CTRL_Y As Long = 3350
    Const OPS_LABEL_Y As Long = 4150
    Const OPS_CTRL_Y As Long = 4410
    Const USE_LABEL_Y As Long = 6330
    Const USE_CTRL_Y As Long = 6590

    DeleteFormIfExists "F2_ScrapPieceCard"
    Set frm = CreateForm
    frm.Caption = UiText("f2.card.caption", "F2 - ScrapPiece card")
    frm.RecordSource = "ScrapPiece"
    frm.DefaultView = 0 ' single form
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 420
    frm.Section(0).Height = 9000
    frm.Width = FORM_STD_WIDTH
    AddFormTitleBar frm, "f2.card.title", "Scrap piece card"
    frm.OnLoad = "=W_F2_OnCurrent()"
    frm.OnCurrent = "=W_F2_OnCurrent()"

    AddBoundText frm, "inventoryTag", 300, TOP_CTRL_Y, 1800
    AddBoundText frm, "areaMm2", 2200, TOP_CTRL_Y, 1500
    AddBoundText frm, "bboxWidthMm", 3800, TOP_CTRL_Y, 1500
    AddBoundText frm, "bboxHeightMm", 5400, TOP_CTRL_Y, 1500
    AddBoundText frm, "maxSpanMm", 7000, TOP_CTRL_Y, 1500
    AddBoundText frm, "napDirectionDeg", 8600, TOP_CTRL_Y, 1500
    AddBoundText frm, "createdAt", 14900, TOP_CTRL_Y, 1800
    AddBoundText frm, "updatedAt", 16800, TOP_CTRL_Y, 1800

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "", 1700, RESV_CTRL_Y, 2200, 300)
    ctl.Name = "txtReservedBy"
    AddBoundText frm, "note", 9000, EDIT_CTRL_Y, 9000

    Set ctl = CreateControl(frm.Name, acComboBox, acDetail, "", "materialId", 300, EDIT_CTRL_Y, 3400, 300)
    ctl.Name = "cbo_materialId"
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT id, materialName FROM FurMaterial ORDER BY materialName;"
    ctl.BoundColumn = 1
    ctl.ColumnCount = 2
    ctl.ColumnWidths = "0;3400"
    ctl.LimitToList = True

    Set ctl = CreateControl(frm.Name, acComboBox, acDetail, "", "storageLocationId", 3800, EDIT_CTRL_Y, 3600, 300)
    ctl.Name = "cbo_storageLocationId"
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT id, locCode FROM StorageLocation ORDER BY locCode;"
    ctl.BoundColumn = 1
    ctl.ColumnCount = 2
    ctl.ColumnWidths = "0;3600"
    ctl.LimitToList = True

    Set ctl = CreateControl(frm.Name, acComboBox, acDetail, "", "scrapStatus", 300, RESV_CTRL_Y, 1300, 300)
    ctl.Name = "cbo_scrapStatus"
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT code, W_StatusLabel(code) AS statusLabel FROM ScrapStatusDict ORDER BY code;"
    ctl.BoundColumn = 1
    ctl.ColumnCount = 2
    ctl.ColumnWidths = "0;1200"
    ctl.LimitToList = True
    ctl.AfterUpdate = "=W_F2_ReservationUiRefresh()"

    Set ctl = CreateControl(frm.Name, acComboBox, acDetail, "", "scrapQuality", 7500, EDIT_CTRL_Y, 1400, 300)
    ctl.Name = "cbo_scrapQuality"
    ctl.RowSourceType = "Table/Query"
    ctl.RowSource = "SELECT code, W_QualityLabel(code) AS qualityLabel FROM ScrapQualityDict ORDER BY code;"
    ctl.BoundColumn = 1
    ctl.ColumnCount = 2
    ctl.ColumnWidths = "0;1000"
    ctl.LimitToList = True

    CreateLabel frm.Name, acDetail, "txt_inventoryTag", UiText("f2.card.col.inventoryTag", "Inv. tag"), 300, TOP_LABEL_Y, 1800, 220
    CreateLabel frm.Name, acDetail, "txt_areaMm2", UiText("f2.card.col.areaMm2", "Area, mm2"), 2200, TOP_LABEL_Y, 1500, 220
    CreateLabel frm.Name, acDetail, "txt_bboxWidthMm", UiText("f2.card.col.bboxWidthMm", "Bbox width, mm"), 3800, TOP_LABEL_Y, 1500, 220
    CreateLabel frm.Name, acDetail, "txt_bboxHeightMm", UiText("f2.card.col.bboxHeightMm", "Bbox height, mm"), 5400, TOP_LABEL_Y, 1500, 220
    CreateLabel frm.Name, acDetail, "txt_maxSpanMm", UiText("f2.card.col.maxSpanMm", "Max span, mm"), 7000, TOP_LABEL_Y, 1500, 220
    CreateLabel frm.Name, acDetail, "txt_napDirectionDeg", UiText("f2.card.col.napDirectionDeg", "Nap, deg"), 8600, TOP_LABEL_Y, 1500, 220
    CreateLabel frm.Name, acDetail, "txt_createdAt", UiText("f2.card.col.createdAt", "Created"), 14900, TOP_LABEL_Y, 1800, 220
    CreateLabel frm.Name, acDetail, "txt_updatedAt", UiText("f2.card.col.updatedAt", "Updated"), 16800, TOP_LABEL_Y, 1800, 220

    CreateLabel frm.Name, acDetail, "cbo_materialId", UiText("f2.card.col.materialId", "Material"), 300, EDIT_LABEL_Y, 3400, 220
    CreateLabel frm.Name, acDetail, "cbo_storageLocationId", UiText("f2.card.col.storageLocationId", "Location"), 3800, EDIT_LABEL_Y, 3600, 220
    CreateLabel frm.Name, acDetail, "cbo_scrapQuality", UiText("f2.card.col.scrapQuality", "Quality"), 7500, EDIT_LABEL_Y, 1400, 220
    CreateLabel frm.Name, acDetail, "txt_note", UiText("f2.card.col.note", "Note"), 9000, EDIT_LABEL_Y, 9000, 220

    CreateFreeLabel frm.Name, acDetail, UiText("f2.card.section.reservation", "Reservation"), 300, RESV_SECTION_Y, 2600, 220
    CreateLabel frm.Name, acDetail, "cbo_scrapStatus", UiText("f2.card.col.scrapStatus", "Status"), 300, RESV_LABEL_Y, 1300, 220
    CreateLabel frm.Name, acDetail, "txtReservedBy", UiText("f3.col.reservedBy", "Reserved by"), 1700, RESV_LABEL_Y, 2200, 220

    Set ctl = CreateControl(frm.Name, acCommandButton, acDetail, "", "", 4100, RESV_BTN_Y - 40, 2400, 380)
    ctl.Name = "cmdReserveFromCard"
    ctl.Caption = UiText("f3.btn.reserve", "Reserve scrap piece")
    ctl.OnClick = "=W_F2_ReserveFromCard()"
    ctl.Visible = True

    Set ctl = CreateControl(frm.Name, acCommandButton, acDetail, "", "", 4100, RESV_BTN_Y - 40, 2400, 380)
    ctl.Name = "cmdReleaseFromCard"
    ctl.Caption = UiText("f3.btn.release", "Release reservation")
    ctl.OnClick = "=W_F2_ReleaseFromCard()"
    ctl.Visible = False
    frm.Controls("txt_areaMm2").Format = "0"
    frm.Controls("txt_areaMm2").DecimalPlaces = 0
    frm.Controls("txt_napDirectionDeg").Format = "0.0"
    frm.Controls("txt_napDirectionDeg").DecimalPlaces = 1
    frm.Controls("txt_bboxWidthMm").Format = "0.0"
    frm.Controls("txt_bboxWidthMm").DecimalPlaces = 1
    frm.Controls("txt_bboxHeightMm").Format = "0.0"
    frm.Controls("txt_bboxHeightMm").DecimalPlaces = 1
    frm.Controls("txt_maxSpanMm").Format = "0.0"
    frm.Controls("txt_maxSpanMm").DecimalPlaces = 1
    frm.Controls("txt_createdAt").Format = UI_DATETIME_FORMAT
    frm.Controls("txt_updatedAt").Format = UI_DATETIME_FORMAT
    On Error Resume Next
    frm.Controls("txt_createdAt").ShowDatePicker = 0
    frm.Controls("txt_updatedAt").ShowDatePicker = 0
    Err.Clear
    On Error GoTo 0
    ' Read-only system/computed fields on the card.
    LockReadOnlyControl frm, "txt_inventoryTag"
    LockReadOnlyControl frm, "txt_areaMm2"
    LockReadOnlyControl frm, "txt_napDirectionDeg"
    LockReadOnlyControl frm, "txt_bboxWidthMm"
    LockReadOnlyControl frm, "txt_bboxHeightMm"
    LockReadOnlyControl frm, "txt_maxSpanMm"
    LockReadOnlyControl frm, "txt_createdAt"
    LockReadOnlyControl frm, "txt_updatedAt"

    CreateFreeLabel frm.Name, acDetail, UiText("f2.card.preview.section", "Contour preview"), 9000, PREVIEW_TITLE_Y, 2800, 250

    Set ctl = CreateControl(frm.Name, acComboBox, acDetail, "", "", 9000, PREVIEW_CTRL_Y, 1500, 320)
    ctl.Name = "cboPreviewMode"
    ctl.RowSourceType = "Value List"
    ctl.RowSource = "Piece;ScanA3"
    ctl.ColumnCount = 1
    ctl.LimitToList = True
    ctl.DefaultValue = """Piece"""
    ctl.AfterUpdate = "=W_F2_ContourPreviewModeChanged()"
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f2.card.preview.mode", "Mode"), 9000, PREVIEW_MODE_LABEL_Y, 1200, 220

    Set ctl = CreateControl(frm.Name, acCheckBox, acDetail, "", "", 12780, PREVIEW_CTRL_Y + 40, 300, 260)
    ctl.Name = "chkNormalizePiece"
    ctl.DefaultValue = "-1"
    Set ctl = CreateControl(frm.Name, acLabel, acDetail, "", UiText("f2.card.preview.normalize", "Normalize nap"), 13100, PREVIEW_CTRL_Y + 20, 2100, 220)
    ctl.Name = "lblNormalizePiece"
    ctl.Caption = UiText("f2.card.preview.normalize", "Normalize nap")

    Set ctl = CreateControl(frm.Name, acCommandButton, acDetail, "", "", 10650, PREVIEW_CTRL_Y - 40, 1900, 380)
    ctl.Name = "cmdOpenPreview"
    ctl.Caption = UiText("f2.card.preview.btn.open", "Open preview")
    ctl.OnClick = "=W_F2_RenderContourVisual()"

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "", 300, OUTPUT_CTRL_Y, 18400, 700)
    ctl.Name = "txtVisualOutput"
    ctl.ControlSource = ""
    ctl.ScrollBars = 2 ' Vertical
    ctl.Visible = False
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f2.card.preview.output", "Status / path"), 300, OUTPUT_LABEL_Y, 2300, 220
    HideAttachedLabel frm, "txtVisualOutput"

    Set ctl = CreateControl(frm.Name, acSubform, acDetail, "", "", 300, OPS_CTRL_Y, 18400, 1800)
    ctl.Name = "subTxHistory"
    ctl.SourceObject = "Form.SF2_ScrapTransactionHistory"
    ctl.LinkMasterFields = "inventoryTag"
    ctl.LinkChildFields = "inventoryTagKey"
    HideAttachedLabel frm, "subTxHistory"
    CreateFreeLabel frm.Name, acDetail, UiText("f2.card.section.operations", "Operations history"), 300, OPS_CTRL_Y - 260, 3600, 250

    Set ctl = CreateControl(frm.Name, acSubform, acDetail, "", "", 300, USE_CTRL_Y, 18400, 1800)
    ctl.Name = "subUsageHistory"
    ctl.SourceObject = "Form.SF2_UsageHistory"
    ctl.LinkMasterFields = "inventoryTag"
    ctl.LinkChildFields = "inventoryTagKey"
    HideAttachedLabel frm, "subUsageHistory"
    CreateFreeLabel frm.Name, acDetail, UiText("f2.card.section.usage", "Usage history"), 300, USE_CTRL_Y - 260, 3600, 250

    ApplyStandardGridStyle frm

    SaveCloseRenameForm frm.Name, "F2_ScrapPieceCard"
End Sub

Public Sub CreateF2_ContourJson()
    Dim frm As Form

    DeleteFormIfExists "Z_Debug_ContourJson"
    DeleteFormIfExists "F2_ContourJson"
    Set frm = CreateForm
    frm.Caption = UiText("f2.contour_json.caption", "F2 - Contour JSON")
    frm.RecordSource = "ScrapPiece"
    frm.DefaultView = 0
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 420
    frm.Section(0).Height = 6500
    frm.Width = FORM_STD_WIDTH
    AddFormTitleBar frm, "f2.contour_json.title", "Contour (JSON)"

    AddBoundText frm, "inventoryTag", 300, 300, 2000
    AddBoundText frm, "areaMm2", 2400, 300, 1400
    AddBoundText frm, "bboxWidthMm", 3900, 300, 1400
    AddBoundText frm, "bboxHeightMm", 5400, 300, 1400
    AddBoundText frm, "maxSpanMm", 6900, 300, 1700
    AddBoundText frm, "napDirectionDeg", 8700, 300, 1600
    frm.Controls("txt_areaMm2").Format = "0"
    frm.Controls("txt_areaMm2").DecimalPlaces = 0
    frm.Controls("txt_bboxWidthMm").Format = "0.0"
    frm.Controls("txt_bboxWidthMm").DecimalPlaces = 1
    frm.Controls("txt_bboxHeightMm").Format = "0.0"
    frm.Controls("txt_bboxHeightMm").DecimalPlaces = 1
    frm.Controls("txt_maxSpanMm").Format = "0.0"
    frm.Controls("txt_maxSpanMm").DecimalPlaces = 1
    frm.Controls("txt_napDirectionDeg").Format = "0.0"
    frm.Controls("txt_napDirectionDeg").DecimalPlaces = 1
    CreateLabel frm.Name, acDetail, "txt_inventoryTag", UiText("f2.contour_preview.col.inventoryTag", "Inv. tag"), 300, 70, 1800, 220
    CreateLabel frm.Name, acDetail, "txt_areaMm2", UiText("f2.contour_preview.col.areaMm2", "Area, mm2"), 2400, 70, 1200, 220
    CreateLabel frm.Name, acDetail, "txt_bboxWidthMm", UiText("f2.contour_preview.col.bboxWidthMm", "Bbox width, mm"), 3900, 70, 1300, 220
    CreateLabel frm.Name, acDetail, "txt_bboxHeightMm", UiText("f2.contour_preview.col.bboxHeightMm", "Bbox height, mm"), 5400, 70, 1400, 220
    CreateLabel frm.Name, acDetail, "txt_maxSpanMm", UiText("f2.contour_preview.col.maxSpanMm", "Max span, mm"), 6900, 70, 1500, 220
    CreateLabel frm.Name, acDetail, "txt_napDirectionDeg", UiText("f2.contour_preview.col.napDirectionDeg", "Nap, deg"), 8700, 70, 1500, 220

    AddBoundText frm, "metricsJson", 300, 900, 9900
    frm.Controls("txt_metricsJson").Height = 800
    frm.Controls("txt_metricsJson").ScrollBars = 2 ' Vertical

    AddBoundText frm, "scrapContour", 300, 1800, 9900
    frm.Controls("txt_scrapContour").Height = 4300
    frm.Controls("txt_scrapContour").ScrollBars = 2 ' Vertical

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "Z_Debug_ContourJson"
End Sub

Public Sub CreateF3_ReservationOperation()
    Dim frm As Form
    Dim ctl As Control

    DeleteFormIfExists "F3_ReservationOperation"
    Set frm = CreateForm
    frm.Caption = UiText("f3.caption", "F3 - Reservation operation")
    frm.RecordSource = ""
    frm.DefaultView = 0
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 420
    frm.Section(0).Height = 2200
    frm.Width = FORM_STD_WIDTH
    AddFormTitleBar frm, "f3.title", "Reservation"

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "", 300, 400, 2200, 300)
    ctl.Name = "txtInventoryTag"
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f3.col.inventoryTag", "Inv. tag"), 300, 150, 1500, 250

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "", 2700, 400, 2000, 300)
    ctl.Name = "txtReservedBy"
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f3.col.reservedBy", "Reserved by"), 2700, 150, 1500, 250

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "", 4900, 400, 3400, 300)
    ctl.Name = "txtNote"
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f3.col.note", "Note"), 4900, 150, 1500, 250

    Set ctl = CreateControl(frm.Name, acCommandButton, acDetail, "", "", 300, 900, 2200, 420)
    ctl.Name = "cmdReserve"
    ctl.Caption = UiText("f3.btn.reserve", "Reserve scrap piece")
    ctl.OnClick = "=W_F3_ReserveSelected()"

    Set ctl = CreateControl(frm.Name, acCommandButton, acDetail, "", "", 2700, 900, 2200, 420)
    ctl.Name = "cmdRelease"
    ctl.Caption = UiText("f3.btn.release", "Release reservation")
    ctl.OnClick = "=W_F3_ReleaseSelected()"

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "F3_ReservationOperation"
End Sub

Public Sub CreateF4_UsageHistory()
    Dim frm As Form
    Dim ctl As Control
    Dim x As Long
    Dim aInv As String
    Dim aLayout As String
    Dim aFragment As String
    Dim aRot As String
    Dim aOffX As String
    Dim aOffY As String
    Const W_INV As Long = 1700
    Const W_LAYOUT As Long = 2400
    Const W_FRAGMENT As Long = 2400
    Const W_ROT As Long = 1700
    Const W_OFFX As Long = 1700
    Const W_OFFY As Long = 1700

    DeleteFormIfExists "F4_UsageHistory"
    Set frm = CreateForm
    frm.Caption = UiText("f4.caption", "F4 - Usage history")
    frm.RecordSource = "Q_F4_UsageHistory"
    frm.DefaultView = 2 ' Datasheet
    frm.OnLoad = "=W_AutoFitActiveDatasheet()"
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 900
    frm.Section(0).Height = 380
    frm.AllowEdits = False
    frm.AllowAdditions = False
    frm.AllowDeletions = False
    frm.DataEntry = False
    frm.Width = FORM_STD_WIDTH

    Set ctl = CreateControl(frm.Name, acTextBox, acHeader, "", "", 300, 280, 2200, 300)
    ctl.Name = "txtFilterInventoryTag"
    CreateLabel frm.Name, acHeader, ctl.Name, UiText("f4.filter.inventoryTag", "Filter inv. tag"), 300, 50, 1800, 250

    Set ctl = CreateControl(frm.Name, acCommandButton, acHeader, "", "", 2700, 260, 1200, 340)
    ctl.Name = "cmdApplyFilter"
    ctl.Caption = UiText("f4.btn.apply", "Apply")
    ctl.OnClick = "=W_F4_ApplyFilter()"

    Set ctl = CreateControl(frm.Name, acCommandButton, acHeader, "", "", 4000, 260, 1200, 340)
    ctl.Name = "cmdClearFilter"
    ctl.Caption = UiText("f4.btn.clear", "Clear")
    ctl.OnClick = "=W_F4_ClearFilter()"

    aInv = W_F1_FieldAlias("f4.col.inventoryTag", "Inv tag")
    aLayout = W_F1_FieldAlias("f4.col.layoutRunId", "Layout run")
    aFragment = W_F1_FieldAlias("f4.col.fragmentId", "Fragment")
    aRot = W_F1_FieldAlias("f4.col.rotationDeg", "Rotation, deg")
    aOffX = W_F1_FieldAlias("f4.col.offsetXmm", "Offset X, mm")
    aOffY = W_F1_FieldAlias("f4.col.offsetYmm", "Offset Y, mm")

    x = 0
    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aInv & "]", x, 0, W_INV, 300)
    ctl.Name = "txt_inventoryTag"
    ctl.ColumnOrder = 1
    ctl.ColumnWidth = W_INV
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.inventoryTag", "Inv. tag"), x, 0, W_INV, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_INV

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aLayout & "]", x, 0, W_LAYOUT, 300)
    ctl.Name = "txt_layoutRunId"
    ctl.ColumnOrder = 2
    ctl.ColumnWidth = W_LAYOUT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.layoutRunId", "Layout run"), x, 0, W_LAYOUT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_LAYOUT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aFragment & "]", x, 0, W_FRAGMENT, 300)
    ctl.Name = "txt_fragmentId"
    ctl.ColumnOrder = 3
    ctl.ColumnWidth = W_FRAGMENT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.fragmentId", "Fragment"), x, 0, W_FRAGMENT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_FRAGMENT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aRot & "]", x, 0, W_ROT, 300)
    ctl.Name = "txt_rotationDeg"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 4
    ctl.ColumnWidth = W_ROT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.rotationDeg", "Rotation, deg"), x, 0, W_ROT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_ROT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aOffX & "]", x, 0, W_OFFX, 300)
    ctl.Name = "txt_offsetXmm"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 5
    ctl.ColumnWidth = W_OFFX
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.offsetXmm", "Offset X, mm"), x, 0, W_OFFX, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_OFFX

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aOffY & "]", x, 0, W_OFFY, 300)
    ctl.Name = "txt_offsetYmm"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 6
    ctl.ColumnWidth = W_OFFY
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.offsetYmm", "Offset Y, mm"), x, 0, W_OFFY, 220
    LockReadOnlyControl frm, ctl.Name

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "F4_UsageHistory"
End Sub

Public Sub CreateF_R1_PickList()
    Dim frm As Form
    Dim ctl As Control
    Dim x As Long
    Dim aInv As String
    Dim aMaterial As String
    Dim aStatus As String
    Dim aQuality As String
    Dim aLocation As String
    Dim aArea As String
    Dim aNap As String

    aInv = W_F1_FieldAlias("f1.col.inventoryTag", "Inv tag")
    aMaterial = W_F1_FieldAlias("f1.col.material", "Material")
    aStatus = W_F1_FieldAlias("f1.col.status", "Status")
    aQuality = W_F1_FieldAlias("f1.col.quality", "Quality")
    aLocation = W_F1_FieldAlias("f1.col.location", "Location")
    aArea = W_F1_FieldAlias("f1.col.area", "Area, mm2")
    aNap = W_F1_FieldAlias("f1.col.nap", "Nap, deg")

    DeleteFormIfExists "F_R1_PickList"
    Set frm = CreateForm
    frm.Caption = UiText("r1.caption", "R1 Pick List")
    frm.RecordSource = "Q_R1_PickList"
    frm.DefaultView = 2 ' Datasheet
    frm.OnLoad = "=W_AutoFitActiveDatasheet()"
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 0
    frm.Section(0).Height = 380
    frm.AllowEdits = False
    frm.AllowAdditions = False
    frm.AllowDeletions = False
    frm.DataEntry = False
    frm.Width = FORM_STD_WIDTH

    x = 0
    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aLocation & "]", x, 0, 1400, 300)
    ctl.Name = "txtLocation"
    ctl.ColumnOrder = 1
    ctl.ColumnWidth = 1400
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.location", "Location"), x, 0, 1400, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1400

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aInv & "]", x, 0, 1900, 300)
    ctl.Name = "txtInvTag"
    ctl.ColumnOrder = 2
    ctl.ColumnWidth = 1900
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.inventoryTag", "Inv tag"), x, 0, 1900, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1900

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aMaterial & "]", x, 0, 1900, 300)
    ctl.Name = "txtMaterial"
    ctl.ColumnOrder = 3
    ctl.ColumnWidth = 1900
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.material", "Material"), x, 0, 1900, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1900

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aStatus & "]", x, 0, 1900, 300)
    ctl.Name = "txtStatus"
    ctl.ColumnOrder = 4
    ctl.ColumnWidth = 1900
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.status", "Status"), x, 0, 1900, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1900

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aQuality & "]", x, 0, 1400, 300)
    ctl.Name = "txtQuality"
    ctl.ColumnOrder = 5
    ctl.ColumnWidth = 1400
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.quality", "Quality"), x, 0, 1400, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1400

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aArea & "]", x, 0, 1300, 300)
    ctl.Name = "txtAreaMm2"
    ctl.Format = "0"
    ctl.ColumnOrder = 6
    ctl.ColumnWidth = 1300
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.area", "Area, mm2"), x, 0, 1300, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + 1300

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aNap & "]", x, 0, 1200, 300)
    ctl.Name = "txtNapDeg"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 7
    ctl.ColumnWidth = 1200
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f1.col.nap", "Nap, deg"), x, 0, 1200, 220
    LockReadOnlyControl frm, ctl.Name

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "F_R1_PickList"
End Sub

Public Sub CreateF_R2_Traceability()
    Dim frm As Form
    Dim ctl As Control
    Dim x As Long
    Dim aInv As String
    Dim aLayout As String
    Dim aFragment As String
    Dim aRot As String
    Dim aOffX As String
    Dim aOffY As String
    Const W_INV As Long = 1800
    Const W_LAYOUT As Long = 2400
    Const W_FRAGMENT As Long = 2400
    Const W_ROT As Long = 1800
    Const W_OFFX As Long = 1800
    Const W_OFFY As Long = 1800

    aInv = W_F1_FieldAlias("f4.col.inventoryTag", "Inv tag")
    aLayout = W_F1_FieldAlias("f4.col.layoutRunId", "Layout run")
    aFragment = W_F1_FieldAlias("f4.col.fragmentId", "Fragment")
    aRot = W_F1_FieldAlias("f4.col.rotationDeg", "Rotation, deg")
    aOffX = W_F1_FieldAlias("f4.col.offsetXmm", "Offset X, mm")
    aOffY = W_F1_FieldAlias("f4.col.offsetYmm", "Offset Y, mm")

    DeleteFormIfExists "F_R2_Traceability"
    Set frm = CreateForm
    frm.Caption = UiText("r2.caption", "R2 Traceability")
    frm.RecordSource = "Q_F4_UsageHistory"
    frm.DefaultView = 2 ' Datasheet
    frm.OnLoad = "=W_AutoFitActiveDatasheet()"
    EnsureHeaderFooterOn frm
    frm.Section(1).Height = 0
    frm.Section(0).Height = 380
    frm.AllowEdits = False
    frm.AllowAdditions = False
    frm.AllowDeletions = False
    frm.DataEntry = False
    frm.Width = FORM_STD_WIDTH

    x = 0
    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aInv & "]", x, 0, W_INV, 300)
    ctl.Name = "txtInvTag"
    ctl.ColumnOrder = 1
    ctl.ColumnWidth = W_INV
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.inventoryTag", "Inv tag"), x, 0, W_INV, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_INV

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aLayout & "]", x, 0, W_LAYOUT, 300)
    ctl.Name = "txtLayoutRunId"
    ctl.ColumnOrder = 2
    ctl.ColumnWidth = W_LAYOUT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.layoutRunId", "Layout run"), x, 0, W_LAYOUT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_LAYOUT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aFragment & "]", x, 0, W_FRAGMENT, 300)
    ctl.Name = "txtFragmentId"
    ctl.ColumnOrder = 3
    ctl.ColumnWidth = W_FRAGMENT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.fragmentId", "Fragment"), x, 0, W_FRAGMENT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_FRAGMENT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aRot & "]", x, 0, W_ROT, 300)
    ctl.Name = "txtRotationDeg"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 4
    ctl.ColumnWidth = W_ROT
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.rotationDeg", "Rotation, deg"), x, 0, W_ROT, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_ROT

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aOffX & "]", x, 0, W_OFFX, 300)
    ctl.Name = "txtOffsetXmm"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 5
    ctl.ColumnWidth = W_OFFX
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.offsetXmm", "Offset X, mm"), x, 0, W_OFFX, 220
    LockReadOnlyControl frm, ctl.Name
    x = x + W_OFFX

    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", "[" & aOffY & "]", x, 0, W_OFFY, 300)
    ctl.Name = "txtOffsetYmm"
    ctl.Format = "0.0"
    ctl.ColumnOrder = 6
    ctl.ColumnWidth = W_OFFY
    CreateLabel frm.Name, acDetail, ctl.Name, UiText("f4.col.offsetYmm", "Offset Y, mm"), x, 0, W_OFFY, 220
    LockReadOnlyControl frm, ctl.Name

    ApplyStandardGridStyle frm
    SaveCloseRenameForm frm.Name, "F_R2_Traceability"
End Sub

Private Sub AddBoundText(ByVal frm As Form, ByVal fieldName As String, ByVal leftPos As Long, ByVal topPos As Long, ByVal widthVal As Long)
    Dim ctl As Control
    Set ctl = CreateControl(frm.Name, acTextBox, acDetail, "", fieldName, leftPos, topPos, widthVal, 300)
    ctl.Name = "txt_" & fieldName
End Sub

Private Sub AddAttachedHeaderLabel(ByVal frm As Form, ByVal detailControlName As String, ByVal captionText As String, Optional ByVal topPos As Long = 260)
    Dim ctl As Control
    Dim lbl As Control

    Set ctl = frm.Controls(detailControlName)

    HideAttachedLabel frm, detailControlName
    Set lbl = CreateControl(frm.Name, acLabel, acHeader, detailControlName, captionText, ctl.Left, topPos, ctl.Width, 220)
    lbl.Caption = captionText
    lbl.Tag = "HDR:" & detailControlName
End Sub

Private Sub SyncAttachedHeaderLabels(ByVal frm As Form)
    On Error Resume Next
    Dim lbl As Control
    Dim ctlName As String
    For Each lbl In frm.Controls
        If lbl.ControlType = acLabel Then
            If Left$(lbl.Tag, 4) = "HDR:" Then
                ctlName = Mid$(lbl.Tag, 5)
                lbl.Left = frm.Controls(ctlName).Left
                lbl.Width = frm.Controls(ctlName).Width
            End If
        End If
    Next lbl
    Err.Clear
    On Error GoTo 0
End Sub

Public Function W_SyncHeadersToColumns() As Boolean
    On Error GoTo ExitFn
    SyncAttachedHeaderLabels Screen.ActiveForm
ExitFn:
    W_SyncHeadersToColumns = True
End Function

Private Sub CreateLabel(ByVal formName As String, ByVal section As Integer, ByVal parentControlName As String, ByVal captionText As String, ByVal leftPos As Long, ByVal topPos As Long, ByVal widthVal As Long, ByVal heightVal As Long)
    Dim lbl As Control
    Set lbl = CreateControl(formName, acLabel, section, parentControlName, captionText, leftPos, topPos, widthVal, heightVal)
    lbl.Caption = captionText
End Sub

Private Sub CreateFreeLabel(ByVal formName As String, ByVal section As Integer, ByVal captionText As String, ByVal leftPos As Long, ByVal topPos As Long, ByVal widthVal As Long, ByVal heightVal As Long)
    Dim lbl As Control
    Set lbl = CreateControl(formName, acLabel, section, "", captionText, leftPos, topPos, widthVal, heightVal)
    lbl.Caption = captionText
End Sub

Private Sub AddFormTitleBar(ByVal frm As Form, ByVal titleKey As String, ByVal titleFallback As String)
    Dim lbl As Control

    EnsureHeaderFooterOn frm
    If frm.Section(acHeader).Height < FORM_TITLEBAR_HEIGHT Then
        frm.Section(acHeader).Height = FORM_TITLEBAR_HEIGHT
    End If

    On Error Resume Next
    frm.Section(acHeader).BackColor = RGB(226, 232, 240)
    frm.Section(acHeader).SpecialEffect = 1
    On Error GoTo 0

    On Error Resume Next
    Set lbl = frm.Controls("lblFormTitle")
    On Error GoTo 0

    If lbl Is Nothing Then
        Set lbl = CreateControl(frm.Name, acLabel, acHeader, "", "", FORM_TITLE_LEFT, FORM_TITLE_TOP, FORM_TITLE_WIDTH, FORM_TITLE_TEXT_HEIGHT)
        lbl.Name = "lblFormTitle"
    End If

    lbl.Caption = UiText(titleKey, titleFallback)
    lbl.FontName = STD_GRID_FONT
    lbl.FontSize = 11
    lbl.FontBold = True
    lbl.ForeColor = RGB(20, 30, 45)
    lbl.BackStyle = 0
End Sub

Private Sub ApplyStandardGridStyle(ByVal frm As Form)
    On Error Resume Next
    Dim ctl As Control
    frm.FontName = STD_GRID_FONT
    frm.FontSize = STD_GRID_FONT_SIZE
    For Each ctl In frm.Controls
        Select Case ctl.ControlType
            Case acTextBox, acComboBox, acListBox, acCheckBox, acOptionButton, acToggleButton, acCommandButton
                ctl.FontName = STD_GRID_FONT
                ctl.FontSize = STD_GRID_FONT_SIZE
                ctl.FontBold = False
            Case acLabel
                ctl.FontName = STD_GRID_FONT
                ctl.FontSize = STD_GRID_FONT_SIZE
                If StrComp(ctl.Name, "lblFormTitle", vbTextCompare) = 0 Then
                    ' Keep explicit title-bar styling for non-datasheet forms.
                    ctl.FontSize = 12
                    ctl.FontBold = True
                    ctl.ForeColor = RGB(20, 30, 45)
                    ctl.BackStyle = 0
                Else
                    ctl.FontBold = False
                End If
        End Select
    Next ctl

    Err.Clear
    On Error GoTo 0
End Sub

Public Function W_AutoFitActiveDatasheet() As Boolean
    On Error GoTo ExitFn
    Dim frm As Form
    Dim ctl As Control

    Set frm = Screen.ActiveForm
    If frm.DefaultView <> 2 Then GoTo ExitFn

    On Error Resume Next
    For Each ctl In frm.Controls
        Select Case ctl.ControlType
            Case acTextBox, acComboBox
                ctl.ColumnWidth = -2 ' AutoFit by data/header
        End Select
    Next ctl
    Err.Clear
    On Error GoTo ExitFn

ExitFn:
    W_AutoFitActiveDatasheet = True
End Function

Public Sub DeleteFormIfExists(ByVal formName As String)
    On Error Resume Next
    DoCmd.DeleteObject acForm, formName
    Err.Clear
    On Error GoTo 0
End Sub

Private Sub SaveCloseRenameForm(ByVal tempFormName As String, ByVal targetFormName As String)
    DoCmd.Save acForm, tempFormName
    DoCmd.Close acForm, tempFormName, acSaveYes
    On Error Resume Next
    DoCmd.DeleteObject acForm, targetFormName
    Err.Clear
    On Error GoTo 0
    DoCmd.Rename targetFormName, acForm, tempFormName
End Sub

Private Sub EnsureHeaderFooterOn(ByVal frm As Form)
    On Error Resume Next
    Dim h As Long
    h = frm.Section(acHeader).Height
    If Err.Number <> 0 Then
        Err.Clear
        DoCmd.SelectObject acForm, frm.Name, False
        DoCmd.RunCommand acCmdFormHdrFtr ' turn ON header/footer once
    End If
    On Error GoTo 0
End Sub

Private Sub HideAttachedLabel(ByVal frm As Form, ByVal controlName As String)
    On Error Resume Next
    frm.Controls(controlName).Controls(0).Visible = False
    Err.Clear
    On Error GoTo 0
End Sub

Private Sub LockReadOnlyControl(ByVal frm As Form, ByVal controlName As String)
    On Error Resume Next
    With frm.Controls(controlName)
        .Locked = True
        .Enabled = True
        .TabStop = False
        If .ControlType = acTextBox Or .ControlType = acComboBox Then
            .BackStyle = 1
            .BackColor = RGB(238, 238, 238)
            .BorderStyle = 0
            .SpecialEffect = 0
        End If
    End With
    Err.Clear
    On Error GoTo 0
End Sub
