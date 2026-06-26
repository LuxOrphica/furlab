Attribute VB_Name = "W_UiLocalizeForms"
Option Compare Database
Option Explicit

' When False, localization updates captions only and keeps manual geometry intact.
Private Const APPLY_UI_GEOMETRY As Boolean = False

Public Sub W_LocalizeManualUiForms_Core()
    On Error GoTo Fail
    LocalizeF1RegistryCaptions_Core
    LocalizeSF1ListCaptions_Core
    LocalizeF2CardCaptions_Core
    Exit Sub
Fail:
    MsgBox "Manual form localization failed: " & Err.Description, vbExclamation, "UI language"
End Sub

Private Sub LocalizeF1RegistryCaptions_Core()
    On Error GoTo Fail
    Dim frm As Form
    Dim wasOpen As Boolean
    wasOpen = IsFormLoaded_Core("F1_ScrapPieceRegistry")
    If wasOpen Then DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes

    DoCmd.OpenForm "F1_ScrapPieceRegistry", acDesign
    Set frm = Forms("F1_ScrapPieceRegistry")

    SafeSetFormCaption_Core frm, UiText("f1.caption", "Scrap pieces registry")
    SafeSetControlCaption_Core frm, "lblFormTitle", UiText("f1.title", "Scrap pieces registry")
    SafeSetAttachedLabel_Core frm, "txtFindInventoryTag", UiText("f1.filter.find", "Find inventory tag")
    SafeSetAttachedLabel_Core frm, "cboFilterMaterial", UiText("f1.filter.material", "Material")
    SafeSetAttachedLabel_Core frm, "cboFilterStatus", UiText("f1.filter.status", "Status")
    SafeSetAttachedLabel_Core frm, "cboFilterLocCode", UiText("f1.filter.location", "Location")
    SafeSetControlCaption_Core frm, "cmdApplyFilters", UiText("f1.btn.apply", "Apply")
    SafeSetControlCaption_Core frm, "cmdResetFilters", UiText("f1.btn.reset", "Reset")
    SafeSetControlCaption_Core frm, "cmdOpenCard", UiText("f1.btn.open_card", "Open card")
    SafeSetControlCaption_Core frm, "cmdNewPiece", UiText("f1.btn.new_piece", "New piece")
    ReplaceFreeLabelCaption_Core frm, "Pieces list", UiText("f1.section.list", "Pieces list")
    ReplaceFreeLabelCaption_Core frm, DecodeEscaped("\u0421\u043f\u0438\u0441\u043e\u043a \u043a\u0443\u0441"), UiText("f1.section.list", "Pieces list")

    If APPLY_UI_GEOMETRY Then
        If ControlExists_Core(frm, "lblFormTitle") Then frm.Controls("lblFormTitle").Width = 12000
        If ControlExists_Core(frm, "txtFindInventoryTag") Then frm.Controls("txtFindInventoryTag").Width = 2500
        If ControlExists_Core(frm, "cboFilterMaterial") Then frm.Controls("cboFilterMaterial").Width = 2200
        If ControlExists_Core(frm, "cboFilterStatus") Then frm.Controls("cboFilterStatus").Width = 1800
        If ControlExists_Core(frm, "cboFilterLocCode") Then frm.Controls("cboFilterLocCode").Width = 1800
        SafeSetAttachedLabelWidth_Core frm, "txtFindInventoryTag", 2600
        SafeSetAttachedLabelWidth_Core frm, "cboFilterMaterial", 1900
        SafeSetAttachedLabelWidth_Core frm, "cboFilterStatus", 1700
        SafeSetAttachedLabelWidth_Core frm, "cboFilterLocCode", 1850
        If ControlExists_Core(frm, "cmdApplyFilters") Then frm.Controls("cmdApplyFilters").Width = 1500
        If ControlExists_Core(frm, "cmdResetFilters") Then frm.Controls("cmdResetFilters").Width = 1500
        If ControlExists_Core(frm, "cmdOpenCard") Then frm.Controls("cmdOpenCard").Width = 1700
        If ControlExists_Core(frm, "cmdNewPiece") Then frm.Controls("cmdNewPiece").Width = 1700
        ExpandFreeLabelWidth_Core frm, UiText("f1.section.list", "Pieces list"), 2600
    End If

    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes
    If wasOpen Then DoCmd.OpenForm "F1_ScrapPieceRegistry", acNormal
    Exit Sub
Fail:
    On Error Resume Next
    DoCmd.Close acForm, "F1_ScrapPieceRegistry", acSaveYes
End Sub

Private Sub LocalizeSF1ListCaptions_Core()
    On Error GoTo Fail
    Dim frm As Form
    Dim wasOpen As Boolean
    Dim lbl As Control
    Dim newCaption As String

    wasOpen = IsFormLoaded_Core("SF1_ScrapPieceList")
    If wasOpen Then DoCmd.Close acForm, "SF1_ScrapPieceList", acSaveYes

    DoCmd.OpenForm "SF1_ScrapPieceList", acDesign
    Set frm = Forms("SF1_ScrapPieceList")

    SafeSetFormCaption_Core frm, UiText("sf1.caption", "Pieces list")
    For Each lbl In frm.Controls
        If lbl.ControlType = acLabel Then
            newCaption = MapSF1LabelCaption_Core(CStr(Nz(lbl.Caption, "")))
            If Len(newCaption) > 0 Then lbl.Caption = newCaption
        End If
    Next lbl

    If APPLY_UI_GEOMETRY Then
        If ControlExists_Core(frm, "txtAreaMm2") Then frm.Controls("txtAreaMm2").ColumnWidth = 1900
        If ControlExists_Core(frm, "txtNapDeg") Then frm.Controls("txtNapDeg").ColumnWidth = 1800
        If ControlExists_Core(frm, "txtStatus") Then frm.Controls("txtStatus").ColumnWidth = 1800
        If ControlExists_Core(frm, "txtQuality") Then frm.Controls("txtQuality").ColumnWidth = 1900
        If ControlExists_Core(frm, "txtLocationCode") Then frm.Controls("txtLocationCode").ColumnWidth = 1850
    End If

    DoCmd.Close acForm, "SF1_ScrapPieceList", acSaveYes
    If wasOpen Then DoCmd.OpenForm "SF1_ScrapPieceList", acNormal
    Exit Sub
Fail:
    On Error Resume Next
    DoCmd.Close acForm, "SF1_ScrapPieceList", acSaveYes
End Sub

Private Function MapSF1LabelCaption_Core(ByVal oldCaption As String) As String
    Dim s As String
    s = LCase$(Trim$(oldCaption))

    Select Case s
        Case "inv tag", "inventory tag"
            MapSF1LabelCaption_Core = UiText("f1.col.inventoryTag", oldCaption)
        Case "material"
            MapSF1LabelCaption_Core = UiText("f1.col.material", oldCaption)
        Case "status"
            MapSF1LabelCaption_Core = UiText("f1.col.status", oldCaption)
        Case "quality"
            MapSF1LabelCaption_Core = UiText("f1.col.quality", oldCaption)
        Case "location", "storage"
            MapSF1LabelCaption_Core = UiText("f1.col.location", oldCaption)
        Case "area, mm2", "area, mm^2", "area mm2"
            MapSF1LabelCaption_Core = UiText("f1.col.area", oldCaption)
        Case "nap, deg", "nap angle, deg"
            MapSF1LabelCaption_Core = UiText("f1.col.nap", oldCaption)
        Case "updated", "updated at"
            MapSF1LabelCaption_Core = UiText("f1.col.updatedAt", oldCaption)
        Case Else
            MapSF1LabelCaption_Core = ""
    End Select
End Function

Private Sub LocalizeF2CardCaptions_Core()
    On Error GoTo Fail
    Dim frm As Form
    Dim wasOpen As Boolean

    wasOpen = IsFormLoaded_Core("F2_ScrapPieceCard")
    If wasOpen Then DoCmd.Close acForm, "F2_ScrapPieceCard", acSaveYes

    DoCmd.OpenForm "F2_ScrapPieceCard", acDesign
    Set frm = Forms("F2_ScrapPieceCard")

    SafeSetFormCaption_Core frm, UiText("f2.card.caption", "Scrap piece card")
    SafeSetControlCaption_Core frm, "lblFormTitle", UiText("f2.card.title", UiText("f2.card.caption", "Scrap piece card"))

    SafeSetAttachedLabelAny_Core frm, Array("txt_inventoryTag", "inventoryTag"), UiText("f2.card.col.inventoryTag", "Inv. tag")
    SafeSetAttachedLabelAny_Core frm, Array("txt_areaMm2", "areaMm2"), UiText("f2.card.col.areaMm2", "Area, mm2")
    SafeSetAttachedLabelAny_Core frm, Array("txt_bboxWidthMm", "bboxWidthMm"), UiText("f2.card.col.bboxWidthMm", "Bbox width, mm")
    SafeSetAttachedLabelAny_Core frm, Array("txt_bboxHeightMm", "bboxHeightMm"), UiText("f2.card.col.bboxHeightMm", "Bbox height, mm")
    SafeSetAttachedLabelAny_Core frm, Array("txt_maxSpanMm", "maxSpanMm"), UiText("f2.card.col.maxSpanMm", "Max span, mm")
    SafeSetAttachedLabelAny_Core frm, Array("txt_napDirectionDeg", "napDirectionDeg"), UiText("f2.card.col.napDirectionDeg", "Nap, deg")
    SafeSetAttachedLabelAny_Core frm, Array("txt_createdAt", "createdAt"), UiText("f2.card.col.createdAt", "Created")
    SafeSetAttachedLabelAny_Core frm, Array("txt_updatedAt", "updatedAt"), UiText("f2.card.col.updatedAt", "Updated")
    SafeSetAttachedLabelAny_Core frm, Array("txt_note", "note"), UiText("f2.card.col.note", "Note")
    SafeSetAttachedLabelAny_Core frm, Array("cbo_materialId", "materialId"), UiText("f2.card.col.materialId", "Material")
    SafeSetAttachedLabelAny_Core frm, Array("cbo_storageLocationId", "storageLocationId"), UiText("f2.card.col.storageLocationId", "Location")
    SafeSetAttachedLabelAny_Core frm, Array("cbo_scrapQuality", "scrapQuality"), UiText("f2.card.col.scrapQuality", "Quality")
    SafeSetAttachedLabelAny_Core frm, Array("cbo_scrapStatus", "scrapStatus"), UiText("f2.card.col.scrapStatus", "Status")
    SafeSetAttachedLabelAny_Core frm, Array("txtReservedBy", "reservedBy"), UiText("f3.col.reservedBy", "Reserved by")

    SafeSetAttachedLabelAny_Core frm, Array("cboContourPreviewMode", "contourPreviewMode"), UiText("f2.card.preview.mode", "Mode")
    SafeSetAttachedLabelAny_Core frm, Array("txtContourPreviewPath", "contourPreviewPath"), UiText("f2.card.preview.output", "Status / path")
    SafeSetControlCaptionAny_Core frm, Array("cmdOpenContourVisual", "cmdOpenPreview"), UiText("f2.card.preview.btn.open", "Open preview")
    SafeSetControlCaptionAny_Core frm, Array("cmdReserveFromCard"), UiText("f3.btn.reserve", "Reserve scrap piece")
    SafeSetControlCaptionAny_Core frm, Array("cmdReleaseFromCard"), UiText("f3.btn.release", "Release reservation")

    SafeSetCheckLabelAny_Core frm, Array("chkNormalizeNap", "chkNormalizeContour"), UiText("f2.card.preview.normalize", "Normalize nap")
    SafeSetControlCaption_Core frm, "РќР°РґРїРёСЃСЊ34", UiText("f2.card.preview.mode", "Mode")
    SafeSetControlCaption_Core frm, "lblNormalizePiece", UiText("f2.card.preview.normalize", "Normalize nap")
    ReplaceFreeLabelCaption_Core frm, "Mode", UiText("f2.card.preview.mode", "Mode")
    ReplaceFreeLabelCaption_Core frm, "Normalize nap", UiText("f2.card.preview.normalize", "Normalize nap")
    ReplaceFreeLabelCaption_Core frm, "Reservation", UiText("f2.card.section.reservation", "Reservation")
    ReplaceFreeLabelCaption_Core frm, "Contour preview", UiText("f2.card.preview.section", "Contour preview")
    ReplaceFreeLabelCaption_Core frm, "Operations history", UiText("f2.card.section.operations", "Operations history")
    ReplaceFreeLabelCaption_Core frm, "Usage history", UiText("f2.card.section.usage", "Usage history")

    If APPLY_UI_GEOMETRY Then
        ' Keep geometry updates disabled by default.
    End If

    DoCmd.Close acForm, "F2_ScrapPieceCard", acSaveYes
    If wasOpen Then DoCmd.OpenForm "F2_ScrapPieceCard", acNormal
    Exit Sub
Fail:
    On Error Resume Next
    DoCmd.Close acForm, "F2_ScrapPieceCard", acSaveYes
End Sub

Private Function DecodeEscaped(ByVal escaped As String) As String
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

    DecodeEscaped = out
End Function

Private Function IsFormLoaded_Core(ByVal formName As String) As Boolean
    On Error GoTo Fail
    IsFormLoaded_Core = CurrentProject.AllForms(formName).IsLoaded
    Exit Function
Fail:
    IsFormLoaded_Core = False
End Function

Private Sub SafeSetFormCaption_Core(ByVal frm As Form, ByVal captionText As String)
    On Error Resume Next
    frm.Caption = captionText
    On Error GoTo 0
End Sub

Private Sub SafeSetControlCaption_Core(ByVal frm As Form, ByVal controlName As String, ByVal captionText As String)
    On Error Resume Next
    frm.Controls(controlName).Caption = captionText
    On Error GoTo 0
End Sub

Private Sub SafeSetControlCaptionAny_Core(ByVal frm As Form, ByVal controlNames As Variant, ByVal captionText As String)
    Dim i As Long
    For i = LBound(controlNames) To UBound(controlNames)
        If ControlExists_Core(frm, CStr(controlNames(i))) Then
            SafeSetControlCaption_Core frm, CStr(controlNames(i)), captionText
            Exit Sub
        End If
    Next i
End Sub

Private Sub SafeSetAttachedLabel_Core(ByVal frm As Form, ByVal controlName As String, ByVal captionText As String)
    On Error Resume Next
    frm.Controls(controlName).Controls(0).Caption = captionText
    On Error GoTo 0
End Sub

Private Sub SafeSetAttachedLabelWidth_Core(ByVal frm As Form, ByVal controlName As String, ByVal twipsWidth As Long)
    On Error Resume Next
    frm.Controls(controlName).Controls(0).Width = twipsWidth
    On Error GoTo 0
End Sub

Private Sub SafeSetAttachedLabelAny_Core(ByVal frm As Form, ByVal controlNames As Variant, ByVal captionText As String)
    Dim i As Long
    For i = LBound(controlNames) To UBound(controlNames)
        If ControlExists_Core(frm, CStr(controlNames(i))) Then
            SafeSetAttachedLabel_Core frm, CStr(controlNames(i)), captionText
            Exit Sub
        End If
    Next i
End Sub

Private Sub SafeSetCheckLabelAny_Core(ByVal frm As Form, ByVal controlNames As Variant, ByVal captionText As String)
    Dim i As Long
    For i = LBound(controlNames) To UBound(controlNames)
        If ControlExists_Core(frm, CStr(controlNames(i))) Then
            On Error Resume Next
            frm.Controls(controlNames(i)).Caption = captionText
            On Error GoTo 0
            Exit Sub
        End If
    Next i
End Sub

Private Function ControlExists_Core(ByVal frm As Form, ByVal controlName As String) As Boolean
    On Error GoTo Fail
    Dim ctl As Control
    Set ctl = frm.Controls(controlName)
    ControlExists_Core = True
    Exit Function
Fail:
    ControlExists_Core = False
End Function

Private Sub ReplaceFreeLabelCaption_Core(ByVal frm As Form, ByVal oldCaption As String, ByVal newCaption As String)
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

Private Sub ExpandFreeLabelWidth_Core(ByVal frm As Form, ByVal captionText As String, ByVal minWidth As Long)
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
