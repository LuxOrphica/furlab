Attribute VB_Name = "W_ReportSetup"
Option Compare Database
Option Explicit

Private Const STD_REPORT_FONT As String = "Segoe UI"
Private Const STD_REPORT_FONT_SIZE As Integer = 9
Private Const REPORT_SETUP_VERSION As String = "RS4-2026-02-15-01"

Public Sub W_CreateStage4Reports(Optional ByVal silent As Boolean = False)
    CreateR1_PickList
    CreateR2_Traceability

    If Not silent Then
        MsgBox "Stage 4 reports created:" & vbCrLf & _
               "- R1_PickList" & vbCrLf & _
               "- R2_Traceability" & vbCrLf & _
               "Version: " & REPORT_SETUP_VERSION, vbInformation, "W report setup"
    End If
End Sub

Public Sub W_OpenR2_Traceability(ByVal layoutRunId As String)
    Dim whereText As String
    whereText = "[layoutRunIdKey]='" & Replace(layoutRunId, "'", "''") & "'"
    DoCmd.OpenReport "R2_Traceability", acViewPreview, , whereText
End Sub

Private Sub CreateR1_PickList()
    Dim rpt As Report
    DeleteReportIfExists "R1_PickList"
    Set rpt = CreateReport
    rpt.Caption = UiText("r1.caption", "R1 Pick List")
    rpt.RecordSource = "Q_R1_PickList"
    rpt.OrderBy = "[locationKey], [inventoryTagKey]"
    rpt.OrderByOn = True

    rpt.Section(acPageHeader).Height = 720
    rpt.Section(acDetail).Height = 300

    AddReportTitle rpt, UiText("r1.title", "Pick list")
    AddReportHeaderLabel rpt, UiText("f1.col.location", "Location"), 300, 380, 1200
    AddReportHeaderLabel rpt, UiText("f1.col.inventoryTag", "Inv tag"), 1600, 380, 1700
    AddReportHeaderLabel rpt, UiText("f1.col.material", "Material"), 3400, 380, 1700
    AddReportHeaderLabel rpt, UiText("f1.col.status", "Status"), 5200, 380, 1700
    AddReportHeaderLabel rpt, UiText("f1.col.quality", "Quality"), 7000, 380, 1300
    AddReportHeaderLabel rpt, UiText("f1.col.area", "Area, mm2"), 8400, 380, 1300
    AddReportHeaderLabel rpt, UiText("f1.col.nap", "Nap, deg"), 9950, 380, 1200

    AddReportText rpt, "txt_locCode", "locationKey", 300, 60, 1200
    AddReportText rpt, "txt_inventoryTag", "inventoryTagKey", 1600, 60, 1700
    AddReportText rpt, "txt_materialName", "materialKey", 3400, 60, 1700
    AddReportText rpt, "txt_scrapStatus", "statusKey", 5200, 60, 1700
    AddReportText rpt, "txt_scrapQuality", "qualityKey", 7000, 60, 1300
    AddReportText rpt, "txt_areaMm2", "areaMm2Key", 8400, 60, 1300, "0"
    AddReportText rpt, "txt_napDeg", "napDegKey", 9950, 60, 1200, "0.0"

    SaveCloseRenameReport rpt.Name, "R1_PickList"
End Sub

Private Sub CreateR2_Traceability()
    Dim rpt As Report
    DeleteReportIfExists "R2_Traceability"
    Set rpt = CreateReport
    rpt.Caption = UiText("r2.caption", "R2 Traceability")
    rpt.RecordSource = "Q_F4_UsageHistory"
    rpt.OrderBy = "[layoutRunIdKey], [fragmentIdKey]"
    rpt.OrderByOn = True

    rpt.Section(acPageHeader).Height = 720
    rpt.Section(acDetail).Height = 300

    AddReportTitle rpt, UiText("r2.title", "Traceability")
    AddReportHeaderLabel rpt, UiText("f4.col.inventoryTag", "Inv tag"), 300, 380, 1500
    AddReportHeaderLabel rpt, UiText("f4.col.layoutRunId", "Layout run"), 1900, 380, 2100
    AddReportHeaderLabel rpt, UiText("f4.col.fragmentId", "Fragment"), 4100, 380, 2100
    AddReportHeaderLabel rpt, UiText("f4.col.rotationDeg", "Rotation, deg"), 6300, 380, 1300
    AddReportHeaderLabel rpt, UiText("f4.col.offsetXmm", "Offset X, mm"), 7900, 380, 1650
    AddReportHeaderLabel rpt, UiText("f4.col.offsetYmm", "Offset Y, mm"), 9800, 380, 1650

    AddReportText rpt, "txt_inventoryTag", "inventoryTagKey", 300, 60, 1500
    AddReportText rpt, "txt_layoutRunId", "layoutRunIdKey", 1900, 60, 2100
    AddReportText rpt, "txt_fragmentId", "fragmentIdKey", 4100, 60, 2100
    AddReportText rpt, "txt_rotationDeg", "rotationDegKey", 6300, 60, 1300, "0.0"
    AddReportText rpt, "txt_offsetXmm", "offsetXmmKey", 7900, 60, 1650, "0.0"
    AddReportText rpt, "txt_offsetYmm", "offsetYmmKey", 9800, 60, 1650, "0.0"

    SaveCloseRenameReport rpt.Name, "R2_Traceability"
End Sub

Private Sub AddReportTitle(ByVal rpt As Report, ByVal titleText As String)
    Dim lbl As Control
    Set lbl = CreateReportControl(rpt.Name, acLabel, acPageHeader, "", titleText, 300, 60, 6000, 300)
    lbl.Caption = titleText
    lbl.FontName = STD_REPORT_FONT
    lbl.FontSize = STD_REPORT_FONT_SIZE + 1
    lbl.FontBold = True
End Sub

Private Sub AddReportHeaderLabel(ByVal rpt As Report, ByVal captionText As String, ByVal leftPos As Long, ByVal topPos As Long, ByVal widthVal As Long)
    Dim lbl As Control
    Set lbl = CreateReportControl(rpt.Name, acLabel, acPageHeader, "", captionText, leftPos, topPos, widthVal, 220)
    lbl.Caption = captionText
    lbl.FontName = STD_REPORT_FONT
    lbl.FontSize = STD_REPORT_FONT_SIZE
    lbl.FontBold = True
End Sub

Private Sub AddReportText(ByVal rpt As Report, ByVal controlName As String, ByVal fieldName As String, ByVal leftPos As Long, ByVal topPos As Long, ByVal widthVal As Long, Optional ByVal formatText As String = "")
    Dim ctl As Control
    Set ctl = CreateReportControl(rpt.Name, acTextBox, acDetail, "", "", leftPos, topPos, widthVal, 260)
    ctl.Name = controlName
    ctl.ControlSource = "[" & fieldName & "]"
    ctl.FontName = STD_REPORT_FONT
    ctl.FontSize = STD_REPORT_FONT_SIZE
    If Len(formatText) > 0 Then ctl.Format = formatText
End Sub

Private Function ReportFieldAlias(ByVal captionKey As String, ByVal fallbackText As String) As String
    ReportFieldAlias = W_SafeSqlAlias_FurLab(UiText(captionKey, fallbackText), fallbackText)
End Function

Private Sub DeleteReportIfExists(ByVal reportName As String)
    On Error Resume Next
    DoCmd.Close acReport, reportName, acSaveNo
    Err.Clear
    DoCmd.DeleteObject acReport, reportName
    Err.Clear
    On Error GoTo 0
End Sub

Private Sub SaveCloseRenameReport(ByVal tempReportName As String, ByVal targetReportName As String)
    DoCmd.Save acReport, tempReportName
    DoCmd.Close acReport, tempReportName, acSaveYes
    On Error Resume Next
    DoCmd.DeleteObject acReport, targetReportName
    Err.Clear
    On Error GoTo 0
    DoCmd.Rename targetReportName, acReport, tempReportName
End Sub
