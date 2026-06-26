Attribute VB_Name = "W_UiText"
Option Compare Database
Option Explicit

' When False, localization updates captions only and keeps manual geometry intact.
Private Const APPLY_UI_GEOMETRY As Boolean = False

Public Sub W_SeedUiTextDict()
    On Error GoTo Fail
    Dim db As DAO.Database
    Set db = CurrentDb
    EnsureUiTextDictSchema db
    EnsureAppConfigSchema db
    ' Safe seed path (ASCII-safe unicode escapes).
    W_RepairUiTextCoreRu

    ' Additional title-bar keys.
    UpsertUiTextEscaped db, "f1.title", "Scrap pieces registry", "\u0420\u0435\u0435\u0441\u0442\u0440 \u043a\u0443\u0441\u043a\u043e\u0432", "F1"
    UpsertUiTextEscaped db, "sf1.title", "Pieces list", "\u0421\u043f\u0438\u0441\u043e\u043a \u043a\u0443\u0441\u043a\u043e\u0432", "F1"
    UpsertUiTextEscaped db, "f2.card.title", "Scrap piece card", "\u041a\u0430\u0440\u0442\u043e\u0447\u043a\u0430 \u043a\u0443\u0441\u043a\u0430", "F2 card"
    UpsertUiTextEscaped db, "f2.contour_json.title", "Contour (JSON)", "\u041a\u043e\u043d\u0442\u0443\u0440 (JSON)", "F2 contour"
    UpsertUiTextEscaped db, "f3.title", "Reservation", "\u0420\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435", "F3"
    UpsertUiTextEscaped db, "f4.title", "Usage history", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f", "F4"
    UpsertUiTextEscaped db, "r1.title", "Pick list", "\u041b\u0438\u0441\u0442 \u043e\u0442\u0431\u043e\u0440\u0430", "Reports"
    UpsertUiTextEscaped db, "r2.title", "Traceability", "\u0422\u0440\u0430\u0441\u0441\u0438\u0440\u0443\u0435\u043c\u043e\u0441\u0442\u044c", "Reports"
    UpsertUiTextEscaped db, "sf2.tx.title", "Scrap transaction history", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0439", "SF2 tx"
    UpsertUiTextEscaped db, "sf2.usage.title", "Scrap usage history", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f", "SF2 usage"
    MsgBox "UiTextDict is ready. Edit captions there once, then rebuild forms.", vbInformation, "UI dictionary"
    Exit Sub
Fail:
    MsgBox "UiTextDict seed failed: " & Err.Description, vbExclamation, "UI dictionary"
End Sub

Private Sub UpsertUiText(ByVal db As DAO.Database, ByVal captionKey As String, ByVal textEn As String, Optional ByVal textRu As String = "", Optional ByVal explicitContext As String = "")
    Dim sql As String
    Dim keyEsc As String
    Dim enEsc As String
    Dim ruEsc As String
    Dim ctx As String
    Dim ctxEsc As String
    Dim hasTextEn As Boolean
    Dim hasTextRu As Boolean
    Dim hasContext As Boolean
    Dim keyWhere As String

    keyEsc = Replace(captionKey, "'", "''")
    enEsc = Replace(textEn, "'", "''")
    ruEsc = Replace(textRu, "'", "''")
    ctx = ResolveUiContext(captionKey, explicitContext)
    ctxEsc = Replace(ctx, "'", "''")

    hasTextEn = FieldExistsInTable("UiTextDict", "textEn")
    hasTextRu = FieldExistsInTable("UiTextDict", "textRu")
    hasContext = FieldExistsInTable("UiTextDict", "context")
    keyWhere = "captionKey='" & keyEsc & "' OR Trim(captionKey)='" & keyEsc & "' OR Trim(Replace(captionKey, Chr(160), ' '))='" & keyEsc & "'"

    If DCount("*", "UiTextDict", keyWhere) = 0 Then
        sql = "INSERT INTO UiTextDict(captionKey"
        If hasTextEn Then sql = sql & ", textEn"
        If hasTextRu Then sql = sql & ", textRu"
        If hasContext Then sql = sql & ", [context]"
        sql = sql & ") VALUES('" & keyEsc & "'"
        If hasTextEn Then sql = sql & ",'" & enEsc & "'"
        If hasTextRu Then
            If Len(Trim$(textRu)) > 0 Then
                sql = sql & ",'" & ruEsc & "'"
            Else
                sql = sql & ",Null"
            End If
        End If
        If hasContext Then sql = sql & ",'" & ctxEsc & "'"
        sql = sql & ")"
        db.Execute sql, dbFailOnError
    Else
        If hasTextEn Then
            db.Execute "UPDATE UiTextDict SET textEn='" & enEsc & "' WHERE " & keyWhere, dbFailOnError
        End If
        If hasTextRu Then
            If Len(Trim$(textRu)) > 0 Then
                db.Execute "UPDATE UiTextDict SET textRu='" & ruEsc & "' WHERE " & keyWhere, dbFailOnError
            Else
                db.Execute "UPDATE UiTextDict SET textRu=Null WHERE " & keyWhere, dbFailOnError
            End If
        End If
        If hasContext Then
            db.Execute "UPDATE UiTextDict SET [context]='" & ctxEsc & "' WHERE " & keyWhere, dbFailOnError
        End If
    End If
End Sub

Public Function UiText(ByVal captionKey As String, ByVal fallbackText As String, Optional ByVal lang As String = "") As String
    On Error GoTo Fail
    Dim langCode As String
    Dim v As Variant
    Dim keyEsc As String

    keyEsc = Replace(captionKey, "'", "''")

    If Len(Trim$(lang)) > 0 Then
        langCode = LCase$(Trim$(lang))
        If langCode <> "ru" And langCode <> "en" Then langCode = "en"
    Else
        langCode = UiCurrentLang()
    End If

    If langCode = "ru" Then
        v = TryLookupUiTextValue("textRu", keyEsc)
        If IsNull(v) Or Len(Trim$(CStr(v))) = 0 Then
            v = TryLookupUiTextValue("textEn", keyEsc)
        End If
    Else
        v = TryLookupUiTextValue("textEn", keyEsc)
        If IsNull(v) Or Len(Trim$(CStr(v))) = 0 Then
            v = TryLookupUiTextValue("textRu", keyEsc)
        End If
    End If

    If IsNull(v) Then
        UiText = fallbackText
    ElseIf Len(Trim$(CStr(v))) = 0 Then
        UiText = fallbackText
    Else
        UiText = CStr(v)
    End If
    Exit Function
Fail:
    UiText = fallbackText
End Function

Private Function TryLookupUiTextValue(ByVal fieldName As String, ByVal keyEsc As String) As Variant
    On Error GoTo Fail
    TryLookupUiTextValue = DLookup(fieldName, "UiTextDict", "captionKey='" & keyEsc & "' OR Trim(captionKey)='" & keyEsc & "' OR Trim(Replace(captionKey, Chr(160), ' '))='" & keyEsc & "'")
    Exit Function
Fail:
    TryLookupUiTextValue = Null
End Function

Private Function UiCurrentLang() As String
    On Error GoTo Fail
    Dim v As Variant
    Dim s As String

    v = DLookup("cfgValue", "AppConfig", "cfgKey='ui.lang'")
    If IsNull(v) Then
        UiCurrentLang = "en"
        Exit Function
    End If

    s = LCase$(Trim$(CStr(v)))
    If s <> "ru" And s <> "en" Then s = "en"
    UiCurrentLang = s
    Exit Function
Fail:
    UiCurrentLang = "en"
End Function

Public Sub W_SetUiLang(ByVal langCode As String, Optional ByVal rebuildQueries As Boolean = False, Optional ByVal rebuildForms As Boolean = False)
    Dim db As DAO.Database
    Dim s As String
    s = LCase$(Trim$(langCode))
    If s <> "ru" And s <> "en" Then s = "en"

    Set db = CurrentDb
    EnsureAppConfigSchema db
    db.Execute "UPDATE AppConfig SET cfgValue='" & Replace(s, "'", "''") & "' WHERE cfgKey='ui.lang'", dbFailOnError

    ' Backward-compatible mode: old calls passed flags in W_SetUiLang.
    If rebuildQueries Then
        W_CreateStage2Queries
        If rebuildForms Then W_CreateStage3Forms
        W_LocalizeManualUiForms
    End If
End Sub

Public Sub W_ApplyUiLanguage(ByVal langCode As String, Optional ByVal rebuildForms As Boolean = True)
    On Error GoTo Fail
    Dim s As String

    s = LCase$(Trim$(langCode))
    If s <> "ru" And s <> "en" Then s = "en"

    W_SetUiLang s
    W_CreateStage2Queries
    W_CreateStage4Reports
    If rebuildForms Then W_CreateStage3Forms
    W_LocalizeManualUiForms

    MsgBox "UI language set to '" & s & "'." & vbCrLf & _
           "Queries rebuilt: yes" & vbCrLf & _
           "Reports rebuilt: yes" & vbCrLf & _
           "Forms rebuilt: " & IIf(rebuildForms, "yes", "no") & vbCrLf & _
           "Manual forms localized: yes", vbInformation, "UI language"
    Exit Sub

Fail:
    MsgBox "UI language switch failed: " & Err.Description, vbExclamation, "UI language"
End Sub

Public Sub W_SetUiLangRu()
    W_ApplyUiLanguage "ru", True
End Sub

Public Sub W_SetUiLangEn()
    W_ApplyUiLanguage "en", True
End Sub

Public Function W_GetUiLang() As String
    W_GetUiLang = UiCurrentLang()
End Function

Public Sub W_ToggleUiLang(Optional ByVal rebuildForms As Boolean = True)
    Dim nextLang As String
    If LCase$(W_GetUiLang()) = "ru" Then
        nextLang = "en"
    Else
        nextLang = "ru"
    End If
    W_ApplyUiLanguage nextLang, rebuildForms
End Sub

Public Sub W_LocalizeManualUiForms()
    W_LocalizeManualUiForms_Core
End Sub

Private Sub LocalizeF1RegistryCaptions()
    On Error GoTo Fail
    Dim frm As Form
    Dim wasOpen As Boolean
    wasOpen = IsFormLoaded("F1_ScrapPieceRegistry")
    If wasOpen Then DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes

    DoCmd.OpenForm "F1_ScrapPieceRegistry", acDesign
    Set frm = Forms("F1_ScrapPieceRegistry")

    SafeSetFormCaption frm, UiText("f1.caption", "Scrap pieces registry")
    SafeSetControlCaption frm, "lblFormTitle", UiText("f1.title", "Scrap pieces registry")
    SafeSetAttachedLabel frm, "txtFindInventoryTag", UiText("f1.filter.find", "Find inventory tag")
    SafeSetAttachedLabel frm, "cboFilterMaterial", UiText("f1.filter.material", "Material")
    SafeSetAttachedLabel frm, "cboFilterStatus", UiText("f1.filter.status", "Status")
    SafeSetAttachedLabel frm, "cboFilterLocCode", UiText("f1.filter.location", "Location")
    SafeSetControlCaption frm, "cmdApplyFilters", UiText("f1.btn.apply", "Apply")
    SafeSetControlCaption frm, "cmdResetFilters", UiText("f1.btn.reset", "Reset")
    SafeSetControlCaption frm, "cmdOpenCard", UiText("f1.btn.open_card", "Open card")
    SafeSetControlCaption frm, "cmdNewPiece", UiText("f1.btn.new_piece", "New piece")
    ReplaceFreeLabelCaption frm, "Pieces list", UiText("f1.section.list", "Pieces list")
    ReplaceFreeLabelCaption frm, U("\u0421\u043f\u0438\u0441\u043e\u043a \u043a\u0443\u0441"), UiText("f1.section.list", "Pieces list")


    If APPLY_UI_GEOMETRY Then
    ' Width tuning for RU captions.
        If ControlExists(frm, "lblFormTitle") Then frm.Controls("lblFormTitle").Width = 12000
        If ControlExists(frm, "txtFindInventoryTag") Then frm.Controls("txtFindInventoryTag").Width = 2500
        If ControlExists(frm, "cboFilterMaterial") Then frm.Controls("cboFilterMaterial").Width = 2200
        If ControlExists(frm, "cboFilterStatus") Then frm.Controls("cboFilterStatus").Width = 1800
        If ControlExists(frm, "cboFilterLocCode") Then frm.Controls("cboFilterLocCode").Width = 1800
        SafeSetAttachedLabelWidth frm, "txtFindInventoryTag", 2600
        SafeSetAttachedLabelWidth frm, "cboFilterMaterial", 1900
        SafeSetAttachedLabelWidth frm, "cboFilterStatus", 1700
        SafeSetAttachedLabelWidth frm, "cboFilterLocCode", 1850
        If ControlExists(frm, "cmdApplyFilters") Then frm.Controls("cmdApplyFilters").Width = 1500
        If ControlExists(frm, "cmdResetFilters") Then frm.Controls("cmdResetFilters").Width = 1500
        If ControlExists(frm, "cmdOpenCard") Then frm.Controls("cmdOpenCard").Width = 1700
        If ControlExists(frm, "cmdNewPiece") Then frm.Controls("cmdNewPiece").Width = 1700
    
        ' Section label can be clipped after RU switch in some builds.
        ExpandFreeLabelWidth frm, UiText("f1.section.list", "Pieces list"), 2600
End If

    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes
    If wasOpen Then DoCmd.OpenForm "F1_ScrapPieceRegistry", acNormal
    Exit Sub
Fail:
    On Error Resume Next
    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes
End Sub

Private Sub LocalizeSF1ListCaptions()
    On Error GoTo Fail
    Dim frm As Form
    Dim wasOpen As Boolean
    Dim lbl As Control
    Dim newCaption As String

    wasOpen = IsFormLoaded("SF1_ScrapPieceList")
    If wasOpen Then DoCmd.Close acForm, "SF1_ScrapPieceList", acSaveYes

    DoCmd.OpenForm "SF1_ScrapPieceList", acDesign
    Set frm = Forms("SF1_ScrapPieceList")

    SafeSetFormCaption frm, UiText("sf1.caption", "Pieces list")
    For Each lbl In frm.Controls
        If lbl.ControlType = acLabel Then
            newCaption = MapSF1LabelCaption(CStr(Nz(lbl.Caption, "")))
            If Len(newCaption) > 0 Then lbl.Caption = newCaption
        End If
    Next lbl

    If APPLY_UI_GEOMETRY Then
    ' Datasheet widths for RU headers (avoid clipping).
        If ControlExists(frm, "txtAreaMm2") Then frm.Controls("txtAreaMm2").ColumnWidth = 1900
        If ControlExists(frm, "txtNapDeg") Then frm.Controls("txtNapDeg").ColumnWidth = 1800
        If ControlExists(frm, "txtStatus") Then frm.Controls("txtStatus").ColumnWidth = 1800
        If ControlExists(frm, "txtQuality") Then frm.Controls("txtQuality").ColumnWidth = 1900
        If ControlExists(frm, "txtLocationCode") Then frm.Controls("txtLocationCode").ColumnWidth = 1850
End If

    DoCmd.Close acForm, "SF1_ScrapPieceList", acSaveYes
    If wasOpen Then DoCmd.OpenForm "SF1_ScrapPieceList", acNormal
    Exit Sub
Fail:
    On Error Resume Next
    DoCmd.Close acForm, "SF1_ScrapPieceList", acSaveYes
End Sub

Private Function U(ByVal escaped As String) As String
    Dim i As Long
    Dim n As Long
    Dim out As String
    Dim chunk As String

    i = 1
    Do While i <= Len(escaped)
        If Mid$(escaped, i, 2) = "\u" And i + 5 <= Len(escaped) Then
            chunk = Mid$(escaped, i + 2, 4)
            If chunk Like "[0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f][0-9A-Fa-f]" Then
                n = CLng("&H" & chunk)
                out = out & ChrW$(n)
                i = i + 6
            Else
                out = out & Mid$(escaped, i, 1)
                i = i + 1
            End If
        Else
            out = out & Mid$(escaped, i, 1)
            i = i + 1
        End If
    Loop

    U = out
End Function

Private Function MapSF1LabelCaption(ByVal oldCaption As String) As String
    Dim s As String
    s = LCase$(Trim$(oldCaption))

    Select Case s
        Case "inv tag", "inventory tag"
            MapSF1LabelCaption = UiText("f1.col.inventoryTag", oldCaption)
        Case "material"
            MapSF1LabelCaption = UiText("f1.col.material", oldCaption)
        Case "status"
            MapSF1LabelCaption = UiText("f1.col.status", oldCaption)
        Case "quality"
            MapSF1LabelCaption = UiText("f1.col.quality", oldCaption)
        Case "location", "storage"
            MapSF1LabelCaption = UiText("f1.col.location", oldCaption)
        Case "area, mm2", "area, mm^2", "area mm2"
            MapSF1LabelCaption = UiText("f1.col.area", oldCaption)
        Case "nap, deg", "nap angle, deg"
            MapSF1LabelCaption = UiText("f1.col.nap", oldCaption)
        Case "updated", "updated at"
            MapSF1LabelCaption = UiText("f1.col.updatedAt", oldCaption)
        Case Else
            MapSF1LabelCaption = ""
    End Select
End Function

Private Sub LocalizeF2CardCaptions()
    On Error GoTo Fail
    Dim frm As Form
    Dim wasOpen As Boolean

    wasOpen = IsFormLoaded("F2_ScrapPieceCard")
    If wasOpen Then DoCmd.Close acForm, "F2_ScrapPieceCard", acSaveYes

    DoCmd.OpenForm "F2_ScrapPieceCard", acDesign
    Set frm = Forms("F2_ScrapPieceCard")

    SafeSetFormCaption frm, UiText("f2.card.caption", "Scrap piece card")
    SafeSetControlCaption frm, "lblFormTitle", UiText("f2.card.title", UiText("f2.card.caption", "Scrap piece card"))

    SafeSetAttachedLabelAny frm, Array("txt_inventoryTag", "inventoryTag"), UiText("f2.card.col.inventoryTag", "Inv. tag")
    SafeSetAttachedLabelAny frm, Array("txt_areaMm2", "areaMm2"), UiText("f2.card.col.areaMm2", "Area, mm2")
    SafeSetAttachedLabelAny frm, Array("txt_bboxWidthMm", "bboxWidthMm"), UiText("f2.card.col.bboxWidthMm", "Bbox width, mm")
    SafeSetAttachedLabelAny frm, Array("txt_bboxHeightMm", "bboxHeightMm"), UiText("f2.card.col.bboxHeightMm", "Bbox height, mm")
    SafeSetAttachedLabelAny frm, Array("txt_maxSpanMm", "maxSpanMm"), UiText("f2.card.col.maxSpanMm", "Max span, mm")
    SafeSetAttachedLabelAny frm, Array("txt_napDirectionDeg", "napDirectionDeg"), UiText("f2.card.col.napDirectionDeg", "Nap, deg")
    SafeSetAttachedLabelAny frm, Array("txt_createdAt", "createdAt"), UiText("f2.card.col.createdAt", "Created")
    SafeSetAttachedLabelAny frm, Array("txt_updatedAt", "updatedAt"), UiText("f2.card.col.updatedAt", "Updated")
    SafeSetAttachedLabelAny frm, Array("txt_note", "note"), UiText("f2.card.col.note", "Note")
    SafeSetAttachedLabelAny frm, Array("cbo_materialId", "materialId"), UiText("f2.card.col.materialId", "Material")
    SafeSetAttachedLabelAny frm, Array("cbo_storageLocationId", "storageLocationId"), UiText("f2.card.col.storageLocationId", "Location")
    SafeSetAttachedLabelAny frm, Array("cbo_scrapQuality", "scrapQuality"), UiText("f2.card.col.scrapQuality", "Quality")
    SafeSetAttachedLabelAny frm, Array("cbo_scrapStatus", "scrapStatus"), UiText("f2.card.col.scrapStatus", "Status")
    SafeSetAttachedLabelAny frm, Array("txtReservedBy", "reservedBy"), UiText("f3.col.reservedBy", "Reserved by")

    SafeSetAttachedLabelAny frm, Array("cboContourPreviewMode", "contourPreviewMode"), UiText("f2.card.preview.mode", "Mode")
    SafeSetAttachedLabelAny frm, Array("txtContourPreviewPath", "contourPreviewPath"), UiText("f2.card.preview.output", "Status / path")
    SafeSetControlCaptionAny frm, Array("cmdOpenContourVisual", "cmdOpenPreview"), UiText("f2.card.preview.btn.open", "Open preview")
    SafeSetControlCaptionAny frm, Array("cmdReserveFromCard"), UiText("f3.btn.reserve", "Reserve scrap piece")
    SafeSetControlCaptionAny frm, Array("cmdReleaseFromCard"), UiText("f3.btn.release", "Release reservation")

    SafeSetCheckLabelAny frm, Array("chkNormalizeNap", "chkNormalizeContour"), UiText("f2.card.preview.normalize", "Normalize nap")
    ' Some F2 builds have free labels instead of attached labels for mode/normalize.
    SafeSetControlCaption frm, "Р СњР В°Р Т‘Р С—Р С‘РЎРѓРЎРЉ34", UiText("f2.card.preview.mode", "Mode")
    SafeSetControlCaption frm, "lblNormalizePiece", UiText("f2.card.preview.normalize", "Normalize nap")
    ReplaceFreeLabelCaption frm, "Mode", UiText("f2.card.preview.mode", "Mode")
    ReplaceFreeLabelCaption frm, "Normalize nap", UiText("f2.card.preview.normalize", "Normalize nap")
    ReplaceFreeLabelCaption frm, "Reservation", UiText("f2.card.section.reservation", "Reservation")
    ReplaceFreeLabelCaption frm, "Contour preview", UiText("f2.card.preview.section", "Contour preview")
    ReplaceFreeLabelCaption frm, "Operations history", UiText("f2.card.section.operations", "Operations history")
    ReplaceFreeLabelCaption frm, "Usage history", UiText("f2.card.section.usage", "Usage history")

    ' Vertical rhythm (16 px = 240 twips) for stable engineering layout.
    ' Keep False when geometry is tuned manually in Access designer.
    Const APPLY_F2_VERTICAL_LAYOUT As Boolean = APPLY_UI_GEOMETRY
    Const RHYTHM As Long = 240
    Const TOP_LABEL_Y As Long = 120
    Const TOP_CTRL_Y As Long = TOP_LABEL_Y + RHYTHM
    Const EDIT_LABEL_Y As Long = 760
    Const EDIT_CTRL_Y As Long = EDIT_LABEL_Y + RHYTHM
    Const RESV_SECTION_Y As Long = 1720
    Const RESV_LABEL_Y As Long = RESV_SECTION_Y + RHYTHM
    Const RESV_CTRL_Y As Long = RESV_LABEL_Y + RHYTHM
    Const PREVIEW_TITLE_Y As Long = RESV_SECTION_Y
    Const PREVIEW_LABEL_Y As Long = PREVIEW_TITLE_Y + RHYTHM
    Const PREVIEW_CTRL_Y As Long = PREVIEW_LABEL_Y + RHYTHM
    Const OPS_LABEL_Y As Long = RESV_CTRL_Y + 1490
    Const OPS_CTRL_Y As Long = OPS_LABEL_Y + RHYTHM
    Const USE_LABEL_Y As Long = OPS_CTRL_Y + 1940
    Const USE_CTRL_Y As Long = USE_LABEL_Y + RHYTHM

    If APPLY_F2_VERTICAL_LAYOUT Then
        SafeSetAttachedLabelTop frm, "txt_inventoryTag", TOP_LABEL_Y
        SafeSetAttachedLabelTop frm, "txt_areaMm2", TOP_LABEL_Y
        SafeSetAttachedLabelTop frm, "txt_bboxWidthMm", TOP_LABEL_Y
        SafeSetAttachedLabelTop frm, "txt_bboxHeightMm", TOP_LABEL_Y
        SafeSetAttachedLabelTop frm, "txt_maxSpanMm", TOP_LABEL_Y
        SafeSetAttachedLabelTop frm, "txt_napDirectionDeg", TOP_LABEL_Y
        SafeSetAttachedLabelTop frm, "txt_createdAt", TOP_LABEL_Y
        SafeSetAttachedLabelTop frm, "txt_updatedAt", TOP_LABEL_Y
        SafeSetControlTop frm, "txt_inventoryTag", TOP_CTRL_Y
        SafeSetControlTop frm, "txt_areaMm2", TOP_CTRL_Y
        SafeSetControlTop frm, "txt_bboxWidthMm", TOP_CTRL_Y
        SafeSetControlTop frm, "txt_bboxHeightMm", TOP_CTRL_Y
        SafeSetControlTop frm, "txt_maxSpanMm", TOP_CTRL_Y
        SafeSetControlTop frm, "txt_napDirectionDeg", TOP_CTRL_Y
        SafeSetControlTop frm, "txt_createdAt", TOP_CTRL_Y
        SafeSetControlTop frm, "txt_updatedAt", TOP_CTRL_Y

        SafeSetAttachedLabelTop frm, "cbo_materialId", EDIT_LABEL_Y
        SafeSetAttachedLabelTop frm, "cbo_storageLocationId", EDIT_LABEL_Y
        SafeSetAttachedLabelTop frm, "cbo_scrapQuality", EDIT_LABEL_Y
        SafeSetAttachedLabelTop frm, "txt_note", EDIT_LABEL_Y
        SafeSetControlTop frm, "cbo_materialId", EDIT_CTRL_Y
        SafeSetControlTop frm, "cbo_storageLocationId", EDIT_CTRL_Y
        SafeSetControlTop frm, "cbo_scrapQuality", EDIT_CTRL_Y
        SafeSetControlTop frm, "txt_note", EDIT_CTRL_Y

        SafeSetAttachedLabelTop frm, "cbo_scrapStatus", RESV_LABEL_Y
        SafeSetAttachedLabelTop frm, "txtReservedBy", RESV_LABEL_Y
        SafeSetControlTop frm, "cbo_scrapStatus", RESV_CTRL_Y
        SafeSetControlTop frm, "txtReservedBy", RESV_CTRL_Y
        SafeSetControlTop frm, "cmdReserveFromCard", RESV_CTRL_Y - 40
        SafeSetControlTop frm, "cmdReleaseFromCard", RESV_CTRL_Y - 40

        SafeSetAttachedLabelTop frm, "cboContourPreviewMode", PREVIEW_LABEL_Y
        SafeSetControlTop frm, "cboContourPreviewMode", PREVIEW_CTRL_Y
        SafeSetControlTop frm, "cmdOpenPreview", PREVIEW_CTRL_Y - 40
        SafeSetControlTop frm, "chkNormalizePiece", PREVIEW_CTRL_Y + 40
        SafeSetControlTop frm, "lblNormalizePiece", PREVIEW_CTRL_Y + 20

        ExpandFreeLabelTop frm, UiText("f2.card.section.reservation", "Reservation"), RESV_SECTION_Y
        ExpandFreeLabelTop frm, UiText("f2.card.preview.section", "Contour preview"), PREVIEW_TITLE_Y
        ExpandFreeLabelTop frm, UiText("f2.card.section.operations", "Operations history"), OPS_LABEL_Y
        ExpandFreeLabelTop frm, UiText("f2.card.section.usage", "Usage history"), USE_LABEL_Y
    End If

    If APPLY_UI_GEOMETRY Then
    ' Width tuning for RU captions on F2.
        SafeSetAttachedLabelWidth frm, "txt_inventoryTag", 1700
        SafeSetAttachedLabelWidth frm, "txt_areaMm2", 1500
        SafeSetAttachedLabelWidth frm, "txt_bboxWidthMm", 2100
        SafeSetAttachedLabelWidth frm, "txt_bboxHeightMm", 2100
        SafeSetAttachedLabelWidth frm, "txt_maxSpanMm", 1900
        SafeSetAttachedLabelWidth frm, "txt_napDirectionDeg", 1600
        SafeSetAttachedLabelWidth frm, "txt_createdAt", 1700
        SafeSetAttachedLabelWidth frm, "txt_updatedAt", 1700
        SafeSetAttachedLabelWidth frm, "cbo_materialId", 1700
        SafeSetAttachedLabelWidth frm, "cbo_storageLocationId", 1600
        SafeSetAttachedLabelWidth frm, "cbo_scrapQuality", 1450
        SafeSetAttachedLabelWidth frm, "txt_note", 1500
        SafeSetAttachedLabelWidth frm, "cbo_scrapStatus", 1200
        SafeSetAttachedLabelWidth frm, "txtReservedBy", 1700
        SafeSetAttachedLabelWidth frm, "cboContourPreviewMode", 1200
        SafeSetAttachedLabelWidth frm, "txtContourPreviewPath", 1900
    
        ' Top row spacing: avoid "Р СљР В°Р С”РЎРѓ. РЎР‚Р В°Р В·Р СР В°РЎвЂ¦...Р Р€Р С–Р С•Р В» Р Р†Р С•РЎР‚РЎРѓР В°..." overlap.
        SafeSetControlLeft frm, "txt_napDirectionDeg", 9000
        SafeSetAttachedLabelLeft frm, "txt_napDirectionDeg", 9000
        SafeSetAttachedLabelWidth frm, "txt_maxSpanMm", 1800
        SafeSetAttachedLabelWidth frm, "txt_napDirectionDeg", 1700
    
        ' Reservation/preview line spacing.
        If ControlExists(frm, "cbo_scrapStatus") Then
            frm.Controls("cbo_scrapStatus").Width = 2000
            On Error Resume Next
            frm.Controls("cbo_scrapStatus").ColumnWidths = "0;1800"
            On Error GoTo 0
        End If
        If ControlExists(frm, "cbo_scrapQuality") Then
            frm.Controls("cbo_scrapQuality").Width = 1900
            On Error Resume Next
            frm.Controls("cbo_scrapQuality").ColumnWidths = "0;1700"
            On Error GoTo 0
        End If
        If ControlExists(frm, "txt_note") Then
            frm.Controls("txt_note").Left = 9800
            frm.Controls("txt_note").Width = 8600
        End If
        SafeSetAttachedLabelLeft frm, "txt_note", 9800
        If ControlExists(frm, "txtReservedBy") Then frm.Controls("txtReservedBy").Width = 2200
        If ControlExists(frm, "txtReservedBy") Then frm.Controls("txtReservedBy").Left = 2500
        SafeSetAttachedLabelLeft frm, "txtReservedBy", 2500
        If ControlExists(frm, "cmdReserveFromCard") Then frm.Controls("cmdReserveFromCard").Left = 5000
        If ControlExists(frm, "cmdReleaseFromCard") Then frm.Controls("cmdReleaseFromCard").Left = 5000
        If ControlExists(frm, "cboContourPreviewMode") Then
            frm.Controls("cboContourPreviewMode").Left = 9200
            frm.Controls("cboContourPreviewMode").Width = 1650
        End If
        SafeSetAttachedLabelLeft frm, "cboContourPreviewMode", 9200
        If ControlExists(frm, "cmdOpenPreview") Then frm.Controls("cmdOpenPreview").Left = 11150
        If ControlExists(frm, "chkNormalizePiece") Then frm.Controls("chkNormalizePiece").Left = 13750
        If ControlExists(frm, "lblNormalizePiece") Then frm.Controls("lblNormalizePiece").Left = 14100
    
        ExpandFreeLabelWidth frm, UiText("f2.card.section.reservation", "Reservation"), 2400
        ExpandFreeLabelWidth frm, UiText("f2.card.preview.section", "Contour preview"), 2400
        ExpandFreeLabelWidth frm, UiText("f2.card.section.operations", "Operations history"), 2700
        ExpandFreeLabelWidth frm, UiText("f2.card.section.usage", "Usage history"), 2900
End If

    DoCmd.Close acForm, "F2_ScrapPieceCard", acSaveYes
    If wasOpen Then DoCmd.OpenForm "F2_ScrapPieceCard", acNormal
    Exit Sub
Fail:
    On Error Resume Next
    DoCmd.Close acForm, "F2_ScrapPieceCard", acSaveYes
End Sub

Private Function IsFormLoaded(ByVal formName As String) As Boolean
    On Error GoTo Fail
    IsFormLoaded = CurrentProject.AllForms(formName).IsLoaded
    Exit Function
Fail:
    IsFormLoaded = False
End Function

Private Sub SafeSetFormCaption(ByVal frm As Form, ByVal captionText As String)
    On Error Resume Next
    frm.Caption = captionText
    On Error GoTo 0
End Sub

Private Sub SafeSetControlCaption(ByVal frm As Form, ByVal controlName As String, ByVal captionText As String)
    On Error Resume Next
    frm.Controls(controlName).Caption = captionText
    On Error GoTo 0
End Sub

Private Sub SafeSetControlCaptionAny(ByVal frm As Form, ByVal controlNames As Variant, ByVal captionText As String)
    Dim i As Long
    For i = LBound(controlNames) To UBound(controlNames)
        If ControlExists(frm, CStr(controlNames(i))) Then
            SafeSetControlCaption frm, CStr(controlNames(i)), captionText
            Exit Sub
        End If
    Next i
End Sub

Private Sub SafeSetAttachedLabel(ByVal frm As Form, ByVal controlName As String, ByVal captionText As String)
    On Error Resume Next
    frm.Controls(controlName).Controls(0).Caption = captionText
    On Error GoTo 0
End Sub

Private Sub SafeSetAttachedLabelWidth(ByVal frm As Form, ByVal controlName As String, ByVal twipsWidth As Long)
    On Error Resume Next
    frm.Controls(controlName).Controls(0).Width = twipsWidth
    On Error GoTo 0
End Sub

Private Sub SafeSetControlLeft(ByVal frm As Form, ByVal controlName As String, ByVal leftTwips As Long)
    On Error Resume Next
    frm.Controls(controlName).Left = leftTwips
    On Error GoTo 0
End Sub

Private Sub SafeSetAttachedLabelLeft(ByVal frm As Form, ByVal controlName As String, ByVal leftTwips As Long)
    On Error Resume Next
    frm.Controls(controlName).Controls(0).Left = leftTwips
    On Error GoTo 0
End Sub

Private Sub SafeSetControlTop(ByVal frm As Form, ByVal controlName As String, ByVal topTwips As Long)
    On Error Resume Next
    frm.Controls(controlName).Top = topTwips
    On Error GoTo 0
End Sub

Private Sub SafeSetAttachedLabelTop(ByVal frm As Form, ByVal controlName As String, ByVal topTwips As Long)
    On Error Resume Next
    frm.Controls(controlName).Controls(0).Top = topTwips
    On Error GoTo 0
End Sub

Private Sub SafeSetAttachedLabelAny(ByVal frm As Form, ByVal controlNames As Variant, ByVal captionText As String)
    Dim i As Long
    For i = LBound(controlNames) To UBound(controlNames)
        If ControlExists(frm, CStr(controlNames(i))) Then
            SafeSetAttachedLabel frm, CStr(controlNames(i)), captionText
            Exit Sub
        End If
    Next i
End Sub

Private Sub SafeSetCheckLabelAny(ByVal frm As Form, ByVal controlNames As Variant, ByVal captionText As String)
    Dim i As Long
    For i = LBound(controlNames) To UBound(controlNames)
        If ControlExists(frm, CStr(controlNames(i))) Then
            On Error Resume Next
            frm.Controls(controlNames(i)).Caption = captionText
            On Error GoTo 0
            Exit Sub
        End If
    Next i
End Sub

Private Function ControlExists(ByVal frm As Form, ByVal controlName As String) As Boolean
    On Error GoTo Fail
    Dim ctl As Control
    Set ctl = frm.Controls(controlName)
    ControlExists = True
    Exit Function
Fail:
    ControlExists = False
End Function

Private Sub ReplaceFreeLabelCaption(ByVal frm As Form, ByVal oldCaption As String, ByVal newCaption As String)
    On Error GoTo ExitSub
    Dim ctl As Control
    For Each ctl In frm.Controls
        If ctl.ControlType = acLabel Then
            If StrComp(Trim$(Nz(ctl.Caption, "")), oldCaption, vbTextCompare) = 0 Then
                ctl.Caption = newCaption
            End If
        End If
    Next ctl
ExitSub:
End Sub

Private Sub ExpandFreeLabelWidth(ByVal frm As Form, ByVal captionText As String, ByVal minWidth As Long)
    On Error GoTo ExitSub
    Dim ctl As Control
    For Each ctl In frm.Controls
        If ctl.ControlType = acLabel Then
            If StrComp(Trim$(Nz(ctl.Caption, "")), captionText, vbTextCompare) = 0 Then
                If ctl.Width < minWidth Then ctl.Width = minWidth
            End If
        End If
    Next ctl
ExitSub:
End Sub

Private Sub ExpandFreeLabelTop(ByVal frm As Form, ByVal captionText As String, ByVal topTwips As Long)
    On Error GoTo ExitSub
    Dim ctl As Control
    For Each ctl In frm.Controls
        If ctl.ControlType = acLabel Then
            If StrComp(Trim$(Nz(ctl.Caption, "")), captionText, vbTextCompare) = 0 Then
                ctl.Top = topTwips
            End If
        End If
    Next ctl
ExitSub:
End Sub

Public Sub W_UiAuditMissingRu()
    On Error GoTo Fail
    Dim cnt As Long
    cnt = DCount("*", "UiTextDict", "(textRu Is Null OR Trim(textRu)='')")

    MsgBox "UiTextDict audit:" & vbCrLf & _
           "Rows with empty textRu: " & CStr(cnt) & vbCrLf & _
           "Open table UiTextDict and fill textRu where needed.", vbInformation, "UI audit"
    Exit Sub
Fail:
    MsgBox "UI audit failed: " & Err.Description, vbExclamation, "UI audit"
End Sub

Public Sub W_UiAuditCoverage()
    On Error GoTo Fail
    Dim keys As Variant
    Dim i As Long
    Dim k As String
    Dim miss As String
    Dim emptyRu As String
    Dim cntMiss As Long
    Dim cntEmpty As Long
    Dim vRu As Variant
    Dim vEn As Variant
    Dim enText As String
    Dim ruText As String

    keys = W_UiCoverageKeys()

    For i = LBound(keys) To UBound(keys)
        k = CStr(keys(i))
        vEn = DLookup("textEn", "UiTextDict", "captionKey='" & Replace(k, "'", "''") & "' OR Trim(captionKey)='" & Replace(k, "'", "''") & "' OR Trim(Replace(captionKey, Chr(160), ' '))='" & Replace(k, "'", "''") & "'")
        vRu = DLookup("textRu", "UiTextDict", "captionKey='" & Replace(k, "'", "''") & "' OR Trim(captionKey)='" & Replace(k, "'", "''") & "' OR Trim(Replace(captionKey, Chr(160), ' '))='" & Replace(k, "'", "''") & "'")
        enText = Trim$(Nz(vEn, ""))
        ruText = Trim$(Nz(vRu, ""))

        If Len(enText) = 0 Then
            cntMiss = cntMiss + 1
            miss = miss & k & vbCrLf
        ElseIf Len(ruText) = 0 Then
            cntEmpty = cntEmpty + 1
            emptyRu = emptyRu & k & vbCrLf
        End If
    Next i

    MsgBox "UI coverage audit:" & vbCrLf & _
           "Missing keys: " & CStr(cntMiss) & vbCrLf & _
           "Empty textRu: " & CStr(cntEmpty) & vbCrLf & vbCrLf & _
           IIf(cntMiss > 0, "Missing:" & vbCrLf & miss & vbCrLf, "") & _
           IIf(cntEmpty > 0, "Empty textRu:" & vbCrLf & emptyRu, ""), _
           vbInformation, "UI coverage"
    Exit Sub
Fail:
    MsgBox "UI coverage audit failed: " & Err.Description, vbExclamation, "UI coverage"
End Sub

Private Function W_UiCoverageKeys() As Variant
    Dim s As String
    s = "f1.title|f1.caption|f1.section.list|f1.filter.find|f1.filter.material|f1.filter.status|f1.filter.location|f1.btn.apply|f1.btn.reset|f1.btn.open_card|f1.btn.new_piece|" & _
        "f1.col.inventoryTag|f1.col.material|f1.col.status|f1.col.quality|f1.col.location|f1.col.area|f1.col.nap|f1.col.updatedAt|sf1.caption|sf1.title|f2.card.btn.contour_visual|" & _
        "f2.card.caption|f2.card.title|f2.card.col.areaMm2|f2.card.col.bboxHeightMm|f2.card.col.bboxWidthMm|f2.card.col.createdAt|f2.card.col.inventoryTag|f2.card.col.materialId|" & _
        "f2.card.col.maxSpanMm|f2.card.col.napDirectionDeg|f2.card.col.note|f2.card.col.scrapQuality|f2.card.col.scrapStatus|f2.card.col.storageLocationId|f2.card.col.updatedAt|" & _
        "f2.card.preview.btn.open|f2.card.preview.btn.refresh|f2.card.preview.mode|f2.card.preview.normalize|f2.card.preview.output|f2.card.preview.section|f2.card.section.operations|" & _
        "f2.card.section.reservation|f2.card.section.system|f2.card.section.usage|f2.contour_json.caption|f2.contour_json.title|f2.contour_preview.btn.refresh|f2.contour_preview.caption|" & _
        "f2.contour_preview.col.areaMm2|f2.contour_preview.col.bboxHeightMm|f2.contour_preview.col.bboxWidthMm|f2.contour_preview.col.inventoryTag|f2.contour_preview.col.maxSpanMm|" & _
        "f2.contour_preview.col.napDirectionDeg|f2.contour_preview.label.preview|f2.contour_visual.btn.redraw|f2.contour_visual.caption|f2.contour_visual.col.areaMm2|" & _
        "f2.contour_visual.col.bboxHeightMm|f2.contour_visual.col.bboxWidthMm|f2.contour_visual.col.inventoryTag|f2.contour_visual.col.maxSpanMm|f2.contour_visual.col.napDirectionDeg|" & _
        "f2.contour_visual.mode.label|f2.contour_visual.mode.piece|f2.contour_visual.mode.scana3|f2.contour_visual.normalize.label|f2.contour_visual.output.label|f3.btn.reserve|" & _
        "f3.btn.release|f3.caption|f3.col.inventoryTag|f3.col.note|f3.col.reservedBy|f3.title|f4.btn.apply|f4.btn.clear|f4.caption|f4.col.fragmentId|f4.col.inventoryTag|" & _
        "f4.col.layoutRunId|f4.col.offsetXmm|f4.col.offsetYmm|f4.col.rotationDeg|f4.filter.inventoryTag|f4.title|r1.caption|r1.title|r2.caption|r2.title|sf2.tx.caption|" & _
        "sf2.tx.title|sf2.tx.col.after|sf2.tx.col.before|sf2.tx.col.inventoryTag|sf2.tx.col.sourceRef|sf2.tx.col.transAt|sf2.tx.col.transType|sf2.usage.caption|sf2.usage.title|" & _
        "sf2.usage.col.fragmentId|sf2.usage.col.inventoryTag|sf2.usage.col.layoutRunId|sf2.usage.col.offsetXmm|sf2.usage.col.offsetYmm|sf2.usage.col.rotationDeg|" & _
        "status.available|status.reserved|status.used|status.discarded|quality.good|quality.limited"
    W_UiCoverageKeys = Split(s, "|")
End Function

Public Sub W_RepairUiTextCoreRu()
    On Error GoTo Fail
    Dim db As DAO.Database
    Set db = CurrentDb
    EnsureUiTextDictSchema db
    EnsureAppConfigSchema db

    UpsertUiTextEscaped db, "f1.title", "Scrap pieces registry", "\u0420\u0435\u0435\u0441\u0442\u0440 \u043a\u0443\u0441\u043a\u043e\u0432", "F1"
    UpsertUiTextEscaped db, "f1.caption", "Scrap pieces registry", "\u0420\u0435\u0435\u0441\u0442\u0440 \u043a\u0443\u0441\u043a\u043e\u0432", "F1"
    UpsertUiTextEscaped db, "f1.section.list", "Pieces list", "\u0421\u043f\u0438\u0441\u043e\u043a \u043a\u0443\u0441\u043a\u043e\u0432", "F1 sections"
    UpsertUiTextEscaped db, "f1.filter.find", "Find inventory tag", "\u041f\u043e\u0438\u0441\u043a \u043f\u043e \u0438\u043d\u0432. \u043c\u0435\u0442\u043a\u0435", "F1 filters"
    UpsertUiTextEscaped db, "f1.filter.material", "Material", "\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b", "F1 filters"
    UpsertUiTextEscaped db, "f1.filter.status", "Status", "\u0421\u0442\u0430\u0442\u0443\u0441", "F1 filters"
    UpsertUiTextEscaped db, "f1.filter.location", "Storage", "\u0425\u0440\u0430\u043d\u0435\u043d\u0438\u0435", "F1 filters"
    UpsertUiTextEscaped db, "f1.btn.apply", "Apply", "\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c", "F1"
    UpsertUiTextEscaped db, "f1.btn.reset", "Reset", "\u0421\u0431\u0440\u043e\u0441", "F1"
    UpsertUiTextEscaped db, "f1.btn.open_card", "Open card", "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0443", "F1"
    UpsertUiTextEscaped db, "f1.btn.new_piece", "New piece", "\u041d\u043e\u0432\u044b\u0439 \u043a\u0443\u0441\u043e\u043a", "F1"
    UpsertUiTextEscaped db, "f1.col.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "F1 grid"
    UpsertUiTextEscaped db, "f1.col.material", "Material", "\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b", "F1 grid"
    UpsertUiTextEscaped db, "f1.col.status", "Status", "\u0421\u0442\u0430\u0442\u0443\u0441", "F1 grid"
    UpsertUiTextEscaped db, "f1.col.quality", "Quality", "\u041a\u0430\u0447\u0435\u0441\u0442\u0432\u043e", "F1 grid"
    UpsertUiTextEscaped db, "f1.col.location", "Storage", "\u0425\u0440\u0430\u043d\u0435\u043d\u0438\u0435", "F1 grid"
    UpsertUiTextEscaped db, "f1.col.area", "Area, mm2", "\u041f\u043b\u043e\u0449\u0430\u0434\u044c, \u043c\u043c2", "F1 grid"
    UpsertUiTextEscaped db, "f1.col.nap", "Nap angle, deg", "\u0423\u0433\u043e\u043b \u0432\u043e\u0440\u0441\u0430, deg", "F1 grid"
    UpsertUiTextEscaped db, "f1.col.updatedAt", "Updated at", "\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e", "F1 grid"
    UpsertUiTextEscaped db, "sf1.caption", "Pieces list", "\u0421\u043f\u0438\u0441\u043e\u043a \u043a\u0443\u0441\u043a\u043e\u0432", "F1"
    UpsertUiTextEscaped db, "sf1.title", "Pieces list", "\u0421\u043f\u0438\u0441\u043e\u043a \u043a\u0443\u0441\u043a\u043e\u0432", "F1"
    UpsertUiTextEscaped db, "f2.card.btn.contour_visual", "Contour view", "\u041a\u043e\u043d\u0442\u0443\u0440 (\u0432\u0438\u0437\u0443\u0430\u043b\u044c\u043d\u043e)", "F2 card"
    UpsertUiTextEscaped db, "f2.card.caption", "Scrap piece card", "\u041a\u0430\u0440\u0442\u043e\u0447\u043a\u0430 \u043a\u0443\u0441\u043a\u0430", "F2 card"
    UpsertUiTextEscaped db, "f2.card.title", "Scrap piece card", "\u041a\u0430\u0440\u0442\u043e\u0447\u043a\u0430 \u043a\u0443\u0441\u043a\u0430", "F2 card"
    UpsertUiTextEscaped db, "f2.card.col.areaMm2", "Area, mm2", "\u041f\u043b\u043e\u0449\u0430\u0434\u044c, \u043c\u043c2", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.bboxHeightMm", "Bounds height, mm", "\u0412\u044b\u0441\u043e\u0442\u0430 \u0433\u0430\u0431\u0430\u0440\u0438\u0442\u0430, \u043c\u043c", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.bboxWidthMm", "Bounds width, mm", "\u0428\u0438\u0440\u0438\u043d\u0430 \u0433\u0430\u0431\u0430\u0440\u0438\u0442\u0430, \u043c\u043c", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.createdAt", "Created at", "\u0421\u043e\u0437\u0434\u0430\u043d\u043e", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.materialId", "Material", "\u041c\u0430\u0442\u0435\u0440\u0438\u0430\u043b", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.maxSpanMm", "Max span, mm", "\u041c\u0430\u043a\u0441. \u0440\u0430\u0437\u043c\u0430\u0445, \u043c\u043c", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.napDirectionDeg", "Nap angle, deg", "\u0423\u0433\u043e\u043b \u0432\u043e\u0440\u0441\u0430, deg", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.note", "Note", "\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.scrapQuality", "Quality", "\u041a\u0430\u0447\u0435\u0441\u0442\u0432\u043e", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.scrapStatus", "Status", "\u0421\u0442\u0430\u0442\u0443\u0441", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.storageLocationId", "Location", "\u041b\u043e\u043a\u0430\u0446\u0438\u044f", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.col.updatedAt", "Updated at", "\u041e\u0431\u043d\u043e\u0432\u043b\u0435\u043d\u043e", "F2 card fields"
    UpsertUiTextEscaped db, "f2.card.preview.btn.open", "Open preview", "\u041e\u0442\u043a\u0440\u044b\u0442\u044c \u043f\u0440\u0435\u0432\u044c\u044e", "F2 card preview"
    UpsertUiTextEscaped db, "f2.card.preview.btn.refresh", "Refresh only", "\u0422\u043e\u043b\u044c\u043a\u043e \u043e\u0431\u043d\u043e\u0432\u0438\u0442\u044c", "F2 card preview"
    UpsertUiTextEscaped db, "f2.card.preview.mode", "Mode", "\u0420\u0435\u0436\u0438\u043c", "F2 card preview"
    UpsertUiTextEscaped db, "f2.card.preview.normalize", "Normalize nap", "\u041d\u043e\u0440\u043c\u0430\u043b\u0438\u0437\u043e\u0432\u0430\u0442\u044c \u0432\u043e\u0440\u0441", "F2 card preview"
    UpsertUiTextEscaped db, "f2.card.preview.output", "Status / path", "\u0421\u0442\u0430\u0442\u0443\u0441 / \u043f\u0443\u0442\u044c", "F2 card preview"
    UpsertUiTextEscaped db, "f2.card.preview.section", "Contour preview", "\u041f\u0440\u0435\u0432\u044c\u044e \u043a\u043e\u043d\u0442\u0443\u0440\u0430", "F2 card preview"
    UpsertUiTextEscaped db, "f2.card.section.operations", "Operations", "\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u0438", "F2 card sections"
    UpsertUiTextEscaped db, "f2.card.section.reservation", "Reservation", "\u0420\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435", "F2 card sections"
    UpsertUiTextEscaped db, "f2.card.section.system", "System", "\u0421\u0438\u0441\u0442\u0435\u043c\u043d\u044b\u0435 \u043f\u043e\u043b\u044f", "F2 card sections"
    UpsertUiTextEscaped db, "f2.card.section.usage", "Usage history", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f", "F2 card sections"
    UpsertUiTextEscaped db, "f2.contour_json.caption", "Contour (JSON)", "\u041a\u043e\u043d\u0442\u0443\u0440 (JSON)", "F2 contour"
    UpsertUiTextEscaped db, "f2.contour_json.title", "Contour (JSON)", "\u041a\u043e\u043d\u0442\u0443\u0440 (JSON)", "F2 contour"
    UpsertUiTextEscaped db, "f2.contour_preview.btn.refresh", "Refresh", "\u041e\u0431\u043d\u043e\u0432\u0438\u0442\u044c", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_preview.caption", "Contour preview", "\u041f\u0440\u0435\u0432\u044c\u044e \u043a\u043e\u043d\u0442\u0443\u0440\u0430", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_preview.col.areaMm2", "Area, mm2", "\u041f\u043b\u043e\u0449\u0430\u0434\u044c, \u043c\u043c2", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_preview.col.bboxHeightMm", "Bounds height, mm", "\u0412\u044b\u0441\u043e\u0442\u0430 \u0433\u0430\u0431\u0430\u0440\u0438\u0442\u0430, \u043c\u043c", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_preview.col.bboxWidthMm", "Bounds width, mm", "\u0428\u0438\u0440\u0438\u043d\u0430 \u0433\u0430\u0431\u0430\u0440\u0438\u0442\u0430, \u043c\u043c", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_preview.col.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_preview.col.maxSpanMm", "Max span, mm", "\u041c\u0430\u043a\u0441. \u0440\u0430\u0437\u043c\u0430\u0445, \u043c\u043c", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_preview.col.napDirectionDeg", "Nap angle, deg", "\u0423\u0433\u043e\u043b \u0432\u043e\u0440\u0441\u0430, deg", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_preview.label.preview", "Preview", "\u041f\u0440\u0435\u0432\u044c\u044e", "F2 contour preview"
    UpsertUiTextEscaped db, "f2.contour_visual.btn.redraw", "Redraw", "\u041f\u0435\u0440\u0435\u0440\u0438\u0441\u043e\u0432\u0430\u0442\u044c", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.caption", "Contour visual", "\u041a\u043e\u043d\u0442\u0443\u0440 (\u0432\u0438\u0437\u0443\u0430\u043b\u044c\u043d\u043e)", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.col.areaMm2", "Area, mm2", "\u041f\u043b\u043e\u0449\u0430\u0434\u044c, \u043c\u043c2", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.col.bboxHeightMm", "Bounds height, mm", "\u0412\u044b\u0441\u043e\u0442\u0430 \u0433\u0430\u0431\u0430\u0440\u0438\u0442\u0430, \u043c\u043c", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.col.bboxWidthMm", "Bounds width, mm", "\u0428\u0438\u0440\u0438\u043d\u0430 \u0433\u0430\u0431\u0430\u0440\u0438\u0442\u0430, \u043c\u043c", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.col.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.col.maxSpanMm", "Max span, mm", "\u041c\u0430\u043a\u0441. \u0440\u0430\u0437\u043c\u0430\u0445, \u043c\u043c", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.col.napDirectionDeg", "Nap angle, deg", "\u0423\u0433\u043e\u043b \u0432\u043e\u0440\u0441\u0430, deg", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.mode.label", "Mode", "\u0420\u0435\u0436\u0438\u043c", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.mode.piece", "Piece (normalized)", "\u041a\u0443\u0441\u043e\u043a (\u043d\u043e\u0440\u043c\u0430\u043b\u0438\u0437.)", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.mode.scana3", "Scan A3 (original)", "\u0421\u043a\u0430\u043d A3 (\u0438\u0441\u0445\u043e\u0434\u043d\u043e\u0435)", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.normalize.label", "Normalization", "\u041d\u043e\u0440\u043c\u0430\u043b\u0438\u0437\u0430\u0446\u0438\u044f", "F2 contour visual"
    UpsertUiTextEscaped db, "f2.contour_visual.output.label", "Output", "\u0412\u044b\u0432\u043e\u0434", "F2 contour visual"
    UpsertUiTextEscaped db, "f3.btn.reserve", "Reserve", "\u0417\u0430\u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043e\u0432\u0430\u0442\u044c", "F3"
    UpsertUiTextEscaped db, "f3.btn.release", "Release reservation", "\u0421\u043d\u044f\u0442\u044c \u0440\u0435\u0437\u0435\u0440\u0432", "F3"
    UpsertUiTextEscaped db, "f3.caption", "Reservation", "\u0420\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435", "F3"
    UpsertUiTextEscaped db, "f3.col.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "F3 grid"
    UpsertUiTextEscaped db, "f3.col.note", "Note", "\u041a\u043e\u043c\u043c\u0435\u043d\u0442\u0430\u0440\u0438\u0439", "F3 grid"
    UpsertUiTextEscaped db, "f3.col.reservedBy", "Reserved for", "\u0420\u0435\u0437\u0435\u0440\u0432 \u043f\u043e\u0434", "F3 grid"
    UpsertUiTextEscaped db, "f3.title", "Reservation", "\u0420\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043e\u0432\u0430\u043d\u0438\u0435", "F3"
    UpsertUiTextEscaped db, "f4.btn.apply", "Apply", "\u041f\u0440\u0438\u043c\u0435\u043d\u0438\u0442\u044c", "F4"
    UpsertUiTextEscaped db, "f4.btn.clear", "Clear", "\u041e\u0447\u0438\u0441\u0442\u0438\u0442\u044c", "F4"
    UpsertUiTextEscaped db, "f4.caption", "Usage history", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f", "F4"
    UpsertUiTextEscaped db, "f4.col.fragmentId", "Fragment", "\u0424\u0440\u0430\u0433\u043c\u0435\u043d\u0442", "F4 grid"
    UpsertUiTextEscaped db, "f4.col.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "F4 grid"
    UpsertUiTextEscaped db, "f4.col.layoutRunId", "Layout run", "\u0417\u0430\u043f\u0443\u0441\u043a \u0440\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0438", "F4 grid"
    UpsertUiTextEscaped db, "f4.col.offsetXmm", "Offset X, mm", "\u0421\u043c\u0435\u0449\u0435\u043d\u0438\u0435 X, \u043c\u043c", "F4 grid"
    UpsertUiTextEscaped db, "f4.col.offsetYmm", "Offset Y, mm", "\u0421\u043c\u0435\u0449\u0435\u043d\u0438\u0435 Y, \u043c\u043c", "F4 grid"
    UpsertUiTextEscaped db, "f4.col.rotationDeg", "Rotation, deg", "\u041f\u043e\u0432\u043e\u0440\u043e\u0442, deg", "F4 grid"
    UpsertUiTextEscaped db, "f4.filter.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "F4 filters"
    UpsertUiTextEscaped db, "f4.title", "Usage history", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f", "F4"
    UpsertUiTextEscaped db, "r1.caption", "R1 Pick List", "\u0052\u0031 \u041b\u0438\u0441\u0442 \u043e\u0442\u0431\u043e\u0440\u0430", "Reports"
    UpsertUiTextEscaped db, "r1.title", "Pick list", "\u041b\u0438\u0441\u0442 \u043e\u0442\u0431\u043e\u0440\u0430", "Reports"
    UpsertUiTextEscaped db, "r2.caption", "R2 Traceability", "\u0052\u0032 \u0422\u0440\u0430\u0441\u0441\u0438\u0440\u0443\u0435\u043c\u043e\u0441\u0442\u044c", "Reports"
    UpsertUiTextEscaped db, "r2.title", "Traceability", "\u0422\u0440\u0430\u0441\u0441\u0438\u0440\u0443\u0435\u043c\u043e\u0441\u0442\u044c", "Reports"
    UpsertUiTextEscaped db, "sf2.tx.caption", "Transactions", "\u041e\u043f\u0435\u0440\u0430\u0446\u0438\u0438 \u043f\u043e \u043a\u0443\u0441\u043a\u0443", "SF2 tx"
    UpsertUiTextEscaped db, "sf2.tx.title", "Scrap transaction history", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u043e\u043f\u0435\u0440\u0430\u0446\u0438\u0439", "SF2 tx"
    UpsertUiTextEscaped db, "sf2.tx.col.after", "After", "\u0421\u0442\u0430\u043b\u043e", "SF2 tx grid"
    UpsertUiTextEscaped db, "sf2.tx.col.before", "Before", "\u0411\u044b\u043b\u043e", "SF2 tx grid"
    UpsertUiTextEscaped db, "sf2.tx.col.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "SF2 tx grid"
    UpsertUiTextEscaped db, "sf2.tx.col.sourceRef", "Source ref", "\u041e\u0441\u043d\u043e\u0432\u0430\u043d\u0438\u0435", "SF2 tx grid"
    UpsertUiTextEscaped db, "sf2.tx.col.transAt", "Date/time", "\u0414\u0430\u0442\u0430/\u0432\u0440\u0435\u043c\u044f", "SF2 tx grid"
    UpsertUiTextEscaped db, "sf2.tx.col.transType", "Type", "\u0422\u0438\u043f", "SF2 tx grid"
    UpsertUiTextEscaped db, "sf2.usage.caption", "Usage", "\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u0435", "SF2 usage"
    UpsertUiTextEscaped db, "sf2.usage.title", "Scrap usage history", "\u0418\u0441\u0442\u043e\u0440\u0438\u044f \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u0438\u044f", "SF2 usage"
    UpsertUiTextEscaped db, "sf2.usage.col.fragmentId", "Fragment", "\u0424\u0440\u0430\u0433\u043c\u0435\u043d\u0442", "SF2 usage grid"
    UpsertUiTextEscaped db, "sf2.usage.col.inventoryTag", "Inventory tag", "\u0418\u043d\u0432. \u043c\u0435\u0442\u043a\u0430", "SF2 usage grid"
    UpsertUiTextEscaped db, "sf2.usage.col.layoutRunId", "Layout run", "\u0417\u0430\u043f\u0443\u0441\u043a \u0440\u0430\u0441\u043a\u043b\u0430\u0434\u043a\u0438", "SF2 usage grid"
    UpsertUiTextEscaped db, "sf2.usage.col.offsetXmm", "Offset X, mm", "\u0421\u043c\u0435\u0449\u0435\u043d\u0438\u0435 X, \u043c\u043c", "SF2 usage grid"
    UpsertUiTextEscaped db, "sf2.usage.col.offsetYmm", "Offset Y, mm", "\u0421\u043c\u0435\u0449\u0435\u043d\u0438\u0435 Y, \u043c\u043c", "SF2 usage grid"
    UpsertUiTextEscaped db, "sf2.usage.col.rotationDeg", "Rotation, deg", "\u041f\u043e\u0432\u043e\u0440\u043e\u0442, deg", "SF2 usage grid"
    UpsertUiTextEscaped db, "status.available", "Available", "\u0414\u043e\u0441\u0442\u0443\u043f\u0435\u043d", "Dictionaries"
    UpsertUiTextEscaped db, "status.reserved", "Reserved", "\u0417\u0430\u0440\u0435\u0437\u0435\u0440\u0432\u0438\u0440\u043e\u0432\u0430\u043d", "Dictionaries"
    UpsertUiTextEscaped db, "status.used", "Used", "\u0418\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d", "Dictionaries"
    UpsertUiTextEscaped db, "status.discarded", "Discarded", "\u0421\u043f\u0438\u0441\u0430\u043d", "Dictionaries"
    UpsertUiTextEscaped db, "quality.good", "Good", "\u0425\u043e\u0440\u043e\u0448\u0435\u0435", "Dictionaries"
    UpsertUiTextEscaped db, "quality.limited", "Limited", "\u041e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d\u043d\u043e\u0435", "Dictionaries"

    MsgBox "Core UI dictionary repaired from canonical values (ASCII-safe).", vbInformation, "UI dictionary"
    Exit Sub
Fail:
    MsgBox "Core UI dictionary repair failed: " & Err.Description, vbExclamation, "UI dictionary"
End Sub

Private Sub UpsertUiTextEscaped(ByVal db As DAO.Database, ByVal captionKey As String, ByVal textEn As String, ByVal textRuEscaped As String, Optional ByVal explicitContext As String = "")
    UpsertUiText db, captionKey, textEn, U(textRuEscaped), explicitContext
End Sub

Private Sub EnsureUiTextDictSchema(ByVal db As DAO.Database)
    On Error Resume Next
    db.Execute "CREATE TABLE UiTextDict (captionKey TEXT(120) NOT NULL, textEn TEXT(255) NULL, textRu TEXT(255) NULL, [context] TEXT(80) NULL)", dbFailOnError
    db.Execute "CREATE UNIQUE INDEX ux_UiTextDict_captionKey ON UiTextDict(captionKey)", dbFailOnError
    On Error GoTo 0

    On Error Resume Next
    db.Execute "ALTER TABLE UiTextDict ADD COLUMN textEn TEXT(255) NULL", dbFailOnError
    db.Execute "ALTER TABLE UiTextDict ADD COLUMN textRu TEXT(255) NULL", dbFailOnError
    db.Execute "ALTER TABLE UiTextDict ADD COLUMN [context] TEXT(80) NULL", dbFailOnError
    On Error GoTo 0

    If FieldExistsInTable("UiTextDict", "captionText") Then
        On Error Resume Next
        db.Execute "UPDATE UiTextDict SET textEn = captionText WHERE (textEn Is Null OR textEn='') AND captionText Is Not Null", dbFailOnError
        db.Execute "ALTER TABLE UiTextDict DROP COLUMN captionText", dbFailOnError
        On Error GoTo 0
    End If

    ' Normalize key values from legacy/broken imports.
    On Error Resume Next
    db.Execute "UPDATE UiTextDict SET captionKey = Trim(Replace(captionKey, Chr(160), ' ')) WHERE captionKey <> Trim(Replace(captionKey, Chr(160), ' '))", dbFailOnError
    On Error GoTo 0
End Sub

Private Sub EnsureAppConfigSchema(ByVal db As DAO.Database)
    On Error Resume Next
    db.Execute "CREATE TABLE AppConfig (cfgKey TEXT(64) NOT NULL, cfgValue TEXT(64) NULL)", dbFailOnError
    db.Execute "CREATE UNIQUE INDEX ux_AppConfig_cfgKey ON AppConfig(cfgKey)", dbFailOnError
    On Error GoTo 0

    If DCount("*", "AppConfig", "cfgKey='ui.lang'") = 0 Then
        db.Execute "INSERT INTO AppConfig(cfgKey, cfgValue) VALUES('ui.lang','en')", dbFailOnError
    End If
End Sub

Public Sub W_FixUiTextDictMojibake()
    On Error GoTo Fail
    Dim rs As DAO.Recordset
    Dim fixedCount As Long
    Dim oldRu As String
    Dim newRu As String
    Dim oldCtx As String
    Dim newCtx As String

    Set rs = CurrentDb.OpenRecordset("SELECT captionKey, textRu, [context] FROM UiTextDict", dbOpenDynaset)
    Do While Not rs.EOF
        oldRu = Nz(rs.Fields("textRu").Value, "")
        newRu = FixUtf8AsAnsiText(oldRu)

        oldCtx = Nz(rs.Fields("context").Value, "")
        newCtx = FixUtf8AsAnsiText(oldCtx)

        If newRu <> oldRu Or newCtx <> oldCtx Then
            rs.Edit
            If newRu <> oldRu Then rs.Fields("textRu").Value = newRu
            If newCtx <> oldCtx Then rs.Fields("context").Value = newCtx
            rs.Update
            fixedCount = fixedCount + 1
        End If
        rs.MoveNext
    Loop

    rs.Close
    Set rs = Nothing
    MsgBox "UiTextDict encoding fix completed. Rows changed: " & CStr(fixedCount), vbInformation, "UI encoding"
    Exit Sub
Fail:
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    Set rs = Nothing
    MsgBox "UiTextDict encoding fix failed: " & Err.Description, vbExclamation, "UI encoding"
End Sub

Public Sub W_FixMojibakeEverywhere()
    On Error GoTo Fail
    Dim db As DAO.Database
    Dim tdf As DAO.TableDef
    Dim fld As DAO.Field
    Dim rs As DAO.Recordset
    Dim whereClause As String
    Dim changedRows As Long
    Dim changedFields As Long
    Dim tableCount As Long
    Dim rowChanged As Boolean
    Dim oldVal As String
    Dim newVal As String

    Set db = CurrentDb

    For Each tdf In db.TableDefs
        If Left$(tdf.Name, 4) <> "MSys" Then
            whereClause = ""
            For Each fld In tdf.Fields
                If fld.Type = dbText Or fld.Type = dbMemo Then
                    If whereClause <> "" Then whereClause = whereClause & " OR "
                    whereClause = whereClause & "(" & fld.Name & " Is Not Null)"
                End If
            Next fld

            If whereClause <> "" Then
                Set rs = db.OpenRecordset("SELECT * FROM [" & tdf.Name & "] WHERE " & whereClause, dbOpenDynaset)
                Do While Not rs.EOF
                    rowChanged = False
                    For Each fld In rs.Fields
                        If fld.Type = dbText Or fld.Type = dbMemo Then
                            oldVal = Nz(fld.Value, "")
                            If Len(oldVal) > 0 Then
                                newVal = FixUtf8AsAnsiText(oldVal)
                                If newVal <> oldVal Then
                                    If Not rowChanged Then rs.Edit
                                    fld.Value = newVal
                                    rowChanged = True
                                    changedFields = changedFields + 1
                                End If
                            End If
                        End If
                    Next fld
                    If rowChanged Then
                        rs.Update
                        changedRows = changedRows + 1
                    End If
                    rs.MoveNext
                Loop
                rs.Close
                Set rs = Nothing
                tableCount = tableCount + 1
            End If
        End If
    Next tdf

    MsgBox "Encoding fix completed." & vbCrLf & _
           "Tables checked: " & CStr(tableCount) & vbCrLf & _
           "Rows changed: " & CStr(changedRows) & vbCrLf & _
           "Fields changed: " & CStr(changedFields), vbInformation, "Encoding fix"
    Exit Sub
Fail:
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    Set rs = Nothing
    MsgBox "Encoding fix failed: " & Err.Description, vbExclamation, "Encoding fix"
End Sub

Public Sub W_RepairAllRussianText()
    On Error GoTo Fail
    Dim msg As String

    W_FixMojibakeEverywhere
    W_NormalizeScrapEnums
    W_SeedUiTextDict
    W_SetUiLang "ru"
    W_CreateStage2Queries
    W_CreateStage3Forms

    msg = "Global text repair completed." & vbCrLf & _
          "Done:" & vbCrLf & _
          "1) Encoding fixed in text fields" & vbCrLf & _
          "2) Scrap status/quality normalized to canonical codes" & vbCrLf & _
          "3) UiTextDict reseeded" & vbCrLf & _
          "4) UI language set to ru" & vbCrLf & _
          "5) Stage 2 queries rebuilt" & vbCrLf & _
          "6) Stage 3 forms rebuilt"
    MsgBox msg, vbInformation, "Text repair"
    Exit Sub

Fail:
    MsgBox "Global text repair failed: " & Err.Description, vbExclamation, "Text repair"
End Sub

Public Sub W_NormalizeScrapEnums()
    On Error GoTo Fail
    Dim rs As DAO.Recordset
    Dim oldStatus As String
    Dim oldQuality As String
    Dim newStatus As String
    Dim newQuality As String
    Dim changed As Long

    Set rs = CurrentDb.OpenRecordset("SELECT id, scrapStatus, scrapQuality FROM ScrapPiece", dbOpenDynaset)
    Do While Not rs.EOF
        oldStatus = Nz(rs.Fields("scrapStatus").Value, "")
        oldQuality = Nz(rs.Fields("scrapQuality").Value, "")

        newStatus = NormalizeScrapStatusValue(oldStatus)
        newQuality = NormalizeScrapQualityValue(oldQuality)

        If newStatus <> oldStatus Or newQuality <> oldQuality Then
            rs.Edit
            If newStatus <> oldStatus Then rs.Fields("scrapStatus").Value = newStatus
            If newQuality <> oldQuality Then rs.Fields("scrapQuality").Value = newQuality
            rs.Update
            changed = changed + 1
        End If
        rs.MoveNext
    Loop
    rs.Close
    Set rs = Nothing

    MsgBox "Scrap enum normalization completed. Rows changed: " & CStr(changed), vbInformation, "Scrap normalize"
    Exit Sub

Fail:
    On Error Resume Next
    If Not rs Is Nothing Then rs.Close
    Set rs = Nothing
    MsgBox "Scrap enum normalization failed: " & Err.Description, vbExclamation, "Scrap normalize"
End Sub

Private Function NormalizeScrapStatusValue(ByVal v As String) As String
    Dim s As String
    s = LCase$(Trim$(FixUtf8AsAnsiText(v)))
    s = Replace(s, ChrW$(1105), ChrW$(1077))

    If s = "" Then
        NormalizeScrapStatusValue = ""
    ElseIf s = "available" Or s = "avail" Then
        NormalizeScrapStatusValue = "Available"
    ElseIf s = "reserved" Or s = "reserve" Then
        NormalizeScrapStatusValue = "Reserved"
    ElseIf s = "used" Or s = "in use" Then
        NormalizeScrapStatusValue = "Used"
    ElseIf s = "discarded" Or s = "discard" Then
        NormalizeScrapStatusValue = "Discarded"
    Else
        NormalizeScrapStatusValue = v
    End If
End Function

Private Function NormalizeScrapQualityValue(ByVal v As String) As String
    Dim s As String
    s = LCase$(Trim$(FixUtf8AsAnsiText(v)))
    s = Replace(s, ChrW$(1105), ChrW$(1077))

    If s = "" Then
        NormalizeScrapQualityValue = ""
    ElseIf s = "good" Or s = "ok" Then
        NormalizeScrapQualityValue = "Good"
    ElseIf s = "limited" Or s = "reject" Then
        NormalizeScrapQualityValue = "Limited"
    Else
        NormalizeScrapQualityValue = v
    End If
End Function

Private Function FixUtf8AsAnsiText(ByVal s As String) As String
    On Error GoTo Fallback
    Dim markerCount As Long
    Dim converted As String
    Dim stmIn As Object
    Dim stmOut As Object
    Dim b As Variant

    If Len(s) = 0 Then
        FixUtf8AsAnsiText = s
        Exit Function
    End If

    markerCount = CountMojibakeMarkers(s)
    If markerCount = 0 Then
        FixUtf8AsAnsiText = s
        Exit Function
    End If

    Set stmIn = CreateObject("ADODB.Stream")
    stmIn.Type = 2 ' text
    stmIn.Charset = "windows-1251"
    stmIn.Open
    stmIn.WriteText s
    stmIn.Position = 0
    stmIn.Type = 1 ' binary
    b = stmIn.Read
    stmIn.Close

    Set stmOut = CreateObject("ADODB.Stream")
    stmOut.Type = 1 ' binary
    stmOut.Open
    stmOut.Write b
    stmOut.Position = 0
    stmOut.Type = 2 ' text
    stmOut.Charset = "utf-8"
    converted = stmOut.ReadText
    stmOut.Close

    If InStr(converted, ChrW(&HFFFD)) > 0 Then
        FixUtf8AsAnsiText = s
    Else
        FixUtf8AsAnsiText = converted
    End If
    Exit Function
Fallback:
    FixUtf8AsAnsiText = s
End Function

Private Function CountMojibakeMarkers(ByVal s As String) As Long
    Dim i As Long
    Dim ch As Integer
    Dim cnt As Long

    ' Typical mojibake markers for UTF-8 text interpreted as CP1251:
    ' "Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћСћР В РІР‚в„ўР вЂ™Р’В ", "Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р вЂ™Р’В Р В Р’В Р Р†Р вЂљРІвЂћвЂ“", "Р В Р’В Р вЂ™Р’В Р В РІР‚в„ўР вЂ™Р’В Р В Р’В Р В РІР‚В Р В Р’В Р Р†Р вЂљРЎв„ўР В Р вЂ Р Р†Р вЂљРЎвЂєР РЋРЎвЂє".
    For i = 1 To Len(s)
        ch = AscW(Mid$(s, i, 1))
        If ch = 1056 Or ch = 1057 Or ch = 1042 Then cnt = cnt + 1
    Next i
    CountMojibakeMarkers = cnt
End Function

Private Function FieldExistsInTable(ByVal tableName As String, ByVal fieldName As String) As Boolean
    On Error GoTo Fail
    Dim tdf As DAO.TableDef
    Dim fld As DAO.Field

    Set tdf = CurrentDb.TableDefs(tableName)
    For Each fld In tdf.Fields
        If StrComp(fld.Name, fieldName, vbTextCompare) = 0 Then
            FieldExistsInTable = True
            Exit Function
        End If
    Next fld
    FieldExistsInTable = False
    Exit Function
Fail:
    FieldExistsInTable = False
End Function

Private Function ResolveUiContext(ByVal captionKey As String, ByVal explicitContext As String) As String
    If Len(Trim$(explicitContext)) > 0 Then
        ResolveUiContext = Trim$(explicitContext)
    ElseIf InStr(1, captionKey, "f1.", vbTextCompare) = 1 Then
        ResolveUiContext = "F1"
    ElseIf InStr(1, captionKey, "f2.", vbTextCompare) = 1 Then
        ResolveUiContext = "F2"
    ElseIf InStr(1, captionKey, "f3.", vbTextCompare) = 1 Then
        ResolveUiContext = "F3"
    ElseIf InStr(1, captionKey, "f4.", vbTextCompare) = 1 Then
        ResolveUiContext = "F4"
    ElseIf InStr(1, captionKey, "sf2.", vbTextCompare) = 1 Then
        ResolveUiContext = "SF2"
    Else
        ResolveUiContext = ""
    End If
End Function


